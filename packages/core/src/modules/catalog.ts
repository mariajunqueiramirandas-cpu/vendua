import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { localParts, type LocalParts } from '../platform/tz.ts';
import { fromPriceCents } from './cart.ts';
import type { ComboSlot, ComboSlotItem } from './combos.ts';

/** a kit pick outside its own schedule reads sold out and carries the label */
export type ScheduledComboSlotItem = ComboSlotItem & { availabilityLabel?: string };

// ── scheduled availability ("só aos sábados, 9h–13h") ───────────────────────

export interface AvailabilityWindow {
  /** 0 = domingo … 6 = sábado, in the store's timezone */
  days: number[];
  /** both or neither; neither = the whole day */
  from?: string;
  to?: string;
}

export interface AvailabilitySchedule {
  windows: AvailabilityWindow[];
  /** outside every window: listed as sold out, or not listed at all */
  outside: 'unavailable' | 'hidden';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function bad(message: string, field = 'availabilitySchedule'): never {
  throw new HttpError(422, 'BAD_REQUEST', message, { field });
}

/** 1–7 well-formed windows; `at` names the field in errors. */
function parseWindows(v: unknown, at: string): AvailabilityWindow[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) bad('a schedule has 1–7 windows', at);
  return v.map((w, i): AvailabilityWindow => {
    const field = `${at}[${i}]`;
    if (typeof w !== 'object' || w === null || Array.isArray(w))
      bad('each window is an object', field);
    const x = w as Record<string, unknown>;
    const days = x.days;
    if (
      !Array.isArray(days) ||
      days.length < 1 ||
      days.length > 7 ||
      days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6) ||
      new Set(days).size !== days.length
    )
      bad('days are distinct weekdays 0–6', `${field}.days`);
    const out: AvailabilityWindow = { days: [...(days as number[])].sort((a, b) => a - b) };
    if (x.from === undefined && x.to === undefined) return out;
    if (
      typeof x.from !== 'string' ||
      typeof x.to !== 'string' ||
      !HHMM.test(x.from) ||
      !HHMM.test(x.to)
    )
      bad('from and to look like 09:00, both or neither', field);
    if (x.from >= x.to) bad('from must be before to', field);
    out.from = x.from;
    out.to = x.to;
    return out;
  });
}

/** null clears; anything else must be a well-formed schedule (≤ 7 windows). */
export function parseAvailabilitySchedule(v: unknown): AvailabilitySchedule | null {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) bad('availabilitySchedule must be an object');
  const o = v as Record<string, unknown>;
  const outside = o.outside === undefined ? 'unavailable' : o.outside;
  if (outside !== 'unavailable' && outside !== 'hidden')
    bad('outside must be unavailable or hidden', 'availabilitySchedule.outside');
  return { windows: parseWindows(o.windows, 'availabilitySchedule.windows'), outside };
}

// ── timed promotions ("seg a sex, 18h–20h, por R$ 29,90") ──────────────────

export interface PromoSchedule {
  /** the price inside the windows; it applies only while below the regular price */
  priceCents: number;
  windows: AvailabilityWindow[];
}

/** null clears; a price and 1–7 windows otherwise. The route checks it against the price. */
export function parsePromoSchedule(v: unknown, maxPrice: number): PromoSchedule | null {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v))
    bad('promoSchedule must be an object', 'promoSchedule');
  const o = v as Record<string, unknown>;
  const price = o.priceCents;
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > maxPrice)
    bad('priceCents is a whole number of cents', 'promoSchedule.priceCents');
  return { priceCents: price, windows: parseWindows(o.windows, 'promoSchedule.windows') };
}

/** local weekday + 'HH:MM' in the store's timezone */
function localClock(now: Date, tz: string): { day: number; hhmm: string } {
  let p: LocalParts;
  try {
    p = localParts(now, tz);
  } catch {
    return localClock(now, 'America/Sao_Paulo');
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: p.weekday, hhmm: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function scheduleOpen(
  s: AvailabilitySchedule | null | undefined,
  now: Date,
  tz: string,
): boolean {
  if (!s || !Array.isArray(s.windows)) return true;
  const { day, hhmm } = localClock(now, tz);
  return s.windows.some(
    (w) =>
      Array.isArray(w.days) &&
      w.days.includes(day) &&
      (!w.from || !w.to || (hhmm >= w.from && hhmm < w.to)),
  );
}

const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAY_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];

const hour = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
};

