import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
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

/** null clears; anything else must be a well-formed schedule (≤ 7 windows). */
export function parseAvailabilitySchedule(v: unknown): AvailabilitySchedule | null {
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) bad('availabilitySchedule must be an object');
  const o = v as Record<string, unknown>;
  const outside = o.outside === undefined ? 'unavailable' : o.outside;
  if (outside !== 'unavailable' && outside !== 'hidden')
    bad('outside must be unavailable or hidden', 'availabilitySchedule.outside');
  if (!Array.isArray(o.windows) || o.windows.length < 1 || o.windows.length > 7)
    bad('a schedule has 1–7 windows', 'availabilitySchedule.windows');
  const windows = o.windows.map((w, i): AvailabilityWindow => {
    const field = `availabilitySchedule.windows[${i}]`;
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
  return { windows, outside };
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** local weekday + 'HH:MM' in the store's timezone */
function localClock(now: Date, tz: string): { day: number; hhmm: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return localClock(now, 'America/Sao_Paulo');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: WEEKDAY[get('weekday')] ?? 0, hhmm: `${get('hour')}:${get('minute')}` };
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
}

export interface CategoryWithProducts {
  id: string;
  slug: string;
  name: string;
  sort: number;
  products: ProductSummary[];
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  status: 'active' | 'sold_out';
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
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
  sort: number;
}

interface ProductRow {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price_cents: number;
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
}

/** Live availability — stock 0 is sold out without anyone flipping a status. */
export const liveStatus = (status: string, stock: number | null) =>
  status === 'active' && stock === 0 ? 'sold_out' : status;

/** Outside its schedule a product reads sold out (with the label) — or, 'hidden', unlisted. */
function scheduled(row: ProductRow, now: Date, tz: string) {
  const s = row.availability_schedule;
  if (!s || scheduleOpen(s, now, tz)) return null;
  return { label: availabilityLabel(s), hidden: s.outside === 'hidden' };
}

function toSummary(row: ProductRow, now: Date, tz: string): ProductSummary {
  const stock = row.stock_quantity;
  const off = scheduled(row, now, tz);
  const status = liveStatus(row.status, stock) as ProductSummary['status'];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePriceCents: row.base_price_cents,
    status: off && status === 'active' ? 'sold_out' : status,
    figureVariant: row.figure_variant,
    tags: row.tags ?? [],
    kind: row.kind ?? 'simple',
    imageUrl: row.image_url,
    stockQuantity: stock,
    lowStockThreshold: row.low_stock_threshold,
    lowStock:
      stock != null &&
      stock > 0 &&
      row.low_stock_threshold != null &&
      stock <= row.low_stock_threshold,
    requiresPreorder: row.requires_preorder,
    preorderLeadDays: row.preorder_lead_days,
    needsChoices: row.needs_choices,
    ...(off && status === 'active' ? { availabilityLabel: off.label } : {}),
  };
}

const productColumns = (tx: Sql) => tx`
  p.id, p.category_id, p.slug, p.name, p.description, p.base_price_cents, p.status, p.figure_variant,
  p.tags, p.kind, p.stock_quantity, p.low_stock_threshold, p.requires_preorder, p.preorder_lead_days,
  p.availability_schedule,
  (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url,
  (p.kind = 'combo' or exists (select 1 from modifier_groups g where g.product_id = p.id)) as needs_choices
`;

