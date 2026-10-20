import { MEDIA_PER_DAY, takeMediaCallTx } from '../copilot/media.ts';
import { MAX_PHOTO_ROWS, readInsumosPhoto } from '../modules/insumos-photo.ts';
import { mediaUpload } from '../modules/media-upload.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { bodyJson, HttpError, UUID_RE, uuidParam } from '../platform/http.ts';
import {
  ADJUST_REASONS,
  adjustIngredients,
  costPerK,
  depthOf,
  linesCost,
  loadAllFichas,
  makePreparo,
  makesCycle,
  MAX_CPK_CENTS,
  MAX_DEPTH,
  MAX_INGREDIENTS,
  MAX_LINE_MILLI,
  MAX_LINES,
  MAX_STOCK_MILLI,
  MODES,
  productFichaCost,
  purchaseIngredients,
  setIngredientStock,
  UNITS,
  type AdjustReason,
  type FichaLine,
  type Fichas,
  type Mode,
  type Unit,
} from '../modules/insumos.ts';
import { audit } from './audit.ts';
import { int, isObj, need, oneOf, optText, text, type AdminDeps } from './context.ts';
import { bodyOf, handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Insumos (ADR 0046): the store's ingredients and preparos, their counts, purchases and
// fichas técnicas — per product, per option, per preparo and per order (packaging).

const MOVES_PAGE = 30;
const PHOTO_MAX = 2 * 1024 * 1024;
const PHOTO_JSON_MAX = 3 * 1024 * 1024;
const MAX_OPTIONS = 80;

export interface AdminIngredient {
  id: string;
  kind: 'insumo' | 'preparo';
  name: string;
  unit: Unit;
  stockMilli: number | null;
  lowMilli: number | null;
  parMilli: number | null;
  packMilli: number | null;
  packName: string | null;
  /** an insumo's average cost of 1000 units; a preparo's, from its ficha; null = not stated */
  costPerKCents: number | null;
  /** the insumos without a cost that a preparo's ficha reaches */
  missingCost: string[];
  yieldMilli: number | null;
  /** a preparo's ficha */
  lines: { ingredientId: string; qtyMilli: number; costCents: number }[];
  /** counted, and at or below zero or its aviso */
  low: boolean;
  /** ficha lines that use it */
  uses: number;
  /** drawn by sales in the last 7 days (cancels given back), counted ones only */
  sold7dMilli: number;
  /** stock × average cost, while above zero */
  valueCents: number | null;
  /** what the shopping list suggests buying, while low */
  buyMilli: number | null;
  buyPacks: number | null;
}

type Row = {
  id: string;
  kind: 'insumo' | 'preparo';
  name: string;
  unit: Unit;
  stock_milli: string | null;
  low_milli: string | null;
  par_milli: string | null;
  pack_milli: string | null;
  pack_name: string | null;
  cost_per_k_cents: string | null;
  yield_milli: string | null;
};
const n = (v: string | null) => (v == null ? null : Number(v));

/** What to buy back to the ideal level (else twice the aviso, else a week of sales), in packs. */
export function restockOf(i: {
  stock: number;
  low: number | null;
  par: number | null;
  sold7d: number;
  pack: number | null;
}) {
  const target = i.par ?? Math.max(i.low ? i.low * 2 : 0, i.sold7d);
  const need = Math.max(0, target - Math.max(0, i.stock), i.stock < 0 ? -i.stock : 0);
  if (need <= 0) return { buyMilli: null, buyPacks: null };
  if (!i.pack) return { buyMilli: need, buyPacks: null };
  const packs = Math.ceil(need / i.pack);
  return { buyMilli: packs * i.pack, buyPacks: packs };
}

async function listIngredients(tx: Sql, tenantId: string, only?: string) {
  const [rows, f, uses, sold] = await Promise.all([
    tx<Row[]>`
      select id, kind, name, unit, stock_milli::text, low_milli::text, par_milli::text, pack_milli::text,
             pack_name, cost_per_k_cents::text, yield_milli::text
      from ingredients where tenant_id = ${tenantId} ${only ? tx`and id = ${only}` : tx``}
      order by name
    `,
    loadAllFichas(tx, tenantId),
    tx<{ id: string; n: number }[]>`
      select ingredient_id as id, count(*)::int as n from recipe_lines
      where tenant_id = ${tenantId} group by 1
    `,
    tx<{ id: string; n: string }[]>`
      select ingredient_id as id, (-sum(delta_milli))::text as n from ingredient_movements
      where tenant_id = ${tenantId} and reason in ('sale', 'cancel')
        and created_at > now() - interval '7 days'
      group by 1
    `,
  ]);
  const used = new Map(uses.map((u) => [u.id, u.n]));
  const sold7 = new Map(sold.map((s) => [s.id, Math.max(0, Number(s.n))]));
  const out: AdminIngredient[] = rows.map((r) => {
    const missing = new Set<string>();
    const cpk = r.kind === 'insumo' ? n(r.cost_per_k_cents) : costPerK(f, r.id, missing);
    const stock = n(r.stock_milli);
    const low = n(r.low_milli);
    const sold7d = sold7.get(r.id) ?? 0;
    const isLow = stock != null && (stock <= 0 || (low != null && stock <= low));
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      unit: r.unit,
      stockMilli: stock,
      lowMilli: low,
      parMilli: n(r.par_milli),
      packMilli: n(r.pack_milli),
      packName: r.pack_name,
      costPerKCents: cpk == null ? null : Math.round(cpk),
      missingCost: [...missing].map((id) => f.ingredients.get(id)?.name ?? '').filter(Boolean),
      yieldMilli: n(r.yield_milli),
      lines: (f.preparo.get(r.id) ?? []).map((l) => ({
        ingredientId: l.ingredientId,
        qtyMilli: l.qty,
        costCents: Math.round(linesCost(f, [l])),
      })),
      low: isLow,
      uses: used.get(r.id) ?? 0,
      sold7dMilli: sold7d,
      valueCents:
        stock != null && stock > 0 && cpk != null ? Math.round((stock * cpk) / 1e6) : null,
      ...(isLow
        ? restockOf({ stock: stock!, low, par: n(r.par_milli), sold7d, pack: n(r.pack_milli) })
        : { buyMilli: null, buyPacks: null }),
    };
  });
  return { list: out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), f };
}