function daysLabel(days: number[], alone: boolean): string {
  if (days.length === 7) return 'todos os dias';
  if (days.length === 1) return alone ? `só ${DAY_PLURAL[days[0]!]}` : DAY_SHORT[days[0]!]!;
  const run = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  if (run && days.length >= 3) return `${DAY_SHORT[days[0]!]} a ${DAY_SHORT[days.at(-1)!]}`;
  const names = days.map((d) => DAY_SHORT[d]!);
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/** pt-BR, e.g. "Só sábados, 9h–13h" or "Seg a sex, 11h–15h · Sáb, 9h–13h" */
export function availabilityLabel(s: AvailabilitySchedule): string {
  const alone = s.windows.length === 1;
  const text = s.windows
    .map((w) => {
      const days = daysLabel(w.days, alone);
      return w.from && w.to ? `${days}, ${hour(w.from)}–${hour(w.to)}` : days;
    })
    .join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function storeTimezone(tx: Sql, tenantId: string): Promise<string> {
  const row = (
    await tx<{ tz: string | null }[]>`
      select hours ->> 'timezone' as tz from store_settings where tenant_id = ${tenantId}
    `
  )[0];
  return row?.tz || 'America/Sao_Paulo';
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  /** display-only "de" price (strike-through), always above basePriceCents; null = no promo */
  compareAtPriceCents: number | null;
  /** display-only "a partir de": the cheapest configured unit, when above basePriceCents */
  fromPriceCents: number | null;
  /** when the product has a timed promotion: its days and hours ("Seg a sex, 18h–20h") */
  promoLabel?: string;
  /** stock-derived: an active product with stockQuantity 0 reads 'sold_out' */
  status: 'active' | 'sold_out' | 'archived';
  figureVariant: 'default' | 'alt';
  tags: string[];
  kind: 'simple' | 'combo';
  /** first gallery image; null = none (figureVariant fallback) */
  imageUrl: string | null;
  /** null = stock not tracked */
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  /** Core's call: tracked, >0 and at/below the threshold */
  lowStock: boolean;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  /** a combo, or a product with modifier groups: the card must open the product page */
  needsChoices: boolean;
  /** set only while outside its availability schedule (status then reads 'sold_out') */
  availabilityLabel?: string;
  /** what the merchant states about allergens and diets (DIETARY_TAGS); [] = nothing stated */
  dietary: string[];
}

export interface CategoryWithProducts {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort: number;
  products: ProductSummary[];
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  status: 'active' | 'sold_out';
  /** units of this option one item can take; 1 = a toggle */
  maxQty: number;
  description: string | null;
  imageUrl: string | null;
}

/** how a group's picks add to the unit price — Core computes it, clients never do */
export type PricingRule = 'sum' | 'average' | 'most_expensive';

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  /** min/max count option units (Σ qty), not distinct options */
  minSelect: number;
  maxSelect: number;
  pricingRule: PricingRule;
  modifiers: Modifier[];
}

export interface MediaItem {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductDetail extends ProductSummary {
  modifierGroups: ModifierGroup[];
  gallery: MediaItem[];
  /** kind 'combo' only; [] otherwise */
  comboSlots: ComboSlot[];
  /** people waiting for a restock (sold-out products; social proof) */
  waitlistCount: number;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort: number;
}

interface ProductRow {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  compare_at_price_cents: number | null;
  status: ProductSummary['status'];
  figure_variant: ProductSummary['figureVariant'];
  tags: string[];
  kind: ProductSummary['kind'];
  image_url: string | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  requires_preorder: boolean;
  preorder_lead_days: number;
  needs_choices: boolean;
  availability_schedule: AvailabilitySchedule | null;
  promo_schedule: PromoSchedule | null;
  dietary: string[] | null;
}

/** the tags products.dietary may hold (migration 0082's CHECK) */
export const DIETARY_TAGS = [
  'sem_gluten',
  'contem_gluten',
  'sem_lactose',
  'contem_lactose',
  'vegano',
  'vegetariano',
  'contem_amendoim',
  'contem_castanhas',
  'contem_ovo',
  'contem_frutos_do_mar',
  'apimentado',
] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

/** an admin write's `dietary`: known tags only (422 otherwise), deduplicated, in list order */
export function parseDietary(v: unknown): DietaryTag[] {
  if (!Array.isArray(v) || v.length > DIETARY_TAGS.length * 2)
    throw new HttpError(422, 'BAD_REQUEST', 'dietary must be a list of tags', { field: 'dietary' });
  for (const tag of v)
    if (!DIETARY_TAGS.includes(tag as DietaryTag))
      throw new HttpError(422, 'BAD_REQUEST', `unknown dietary tag`, {
        field: 'dietary',
        allowed: DIETARY_TAGS,
      });
  return DIETARY_TAGS.filter((t) => v.includes(t));
}

/** Live availability — stock 0 is sold out without anyone flipping a status. */
export const liveStatus = (status: string, stock: number | null) =>
  status === 'active' && stock === 0 ? 'sold_out' : status;

/** Core's low-stock call: tracked, above zero and at/below the threshold. */
export const isLowStock = (stock: number | null, threshold: number | null) =>
  stock != null && stock > 0 && threshold != null && stock <= threshold;

/** Outside its schedule a product reads sold out (with the label) — or, 'hidden', unlisted. */
function scheduled(row: ProductRow, now: Date, tz: string) {
  const s = row.availability_schedule;
  if (!s || scheduleOpen(s, now, tz)) return null;
  return { label: availabilityLabel(s), hidden: s.outside === 'hidden' };
}

/** A timed promotion that can apply: its price is below the regular one and it has windows. */
/** A stored window read back defensively: a malformed one never reaches the clock math. */
const goodWindow = (w: unknown): w is AvailabilityWindow => {
  if (typeof w !== 'object' || w === null) return false;
  const x = w as Record<string, unknown>;
  const days = x.days;
  if (
    !Array.isArray(days) ||
    !days.length ||
    days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)
  )
    return false;
  if (x.from === undefined && x.to === undefined) return true;
  return (
    typeof x.from === 'string' &&
    typeof x.to === 'string' &&
    HHMM.test(x.from) &&
    HHMM.test(x.to) &&
    x.from < x.to
  );
};

function promoOf(row: ProductRow): PromoSchedule | null {
  const p = row.promo_schedule;
  if (
    !p ||
    !Number.isInteger(p.priceCents) ||
    p.priceCents < 0 ||
    p.priceCents >= row.base_price_cents ||
    !Array.isArray(p.windows)
  )
    return null;
  const windows = p.windows.filter(goodWindow);
  return windows.length ? { priceCents: p.priceCents, windows } : null;
}

/**
 * The price a shopper pays now — inside a promotion's window its price, the regular one struck
 * through. Cart lines, checkout's reprice and the order all read it from here.
 */
function priceNow(row: ProductRow, now: Date, tz: string) {
  const promo = promoOf(row);
  if (!promo || !scheduleOpen({ windows: promo.windows, outside: 'unavailable' }, now, tz))
    return { base: row.base_price_cents, compareAt: row.compare_at_price_cents };
  return {
    base: promo.priceCents,
    compareAt: Math.max(row.compare_at_price_cents ?? 0, row.base_price_cents),
  };
}

function toSummary(
  row: ProductRow,
  now: Date,
  tz: string,
  groups: readonly ModifierGroup[] = [],
  /** a kit's slots — its from-price takes the cheapest valid picks */
  slots: readonly ComboSlot[] = [],
): ProductSummary {
  const stock = row.stock_quantity;
  const off = scheduled(row, now, tz);
  const status = liveStatus(row.status, stock) as ProductSummary['status'];
  const price = priceNow(row, now, tz);
  const promo = promoOf(row);
  const from = fromPriceCents(price.base, groups, row.kind === 'combo' ? slots : []);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePriceCents: price.base,
    compareAtPriceCents: price.compareAt,
    fromPriceCents: from !== null && from > price.base ? from : null,
    ...(promo
      ? { promoLabel: availabilityLabel({ windows: promo.windows, outside: 'unavailable' }) }
      : {}),
    status: off && status === 'active' ? 'sold_out' : status,
    figureVariant: row.figure_variant,
    tags: row.tags ?? [],
    kind: row.kind ?? 'simple',
    imageUrl: row.image_url,
    stockQuantity: stock,
    lowStockThreshold: row.low_stock_threshold,
    lowStock: isLowStock(stock, row.low_stock_threshold),
    requiresPreorder: row.requires_preorder,
    preorderLeadDays: row.preorder_lead_days,
    needsChoices: row.needs_choices,
    ...(off && status === 'active' ? { availabilityLabel: off.label } : {}),
    dietary: row.dietary ?? [],
  };
}

