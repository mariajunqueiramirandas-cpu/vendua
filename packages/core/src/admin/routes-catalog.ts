import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, bodyJson, uuidParam } from '../platform/http.ts';
import {
  availabilityLabel,
  isLowStock,
  liveStatus,
  loadComboSlots,
  parseAvailabilitySchedule,
  parseDietary,
  parsePromoSchedule,
  scheduleOpen,
  storefrontPreview,
  storeTimezone,
  type AvailabilitySchedule,
  type PromoSchedule,
} from '../modules/catalog.ts';
import { adjustStock, MAX_STOCK, setStock } from '../modules/stock.ts';
import { saveKitStepsTx } from '../modules/combos.ts';
import { audit } from './audit.ts';
import {
  bool,
  int,
  isObj,
  need,
  oneOf,
  optInt,
  optText,
  slugify,
  text,
  type AdminDeps,
  type Merchant,
} from './context.ts';
import { bodyOf, handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeTz } from './routes-orders.ts';

const MAX_PRICE = 10_000_000;
// options in one group: a pizzeria's flavour list
const MAX_OPTIONS = 100;
const PRICING_RULES = ['sum', 'average', 'most_expensive'] as const;

/** Photo links: https:// or root-relative (an upload's /v1/media/…), never protocol-relative. */
function mediaUrl(v: unknown, field: string): string {
  const url = text(v, field, 1000, 1);
  if (!/^(https:\/\/|\/)/.test(url) || url.startsWith('//'))
    throw new HttpError(422, 'BAD_REQUEST', 'photo links must be https:// or uploaded', { field });
  return url;
}

/** "de" price: null clears; otherwise strictly above the selling price. */
function compareAt(v: unknown, priceCents: number): number | null {
  const cents = optInt(v, 'compareAtPriceCents', 1, MAX_PRICE) ?? null;
  if (cents !== null && cents <= priceCents)
    throw new HttpError(422, 'BAD_REQUEST', 'the "de" price must be above the price', {
      field: 'compareAtPriceCents',
    });
  return cents;
}

export interface AdminProductRow {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** display-only strike-through price; null = no promo */
  compareAtPriceCents: number | null;
  status: 'active' | 'sold_out' | 'archived';
  /** Core's live status: stock 0 reads sold out; archived stays archived */
  liveStatus: 'active' | 'sold_out' | 'archived';
  kind: 'simple' | 'combo';
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  /** Core's low-stock call, the storefront's own */
  lowStock: boolean;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  sort: number;
  soldOutUntil: string | null;
  availabilitySchedule: AvailabilitySchedule | null;
  /** false while outside its schedule */
  availableNow: boolean;
  /** a lower price on some weekdays and hours; null = none */
  promoSchedule: PromoSchedule | null;
  /** true while one of its windows holds */
  promoNow: boolean;
  tags: string[];
  /** allergens and diets the merchant states (DIETARY_TAGS) */
  dietary: string[];
  imageUrl: string | null;
  dominant: string | null;
  mediaCount: number;
  groupCount: number;
  waiting: number;
}

const productCols = (tx: Sql) => tx`
  p.id, p.category_id as "categoryId", p.slug, p.name, p.description, p.base_price_cents as "priceCents",
  p.compare_at_price_cents as "compareAtPriceCents", p.status, p.kind,
  p.stock_quantity as "stockQuantity", p.low_stock_threshold as "lowStockThreshold",
  p.requires_preorder as "requiresPreorder", p.preorder_lead_days as "preorderLeadDays", p.sort,
  p.sold_out_until as "soldOutUntil", p.tags, p.availability_schedule as "availabilitySchedule",
  p.promo_schedule as "promoSchedule", p.dietary,
  (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as "imageUrl",
  (select mo.dominant from product_media m join media_objects mo
     on m.url like '/v1/media/%' and mo.id::text = split_part(split_part(m.url, '/', 5), '.', 1)
   where m.product_id = p.id order by m.sort, m.id limit 1) as dominant,
  (select count(*)::int from product_media m where m.product_id = p.id) as "mediaCount",
  (select count(*)::int from modifier_groups g where g.product_id = p.id) as "groupCount",
  (select count(*)::int from notify_requests n where n.product_id = p.id and n.notified_at is null) as waiting
`;

/** availableNow and promoNow from the schedules, in the store's timezone; Core's stock calls */
async function withNow(tx: Sql, tenantId: string, rows: AdminProductRow[]) {
  const tz = rows.some((r) => r.availabilitySchedule || r.promoSchedule)
    ? await storeTimezone(tx, tenantId)
    : 'America/Sao_Paulo';
  const now = new Date();
  for (const r of rows) {
    r.liveStatus = liveStatus(r.status, r.stockQuantity) as AdminProductRow['liveStatus'];
    r.lowStock = isLowStock(r.stockQuantity, r.lowStockThreshold);
    r.availableNow = scheduleOpen(r.availabilitySchedule, now, tz);
    r.promoNow =
      !!r.promoSchedule &&
      r.promoSchedule.priceCents < r.priceCents &&
      scheduleOpen({ windows: r.promoSchedule.windows, outside: 'unavailable' }, now, tz);
  }
  return rows;
}

async function productRow(tx: Sql, tenantId: string, id: string): Promise<AdminProductRow> {
  const row = (
    await tx<AdminProductRow[]>`
      select ${productCols(tx)} from products p
      where p.tenant_id = ${tenantId} and p.id = ${id} and p.deleted_at is null
    `
  )[0];
  if (!row) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  return (await withNow(tx, tenantId, [row]))[0]!;
}

async function productDetail(tx: Sql, tenantId: string, id: string) {
  // independent reads in one batch; only a kit's slots wait for the product's kind
  const [product, groups, options, gallery, [sales], storefront] = await Promise.all([
    productRow(tx, tenantId, id),
    tx<
      {
        id: string;
        name: string;
        required: boolean;
        min_select: number;
        max_select: number;
        pricing_rule: string;
      }[]
    >`
      select id, name, required, min_select, max_select, pricing_rule from modifier_groups
      where tenant_id = ${tenantId} and product_id = ${id} order by sort, name
    `,
    tx<
      {
        id: string;
        group_id: string;
        name: string;
        price_delta_cents: number;
        status: string;
        max_qty: number;
        description: string | null;
        image_url: string | null;
      }[]
    >`
      select m.id, m.group_id, m.name, m.price_delta_cents, m.status, m.max_qty, m.description,
             m.image_url from modifiers m
        join modifier_groups g on g.id = m.group_id
      where m.tenant_id = ${tenantId} and g.product_id = ${id} order by m.sort, m.name
    `,
    tx`
      select url, alt, width, height from product_media
      where tenant_id = ${tenantId} and product_id = ${id} order by sort, id
    `,
    tx<{ qty: number; revenueCents: number }[]>`
      select coalesce(sum(i.qty), 0)::int as qty, coalesce(sum(i.line_total_cents), 0)::int as "revenueCents"
      from order_items i join orders o on o.id = i.order_id
      where i.tenant_id = ${tenantId} and i.product_id = ${id}
        and o.state not in ('cancelled', 'refunded') and o.placed_at > now() - interval '30 days'
    `,
    // what the shopper sees now — the storefront's own summary, schedules in Core's words
    storefrontPreview(tx, tenantId, id),
  ]);
  return {
    product: {
      ...product,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        pricingRule: g.pricing_rule,
        options: options
          .filter((o) => o.group_id === g.id)
          .map((o) => ({
            id: o.id,
            name: o.name,
            priceDeltaCents: o.price_delta_cents,
            status: o.status,
            maxQty: o.max_qty,
            description: o.description,
            imageUrl: o.image_url,
          })),
      })),
      gallery,
      comboSlots: product.kind === 'combo' ? await loadComboSlots(tx, tenantId, id) : [],
      sales30: sales!,
      storefront: storefront!,
    },
  };
}