const milli = (v: unknown, field: string, min: number, max: number) => int(v, field, min, max);
const optMilli = (v: unknown, field: string, min: number, max: number) =>
  v === undefined ? undefined : v === null ? null : milli(v, field, min, max);

/** `{cents, milli}`: what an amount of it costs → the cost of 1000 units */
function costInput(v: unknown, field: string): number | null {
  if (v === null) return null;
  if (!isObj(v))
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be {cents, milli}`, { field });
  const cents = int(v.cents, `${field}.cents`, 0, 100_000_000);
  const q = milli(v.milli, `${field}.milli`, 1, MAX_LINE_MILLI);
  const cpk = Math.round((cents * 1e6) / q);
  if (cpk > MAX_CPK_CENTS)
    throw new HttpError(422, 'BAD_REQUEST', `${field} is too high for that amount`, { field });
  return cpk;
}

/** A ficha's lines; one ingredient twice in the same mode is summed. */
async function parseLines(
  tx: Sql,
  tenantId: string,
  v: unknown,
  field: string,
  opts: { modes: boolean },
): Promise<FichaLine[]> {
  if (!Array.isArray(v) || v.length > MAX_LINES)
    throw new HttpError(422, 'BAD_REQUEST', `${field} must list at most ${MAX_LINES} insumos`, {
      field,
    });
  const merged = new Map<string, FichaLine>();
  v.forEach((x: unknown, i: number) => {
    const f = `${field}[${i}]`;
    if (!isObj(x))
      throw new HttpError(422, 'BAD_REQUEST', `${f} must be {ingredientId, qtyMilli}`, {
        field: f,
      });
    if (typeof x.ingredientId !== 'string' || !UUID_RE.test(x.ingredientId))
      throw new HttpError(422, 'BAD_REQUEST', `${f}.ingredientId must be an id`, {
        field: `${f}.ingredientId`,
      });
    const qty = milli(x.qtyMilli, `${f}.qtyMilli`, 1, MAX_LINE_MILLI);
    const mode =
      opts.modes && x.mode != null ? oneOf(x.mode, `${f}.mode`, MODES) : (null as Mode | null);
    const key = `${x.ingredientId}|${mode ?? ''}`;
    const prev = merged.get(key);
    merged.set(key, {
      ingredientId: x.ingredientId.toLowerCase(),
      qty: Math.min(MAX_LINE_MILLI, (prev?.qty ?? 0) + qty),
      mode,
    });
  });
  const lines = [...merged.values()];
  const ids = [...new Set(lines.map((l) => l.ingredientId))];
  const found = new Set(
    ids.length
      ? (
          await tx<{ id: string }[]>`
            select id from ingredients where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
          `
        ).map((r) => r.id)
      : [],
  );
  const lost = ids.find((id) => !found.has(id));
  if (lost)
    throw new HttpError(422, 'INGREDIENT_NOT_FOUND', 'an insumo in the ficha does not exist', {
      field,
      ingredientId: lost,
    });
  return lines;
}

type Owner =
  { product: string } | { modifiers: string[] } | { preparo: string } | { perOrder: true };

async function replaceLines(tx: Sql, tenantId: string, owner: Owner, lines: FichaLine[]) {
  const ownerSql =
    'product' in owner
      ? tx`product_id = ${owner.product}`
      : 'modifiers' in owner
        ? tx`modifier_id = any(${owner.modifiers}::uuid[])`
        : 'preparo' in owner
          ? tx`preparo_id = ${owner.preparo}`
          : tx`per_order`;
  await tx`delete from recipe_lines where tenant_id = ${tenantId} and ${ownerSql}`;
  const targets: { product: string | null; modifier: string | null; preparo: string | null }[] =
    'product' in owner
      ? [{ product: owner.product, modifier: null, preparo: null }]
      : 'modifiers' in owner
        ? owner.modifiers.map((m) => ({ product: null, modifier: m, preparo: null }))
        : 'preparo' in owner
          ? [{ product: null, modifier: null, preparo: owner.preparo }]
          : [{ product: null, modifier: null, preparo: null }];
  const rows = targets.flatMap((t) => lines.map((l, sort) => ({ ...t, ...l, sort })));
  if (!rows.length) return;
  const col = <T>(fn: (r: (typeof rows)[number]) => T) => rows.map(fn);
  await tx`
    insert into recipe_lines (tenant_id, product_id, modifier_id, preparo_id, per_order, ingredient_id,
                              qty_milli, mode, sort)
    select ${tenantId}, v.product_id, v.modifier_id, v.preparo_id, ${'perOrder' in owner}, v.ingredient_id,
           v.qty, v.mode, v.sort
    from unnest(${col((r) => r.product)}::uuid[], ${col((r) => r.modifier)}::uuid[],
                ${col((r) => r.preparo)}::uuid[], ${col((r) => r.ingredientId)}::uuid[],
                ${col((r) => r.qty)}::bigint[], ${col((r) => r.mode)}::text[], ${col((r) => r.sort)}::int[])
      as v(product_id, modifier_id, preparo_id, ingredient_id, qty, mode, sort)
  `;
}

/** A ficha's lines with what each costs now, for the screens. */
function linesOut(f: Fichas, lines: FichaLine[]) {
  return lines.map((l) => {
    const ing = f.ingredients.get(l.ingredientId);
    return {
      ingredientId: l.ingredientId,
      name: ing?.name ?? '',
      unit: ing?.unit ?? 'un',
      kind: ing?.kind ?? 'insumo',
      qtyMilli: l.qty,
      mode: l.mode,
      costCents: Math.round(linesCost(f, [l])),
    };
  });
}

/** The ficha of every mode's packaging per order, in cents. */
const perOrderCost = (f: Fichas) =>
  Object.fromEntries(
    MODES.map((m) => [
      m,
      Math.round(
        linesCost(
          f,
          f.perOrder.filter((l) => l.mode == null || l.mode === m),
        ),
      ),
    ]),
  ) as Record<Mode, number>;

async function productFicha(tx: Sql, tenantId: string, productId: string) {
  const [[p], options, f] = await Promise.all([
    tx<{ id: string; kind: string }[]>`
      select id, kind from products where tenant_id = ${tenantId} and id = ${productId} and deleted_at is null
    `,
    tx<
      {
        id: string;
        group_id: string;
        group_name: string;
        name: string;
        price_delta_cents: number;
        same_name: number;
      }[]
    >`
      select m.id, g.id as group_id, g.name as group_name, m.name, m.price_delta_cents,
             (select count(*)::int from modifiers o
                join modifier_groups og on og.id = o.group_id
                join products op on op.id = og.product_id and op.deleted_at is null
              where o.tenant_id = m.tenant_id and o.stock_key = m.stock_key) as same_name
      from modifiers m join modifier_groups g on g.id = m.group_id
      where m.tenant_id = ${tenantId} and g.product_id = ${productId}
      order by g.sort, g.name, m.sort, m.name
    `,
    loadAllFichas(tx, tenantId),
  ]);
  if (!p) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  const missing = new Set<string>();
  const lines = f.product.get(productId) ?? [];
  const cost = productFichaCost(f, productId, missing);
  return {
    kind: p.kind,
    lines: linesOut(f, lines),
    cost,
    options: options.map((o) => {
      const ol = f.modifier.get(o.id) ?? [];
      return {
        id: o.id,
        groupId: o.group_id,
        groupName: o.group_name,
        name: o.name,
        priceDeltaCents: o.price_delta_cents,
        lines: linesOut(f, ol),
        costCents: ol.length ? Math.round(linesCost(f, ol, 1, missing)) : null,
        sameName: o.same_name,
      };
    }),
    missingCost: [...missing].map((id) => f.ingredients.get(id)?.name ?? '').filter(Boolean),
    perOrderCents: perOrderCost(f),
  };
}

function ingredientId(c: Parameters<typeof uuidParam>[0]) {
  return uuidParam(c, 'id');
}

export function mountInsumos(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/insumos',
    read('manager', async (tx, t) => {
      const { list, f } = await listIngredients(tx, t.id);
      return {
        insumos: list,
        perOrder: linesOut(f, f.perOrder),
        perOrderCents: perOrderCost(f),
        valueCents: list.reduce((s, i) => s + (i.valueCents ?? 0), 0),
      };
    }),
  );

  admin.post(
    '/insumos',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c);
      const kind = oneOf(body.kind ?? 'insumo', 'kind', ['insumo', 'preparo'] as const);
      const name = text(body.name, 'name', 80, 1);
      const unit = oneOf(body.unit, 'unit', UNITS);
      const cpk = kind === 'insumo' && body.cost != null ? costInput(body.cost, 'cost') : null;
      const yieldMilli =
        kind === 'preparo' ? milli(body.yieldMilli, 'yieldMilli', 1, MAX_LINE_MILLI) : null;
      const stock = optMilli(body.stockMilli, 'stockMilli', 0, MAX_STOCK_MILLI) ?? null;
      const low = optMilli(body.lowMilli, 'lowMilli', 1, MAX_STOCK_MILLI) ?? null;
      const par = optMilli(body.parMilli, 'parMilli', 1, MAX_STOCK_MILLI) ?? null;
      const pack = optMilli(body.packMilli, 'packMilli', 1, MAX_LINE_MILLI) ?? null;
      const packName = optText(body.packName, 'packName', 24) ?? null;
      const [n] = await tx<{ n: number }[]>`
        select count(*)::int as n from ingredients where tenant_id = ${t.id}`;
      if ((n?.n ?? 0) >= MAX_INGREDIENTS)
        throw new HttpError(409, 'LIMIT_REACHED', `up to ${MAX_INGREDIENTS} insumos`);
      const [row] = await tx<{ id: string }[]>`
        insert into ingredients (tenant_id, kind, name, unit, cost_per_k_cents, yield_milli, low_milli,
                                 par_milli, pack_milli, pack_name)
        values (${t.id}, ${kind}, ${name}, ${unit}, ${cpk}, ${yieldMilli}, ${low}, ${par}, ${pack}, ${packName})
        on conflict (tenant_id, vendua_stock_key(name)) do nothing
        returning id
      `;
      if (!row)
        throw new HttpError(409, 'INGREDIENT_EXISTS', `"${name}" is already an insumo`, {
          field: 'name',
        });
      if (kind === 'preparo' && body.lines !== undefined) {
        const lines = await parseLines(tx, t.id, body.lines, 'lines', { modes: false });
        await assertPreparoLines(tx, t.id, row.id, lines);
        await replaceLines(tx, t.id, { preparo: row.id }, lines);
      }
      if (stock != null) await setIngredientStock(tx, t.id, row.id, stock, m.name);
      const { list } = await listIngredients(tx, t.id, row.id);
      await audit(tx, t.id, m, {
        action: 'insumo.create',
        entity: 'insumo',
        entityId: row.id,
        summary: `criou o ${kind === 'preparo' ? 'preparo' : 'insumo'} "${name}"`,
        after: { kind, name, unit, costPerKCents: cpk, stockMilli: stock },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 201, body: { insumo: list[0] } };
    }),
  );

  admin.patch(
    '/insumos/:id',
    write('manager', async (tx, t, m, c) => {
      const id = ingredientId(c);
      const body = await bodyOf(c);
      const { list: [before] = [] } = await listIngredients(tx, t.id, id);
      if (!before) throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found');
      const set: Record<string, unknown> = {};
      if (body.name !== undefined) set.name = text(body.name, 'name', 80, 1);
      if (body.unit !== undefined) {
        const unit = oneOf(body.unit, 'unit', UNITS);
        if (unit !== before.unit && (before.uses > 0 || before.stockMilli != null))
          throw new HttpError(
            409,
            'INGREDIENT_IN_USE',
            'the unit changes only while no ficha uses it and it is not counted',
            { field: 'unit', uses: before.uses },
          );
        set.unit = unit;
      }
      if (body.cost !== undefined) {
        if (before.kind !== 'insumo')
          throw new HttpError(422, 'BAD_REQUEST', 'a preparo costs what its ficha costs', {
            field: 'cost',
          });
        set.cost_per_k_cents = costInput(body.cost, 'cost');
      }
      if (body.yieldMilli !== undefined) {
        if (before.kind !== 'preparo')
          throw new HttpError(422, 'BAD_REQUEST', 'only a preparo yields', { field: 'yieldMilli' });
        set.yield_milli = milli(body.yieldMilli, 'yieldMilli', 1, MAX_LINE_MILLI);
      }
      for (const [k, col, max] of [
        ['lowMilli', 'low_milli', MAX_STOCK_MILLI],
        ['parMilli', 'par_milli', MAX_STOCK_MILLI],
        ['packMilli', 'pack_milli', MAX_LINE_MILLI],
      ] as const)
        if (body[k] !== undefined) set[col] = optMilli(body[k], k, 1, max);
      if (body.packName !== undefined) set.pack_name = optText(body.packName, 'packName', 24);
      const stock =
        body.stockMilli === undefined
          ? undefined
          : optMilli(body.stockMilli, 'stockMilli', 0, MAX_STOCK_MILLI);
      if (!Object.keys(set).length && stock === undefined)
        throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      if (Object.keys(set).length) {
        const cols = Object.keys(set);
        const updated = await tx`
          update ingredients set ${tx(set as never, cols as never)}, updated_at = now()
          where tenant_id = ${t.id} and id = ${id}
            and not exists (
              select 1 from ingredients o where o.tenant_id = ${t.id} and o.id <> ${id}
                and vendua_stock_key(o.name) = vendua_stock_key(${(set.name as string) ?? before.name})
            )
          returning 1
        `;
        if (!updated.length)
          throw new HttpError(409, 'INGREDIENT_EXISTS', 'another insumo has that name', {
            field: 'name',
          });
      }
      if (stock !== undefined) await setIngredientStock(tx, t.id, id, stock, m.name);
      const { list } = await listIngredients(tx, t.id, id);
      await audit(tx, t.id, m, {
        action: 'insumo.update',
        entity: 'insumo',
        entityId: id,
        summary:
          stock === null
            ? `parou de contar "${before.name}"`
            : stock !== undefined && before.stockMilli == null
              ? `começou a contar "${before.name}"`
              : `alterou "${before.name}"`,
        before: {
          name: before.name,
          costPerKCents: before.costPerKCents,
          stockMilli: before.stockMilli,
          lowMilli: before.lowMilli,
        },
        after: {
          name: list[0]!.name,
          costPerKCents: list[0]!.costPerKCents,
          stockMilli: list[0]!.stockMilli,
          lowMilli: list[0]!.lowMilli,
        },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { insumo: list[0] } };
    }),
  );

  // its ficha lines go with it: the screen says where it's used before asking
  admin.delete(
    '/insumos/:id',
    write('manager', async (tx, t, m, c) => {
      const id = ingredientId(c);
      const [gone] = await tx<{ name: string; kind: string }[]>`
        delete from ingredients where tenant_id = ${t.id} and id = ${id} returning name, kind
      `;
      if (!gone) throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found');
      await audit(tx, t.id, m, {
        action: 'insumo.delete',
        entity: 'insumo',
        entityId: id,
        summary: `apagou o ${gone.kind === 'preparo' ? 'preparo' : 'insumo'} "${gone.name}"`,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { deleted: true } };
    }),
  );

  // where it's used: products, options, preparos and the order's packaging
  admin.get(
    '/insumos/:id/uses',
    read('manager', async (tx, t, _m, c) => {
      const id = ingredientId(c);
      const rows = await tx<
        {
          product_id: string | null;
          product_name: string | null;
          option_name: string | null;
          preparo_id: string | null;
          preparo_name: string | null;
          per_order: boolean;
        }[]
      >`
        select coalesce(r.product_id, g.product_id) as product_id, coalesce(p.name, gp.name) as product_name,
               mo.name as option_name, r.preparo_id, pr.name as preparo_name, r.per_order
        from recipe_lines r
          left join products p on p.id = r.product_id
          left join modifiers mo on mo.id = r.modifier_id
          left join modifier_groups g on g.id = mo.group_id
          left join products gp on gp.id = g.product_id
          left join ingredients pr on pr.id = r.preparo_id
        where r.tenant_id = ${t.id} and r.ingredient_id = ${id}
          and coalesce(p.deleted_at, gp.deleted_at) is null
        order by 2, 3 nulls first
        limit 200
      `;
      return {
        products: rows
          .filter((r) => r.product_id)
          .map((r) => ({ id: r.product_id!, name: r.product_name!, option: r.option_name })),
        preparos: rows
          .filter((r) => r.preparo_id)
          .map((r) => ({ id: r.preparo_id!, name: r.preparo_name! })),
        perOrder: rows.some((r) => r.per_order),
      };
    }),
  );

  // a preparo's ficha and how much one batch makes
  admin.put(
    '/insumos/:id/ficha',
    write('manager', async (tx, t, m, c) => {
      const id = ingredientId(c);
      const body = await bodyOf(c, 64 * 1024);
      // every preparo, in id order: two edits at once can't each pass the cycle check
      const locked = await tx<{ id: string; kind: string; name: string }[]>`
        select id, kind, name from ingredients
        where tenant_id = ${t.id} and (id = ${id} or kind = 'preparo')
        order by id for update
      `;
      const p = locked.find((r) => r.id === id.toLowerCase());
      if (!p) throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found');
      if (p.kind !== 'preparo')
        throw new HttpError(422, 'NOT_A_PREPARO', 'only a preparo has a ficha of its own');
      const lines = await parseLines(tx, t.id, body.lines, 'lines', { modes: false });
      await assertPreparoLines(tx, t.id, id, lines);
      if (body.yieldMilli !== undefined)
        await tx`
          update ingredients set yield_milli = ${milli(body.yieldMilli, 'yieldMilli', 1, MAX_LINE_MILLI)},
            updated_at = now()
          where tenant_id = ${t.id} and id = ${id}
        `;
      await replaceLines(tx, t.id, { preparo: id }, lines);
      const { list } = await listIngredients(tx, t.id, id);
      await audit(tx, t.id, m, {
        action: 'insumo.ficha',
        entity: 'insumo',
        entityId: id,
        summary: `editou a ficha do preparo "${p.name}" (${lines.length} insumos)`,
        after: { lines, yieldMilli: list[0]!.yieldMilli },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { insumo: list[0] } };
    }),
  );

  // the − / + taps and losses: relative, so a sale drawn meanwhile still counts
  admin.post(
    '/insumos/adjust',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c);
      if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > 100)
        throw new HttpError(422, 'BAD_REQUEST', 'changes must list 1–100 insumos', {
          field: 'changes',
        });
      const adds = new Map<string, { add: number; reason: AdjustReason }>();
      body.changes.forEach((x: unknown, i: number) => {
        const f = `changes[${i}]`;
        if (!isObj(x) || typeof x.id !== 'string' || !UUID_RE.test(x.id))
          throw new HttpError(422, 'BAD_REQUEST', `${f} must be {id, addMilli}`, { field: f });
        const add = milli(x.addMilli, `${f}.addMilli`, -MAX_STOCK_MILLI, MAX_STOCK_MILLI);
        const reason = oneOf(x.reason ?? 'adjust', `${f}.reason`, ADJUST_REASONS);
        const prev = adds.get(x.id.toLowerCase());
        adds.set(x.id.toLowerCase(), {
          add: (prev?.add ?? 0) + add,
          reason: prev && prev.reason !== reason ? 'adjust' : reason,
        });
      });
      const stock = await adjustIngredients(
        tx,
        t.id,
        [...adds].map(([id, v]) => ({ id, ...v })),
        m.name,
      );
      const changed = Object.keys(stock);
      if (changed.length) {
        const loss = [...adds.values()].every((v) => v.reason === 'loss');
        await audit(tx, t.id, m, {
          action: loss ? 'insumo.loss' : 'insumo.adjust',
          entity: 'insumo',
          entityId: changed.length === 1 ? changed[0]! : null,
          summary: loss
            ? `registrou perda em ${changed.length} ${changed.length === 1 ? 'insumo' : 'insumos'}`
            : `ajustou o estoque de ${changed.length} ${changed.length === 1 ? 'insumo' : 'insumos'}`,
          after: stock,
        });
        await emitAdminTx(tx, t.id, 'catalog');
      }
      return { status: 200, body: { stock } };
    }),
  );

  // what arrived and what it cost: the average cost moves with each purchase
  admin.post(
    '/insumos/purchases',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c);
      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 60)
        throw new HttpError(422, 'BAD_REQUEST', 'items must list 1–60 insumos', {
          field: 'items',
        });
      const seen = new Set<string>();
      const items = body.items.map((x: unknown, i: number) => {
        const f = `items[${i}]`;
        if (!isObj(x) || typeof x.id !== 'string' || !UUID_RE.test(x.id))
          throw new HttpError(422, 'BAD_REQUEST', `${f} must be {id, qtyMilli, costCents}`, {
            field: f,
          });
        const id = x.id.toLowerCase();
        if (seen.has(id))
          throw new HttpError(422, 'BAD_REQUEST', 'an insumo appears twice', { field: `${f}.id` });
        seen.add(id);
        return {
          id,
          qty: milli(x.qtyMilli, `${f}.qtyMilli`, 1, MAX_LINE_MILLI),
          costCents: int(x.costCents, `${f}.costCents`, 0, 100_000_000),
        };
      });
      const note = optText(body.note, 'note', 120) ?? null;
      await purchaseIngredients(tx, t.id, items, note, m.name);
      const total = items.reduce((s: number, i: { costCents: number }) => s + i.costCents, 0);
      await audit(tx, t.id, m, {
        action: 'insumo.purchase',
        entity: 'insumo',
        entityId: items.length === 1 ? items[0]!.id : null,
        summary: `registrou uma compra de ${items.length} ${items.length === 1 ? 'insumo' : 'insumos'}${note ? ` (${note})` : ''}`,
        after: { items, totalCents: total },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      const { list } = await listIngredients(tx, t.id);
      return { status: 200, body: { insumos: list.filter((x) => seen.has(x.id)) } };
    }),
  );

  // "Foto ou print" (modules/insumos-photo.ts): one photo per call, read and matched to the
  // store's insumos for review; nothing is written but the day's media ledger
  admin.post('/insumos/photo', async (c) => {
    const m = need(c, 'manager');
    const t = c.get('tenant');
    const gateway = d.copilotMedia.gateway;
    if (!gateway) throw new HttpError(503, 'MEDIA_UNAVAILABLE', 'photo reading is off here');
    const body = await bodyJson(c, PHOTO_JSON_MAX);
    const up = mediaUpload({ ...body, kind: 'image' }, { maxBytes: PHOTO_MAX, maxCaption: 0 });
    const names = await withTenant(d.sql, t.id, async (tx) => {
      if (!(await takeMediaCallTx(tx, t.id, m.userId, 'image')))
        throw new HttpError(429, 'RATE_LIMITED', `at most ${MEDIA_PER_DAY} photos a day`);
      return (
        await tx<{ name: string }[]>`
          select name from ingredients where tenant_id = ${t.id} and kind = 'insumo'
          order by updated_at desc limit 300`
      ).map((r) => r.name);
    });
    const read = await readInsumosPhoto(gateway, t.id, up.bytes, names);
    if (!read) throw new HttpError(422, 'IMAGE_UNREAD', 'não consegui ler a foto');
    const matches = read.rows.length
      ? await withTenant(
          d.sql,
          t.id,
          (tx) => tx<{ ord: number; id: string }[]>`
            select r.ord::int as ord, i.id
            from unnest(${read.rows.map((r) => r.name)}::text[]) with ordinality as r(name, ord)
            join ingredients i on i.tenant_id = ${t.id} and i.kind = 'insumo'
              and vendua_stock_key(i.name) = vendua_stock_key(r.name)
          `,
        )
      : [];
    const byOrd = new Map(matches.map((x) => [x.ord, x.id]));
    return c.json({
      kind: read.kind,
      rows: read.rows.map((r, i) => ({ ...r, matchId: byOrd.get(i + 1) ?? null })),
    });
  });

  // the reviewed photo: missing insumos created, what was bought registered as one purchase,
  // and a price list's prices set as the cost, all or nothing
  admin.post(
    '/insumos/import',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c, 128 * 1024);
      if (
        !Array.isArray(body.items) ||
        body.items.length === 0 ||
        body.items.length > MAX_PHOTO_ROWS
      )
        throw new HttpError(422, 'BAD_REQUEST', `items must list 1–${MAX_PHOTO_ROWS} insumos`, {
          field: 'items',
        });
      const items = body.items.map((x: unknown, i: number) => {
        const f = `items[${i}]`;
        if (!isObj(x))
          throw new HttpError(422, 'BAD_REQUEST', `${f} must be an object`, { field: f });
        if (x.id != null && (typeof x.id !== 'string' || !UUID_RE.test(x.id)))
          throw new HttpError(422, 'BAD_REQUEST', `${f}.id must be a uuid`, { field: `${f}.id` });
        const qty = optMilli(x.qtyMilli, `${f}.qtyMilli`, 1, MAX_LINE_MILLI) ?? null;
        const paid =
          x.costCents == null ? null : int(x.costCents, `${f}.costCents`, 0, 100_000_000);
        if ((qty == null) !== (paid == null))
          throw new HttpError(422, 'BAD_REQUEST', `${f} needs both qtyMilli and costCents`, {
            field: f,
          });
        return {
          f,
          id: typeof x.id === 'string' ? (x.id.toLowerCase() as string | null) : null,
          name: x.id == null ? text(x.name, `${f}.name`, 80, 1) : null,
          key: null as string | null,
          unit: oneOf(x.unit, `${f}.unit`, UNITS),
          qty,
          paid,
          cpk: qty == null && x.cost != null ? costInput(x.cost, `${f}.cost`) : null,
          pack: optMilli(x.packMilli, `${f}.packMilli`, 1, MAX_LINE_MILLI) ?? null,
          packName: optText(x.packName, `${f}.packName`, 24) ?? null,
        };
      });
      const note = optText(body.note, 'note', 120) ?? null;

      // a new name the store already has (or one this photo lists twice) is that one insumo
      const unnamed = items.filter((x) => !x.id);
      if (unnamed.length) {
        const keys = await tx<{ k: string; id: string | null }[]>`
          select vendua_stock_key(r.name) as k, i.id
          from unnest(${unnamed.map((x) => x.name!)}::text[]) with ordinality as r(name, ord)
          left join ingredients i on i.tenant_id = ${t.id}
            and vendua_stock_key(i.name) = vendua_stock_key(r.name)
          order by r.ord
        `;
        for (const [i, x] of unnamed.entries()) {
          x.key = keys[i]!.k;
          x.id = keys[i]!.id;
        }
      }
      // the insumos already there, locked in id order like a sale's draw
      const named = [...new Set(items.filter((x) => x.id).map((x) => x.id!))].sort();
      const have = new Map(
        (
          await tx<{ id: string; kind: string; name: string; unit: Unit; pack: number | null }[]>`
            select id, kind, name, unit, pack_milli::float8 as pack from ingredients
            where tenant_id = ${t.id} and id = any(${named}::uuid[])
            order by id for update
          `
        ).map((r) => [r.id, r]),
      );
      const fresh = new Set(items.filter((x) => !x.id).map((x) => x.key)).size;
      if (fresh) {
        const [n] = await tx<{ n: number }[]>`
          select count(*)::int as n from ingredients where tenant_id = ${t.id}`;
        if ((n?.n ?? 0) + fresh > MAX_INGREDIENTS)
          throw new HttpError(409, 'LIMIT_REACHED', `up to ${MAX_INGREDIENTS} insumos`);
      }
      const made = new Map<string, { id: string; name: string; unit: Unit }>();
      const buys = new Map<string, { qty: number; costCents: number }>();
      const prices = new Map<string, number>();
      for (const x of items) {
        const mine = x.id ? have.get(x.id) : made.get(x.key!);
        if (x.id && !mine)
          throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found', {
            field: `${x.f}.id`,
          });
        if (mine && 'kind' in mine && mine.kind !== 'insumo')
          throw new HttpError(
            422,
            'PREPARO_NOT_BOUGHT',
            `"${mine.name}" is made here, not bought`,
            {
              field: x.name ? `${x.f}.name` : `${x.f}.id`,
            },
          );
        if (mine && mine.unit !== x.unit)
          throw new HttpError(
            422,
            'INGREDIENT_UNIT_MISMATCH',
            `"${mine.name}" is counted in ${mine.unit}`,
            { field: `${x.f}.unit` },
          );
        let id: string;
        if (mine) {
          id = mine.id;
          if ('pack' in mine && mine.pack == null && x.pack != null) {
            await tx`
              update ingredients set pack_milli = ${x.pack},
                pack_name = coalesce(pack_name, ${x.packName}), updated_at = now()
              where tenant_id = ${t.id} and id = ${id}`;
            mine.pack = x.pack;
          }
        } else {
          const [row] = await tx<{ id: string }[]>`
            insert into ingredients (tenant_id, kind, name, unit, pack_milli, pack_name)
            values (${t.id}, 'insumo', ${x.name}, ${x.unit}, ${x.pack}, ${x.pack ? x.packName : null})
            on conflict (tenant_id, vendua_stock_key(name)) do nothing
            returning id
          `;
          if (!row)
            throw new HttpError(409, 'INGREDIENT_EXISTS', `"${x.name}" is already an insumo`, {
              field: `${x.f}.name`,
            });
          id = row.id;
          made.set(x.key!, { id, name: x.name!, unit: x.unit });
        }
        if (x.qty != null) {
          const b = buys.get(id) ?? { qty: 0, costCents: 0 };
          buys.set(id, { qty: b.qty + x.qty, costCents: b.costCents + x.paid! });
        } else if (x.cpk != null) prices.set(id, x.cpk);
      }
      const priced = [...prices]
        .filter(([id]) => !buys.has(id))
        .sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [id, cpk] of priced)
        await tx`
          update ingredients set cost_per_k_cents = ${cpk}, updated_at = now()
          where tenant_id = ${t.id} and id = ${id}`;
      const bought = [...buys].map(([id, b]) => {
        if (b.qty > MAX_LINE_MILLI || b.costCents > 100_000_000)
          throw new HttpError(422, 'BAD_REQUEST', 'one insumo was bought too much', {
            field: 'items',
          });
        return { id, ...b };
      });
      if (bought.length) await purchaseIngredients(tx, t.id, bought, note, m.name);
      const total = bought.reduce((s, b) => s + b.costCents, 0);
      await audit(tx, t.id, m, {
        action: 'insumo.import',
        entity: 'insumo',
        entityId: null,
        summary: `lançou uma foto: ${[
          bought.length
            ? `compra de ${bought.length} ${bought.length === 1 ? 'insumo' : 'insumos'}`
            : null,
          priced.length ? `${priced.length} ${priced.length === 1 ? 'custo' : 'custos'}` : null,
          made.size ? `${made.size} ${made.size === 1 ? 'insumo novo' : 'insumos novos'}` : null,
        ]
          .filter(Boolean)
          .join(', ')}${note ? ` (${note})` : ''}`,
        after: {
          created: [...made.values()].map((x) => x.name),
          bought: bought.map((b) => ({ id: b.id, qtyMilli: b.qty, costCents: b.costCents })),
          priced: priced.map(([id, cpk]) => ({ id, costPerKCents: cpk })),
          totalCents: total,
        },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return {
        status: 200,
        body: {
          created: made.size,
          bought: bought.length,
          priced: priced.length,
          totalCents: total,
        },
      };
    }),
  );

  // a batch of a counted preparo was made
  admin.post(
    '/insumos/:id/made',
    write('manager', async (tx, t, m, c) => {
      const id = ingredientId(c);
      const body = await bodyOf(c);
      const made = milli(body.qtyMilli, 'qtyMilli', 1, MAX_LINE_MILLI);
      await makePreparo(tx, t.id, id, made, m.name);
      const { list } = await listIngredients(tx, t.id, id);
      await audit(tx, t.id, m, {
        action: 'insumo.made',
        entity: 'insumo',
        entityId: id,
        summary: `registrou que fez "${list[0]!.name}"`,
        after: { qtyMilli: made },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { insumo: list[0] } };
    }),
  );

  admin.get(
    '/insumos/:id/movements',
    read('manager', async (tx, t, _m, c) => {
      const id = ingredientId(c);
      const cursor = c.req.query('before');
      if (cursor !== undefined && !UUID_RE.test(cursor))
        throw new HttpError(422, 'BAD_REQUEST', 'before is not a cursor from this list', {
          field: 'before',
        });
      const rows = await tx<
        {
          id: string;
          created_at: Date;
          reason: string;
          delta_milli: string;
          after_milli: string | null;
          cost_cents: number | null;
          order_id: string | null;
          number: number | null;
          actor_label: string | null;
          note: string | null;
        }[]
      >`
        select s.id, s.created_at, s.reason, s.delta_milli::text, s.after_milli::text, s.cost_cents,
               s.order_id, o.number, s.actor_label, s.note
        from ingredient_movements s
          left join orders o on o.tenant_id = s.tenant_id and o.id = s.order_id
        where s.tenant_id = ${t.id} and s.ingredient_id = ${id}
          ${
            cursor
              ? tx`and (s.created_at, s.id) < (select x.created_at, x.id from ingredient_movements x
                                                 where x.tenant_id = ${t.id} and x.id = ${cursor})`
              : tx``
          }
        order by s.created_at desc, s.id desc
        limit ${MOVES_PAGE + 1}
      `;
      const page = rows.slice(0, MOVES_PAGE);
      return {
        movements: page.map((r) => ({
          id: r.id,
          at: r.created_at.toISOString(),
          reason: r.reason,
          deltaMilli: Number(r.delta_milli),
          afterMilli: n(r.after_milli),
          costCents: r.cost_cents,
          order: r.order_id && r.number != null ? { id: r.order_id, number: r.number } : null,
          by: r.actor_label,
          note: r.note,
        })),
        next: rows.length > MOVES_PAGE ? page.at(-1)!.id : null,
      };
    }),
  );

  // packaging every order takes (a bag, napkins), per mode
  admin.put(
    '/insumos/por-pedido',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c, 64 * 1024);
      const lines = await parseLines(tx, t.id, body.lines, 'lines', { modes: true });
      await replaceLines(tx, t.id, { perOrder: true }, lines);
      const f = await loadAllFichas(tx, t.id);
      await audit(tx, t.id, m, {
        action: 'insumo.per_order',
        entity: 'insumo',
        entityId: null,
        summary: `editou a embalagem de cada pedido (${lines.length} itens)`,
        after: { lines },
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return {
        status: 200,
        body: { perOrder: linesOut(f, f.perOrder), perOrderCents: perOrderCost(f) },
      };
    }),
  );

  admin.get(
    '/products/:id/ficha',
    read('manager', async (tx, t, _m, c) => ({
      ficha: await productFicha(tx, t.id, uuidParam(c, 'id')),
    })),
  );

  // the product's ficha (with packaging per mode) and, optionally, its options' fichas; an
  // option's `sameName` gives the same ficha to every option with its name across the store
  admin.put(
    '/products/:id/ficha',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 128 * 1024);
      const [p] = await tx<{ name: string }[]>`
        select name from products where tenant_id = ${t.id} and id = ${id} and deleted_at is null
      `;
      if (!p) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
      if (body.lines !== undefined) {
        const lines = await parseLines(tx, t.id, body.lines, 'lines', { modes: true });
        await replaceLines(tx, t.id, { product: id }, lines);
      }
      let optionCount = 0;
      if (body.options !== undefined) {
        if (!Array.isArray(body.options) || body.options.length > MAX_OPTIONS)
          throw new HttpError(422, 'BAD_REQUEST', `options: at most ${MAX_OPTIONS}`, {
            field: 'options',
          });
        const own = new Map(
          (
            await tx<{ id: string; stock_key: string }[]>`
              select m.id, m.stock_key from modifiers m join modifier_groups g on g.id = m.group_id
              where m.tenant_id = ${t.id} and g.product_id = ${id}
            `
          ).map((r) => [r.id, r.stock_key]),
        );
        for (const [i, o] of (body.options as unknown[]).entries()) {
          const f = `options[${i}]`;
          if (!isObj(o) || typeof o.id !== 'string' || !own.has(o.id.toLowerCase()))
            throw new HttpError(422, 'OPTION_NOT_FOUND', `${f} is not an option of this product`, {
              field: `${f}.id`,
            });
          const oid = o.id.toLowerCase();
          const lines = await parseLines(tx, t.id, o.lines, `${f}.lines`, { modes: true });
          const targets =
            o.sameName === true
              ? (
                  await tx<{ id: string }[]>`
                    select m.id from modifiers m
                      join modifier_groups g on g.id = m.group_id
                      join products op on op.id = g.product_id and op.deleted_at is null
                    where m.tenant_id = ${t.id} and m.stock_key = ${own.get(oid)!}
                  `
                ).map((r) => r.id)
              : [oid];
          await replaceLines(tx, t.id, { modifiers: targets }, lines);
          optionCount += targets.length;
        }
      }
      const ficha = await productFicha(tx, t.id, id);
      await audit(tx, t.id, m, {
        action: 'product.ficha',
        entity: 'product',
        entityId: id,
        summary: `editou a ficha técnica de "${p.name}"${optionCount ? ` e de ${optionCount} ${optionCount === 1 ? 'opção' : 'opções'}` : ''}`,
        after: { lines: body.lines ?? null, options: optionCount },
      });
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: { ficha } };
    }),
  );
}

/** A preparo's ficha may not reach back to it, nor nest past MAX_DEPTH. */
async function assertPreparoLines(tx: Sql, tenantId: string, id: string, lines: FichaLine[]) {
  if (lines.some((l) => l.ingredientId === id))
    throw new HttpError(422, 'FICHA_CYCLE', 'a preparo cannot use itself', { field: 'lines' });
  const f = await loadAllFichas(tx, tenantId);
  if (makesCycle(f, id, lines))
    throw new HttpError(422, 'FICHA_CYCLE', 'this ficha uses a preparo made from this one', {
      field: 'lines',
    });
  // its own depth, plus how deep the preparos using it already go
  const above = (target: string, seen: string[]): number =>
    Math.max(
      0,
      ...[...f.preparo]
        .filter(([pid, ls]) => !seen.includes(pid) && ls.some((l) => l.ingredientId === target))
        .map(([pid]) => 1 + above(pid, [...seen, pid])),
    );
  if (depthOf(f, lines) + above(id, [id]) > MAX_DEPTH)
    throw new HttpError(422, 'FICHA_TOO_DEEP', `preparos nest at most ${MAX_DEPTH} deep`, {
      field: 'lines',
    });
}
