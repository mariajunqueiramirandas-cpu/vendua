import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, bodyJson, uuidParam } from '../platform/http.ts';
import {
  loadComboSlots,
  parseAvailabilitySchedule,
  scheduleOpen,
  storeTimezone,
  type AvailabilitySchedule,
} from '../modules/catalog.ts';
import { setStock } from '../modules/stock.ts';
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
} from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeTz } from './routes-orders.ts';

const MAX_PRICE = 10_000_000;

export interface AdminProductRow {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  status: 'active' | 'sold_out' | 'archived';
  kind: 'simple' | 'combo';
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  sort: number;
  soldOutUntil: string | null;
  availabilitySchedule: AvailabilitySchedule | null;
  /** false while outside its schedule */
  availableNow: boolean;
  tags: string[];
  imageUrl: string | null;
  dominant: string | null;
  mediaCount: number;
  groupCount: number;
  waiting: number;
}

const productCols = (tx: Sql) => tx`
  p.id, p.category_id as "categoryId", p.slug, p.name, p.description, p.base_price_cents as "priceCents",
  p.status, p.kind, p.stock_quantity as "stockQuantity", p.low_stock_threshold as "lowStockThreshold",
  p.requires_preorder as "requiresPreorder", p.preorder_lead_days as "preorderLeadDays", p.sort,
  p.sold_out_until as "soldOutUntil", p.tags, p.availability_schedule as "availabilitySchedule",
  (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as "imageUrl",
  (select mo.dominant from product_media m join media_objects mo
     on m.url like '/v1/media/%' and mo.id::text = split_part(split_part(m.url, '/', 5), '.', 1)
   where m.product_id = p.id order by m.sort, m.id limit 1) as dominant,
  (select count(*)::int from product_media m where m.product_id = p.id) as "mediaCount",
  (select count(*)::int from modifier_groups g where g.product_id = p.id) as "groupCount",
  (select count(*)::int from notify_requests n where n.product_id = p.id and n.notified_at is null) as waiting
`;

/** availableNow from the schedule, in the store's timezone */
async function withNow(tx: Sql, tenantId: string, rows: AdminProductRow[]) {
  const tz = rows.some((r) => r.availabilitySchedule)
    ? await storeTimezone(tx, tenantId)
    : 'America/Sao_Paulo';
  const now = new Date();
  for (const r of rows) r.availableNow = scheduleOpen(r.availabilitySchedule, now, tz);
  return rows;
}

async function productRow(tx: Sql, tenantId: string, id: string): Promise<AdminProductRow> {
  const row = (
    await tx<AdminProductRow[]>`
      select ${productCols(tx)} from products p where p.tenant_id = ${tenantId} and p.id = ${id}
    `
  )[0];
  if (!row) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  return (await withNow(tx, tenantId, [row]))[0]!;
}