async function uniqueSlug(
  tx: Sql,
  table: 'products' | 'categories',
  tenantId: string,
  base: string,
) {
  const root = slugify(base).slice(0, 50);
  const taken = new Set(
    (
      await tx<{ slug: string }[]>`
        select slug from ${tx(table)} where tenant_id = ${tenantId} and (slug = ${root} or slug like ${root + '-%'})
      `
    ).map((r) => r.slug),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

async function categoryOf(tx: Sql, tenantId: string, id: unknown): Promise<string> {
  if (typeof id !== 'string' || !UUID_RE.test(id))
    throw new HttpError(422, 'BAD_REQUEST', 'pick a category', { field: 'categoryId' });
  const row = (await tx`select id from categories where tenant_id = ${tenantId} and id = ${id}`)[0];
  if (!row) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'category not found');
  return id;
}

function uuidList(v: unknown, name: string, max: number): string[] {
  if (
    !Array.isArray(v) ||
    v.length === 0 ||
    v.length > max ||
    v.some((x) => typeof x !== 'string' || !UUID_RE.test(x))
  )
    throw new HttpError(422, 'BAD_REQUEST', `${name} must list 1–${max} ids`, { field: name });
  return [...new Set(v as string[])];
}

/** Forgiving money: "12", "12,5", "12.50", "R$ 1.234,56" → cents. null = not money. */
export function parseMoney(input: string): number | null {
  let s = input.replace(/r\$|\s/gi, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    const dec = s.slice(lastSep + 1).padEnd(2, '0');
    s = `${intPart || '0'}.${dec}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Math.round(Number(s) * 100);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? n : null;
}

/** "Pudim de leite - R$ 12,50" per line (a WhatsApp menu paste) → name + price. */
export function parseMenuPaste(raw: string): { name: string; priceCents: number }[] {
  const out: { name: string; priceCents: number }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.replace(/^[\s•*·\-–—\d.)]+(?=\D)/, '').trim();
    if (!clean) continue;
    const m =
      /^(.*?)[\s\-–—:.|]*(?:R\$\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:[,.]\d{1,2})?|\d+(?:[,.]\d{1,2})?)\s*(?:reais)?$/i.exec(
        clean,
      );
    if (!m) continue;
    const name = m[1]!.replace(/[\s\-–—:.|]+$/, '').trim();
    const price = parseMoney(m[2]!.replace(/\s/g, ''));
    if (name.length >= 2 && name.length <= 120 && price !== null && price > 0)
      out.push({ name, priceCents: price });
  }
  return out.slice(0, 100);
}

export function mountCatalog(d: AdminDeps) {
  const { admin } = d;
  const { read, write, named } = handlers(d);

  admin.get(
    '/catalog',
    named('catalog').read('manager', async (tx, t) => {
      const categories = await tx<
        { id: string; slug: string; name: string; description: string | null; sort: number }[]
      >`
        select id, slug, name, description, sort from categories where tenant_id = ${t.id} order by sort, name
      `;
      const products = await withNow(
        tx,
        t.id,
        await tx<AdminProductRow[]>`
          select ${productCols(tx)} from products p where p.tenant_id = ${t.id} and p.deleted_at is null
          order by p.sort, p.name
        `,
      );
      return {
        categories: categories.map((c) => ({
          ...c,
          products: products.filter((p) => p.categoryId === c.id),
        })),
      };
    }),
  );

  admin.get(
    '/products/:id',
    read('manager', async (tx, t, _m, c) => productDetail(tx, t.id, uuidParam(c, 'id'))),
  );

  // ── categories ───────────────────────────────────────────────────────────

  admin.post(
    '/categories',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const name = text(body.name, 'name', 60, 1);
      const description = optText(body.description, 'description', 500) ?? null;
      const sort = (
        await tx<
          { n: number }[]
        >`select coalesce(max(sort), -1) + 1 as n from categories where tenant_id = ${t.id}`
      )[0]!.n;
      const row = (
        await tx`
          insert into categories (tenant_id, slug, name, description, sort)
          values (${t.id}, ${await uniqueSlug(tx, 'categories', t.id, name)}, ${name}, ${description}, ${sort})
          returning id, slug, name, description, sort
        `
      )[0]!;
      await audit(tx, t.id, m, {
        action: 'category.create',
        entity: 'category',
        entityId: row.id,
        summary: `criou a categoria "${name}"`,
        after: row,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: { category: row } };
    }),
  );

  admin.patch(
    '/categories/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      const set: Record<string, unknown> = {};
      if (body.name !== undefined) set.name = text(body.name, 'name', 60, 1);
      if (body.description !== undefined)
        set.description = optText(body.description, 'description', 500) ?? null;
      if (!Object.keys(set).length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const before = (
        await tx<{ name: string; description: string | null }[]>`
          select name, description from categories where tenant_id = ${t.id} and id = ${id}
        `
      )[0];
      if (!before) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'category not found');
      const row = (
        await tx`
          update categories set ${tx(set as never)} where tenant_id = ${t.id} and id = ${id}
          returning id, slug, name, description, sort
        `
      )[0]!;
      const renamed = set.name !== undefined && set.name !== before.name;
      await audit(tx, t.id, m, {
        action: renamed ? 'category.rename' : 'category.update',
        entity: 'category',
        entityId: id,
        summary: renamed
          ? `renomeou "${before.name}" para "${row.name}"`
          : `alterou a descrição de "${row.name}"`,
        before,
        after: set,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { category: row } };
    }),
  );

  admin.delete(
    '/categories/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const cat = (
        await tx<
          { name: string }[]
        >`select name from categories where tenant_id = ${t.id} and id = ${id}`
      )[0];
      if (!cat) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'category not found');
      const live = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from products where tenant_id = ${t.id} and category_id = ${id} and status <> 'archived'
        `
      )[0]!.n;
      if (live > 0)
        throw new HttpError(409, 'CATEGORY_NOT_EMPTY', 'move or archive its products first', {
          products: live,
        });
      // its hidden and apagados products go with it; a cart still holding one can't hold that back
      await tx`
        delete from cart_items where tenant_id = ${t.id}
          and product_id in (select id from products where tenant_id = ${t.id} and category_id = ${id})
      `;
      await tx`delete from categories where tenant_id = ${t.id} and id = ${id}`;
      await audit(tx, t.id, m, {
        action: 'category.delete',
        entity: 'category',
        entityId: id,
        summary: `apagou a categoria "${cat.name}"`,
        before: cat,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { deleted: true } };
    }),
  );

  admin.put(
    '/categories/order',
    write('manager', async (tx, t, m, c) => {
      const ids = uuidList((await bodyJson(c)).ids, 'ids', 100);
      for (const [i, id] of ids.entries())
        await tx`update categories set sort = ${i} where tenant_id = ${t.id} and id = ${id}`;
      await audit(tx, t.id, m, {
        action: 'category.reorder',
        entity: 'category',
        summary: 'reordenou as categorias',
        after: { ids },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { ok: true } };
    }),
  );

  // ── products ─────────────────────────────────────────────────────────────

  admin.post(
    '/products',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const name = text(body.name, 'name', 120, 2);
      const categoryId = await categoryOf(tx, t.id, body.categoryId);
      const price = int(body.priceCents, 'priceCents', 0, MAX_PRICE);
      const compareAtCents = compareAt(body.compareAtPriceCents, price);
      const description = optText(body.description, 'description', 1000) ?? null;
      const dietary = body.dietary === undefined ? [] : parseDietary(body.dietary);
      const sort = (
        await tx<{ n: number }[]>`
            select coalesce(max(sort), -1) + 1 as n from products where tenant_id = ${t.id} and category_id = ${categoryId}
          `
      )[0]!.n;
      const id = (
        await tx<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, description, base_price_cents,
                                compare_at_price_cents, sort, dietary)
          values (${t.id}, ${categoryId}, ${await uniqueSlug(tx, 'products', t.id, name)}, ${name}, ${description}, ${price},
                  ${compareAtCents}, ${sort}, ${tx.array(dietary)})
          returning id
        `
      )[0]!.id;
      await audit(tx, t.id, m, {
        action: 'product.create',
        entity: 'product',
        entityId: id,
        summary: `criou "${name}"`,
        after: { name, priceCents: price, compareAtPriceCents: compareAtCents },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: await productDetail(tx, t.id, id) };
    }),
  );

  admin.patch(
    '/products/:id',
    named('product.patch').write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c);
      const before = await productRow(tx, t.id, id);
      const set: Record<string, unknown> = {};
      const changes: string[] = [];
      if (body.name !== undefined) {
        set.name = text(body.name, 'name', 120, 2);
        changes.push('nome');
      }
      if (body.description !== undefined) {
        set.description = optText(body.description, 'description', 1000) ?? null;
        changes.push('descrição');
      }
      if (body.priceCents !== undefined) {
        set.base_price_cents = int(body.priceCents, 'priceCents', 0, MAX_PRICE);
        changes.push('preço');
      }
      if (body.compareAtPriceCents !== undefined) {
        set.compare_at_price_cents = compareAt(
          body.compareAtPriceCents,
          (set.base_price_cents as number | undefined) ?? before.priceCents,
        );
        changes.push('preço "de"');
      } else if (
        set.base_price_cents !== undefined &&
        before.compareAtPriceCents !== null &&
        before.compareAtPriceCents <= (set.base_price_cents as number)
      ) {
        throw new HttpError(422, 'BAD_REQUEST', 'the "de" price must be above the price', {
          field: 'compareAtPriceCents',
        });
      }
      const promo =
        body.promoSchedule !== undefined
          ? parsePromoSchedule(body.promoSchedule, MAX_PRICE)
          : before.promoSchedule;
      if (
        (body.promoSchedule !== undefined || set.base_price_cents !== undefined) &&
        promo &&
        promo.priceCents >= ((set.base_price_cents as number | undefined) ?? before.priceCents)
      )
        throw new HttpError(422, 'BAD_REQUEST', 'the promotion price must be below the price', {
          field: 'promoSchedule.priceCents',
        });
      if (body.promoSchedule !== undefined) {
        set.promo_schedule = promo ? tx.json(promo as never) : null;
        changes.push('promoção por horário');
      }
      if (body.categoryId !== undefined) {
        set.category_id = await categoryOf(tx, t.id, body.categoryId);
        changes.push('categoria');
      }
      if (body.requiresPreorder !== undefined) {
        set.requires_preorder = bool(body.requiresPreorder, 'requiresPreorder');
        changes.push('encomenda');
      }
      if (body.preorderLeadDays !== undefined) {
        set.preorder_lead_days = int(body.preorderLeadDays, 'preorderLeadDays', 0, 60);
        changes.push('antecedência');
      }
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags) || body.tags.length > 12)
          throw new HttpError(422, 'BAD_REQUEST', 'tags: at most 12', { field: 'tags' });
        set.tags = tx.json(body.tags.map((x, i) => text(x, `tags[${i}]`, 30, 1)));
        changes.push('etiquetas');
      }
      if (body.dietary !== undefined) {
        set.dietary = tx.array(parseDietary(body.dietary));
        changes.push('alergênicos e dietas');
      }
      if (body.availabilitySchedule !== undefined) {
        const sched = parseAvailabilitySchedule(body.availabilitySchedule);
        set.availability_schedule = sched ? tx.json(sched as never) : null;
        changes.push('horário de venda');
      }
      if (Object.keys(set).length)
        await tx`update products set ${tx(set as never)} where tenant_id = ${t.id} and id = ${id}`;

      // availability goes through setStock so a restock wakes the waitlist
      let status: string | undefined;
      let soldOutUntil: Date | null | undefined;
      if (body.availability !== undefined) {
        const a = oneOf(body.availability, 'availability', [
          'available',
          'sold_out_today',
          'sold_out',
          'hidden',
        ] as const);
        status = a === 'available' ? 'active' : a === 'hidden' ? 'archived' : 'sold_out';
        soldOutUntil = a === 'sold_out_today' ? await nextLocalMidnight(tx, t.id) : null;
        changes.push('disponibilidade');
      }
      const stockQuantity = optInt(body.stockQuantity, 'stockQuantity', 0, 1_000_000);
      const lowStockThreshold = optInt(body.lowStockThreshold, 'lowStockThreshold', 0, 1_000_000);
      if (stockQuantity !== undefined) changes.push('estoque');
      if (lowStockThreshold !== undefined) changes.push('alerta de estoque');
      let woken = 0;
      if (status !== undefined || stockQuantity !== undefined || lowStockThreshold !== undefined) {
        const r = await setStock(tx, t.id, id, {
          ...(stockQuantity !== undefined ? { stockQuantity } : {}),
          ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        woken = r.waiting;
        if (soldOutUntil !== undefined)
          await tx`update products set sold_out_until = ${soldOutUntil} where tenant_id = ${t.id} and id = ${id}`;
      }
      if (!changes.length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const after = await productRow(tx, t.id, id);
      await audit(tx, t.id, m, {
        action: 'product.update',
        entity: 'product',
        entityId: id,
        summary: `alterou ${changes.join(', ')} de "${after.name}"`,
        before: pick(before, [
          'name',
          'priceCents',
          'compareAtPriceCents',
          'status',
          'stockQuantity',
          'categoryId',
        ]),
        after: pick(after, [
          'name',
          'priceCents',
          'compareAtPriceCents',
          'status',
          'stockQuantity',
          'categoryId',
        ]),
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return {
        status: 200,
        body: { ...(await productDetail(tx, t.id, id)), waitlistWoken: woken },
      };
    }),
  );

  admin.post(
    '/products/:id/duplicate',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const src = await productRow(tx, t.id, id);
      const name = `${src.name} (cópia)`.slice(0, 120);
      const copy = (
        await tx<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, description, base_price_cents,
                                compare_at_price_cents, promo_schedule, status, figure_variant, tags, kind,
                                requires_preorder, preorder_lead_days, sort, low_stock_threshold, dietary)
          select tenant_id, category_id, ${await uniqueSlug(tx, 'products', t.id, name)}, ${name}, description,
                 base_price_cents, compare_at_price_cents, promo_schedule, 'archived', figure_variant, tags, kind,
                 requires_preorder, preorder_lead_days, sort + 1, low_stock_threshold, dietary
          from products where tenant_id = ${t.id} and id = ${id}
          returning id
        `
      )[0]!.id;
      await tx`
        insert into product_media (tenant_id, product_id, url, alt, width, height, sort)
        select tenant_id, ${copy}, url, alt, width, height, sort from product_media where product_id = ${id}
      `;
      const groups = await tx<
        { id: string }[]
      >`select id from modifier_groups where tenant_id = ${t.id} and product_id = ${id}`;
      for (const g of groups) {
        const ng = (
          await tx<{ id: string }[]>`
            insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select,
                                         pricing_rule, sort)
            select tenant_id, ${copy}, name, required, min_select, max_select, pricing_rule, sort
            from modifier_groups where id = ${g.id}
            returning id
          `
        )[0]!.id;
        await tx`
          insert into modifiers (tenant_id, group_id, name, price_delta_cents, status, max_qty, description,
                                 image_url, sort)
          select tenant_id, ${ng}, name, price_delta_cents, status, max_qty, description, image_url, sort
          from modifiers where group_id = ${g.id}
        `;
      }
      const slots = await tx<
        { id: string }[]
      >`select id from combo_slots where tenant_id = ${t.id} and product_id = ${id}`;
      for (const s of slots) {
        const ns = (
          await tx<{ id: string }[]>`
            insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
            select tenant_id, ${copy}, name, min_select, max_select, qty_per_item, sort from combo_slots where id = ${s.id}
            returning id
          `
        )[0]!.id;
        await tx`
          insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
          select tenant_id, ${ns}, product_id, price_delta_cents, sort from combo_slot_items where slot_id = ${s.id}
        `;
      }
      await audit(tx, t.id, m, {
        action: 'product.duplicate',
        entity: 'product',
        entityId: copy,
        summary: `duplicou "${src.name}" (a cópia começa escondida)`,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: await productDetail(tx, t.id, copy) };
    }),
  );

  admin.put(
    '/products/:id/media',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      if (!Array.isArray(body.media) || body.media.length > 12)
        throw new HttpError(422, 'BAD_REQUEST', 'at most 12 photos', { field: 'media' });
      const media = (body.media as unknown[]).map((x, i) => {
        if (!isObj(x)) throw new HttpError(422, 'BAD_REQUEST', `media[${i}] must be an object`);
        return {
          url: mediaUrl(x.url, `media[${i}].url`),
          alt: optText(x.alt, `media[${i}].alt`, 200) ?? null,
          width: optInt(x.width, 'width', 1, 10_000) ?? null,
          height: optInt(x.height, 'height', 1, 10_000) ?? null,
        };
      });
      const p = await productRow(tx, t.id, id);
      await tx`delete from product_media where tenant_id = ${t.id} and product_id = ${id}`;
      for (const [sort, x] of media.entries())
        await tx`
          insert into product_media (tenant_id, product_id, url, alt, width, height, sort)
          values (${t.id}, ${id}, ${x.url}, ${x.alt}, ${x.width}, ${x.height}, ${sort})
        `;
      await audit(tx, t.id, m, {
        action: 'product.media',
        entity: 'product',
        entityId: id,
        summary: `atualizou as fotos de "${p.name}" (${media.length})`,
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: await productDetail(tx, t.id, id) };
    }),
  );

  // Option groups ("opções"): ids are kept for rows the client sends back, so
  // carts holding a modifier id keep resolving after an edit.
  admin.put(
    '/products/:id/options',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      // a pizzeria's flavour lists run long: up to 12 groups of 100 options
      const body = await bodyJson(c, 256 * 1024);
      if (!Array.isArray(body.groups) || body.groups.length > 12)
        throw new HttpError(422, 'BAD_REQUEST', 'at most 12 option groups', { field: 'groups' });
      const groups = (body.groups as unknown[]).map((g, gi) => {
        if (!isObj(g)) throw new HttpError(422, 'BAD_REQUEST', `groups[${gi}] must be an object`);
        const options = Array.isArray(g.options) ? g.options : [];
        if (options.length === 0 || options.length > MAX_OPTIONS)
          throw new HttpError(
            422,
            'BAD_REQUEST',
            `"${String(g.name ?? '')}" needs 1–${MAX_OPTIONS} options`,
            {
              field: `groups[${gi}].options`,
            },
          );
        const minSelect = int(g.minSelect ?? 0, `groups[${gi}].minSelect`, 0, 40);
        const maxSelect = int(g.maxSelect ?? 1, `groups[${gi}].maxSelect`, 1, 40);
        if (minSelect > maxSelect)
          throw new HttpError(422, 'BAD_REQUEST', 'the minimum is above the maximum', {
            field: `groups[${gi}].minSelect`,
          });
        const parsed = options.map((o: unknown, oi: number) => {
          if (!isObj(o)) throw new HttpError(422, 'BAD_REQUEST', 'option must be an object');
          const field = `groups[${gi}].options[${oi}]`;
          // a repeatable discount would let the shopper multiply a line below zero
          if (
            typeof o.priceDeltaCents === 'number' &&
            o.priceDeltaCents < 0 &&
            typeof o.maxQty === 'number' &&
            o.maxQty > 1
          )
            throw new HttpError(
              422,
              'BAD_REQUEST',
              'an option with a discount can be picked only once',
              {
                field: `${field}.maxQty`,
              },
            );
          return {
            id: typeof o.id === 'string' && UUID_RE.test(o.id) ? o.id : null,
            name: text(o.name, `${field}.name`, 60, 1),
            priceDeltaCents: int(o.priceDeltaCents ?? 0, 'priceDeltaCents', -MAX_PRICE, MAX_PRICE),
            status: o.status === 'sold_out' ? 'sold_out' : 'active',
            maxQty: int(o.maxQty ?? 1, `${field}.maxQty`, 1, 20),
            description: optText(o.description, `${field}.description`, 200) ?? null,
            imageUrl:
              o.imageUrl === undefined || o.imageUrl === null || o.imageUrl === ''
                ? null
                : mediaUrl(o.imageUrl, `${field}.imageUrl`),
          };
        });
        // one row per id: a repeated id would leave which edit wins to chance
        const seen = new Set<string>();
        for (const [oi, o] of parsed.entries()) {
          if (!o.id) continue;
          if (seen.has(o.id))
            throw new HttpError(422, 'BAD_REQUEST', 'an option appears twice', {
              field: `groups[${gi}].options[${oi}].id`,
            });
          seen.add(o.id);
        }
        const name = text(g.name, `groups[${gi}].name`, 60, 1);
        // a group can't ask for more units than its options offer together
        const most = parsed.reduce((n, o) => n + o.maxQty, 0);
        if (minSelect > most)
          throw new HttpError(
            422,
            'BAD_REQUEST',
            `"${name}" asks for ${minSelect} but offers at most ${most}`,
            { field: `groups[${gi}].minSelect` },
          );
        return {
          id: typeof g.id === 'string' && UUID_RE.test(g.id) ? g.id : null,
          name,
          required: minSelect > 0,
          minSelect,
          maxSelect: Math.min(maxSelect, most),
          pricingRule: oneOf(g.pricingRule ?? 'sum', `groups[${gi}].pricingRule`, PRICING_RULES),
          options: parsed,
        };
      });
      const p = await productRow(tx, t.id, id);
      const keepGroups = groups.map((g) => g.id).filter(Boolean) as string[];
      await tx`
        delete from modifier_groups where tenant_id = ${t.id} and product_id = ${id}
          and not (id = any(${keepGroups}::uuid[]))
      `;
      for (const [gs, g] of groups.entries()) {
        const existing = g.id
          ? (
              await tx<{ id: string }[]>`
                update modifier_groups set name = ${g.name}, required = ${g.required}, min_select = ${g.minSelect},
                  max_select = ${g.maxSelect}, pricing_rule = ${g.pricingRule}, sort = ${gs}
                where tenant_id = ${t.id} and product_id = ${id} and id = ${g.id} returning id
              `
            )[0]
          : undefined;
        const gid =
          existing?.id ??
          (
            await tx<{ id: string }[]>`
              insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select,
                                           pricing_rule, sort)
              values (${t.id}, ${id}, ${g.name}, ${g.required}, ${g.minSelect}, ${g.maxSelect}, ${g.pricingRule}, ${gs})
              returning id
            `
          )[0]!.id;
        const keepOpts = g.options.map((o) => o.id).filter(Boolean) as string[];
        await tx`
          delete from modifiers where tenant_id = ${t.id} and group_id = ${gid} and not (id = any(${keepOpts}::uuid[]))
        `;
        // one statement for the kept options and one for the new ones, however long the list
        const rows = g.options.map((o, os) => ({ ...o, sort: os }));
        const col = <K extends keyof (typeof rows)[number]>(xs: typeof rows, k: K) =>
          xs.map((r) => r[k]);
        const kept = rows.filter((r) => r.id);
        const updated = new Set(
          kept.length
            ? (
                await tx<{ id: string }[]>`
                  update modifiers m set name = v.name, price_delta_cents = v.delta, status = v.status,
                    max_qty = v.max_qty, description = v.description, image_url = v.image_url, sort = v.sort
                  from unnest(${col(kept, 'id')}::uuid[], ${col(kept, 'name')}::text[],
                              ${col(kept, 'priceDeltaCents')}::int[], ${col(kept, 'status')}::text[],
                              ${col(kept, 'maxQty')}::int[], ${col(kept, 'description')}::text[],
                              ${col(kept, 'imageUrl')}::text[], ${col(kept, 'sort')}::int[])
                    as v(id, name, delta, status, max_qty, description, image_url, sort)
                  where m.tenant_id = ${t.id} and m.group_id = ${gid} and m.id = v.id
                  returning m.id
                `
              ).map((r) => r.id)
            : [],
        );
        const fresh = rows.filter((r) => !r.id || !updated.has(r.id));
        if (fresh.length)
          await tx`
            insert into modifiers (tenant_id, group_id, name, price_delta_cents, status, max_qty, description,
                                   image_url, sort)
            select ${t.id}, ${gid}, v.name, v.delta, v.status, v.max_qty, v.description, v.image_url, v.sort
            from unnest(${col(fresh, 'name')}::text[], ${col(fresh, 'priceDeltaCents')}::int[],
                        ${col(fresh, 'status')}::text[], ${col(fresh, 'maxQty')}::int[],
                        ${col(fresh, 'description')}::text[], ${col(fresh, 'imageUrl')}::text[],
                        ${col(fresh, 'sort')}::int[])
              as v(name, delta, status, max_qty, description, image_url, sort)
          `;
      }
      await audit(tx, t.id, m, {
        action: 'product.options',
        entity: 'product',
        entityId: id,
        summary: `editou as opções de "${p.name}" (${groups.length} grupos)`,
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: await productDetail(tx, t.id, id) };
    }),
  );

  admin.put(
    '/products/:id/kit',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c, 64 * 1024);
      if (!Array.isArray(body.slots) || body.slots.length > 8)
        throw new HttpError(422, 'BAD_REQUEST', 'at most 8 kit steps', { field: 'slots' });
      const slots = (body.slots as unknown[]).map((s, i) => {
        if (!isObj(s)) throw new HttpError(422, 'BAD_REQUEST', `slots[${i}] must be an object`);
        const minSelect = int(s.minSelect ?? 1, `slots[${i}].minSelect`, 0, 99);
        const maxSelect = int(s.maxSelect ?? minSelect, `slots[${i}].maxSelect`, 1, 99);
        if (minSelect > maxSelect)
          throw new HttpError(422, 'BAD_REQUEST', 'the minimum is above the maximum', {
            field: `slots[${i}]`,
          });
        if (!Array.isArray(s.items) || s.items.length === 0 || s.items.length > 40)
          throw new HttpError(422, 'BAD_REQUEST', `"${String(s.name ?? '')}" needs 1–40 products`, {
            field: `slots[${i}].items`,
          });
        const name = text(s.name, `slots[${i}].name`, 80, 1);
        const qtyPerItem = int(s.qtyPerItem ?? 1, `slots[${i}].qtyPerItem`, 1, 99);
        const items = (s.items as unknown[]).map((it) => {
          const r = isObj(it) ? it : {};
          if (typeof r.productId !== 'string' || !UUID_RE.test(r.productId))
            throw new HttpError(422, 'BAD_REQUEST', 'kit items need a productId');
          return {
            productId: r.productId,
            priceDeltaCents: int(r.priceDeltaCents ?? 0, 'priceDeltaCents', -100_000, 100_000),
          };
        });
        // a step nobody can fill keeps the kit listed while every add fails
        const most = new Set(items.map((x) => x.productId)).size * qtyPerItem;
        if (minSelect > most)
          throw new HttpError(
            422,
            'BAD_REQUEST',
            `"${name}" asks for ${minSelect} but offers at most ${most}`,
            { field: `slots[${i}].minSelect` },
          );
        return {
          id: typeof s.id === 'string' && UUID_RE.test(s.id) ? s.id : null,
          name,
          minSelect,
          maxSelect,
          qtyPerItem,
          items,
        };
      });
      const p = await productRow(tx, t.id, id);
      const picked = [...new Set(slots.flatMap((s) => s.items.map((x) => x.productId)))];
      if (picked.includes(id))
        throw new HttpError(422, 'BAD_REQUEST', 'a kit cannot contain itself');
      const live = await tx<{ id: string }[]>`
        select id from products where tenant_id = ${t.id} and id = any(${picked}::uuid[]) and deleted_at is null
      `;
      if (live.length < picked.length)
        throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'a kit item no longer exists');
      await saveKitStepsTx(tx, t.id, id, slots);
      await tx`update products set kind = ${slots.length ? 'combo' : 'simple'} where tenant_id = ${t.id} and id = ${id}`;
      await audit(tx, t.id, m, {
        action: 'product.kit',
        entity: 'product',
        entityId: id,
        summary: `montou o kit "${p.name}" (${slots.length} etapas)`,
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: await productDetail(tx, t.id, id) };
    }),
  );

  admin.put(
    '/products/order',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const categoryId = await categoryOf(tx, t.id, body.categoryId);
      const ids = uuidList(body.ids, 'ids', 300);
      for (const [i, id] of ids.entries())
        await tx`update products set sort = ${i}, category_id = ${categoryId} where tenant_id = ${t.id} and id = ${id}`;
      await audit(tx, t.id, m, {
        action: 'product.reorder',
        entity: 'category',
        entityId: categoryId,
        summary: 'reordenou produtos',
        after: { ids },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { ok: true } };
    }),
  );

  // Several products at once. Every action but delete/restore answers with `before`, what it
  // changed, which `revert` puts back: the bar's "desfazer" echoes Core's own values.
  admin.post(
    '/products/bulk',
    named('products.bulk').write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c, 512 * 1024);
      const action = oneOf(body.action, 'action', BULK_ACTIONS);
      if (action === 'revert') return revertBulk(tx, t.id, m, body.items);
      const ids = uuidList(body.ids, 'ids', 300);
      // id order, the same as checkout's row locks
      const rows = (
        await tx<BulkRow[]>`
          select ${bulkCols(tx)} from products p
          where p.tenant_id = ${t.id} and p.id = any(${ids}::uuid[]) order by p.id for update
        `
      ).filter((r) => (action === 'restore' ? r.deleted : !r.deleted));
      const live = rows.map((r) => r.id);
      let summary = '';
      let before: Record<string, unknown>[] | undefined;
      let woken = 0;
      const n = `${live.length} ${live.length === 1 ? 'produto' : 'produtos'}`;
      if (action === 'category') {
        const categoryId = await categoryOf(tx, t.id, body.categoryId);
        before = rows.map((r) => ({ id: r.id, categoryId: r.categoryId }));
        await tx`update products set category_id = ${categoryId} where tenant_id = ${t.id} and id = any(${live}::uuid[])`;
        summary = `moveu ${n} de categoria`;
      } else if (action === 'price_percent' || action === 'price_amount') {
        const pct = action === 'price_percent' ? int(body.percent, 'percent', -90, 300) : 0;
        const add =
          action === 'price_amount'
            ? int(body.amountCents, 'amountCents', -MAX_PRICE, MAX_PRICE)
            : 0;
        const field = action === 'price_percent' ? 'percent' : 'amountCents';
        if (pct === 0 && add === 0)
          throw new HttpError(422, 'BAD_REQUEST', `${field} cannot be 0`, { field });
        // integer cents. A percentage rounds to the nearest 10 cents (merchants price in round
        // numbers); an amount is exact. The "de" price and a timed promotion move with it, and
        // drop when they no longer sit above (or below) the price.
        const move = (cents: number) =>
          Math.min(
            MAX_PRICE,
            pct ? Math.max(0, Math.round((cents * (100 + pct)) / 1000) * 10) : cents + add,
          );
        const next = rows.map((r) => {
          const base = move(r.priceCents);
          const cmp = r.compareAtPriceCents === null ? null : move(r.compareAtPriceCents);
          const promo = r.promoSchedule?.priceCents;
          const promoNext = typeof promo === 'number' ? move(promo) : null;
          return {
            r,
            base,
            cmp: cmp !== null && cmp > base ? cmp : null,
            promo: promoNext !== null && promoNext < base ? promoNext : null,
            bad:
              (r.priceCents > 0 || add !== 0) && base <= 0
                ? true
                : promoNext !== null && promoNext < 0,
          };
        });
        const bad = next.filter((x) => x.bad);
        if (bad.length)
          throw new HttpError(422, 'PRICE_NOT_POSITIVE', 'a price would drop to zero or below', {
            field,
            products: bad.slice(0, 10).map((x) => ({ id: x.r.id, name: x.r.name })),
          });
        before = rows.map((r) => ({
          id: r.id,
          priceCents: r.priceCents,
          compareAtPriceCents: r.compareAtPriceCents,
          promoSchedule: r.promoSchedule,
        }));
        if (next.length)
          await tx`
            update products p set base_price_cents = v.base, compare_at_price_cents = v.cmp,
              promo_schedule = case when v.promo is not null
                then jsonb_set(p.promo_schedule, '{priceCents}', to_jsonb(v.promo)) end
            from unnest(${live}::uuid[], ${next.map((x) => x.base)}::int[],
                        ${next.map((x) => x.cmp)}::int[], ${next.map((x) => x.promo)}::int[])
              as v(id, base, cmp, promo)
            where p.tenant_id = ${t.id} and p.id = v.id
          `;
        summary = pct
          ? `${pct > 0 ? 'aumentou' : 'baixou'} em ${Math.abs(pct)}% o preço de ${n}`
          : `${add > 0 ? 'aumentou' : 'baixou'} em ${brl(Math.abs(add))} o preço de ${n}`;
      } else if (action === 'stock') {
        const stockQuantity =
          body.stockQuantity === null
            ? null
            : int(body.stockQuantity, 'stockQuantity', 0, MAX_STOCK);
        before = rows.map((r) => ({ id: r.id, stockQuantity: r.stockQuantity }));
        for (const id of live) woken += (await setStock(tx, t.id, id, { stockQuantity })).waiting;
        summary =
          stockQuantity === null
            ? `parou de contar o estoque de ${n}`
            : `pôs ${stockQuantity} no estoque de ${n}`;
      } else if (action === 'schedule') {
        const sched = parseAvailabilitySchedule(body.availabilitySchedule);
        before = rows.map((r) => ({ id: r.id, availabilitySchedule: r.availabilitySchedule }));
        await tx`
          update products set availability_schedule = ${sched ? tx.json(sched as never) : null}
          where tenant_id = ${t.id} and id = any(${live}::uuid[])
        `;
        summary = sched
          ? `pôs o horário "${availabilityLabel(sched)}" em ${n}`
          : `tirou o horário de venda de ${n}`;
      } else if (action === 'delete') {
        await softDelete(tx, t.id, live);
        summary = `apagou ${n}`;
      } else if (action === 'restore') {
        await restore(tx, t.id, live);
        summary = `recuperou ${n}`;
      } else {
        const status =
          action === 'available' ? 'active' : action === 'hidden' ? 'archived' : 'sold_out';
        const until = action === 'sold_out_today' ? await nextLocalMidnight(tx, t.id) : null;
        before = rows.map((r) => ({ id: r.id, status: r.status, soldOutUntil: r.soldOutUntil }));
        for (const id of live) {
          woken += (await setStock(tx, t.id, id, { status })).waiting;
          await tx`update products set sold_out_until = ${until} where tenant_id = ${t.id} and id = ${id}`;
        }
        summary = `${
          action === 'available'
            ? 'disponibilizou'
            : action === 'hidden'
              ? 'escondeu'
              : action === 'sold_out'
                ? 'marcou como esgotado'
                : 'marcou como esgotado hoje'
        } ${n}`;
      }
      await audit(tx, t.id, m, {
        action: `product.bulk.${action}`,
        entity: 'product',
        summary,
        ...(before ? { before } : {}),
        after: {
          ids: live,
          ...pickBody(body, ['categoryId', 'percent', 'amountCents', 'stockQuantity']),
        },
      });
      if (live.length) await emitAdminTx(tx, t.id, 'catalog');
      return {
        status: 200,
        body: { updated: live.length, ...(before ? { before } : {}), waitlistWoken: woken },
      };
    }),
  );

  // "apagar": a soft delete (migration 0090) — orders keep their lines, "desfazer" restores it
  admin.delete(
    '/products/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const p = await productRow(tx, t.id, id);
      await softDelete(tx, t.id, [id]);
      await audit(tx, t.id, m, {
        action: 'product.delete',
        entity: 'product',
        entityId: id,
        summary: `apagou "${p.name}"`,
        before: pick(p, ['name', 'priceCents', 'status', 'categoryId']),
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: { deleted: true } };
    }),
  );

  admin.post(
    '/products/:id/restore',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<{ name: string; deleted: boolean }[]>`
          select name, deleted_at is not null as deleted from products
          where tenant_id = ${t.id} and id = ${id} for update
        `
      )[0];
      if (!row) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
      if (row.deleted) {
        await restore(tx, t.id, [id]);
        await audit(tx, t.id, m, {
          action: 'product.restore',
          entity: 'product',
          entityId: id,
          summary: `recuperou "${row.name}"`,
        });
        await emitAdminTx(tx, t.id, 'catalog', id);
      }
      return { status: 200, body: await productDetail(tx, t.id, id) };
    }),
  );

  // The Estoque screen's taps: relative changes, so a sale drawn meanwhile still counts.
  // An absolute count ("contei 24") goes through PATCH /products/:id.
  admin.post(
    '/products/stock',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > 100)
        throw new HttpError(422, 'BAD_REQUEST', 'changes must list 1–100 products', {
          field: 'changes',
        });
      const adds = new Map<string, number>();
      body.changes.forEach((x: unknown, i: number) => {
        if (!isObj(x) || typeof x.productId !== 'string' || !UUID_RE.test(x.productId))
          throw new HttpError(422, 'BAD_REQUEST', `changes[${i}].productId must be an id`, {
            field: `changes[${i}].productId`,
          });
        const add = int(x.add, `changes[${i}].add`, -MAX_STOCK, MAX_STOCK);
        const id = x.productId.toLowerCase();
        adds.set(id, (adds.get(id) ?? 0) + add);
      });
      // id order, the same as checkout's row locks, so the two never deadlock
      const ids = [...adds.keys()].filter((id) => adds.get(id) !== 0).sort();
      const stock: Record<string, number> = {};
      const before: Record<string, number> = {};
      let woken = 0;
      for (const id of ids) {
        const r = await adjustStock(tx, t.id, id, adds.get(id)!);
        if (!r) continue;
        before[id] = r.before;
        stock[id] = r.after;
        woken += r.waiting;
      }
      const changed = Object.keys(stock);
      if (changed.length) {
        const one =
          changed.length === 1
            ? (
                await tx<
                  { name: string }[]
                >`select name from products where tenant_id = ${t.id} and id = ${changed[0]!}`
              )[0]!.name
            : null;
        await audit(tx, t.id, m, {
          action: 'product.stock.adjust',
          entity: 'product',
          entityId: one ? changed[0]! : null,
          summary: one
            ? `ajustou o estoque de "${one}" (${before[changed[0]!]} → ${stock[changed[0]!]})`
            : `ajustou o estoque de ${changed.length} produtos`,
          before,
          after: stock,
        });
        await emitAdminTx(tx, t.id, 'catalog');
      }
      return { status: 200, body: { stock, waitlistWoken: woken } };
    }),
  );

  // Paste a menu from WhatsApp → products; the client shows /import/preview first.
  admin.post(
    '/products/import',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c, 64 * 1024);
      const raw = text(body.text, 'text', 20_000, 2);
      const categoryId = await categoryOf(tx, t.id, body.categoryId);
      const items = parseMenuPaste(raw);
      if (!items.length)
        throw new HttpError(422, 'NOTHING_TO_IMPORT', 'no "name - price" lines found', {
          field: 'text',
        });
      let sort = (
        await tx<
          { n: number }[]
        >`select coalesce(max(sort), -1) + 1 as n from products where tenant_id = ${t.id} and category_id = ${categoryId}`
      )[0]!.n;
      const created: string[] = [];
      for (const it of items) {
        created.push(
          (
            await tx<{ id: string }[]>`
              insert into products (tenant_id, category_id, slug, name, base_price_cents, sort)
              values (${t.id}, ${categoryId}, ${await uniqueSlug(tx, 'products', t.id, it.name)}, ${it.name}, ${it.priceCents}, ${sort++})
              returning id
            `
          )[0]!.id,
        );
      }
      await audit(tx, t.id, m, {
        action: 'product.import',
        entity: 'product',
        summary: `colou uma lista e criou ${created.length} produtos`,
        after: { items },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: { created: created.length, ids: created } };
    }),
  );

  // parse only, nothing written — a read with a body, so no idempotency claim
  admin.post('/products/import/preview', async (c) => {
    need(c, 'manager');
    const body = await bodyJson(c, 64 * 1024);
    return c.json({ items: parseMenuPaste(text(body.text, 'text', 20_000)) });
  });
}