export async function getCatalog(
  tx: Sql,
  tenantId: string,
  now = new Date(),
): Promise<CategoryWithProducts[]> {
  const categories = await tx<CategoryRow[]>`
    select id, slug, name, sort from categories
    where tenant_id = ${tenantId} order by sort, name
  `;
  const products = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p
    where p.tenant_id = ${tenantId} and p.status != 'archived'
    order by p.name
  `;
  const tz = await storeTimezone(tx, tenantId);
  const listed = products.filter((p) => !scheduled(p, now, tz)?.hidden);
  return categories.map((cat) => ({
    id: cat.id,
    slug: cat.slug,
    name: cat.name,
    sort: cat.sort,
    products: listed.filter((p) => p.category_id === cat.id).map((p) => toSummary(p, now, tz)),
  }));
}

export async function getProduct(
  tx: Sql,
  tenantId: string,
  slug: string,
): Promise<ProductDetail | null> {
  const rows = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p where p.tenant_id = ${tenantId} and p.slug = ${slug} and p.status != 'archived'
    limit 1
  `;
  return attachDetail(tx, tenantId, rows, { hideScheduled: true });
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

async function attachDetail(
  tx: Sql,
  tenantId: string,
  rows: ProductRow[],
  opts: { forUpdate?: boolean; hideScheduled?: boolean } = {},
): Promise<ProductDetail | null> {
  const product = rows[0];
  if (!product) return null;
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const groups = await tx<
    {
      id: string;
      name: string;
      required: boolean;
      min_select: number;
      max_select: number;
      sort: number;
    }[]
  >`
    select id, name, required, min_select, max_select, sort from modifier_groups
    where tenant_id = ${tenantId} and product_id = ${product.id} order by sort, name ${lock}
  `;
  const modifiers = await tx<
    {
      id: string;
      group_id: string;
      name: string;
      price_delta_cents: number;
      status: 'active' | 'sold_out';
      sort: number;
    }[]
  >`
    select m.id, m.group_id, m.name, m.price_delta_cents, m.status, m.sort
    from modifiers m join modifier_groups g on g.id = m.group_id
    where m.tenant_id = ${tenantId} and g.product_id = ${product.id}
    order by m.sort, m.name ${lock}
  `;
  const gallery = await tx<MediaItem[]>`
    select url, alt, width, height from product_media
    where tenant_id = ${tenantId} and product_id = ${product.id} order by sort, id
  `;
  // a 'hidden' product still opens from a shared link: it reads sold out with its label
  const summary = toSummary(product, new Date(), await storeTimezone(tx, tenantId));
  const waitlistCount =
    summary.status === 'sold_out'
      ? (
          await tx<{ n: number }[]>`
            select count(*)::int as n from notify_requests
            where tenant_id = ${tenantId} and subject = 'product' and product_id = ${product.id}
              and notified_at is null
          `
        )[0]!.n
      : 0;
  return {
    ...summary,
    modifierGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      modifiers: modifiers
        .filter((m) => m.group_id === g.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          priceDeltaCents: m.price_delta_cents,
          status: m.status,
        })),
    })),
    gallery: [...gallery],
    comboSlots:
      product.kind === 'combo'
        ? await loadComboSlots(tx, tenantId, product.id, {
            ...(opts.hideScheduled ? { hideScheduled: true } : {}),
          })
        : [],
    waitlistCount,
  };
}

export async function loadComboSlots(
  tx: Sql,
  tenantId: string,
  productId: string,
  /** the shopper's product page drops picks whose schedule says 'hidden'; validation keeps
   *  them (sold out + label) so a stale pick gets SOLD_OUT/schedule, not "unknown item" */
  opts: { hideScheduled?: boolean } = {},
): Promise<ComboSlot[]> {
  const slots = await tx<
    { id: string; name: string; min_select: number; max_select: number; qty_per_item: number }[]
  >`
    select id, name, min_select, max_select, qty_per_item from combo_slots
    where tenant_id = ${tenantId} and product_id = ${productId} order by sort, name
  `;
  if (slots.length === 0) return [];
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
    where i.tenant_id = ${tenantId} and s.product_id = ${productId} and p.status != 'archived'
    order by i.sort, p.name
  `;
  const now = new Date();
  const tz = items.some((i) => i.availability_schedule)
    ? await storeTimezone(tx, tenantId)
    : 'America/Sao_Paulo';
  const off = (i: (typeof items)[number]) =>
    i.availability_schedule && !scheduleOpen(i.availability_schedule, now, tz)
      ? i.availability_schedule
      : null;
  return slots.map((s) => ({
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
  }));
}