async function productDetail(tx: Sql, tenantId: string, id: string) {
  const product = await productRow(tx, tenantId, id);
  const groups = await tx<
    { id: string; name: string; required: boolean; min_select: number; max_select: number }[]
  >`
    select id, name, required, min_select, max_select from modifier_groups
    where tenant_id = ${tenantId} and product_id = ${id} order by sort, name
  `;
  const options = await tx<
    { id: string; group_id: string; name: string; price_delta_cents: number; status: string }[]
  >`
    select m.id, m.group_id, m.name, m.price_delta_cents, m.status from modifiers m
      join modifier_groups g on g.id = m.group_id
    where m.tenant_id = ${tenantId} and g.product_id = ${id} order by m.sort, m.name
  `;
  const gallery = await tx`
    select url, alt, width, height from product_media
    where tenant_id = ${tenantId} and product_id = ${id} order by sort, id
  `;
  const sales = (
    await tx<{ qty: number; revenueCents: number }[]>`
      select coalesce(sum(i.qty), 0)::int as qty, coalesce(sum(i.line_total_cents), 0)::int as "revenueCents"
      from order_items i join orders o on o.id = i.order_id
      where i.tenant_id = ${tenantId} and i.product_id = ${id}
        and o.state not in ('cancelled', 'refunded') and o.placed_at > now() - interval '30 days'
    `
  )[0]!;
  return {
    product: {
      ...product,
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        options: options
          .filter((o) => o.group_id === g.id)
          .map((o) => ({
            id: o.id,
            name: o.name,
            priceDeltaCents: o.price_delta_cents,
            status: o.status,
          })),
      })),
      gallery,
      comboSlots: product.kind === 'combo' ? await loadComboSlots(tx, tenantId, id) : [],
      sales30: sales,
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
  const { read, write } = handlers(d);

  admin.get(
    '/catalog',
    read('manager', async (tx, t) => {
      const categories = await tx<{ id: string; slug: string; name: string; sort: number }[]>`
        select id, slug, name, sort from categories where tenant_id = ${t.id} order by sort, name
      `;
      const products = await withNow(
        tx,
        t.id,
        await tx<AdminProductRow[]>`
          select ${productCols(tx)} from products p where p.tenant_id = ${t.id}
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
      const sort = (
        await tx<
          { n: number }[]
        >`select coalesce(max(sort), -1) + 1 as n from categories where tenant_id = ${t.id}`
      )[0]!.n;
      const row = (
        await tx`
          insert into categories (tenant_id, slug, name, sort)
          values (${t.id}, ${await uniqueSlug(tx, 'categories', t.id, name)}, ${name}, ${sort})
          returning id, slug, name, sort
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
      const name = text(body.name, 'name', 60, 1);
      const before = (
        await tx`select name from categories where tenant_id = ${t.id} and id = ${id}`
      )[0];
      if (!before) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'category not found');
      const row = (
        await tx`update categories set name = ${name} where tenant_id = ${t.id} and id = ${id} returning id, slug, name, sort`
      )[0]!;
      await audit(tx, t.id, m, {
        action: 'category.rename',
        entity: 'category',
        entityId: id,
        summary: `renomeou "${before.name}" para "${name}"`,
        before,
        after: { name },
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
      const description = optText(body.description, 'description', 1000) ?? null;
      const sort = (
        await tx<{ n: number }[]>`
            select coalesce(max(sort), -1) + 1 as n from products where tenant_id = ${t.id} and category_id = ${categoryId}
          `
      )[0]!.n;
      const id = (
        await tx<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, description, base_price_cents, sort)
          values (${t.id}, ${categoryId}, ${await uniqueSlug(tx, 'products', t.id, name)}, ${name}, ${description}, ${price}, ${sort})
          returning id
        `
      )[0]!.id;
      await audit(tx, t.id, m, {
        action: 'product.create',
        entity: 'product',
        entityId: id,
        summary: `criou "${name}"`,
        after: { name, priceCents: price },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: await productDetail(tx, t.id, id) };
    }),
  );

  admin.patch(
    '/products/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
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
        before: pick(before, ['name', 'priceCents', 'status', 'stockQuantity', 'categoryId']),
        after: pick(after, ['name', 'priceCents', 'status', 'stockQuantity', 'categoryId']),
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
          insert into products (tenant_id, category_id, slug, name, description, base_price_cents, status, figure_variant,
                                tags, kind, requires_preorder, preorder_lead_days, sort, low_stock_threshold)
          select tenant_id, category_id, ${await uniqueSlug(tx, 'products', t.id, name)}, ${name}, description,
                 base_price_cents, 'archived', figure_variant, tags, kind, requires_preorder, preorder_lead_days,
                 sort + 1, low_stock_threshold
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
            insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
            select tenant_id, ${copy}, name, required, min_select, max_select, sort from modifier_groups where id = ${g.id}
            returning id
          `
        )[0]!.id;
        await tx`
          insert into modifiers (tenant_id, group_id, name, price_delta_cents, status, sort)
          select tenant_id, ${ng}, name, price_delta_cents, status, sort from modifiers where group_id = ${g.id}
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
        const url = text(x.url, `media[${i}].url`, 1000, 1);
        if (!/^(https:\/\/|\/)/.test(url) || url.startsWith('//'))
          throw new HttpError(422, 'BAD_REQUEST', 'photo links must be https:// or uploaded');
        return {
          url,
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
      const body = await bodyJson(c, 64 * 1024);
      if (!Array.isArray(body.groups) || body.groups.length > 12)
        throw new HttpError(422, 'BAD_REQUEST', 'at most 12 option groups', { field: 'groups' });
      const groups = (body.groups as unknown[]).map((g, gi) => {
        if (!isObj(g)) throw new HttpError(422, 'BAD_REQUEST', `groups[${gi}] must be an object`);
        const options = Array.isArray(g.options) ? g.options : [];
        if (options.length === 0 || options.length > 40)
          throw new HttpError(422, 'BAD_REQUEST', `"${String(g.name ?? '')}" needs 1–40 options`, {
            field: `groups[${gi}].options`,
          });
        const minSelect = int(g.minSelect ?? 0, `groups[${gi}].minSelect`, 0, 40);
        const maxSelect = int(g.maxSelect ?? 1, `groups[${gi}].maxSelect`, 1, 40);
        if (minSelect > maxSelect)
          throw new HttpError(422, 'BAD_REQUEST', 'the minimum is above the maximum', {
            field: `groups[${gi}].minSelect`,
          });
        return {
          id: typeof g.id === 'string' && UUID_RE.test(g.id) ? g.id : null,
          name: text(g.name, `groups[${gi}].name`, 60, 1),
          required: minSelect > 0,
          minSelect,
          maxSelect: Math.min(maxSelect, options.length),
          options: options.map((o: unknown, oi: number) => {
            if (!isObj(o)) throw new HttpError(422, 'BAD_REQUEST', 'option must be an object');
            return {
              id: typeof o.id === 'string' && UUID_RE.test(o.id) ? o.id : null,
              name: text(o.name, `groups[${gi}].options[${oi}].name`, 60, 1),
              priceDeltaCents: int(
                o.priceDeltaCents ?? 0,
                'priceDeltaCents',
                -MAX_PRICE,
                MAX_PRICE,
              ),
              status: o.status === 'sold_out' ? 'sold_out' : 'active',
            };
          }),
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
                  max_select = ${g.maxSelect}, sort = ${gs}
                where tenant_id = ${t.id} and product_id = ${id} and id = ${g.id} returning id
              `
            )[0]
          : undefined;
        const gid =
          existing?.id ??
          (
            await tx<{ id: string }[]>`
              insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
              values (${t.id}, ${id}, ${g.name}, ${g.required}, ${g.minSelect}, ${g.maxSelect}, ${gs}) returning id
            `
          )[0]!.id;
        const keepOpts = g.options.map((o) => o.id).filter(Boolean) as string[];
        await tx`
          delete from modifiers where tenant_id = ${t.id} and group_id = ${gid} and not (id = any(${keepOpts}::uuid[]))
        `;
        for (const [os, o] of g.options.entries()) {
          const upd = o.id
            ? (
                await tx`
                  update modifiers set name = ${o.name}, price_delta_cents = ${o.priceDeltaCents}, status = ${o.status}, sort = ${os}
                  where tenant_id = ${t.id} and group_id = ${gid} and id = ${o.id} returning id
                `
              )[0]
            : undefined;
          if (!upd)
            await tx`
              insert into modifiers (tenant_id, group_id, name, price_delta_cents, status, sort)
              values (${t.id}, ${gid}, ${o.name}, ${o.priceDeltaCents}, ${o.status}, ${os})
            `;
        }
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
        return {
          name: text(s.name, `slots[${i}].name`, 80, 1),
          minSelect,
          maxSelect,
          qtyPerItem: int(s.qtyPerItem ?? 1, `slots[${i}].qtyPerItem`, 1, 99),
          items: (s.items as unknown[]).map((it) => {
            const r = isObj(it) ? it : {};
            if (typeof r.productId !== 'string' || !UUID_RE.test(r.productId))
              throw new HttpError(422, 'BAD_REQUEST', 'kit items need a productId');
            return {
              productId: r.productId,
              priceDeltaCents: int(r.priceDeltaCents ?? 0, 'priceDeltaCents', -100_000, 100_000),
            };
          }),
        };
      });
      const p = await productRow(tx, t.id, id);
      await tx`delete from combo_slots where tenant_id = ${t.id} and product_id = ${id}`;
      for (const [sort, s] of slots.entries()) {
        const slotId = (
          await tx<{ id: string }[]>`
            insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
            values (${t.id}, ${id}, ${s.name}, ${s.minSelect}, ${s.maxSelect}, ${s.qtyPerItem}, ${sort}) returning id
          `
        )[0]!.id;
        for (const [isort, it] of s.items.entries()) {
          if (it.productId === id)
            throw new HttpError(422, 'BAD_REQUEST', 'a kit cannot contain itself');
          const ok = (
            await tx`select 1 from products where tenant_id = ${t.id} and id = ${it.productId}`
          )[0];
          if (!ok) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'a kit item no longer exists');
          await tx`
            insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
            values (${t.id}, ${slotId}, ${it.productId}, ${it.priceDeltaCents}, ${isort})
            on conflict (slot_id, product_id) do nothing
          `;
        }
      }
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

  admin.post(
    '/products/bulk',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyJson(c);
      const ids = uuidList(body.ids, 'ids', 300);
      const action = oneOf(body.action, 'action', [
        'available',
        'sold_out_today',
        'hidden',
        'category',
        'price_percent',
      ] as const);
      let summary = '';
      if (action === 'category') {
        const categoryId = await categoryOf(tx, t.id, body.categoryId);
        await tx`update products set category_id = ${categoryId} where tenant_id = ${t.id} and id = any(${ids}::uuid[])`;
        summary = `moveu ${ids.length} produtos de categoria`;
      } else if (action === 'price_percent') {
        const pct = int(body.percent, 'percent', -90, 300);
        if (pct === 0)
          throw new HttpError(422, 'BAD_REQUEST', 'percent cannot be 0', { field: 'percent' });
        // integer cents, rounded to the nearest 10 cents — merchants price in round numbers
        await tx`
          update products set base_price_cents = least(${MAX_PRICE}, greatest(0,
            (round(base_price_cents * (100 + ${pct}) / 1000.0) * 10)::int))
          where tenant_id = ${t.id} and id = any(${ids}::uuid[])
        `;
        summary = `${pct > 0 ? 'aumentou' : 'baixou'} em ${Math.abs(pct)}% o preço de ${ids.length} produtos`;
      } else {
        const status =
          action === 'available' ? 'active' : action === 'hidden' ? 'archived' : 'sold_out';
        const until = action === 'sold_out_today' ? await nextLocalMidnight(tx, t.id) : null;
        for (const id of ids) {
          await setStock(tx, t.id, id, { status }).catch((e) => {
            if ((e as HttpError).code !== 'PRODUCT_NOT_FOUND') throw e;
          });
          await tx`update products set sold_out_until = ${until} where tenant_id = ${t.id} and id = ${id}`;
        }
        summary = `${action === 'available' ? 'disponibilizou' : action === 'hidden' ? 'escondeu' : 'marcou como esgotado hoje'} ${ids.length} produtos`;
      }
      await audit(tx, t.id, m, {
        action: `product.bulk.${action}`,
        entity: 'product',
        summary,
        after: { ids, ...body },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { updated: ids.length } };
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