const productColumns = (tx: Sql) => tx`
  p.id, p.category_id, p.slug, p.name, p.description, p.base_price_cents, p.compare_at_price_cents,
  p.status, p.figure_variant,
  p.tags, p.kind, p.stock_quantity, p.low_stock_threshold, p.requires_preorder, p.preorder_lead_days,
  p.availability_schedule, p.promo_schedule, p.dietary,
  (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url,
  (p.kind = 'combo' or exists (select 1 from modifier_groups g where g.product_id = p.id)) as needs_choices
`;

/** When the next window in these schedules opens or closes (store time); null when none. */
export function nextChangeAt(
  schedules: readonly (readonly AvailabilityWindow[] | undefined)[],
  now: Date,
  tz: string,
): Date | null {
  const { day, hhmm } = localClock(now, tz);
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const at = minutes(hhmm);
  let best = Infinity;
  for (const windows of schedules)
    for (const w of windows ?? []) {
      if (!goodWindow(w)) continue;
      for (const d of w.days)
        for (const mark of w.from && w.to ? [minutes(w.from), minutes(w.to)] : [0, 1440]) {
          let ahead = ((d - day + 7) % 7) * 1440 + mark - at;
          if (ahead <= 0) ahead += 7 * 1440;
          best = Math.min(best, ahead);
        }
    }
  if (!Number.isFinite(best)) return null;
  const guess = Math.floor(now.getTime() / 60_000) * 60_000 + best * 60_000;
  // that was wall-clock minutes; a daylight-saving change in between moves the instant
  const target = (day * 1440 + at + best) % (7 * 1440);
  const there = localClock(new Date(guess), tz);
  let drift = target - (there.day * 1440 + minutes(there.hhmm));
  if (drift > 3.5 * 1440) drift -= 7 * 1440;
  if (drift < -3.5 * 1440) drift += 7 * 1440;
  return new Date(guess + drift * 60_000);
}