/** Next 00:00 in the store's timezone — when "esgotado hoje" ends. */
export async function nextLocalMidnight(tx: Sql, tenantId: string): Promise<Date> {
  const tz = await storeTz(tx, tenantId);
  const row = (
    await tx<{ at: Date }[]>`
      select ((date_trunc('day', now() at time zone ${tz}) + interval '1 day') at time zone ${tz}) as at
    `
  )[0]!;
  return new Date(row.at);
}

function pick<T extends object>(o: T, keys: (keyof T)[]) {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

function pickBody(body: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

const BULK_ACTIONS = [
  'available',
  'sold_out_today',
  'sold_out',
  'hidden',
  'category',
  'price_percent',
  'price_amount',
  'stock',
  'schedule',
  'delete',
  'restore',
  'revert',
] as const;

interface BulkRow {
  id: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  promoSchedule: PromoSchedule | null;
  status: string;
  soldOutUntil: Date | null;
  categoryId: string;
  stockQuantity: number | null;
  availabilitySchedule: AvailabilitySchedule | null;
  deleted: boolean;
}

const bulkCols = (tx: Sql) => tx`
  p.id, p.name, p.base_price_cents as "priceCents", p.compare_at_price_cents as "compareAtPriceCents",
  p.promo_schedule as "promoSchedule", p.status, p.sold_out_until as "soldOutUntil",
  p.category_id as "categoryId", p.stock_quantity as "stockQuantity",
  p.availability_schedule as "availabilitySchedule", p.deleted_at is not null as deleted
`;

/** The trigger keeps it archived from here on; "esgotado hoje" has nothing left to end. */
async function softDelete(tx: Sql, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  await tx`
    update products set deleted_status = status, deleted_at = now(), sold_out_until = null
    where tenant_id = ${tenantId} and id = any(${ids}::uuid[]) and deleted_at is null
  `;
}

async function restore(tx: Sql, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  await tx`
    update products set deleted_at = null, status = coalesce(deleted_status, 'archived'),
      deleted_status = null
    where tenant_id = ${tenantId} and id = any(${ids}::uuid[]) and deleted_at is not null
  `;
}

interface Revert {
  id: string;
  categoryId?: string;
  price?: { base: number; cmp: number | null; promo: PromoSchedule | null };
  status?: { status: 'active' | 'sold_out' | 'archived'; until: Date | null };
  stock?: number | null;
  schedule?: AvailabilitySchedule | null;
}

/** One `before` entry of a bulk answer, checked like the write that first set it. */
function parseRevert(x: unknown, i: number): Revert {
  const at = `items[${i}]`;
  if (!isObj(x) || typeof x.id !== 'string' || !UUID_RE.test(x.id))
    throw new HttpError(422, 'BAD_REQUEST', `${at}.id must be an id`, { field: `${at}.id` });
  const out: Revert = { id: x.id.toLowerCase() };
  if (x.categoryId !== undefined) {
    if (typeof x.categoryId !== 'string' || !UUID_RE.test(x.categoryId))
      throw new HttpError(422, 'BAD_REQUEST', 'pick a category', { field: `${at}.categoryId` });
    out.categoryId = x.categoryId;
  }
  if (x.priceCents !== undefined) {
    const base = int(x.priceCents, `${at}.priceCents`, 0, MAX_PRICE);
    const cmp =
      x.compareAtPriceCents == null
        ? null
        : int(x.compareAtPriceCents, `${at}.compareAtPriceCents`, 1, MAX_PRICE);
    if (cmp !== null && cmp <= base)
      throw new HttpError(422, 'BAD_REQUEST', 'the "de" price must be above the price', {
        field: `${at}.compareAtPriceCents`,
      });
    const promo = x.promoSchedule == null ? null : parsePromoSchedule(x.promoSchedule, MAX_PRICE);
    if (promo && promo.priceCents >= base)
      throw new HttpError(422, 'BAD_REQUEST', 'the promotion price must be below the price', {
        field: `${at}.promoSchedule.priceCents`,
      });
    out.price = { base, cmp, promo };
  }
  if (x.status !== undefined) {
    const status = oneOf(x.status, `${at}.status`, ['active', 'sold_out', 'archived'] as const);
    let until: Date | null = null;
    if (status === 'sold_out' && x.soldOutUntil != null) {
      const d = new Date(text(x.soldOutUntil, `${at}.soldOutUntil`, 40));
      // "esgotado hoje" ends by the next midnight; one already past is the sweeper's to end
      if (Number.isNaN(d.getTime()) || Math.abs(d.getTime() - Date.now()) > 2 * 86_400_000)
        throw new HttpError(422, 'BAD_REQUEST', 'soldOutUntil is not today', {
          field: `${at}.soldOutUntil`,
        });
      until = d;
    }
    out.status = { status, until };
  }
  if (x.stockQuantity !== undefined)
    out.stock =
      x.stockQuantity === null ? null : int(x.stockQuantity, `${at}.stockQuantity`, 0, MAX_STOCK);
  if (x.availabilitySchedule !== undefined)
    out.schedule = parseAvailabilitySchedule(x.availabilitySchedule);
  return out;
}

/** Puts back what a bulk action changed; products apagados meanwhile are left alone. */
async function revertBulk(tx: Sql, tenantId: string, m: Merchant, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 300)
    throw new HttpError(422, 'BAD_REQUEST', 'items must list 1–300 products', { field: 'items' });
  const byId = new Map(raw.map((x, i) => parseRevert(x, i)).map((r) => [r.id, r]));
  const ids = [...byId.keys()].sort();
  const live = (
    await tx<{ id: string }[]>`
      select id from products where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
        and deleted_at is null
      order by id for update
    `
  ).map((r) => r.id);
  const cats = new Set<string>();
  let woken = 0;
  for (const id of live) {
    const x = byId.get(id)!;
    const set: Record<string, unknown> = {};
    if (x.categoryId) {
      if (!cats.has(x.categoryId)) cats.add(await categoryOf(tx, tenantId, x.categoryId));
      set.category_id = x.categoryId;
    }
    if (x.price) {
      set.base_price_cents = x.price.base;
      set.compare_at_price_cents = x.price.cmp;
      set.promo_schedule = x.price.promo ? tx.json(x.price.promo as never) : null;
    }
    if (x.schedule !== undefined)
      set.availability_schedule = x.schedule ? tx.json(x.schedule as never) : null;
    if (Object.keys(set).length)
      await tx`update products set ${tx(set as never)} where tenant_id = ${tenantId} and id = ${id}`;
    if (x.status || x.stock !== undefined) {
      woken += (
        await setStock(tx, tenantId, id, {
          ...(x.status ? { status: x.status.status } : {}),
          ...(x.stock !== undefined ? { stockQuantity: x.stock } : {}),
        })
      ).waiting;
      if (x.status)
        await tx`update products set sold_out_until = ${x.status.until} where tenant_id = ${tenantId} and id = ${id}`;
    }
  }
  await audit(tx, tenantId, m, {
    action: 'product.bulk.revert',
    entity: 'product',
    summary: `desfez a última mudança em ${live.length} ${live.length === 1 ? 'produto' : 'produtos'}`,
    after: { ids: live },
  });
  if (live.length) await emitAdminTx(tx, tenantId, 'catalog');
  return { status: 200, body: { updated: live.length, waitlistWoken: woken } };
}