export async function getCatalog(
  tx: Sql,
  tenantId: string,
  now = new Date(),
): Promise<CategoryWithProducts[]> {
  return (await getCatalogView(tx, tenantId, now)).categories;
}

/**
 * The storefront's catalog, and when it next changes by itself (a promotion or a product's
 * hours starting or ending), so an open page knows to fetch it again.
 */
export async function getCatalogView(
  tx: Sql,
  tenantId: string,
  now = new Date(),
): Promise<{ categories: CategoryWithProducts[]; nextChangeAt: Date | null }> {
  // independent reads go out together — postgres.js pipelines them on the tx's connection
  const [categories, products, tz] = await Promise.all([
    tx<CategoryRow[]>`
      select id, slug, name, description, sort from categories
      where tenant_id = ${tenantId} order by sort, name
    `,
    tx<ProductRow[]>`
      select ${productColumns(tx)}
      from products p
      where p.tenant_id = ${tenantId} and p.status != 'archived'
      order by p.name
    `,
    storeTimezone(tx, tenantId),
  ]);
  const listed = products.filter((p) => !scheduled(p, now, tz)?.hidden);
  // "a partir de" needs each listed product's lists and each kit's slots
  const [groups, slots] = await Promise.all([
    loadGroups(
      tx,
      tenantId,
      listed.filter((p) => p.needs_choices).map((p) => p.id),
    ),
    loadComboSlotsFor(
      tx,
      tenantId,
      listed.filter((p) => p.kind === 'combo').map((p) => p.id),
      { now },
    ),
  ]);
  return {
    categories: categories.map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      sort: cat.sort,
      products: listed
        .filter((p) => p.category_id === cat.id)
        .map((p) => toSummary(p, now, tz, groups.get(p.id), slots.get(p.id))),
    })),
    nextChangeAt: nextChangeAt(
      products.flatMap((p) => [p.availability_schedule?.windows, promoOf(p)?.windows]),
      now,
      tz,
    ),
  };
}

/** Each product's option groups with their options, in display order. */
async function loadGroups(
  tx: Sql,
  tenantId: string,
  ids: readonly string[],
  opts: { forUpdate?: boolean } = {},
): Promise<Map<string, ModifierGroup[]>> {
  const out = new Map<string, ModifierGroup[]>();
  if (ids.length === 0) return out;
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const [groups, modifiers] = await Promise.all([
    tx<
      {
        id: string;
        product_id: string;
        name: string;
        required: boolean;
        min_select: number;
        max_select: number;
        pricing_rule: PricingRule;
        sort: number;
      }[]
    >`
      select id, product_id, name, required, min_select, max_select, pricing_rule, sort from modifier_groups
      where tenant_id = ${tenantId} and product_id = any(${ids as string[]}::uuid[])
      order by product_id, sort, name ${lock}
    `,
    tx<
      {
        id: string;
        group_id: string;
        name: string;
        price_delta_cents: number;
        status: 'active' | 'sold_out';
        max_qty: number;
        description: string | null;
        image_url: string | null;
        sort: number;
      }[]
    >`
      select m.id, m.group_id, m.name, m.price_delta_cents, m.status, m.max_qty, m.description,
             m.image_url, m.sort
      from modifiers m join modifier_groups g on g.id = m.group_id
      where m.tenant_id = ${tenantId} and g.product_id = any(${ids as string[]}::uuid[])
      order by g.product_id, m.sort, m.name ${lock}
    `,
  ]);
  const byGroup = new Map<string, Modifier[]>();
  for (const m of modifiers) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push({
      id: m.id,
      name: m.name,
      priceDeltaCents: m.price_delta_cents,
      status: m.status,
      maxQty: m.max_qty,
      description: m.description,
      imageUrl: m.image_url,
    });
    byGroup.set(m.group_id, list);
  }
  for (const g of groups) {
    const list = out.get(g.product_id) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      required: g.required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      pricingRule: g.pricing_rule,
      modifiers: byGroup.get(g.id) ?? [],
    });
    out.set(g.product_id, list);
  }
  return out;
}

export async function getProduct(
  tx: Sql,
  tenantId: string,
  slug: string,
  /** the shopper's page hides 'hidden' kit picks; a line quote keeps them, like add-to-cart */
  opts: { hideScheduled?: boolean } = { hideScheduled: true },
): Promise<ProductDetail | null> {
  const rows = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p where p.tenant_id = ${tenantId} and p.slug = ${slug} and p.status != 'archived'
    limit 1
  `;
  return attachDetail(tx, tenantId, rows, opts);
}

export async function getProductById(
  tx: Sql,
  tenantId: string,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ProductDetail | null> {
  const lock = opts.forUpdate ? tx`for update of p` : tx``;
  const rows = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p where p.tenant_id = ${tenantId} and p.id = ${id} and p.status != 'archived'
    limit 1 ${lock}
  `;
  return attachDetail(tx, tenantId, rows, opts);
}

/** Several products by id, each with its full detail — checkout loads its lines in one pass. */
export async function getProductsById(
  tx: Sql,
  tenantId: string,
  ids: readonly string[],
  opts: { forUpdate?: boolean } = {},
): Promise<Map<string, ProductDetail>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  // id order: two locking passes over the same products always take their rows in one order
  const lock = opts.forUpdate ? tx`for update of p` : tx``;
  const rows = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p
    where p.tenant_id = ${tenantId} and p.id = any(${unique}::uuid[]) and p.status != 'archived'
    order by p.id ${lock}
  `;
  return attachDetails(tx, tenantId, rows, opts);
}

async function attachDetail(
  tx: Sql,
  tenantId: string,
  rows: ProductRow[],
  opts: { forUpdate?: boolean; hideScheduled?: boolean } = {},
): Promise<ProductDetail | null> {
  const product = rows[0];
  if (!product) return null;
  return (await attachDetails(tx, tenantId, [product], opts)).get(product.id) ?? null;
}

async function attachDetails(
  tx: Sql,
  tenantId: string,
  rows: ProductRow[],
  opts: { forUpdate?: boolean; hideScheduled?: boolean } = {},
): Promise<Map<string, ProductDetail>> {
  const out = new Map<string, ProductDetail>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const [groups, gallery, tz, comboSlots] = await Promise.all([
    loadGroups(tx, tenantId, ids, opts),
    tx<(MediaItem & { product_id: string })[]>`
      select product_id, url, alt, width, height from product_media
      where tenant_id = ${tenantId} and product_id = any(${ids}::uuid[])
      order by product_id, sort, id
    `,
    storeTimezone(tx, tenantId),
    loadComboSlotsFor(
      tx,
      tenantId,
      rows.filter((r) => r.kind === 'combo').map((r) => r.id),
      opts.hideScheduled ? { hideScheduled: true } : {},
    ),
  ]);
  // a 'hidden' product still opens from a shared link: it reads sold out with its label
  const now = new Date();
  const summaries = new Map(
    rows.map((r) => [r.id, toSummary(r, now, tz, groups.get(r.id), comboSlots.get(r.id))]),
  );
  const soldOut = rows.filter((r) => summaries.get(r.id)!.status === 'sold_out').map((r) => r.id);
  const waiting = soldOut.length
    ? await tx<{ product_id: string; n: number }[]>`
        select product_id, count(*)::int as n from notify_requests
        where tenant_id = ${tenantId} and subject = 'product' and product_id = any(${soldOut}::uuid[])
          and notified_at is null
        group by product_id
      `
    : [];
  const waitlist = new Map(waiting.map((w) => [w.product_id, w.n]));
  for (const product of rows) {
    out.set(product.id, {
      ...summaries.get(product.id)!,
      modifierGroups: groups.get(product.id) ?? [],
      gallery: gallery
        .filter((m) => m.product_id === product.id)
        .map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height })),
      comboSlots: comboSlots.get(product.id) ?? [],
      waitlistCount: waitlist.get(product.id) ?? 0,
    });
  }
  return out;
}

export async function loadComboSlots(
  tx: Sql,
  tenantId: string,
  productId: string,
  /** the shopper's product page drops picks whose schedule says 'hidden'; validation keeps
   *  them (sold out + label) so a stale pick gets SOLD_OUT/schedule, not "unknown item" */
  opts: { hideScheduled?: boolean } = {},
): Promise<ComboSlot[]> {
  return (await loadComboSlotsFor(tx, tenantId, [productId], opts)).get(productId) ?? [];
}

/** Several kits' slots in two queries — the catalog's from-prices need every listed kit's. */
export async function loadComboSlotsFor(
  tx: Sql,
  tenantId: string,
  productIds: readonly string[],
  opts: { hideScheduled?: boolean; now?: Date } = {},
): Promise<Map<string, ComboSlot[]>> {
  const out = new Map<string, ComboSlot[]>();
  if (productIds.length === 0) return out;
  const slots = await tx<
    {
      id: string;
      product_id: string;
      name: string;
      min_select: number;
      max_select: number;
      qty_per_item: number;
    }[]
  >`
    select id, product_id, name, min_select, max_select, qty_per_item from combo_slots
    where tenant_id = ${tenantId} and product_id = any(${productIds as string[]}::uuid[])
    order by sort, name
  `;
  if (slots.length === 0) return out;
  const items = await tx<
    {
      slot_id: string;
      product_id: string;
      slug: string;
      name: string;
      price_delta_cents: number;
      status: string;
      stock_quantity: number | null;
      image_url: string | null;
      availability_schedule: AvailabilitySchedule | null;
    }[]
  >`
    select i.slot_id, p.id as product_id, p.slug, p.name, i.price_delta_cents, p.status, p.stock_quantity,
      p.availability_schedule,
      (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url
    from combo_slot_items i join combo_slots s on s.id = i.slot_id join products p on p.id = i.product_id
    where i.tenant_id = ${tenantId} and s.product_id = any(${productIds as string[]}::uuid[])
      and p.status != 'archived'
    order by i.sort, p.name
  `;
  const now = opts.now ?? new Date();
  const tz = items.some((i) => i.availability_schedule)
    ? await storeTimezone(tx, tenantId)
    : 'America/Sao_Paulo';
  const off = (i: (typeof items)[number]) =>
    i.availability_schedule && !scheduleOpen(i.availability_schedule, now, tz)
      ? i.availability_schedule
      : null;
  for (const s of slots) {
    const list = out.get(s.product_id) ?? [];
    list.push({
      id: s.id,
      name: s.name,
      minSelect: s.min_select,
      maxSelect: s.max_select,
      qtyPerItem: s.qty_per_item,
      items: items
        .filter((i) => i.slot_id === s.id)
        .filter((i) => !(opts.hideScheduled && off(i)?.outside === 'hidden'))
        .map((i): ScheduledComboSlotItem => {
          const status = liveStatus(i.status, i.stock_quantity);
          const sched = status === 'active' ? off(i) : null;
          return {
            productId: i.product_id,
            slug: i.slug,
            name: i.name,
            priceDeltaCents: i.price_delta_cents,
            status: sched ? 'sold_out' : status,
            stockQuantity: i.stock_quantity,
            imageUrl: i.image_url,
            ...(sched ? { availabilityLabel: availabilityLabel(sched) } : {}),
          };
        }),
    });
    out.set(s.product_id, list);
  }
  return out;
}

/** The admin's view of a product's storefront face at `now`. */
export interface StorefrontPreview {
  status: ProductSummary['status'];
  basePriceCents: number;
  compareAtPriceCents: number | null;
  fromPriceCents: number | null;
  promoLabel: string | null;
  availabilityLabel: string | null;
  lowStock: boolean;
  /** the availability schedule in words, whether or not it holds now */
  availabilityScheduleLabel: string | null;
  /** the promotion's days and hours in words, whether or not it applies now */
  promoScheduleLabel: string | null;
}

const scheduleWords = (windows: unknown): string | null => {
  const good = Array.isArray(windows) ? windows.filter(goodWindow) : [];
  return good.length ? availabilityLabel({ windows: good, outside: 'unavailable' }) : null;
};

/**
 * What the storefront shows for one product (archived included) — the same toSummary the
 * catalog reads, so the admin never re-derives a price form, a badge or a schedule's words.
 */
export async function storefrontPreview(
  tx: Sql,
  tenantId: string,
  id: string,
  now = new Date(),
): Promise<StorefrontPreview | null> {
  const row = (
    await tx<ProductRow[]>`
      select ${productColumns(tx)} from products p where p.tenant_id = ${tenantId} and p.id = ${id}
    `
  )[0];
  if (!row) return null;
  const [groups, slots, tz] = await Promise.all([
    loadGroups(tx, tenantId, [id]),
    loadComboSlotsFor(tx, tenantId, row.kind === 'combo' ? [id] : [], { now }),
    storeTimezone(tx, tenantId),
  ]);
  const s = toSummary(row, now, tz, groups.get(id), slots.get(id));
  return {
    status: s.status,
    basePriceCents: s.basePriceCents,
    compareAtPriceCents: s.compareAtPriceCents,
    fromPriceCents: s.fromPriceCents,
    promoLabel: s.promoLabel ?? null,
    availabilityLabel: s.availabilityLabel ?? null,
    lowStock: s.lowStock,
    availabilityScheduleLabel: scheduleWords(row.availability_schedule?.windows),
    promoScheduleLabel: scheduleWords(row.promo_schedule?.windows),
  };
}
