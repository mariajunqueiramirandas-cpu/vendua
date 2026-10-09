import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import { MAX_COST_CENTS } from '../modules/pricing-calc.ts';
import {
  ADJUST_REASONS,
  adjustAddonStock,
  MAX_STOCK,
  setAddonStock,
  type AdjustReason,
} from '../modules/stock.ts';
import { audit } from './audit.ts';
import { int, isObj, oneOf, type AdminDeps } from './context.ts';
import { bodyOf, handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Estoque beyond the product rows: adicionais counted by name (an addon_stock row per
// modifiers.stock_key), each counted item's history, and what the stock is worth.

export interface AdminAddon {
  key: string;
  name: string;
  tracked: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  lowStock: boolean;
  costCents: number | null;
  /** live: counted at 0, or every option with this name marked esgotado */
  status: 'active' | 'sold_out';
  /** the most common extra price among the options with this name */
  priceDeltaCents: number;
  /** products offering it; 0 = counted but no longer offered */
  productCount: number;
  products: { id: string; name: string }[];
}

const MOVES_PAGE = 30;

async function listAddons(tx: Sql, tenantId: string, only?: string): Promise<AdminAddon[]> {
  const [options, counted] = await Promise.all([
    tx<
      {
        key: string;
        name: string;
        price_delta_cents: number;
        status: string;
        product_id: string;
        product_name: string;
      }[]
    >`
      select m.stock_key as key, m.name, m.price_delta_cents, m.status, p.id as product_id,
             p.name as product_name
      from modifiers m
        join modifier_groups g on g.id = m.group_id
        join products p on p.id = g.product_id
      where m.tenant_id = ${tenantId} and p.deleted_at is null
        ${only === undefined ? tx`` : tx`and m.stock_key = ${only}`}
      order by p.sort, p.name
    `,
    tx<
      {
        key: string;
        name: string;
        stock_quantity: number;
        low_stock_threshold: number | null;
        cost_cents: number | null;
      }[]
    >`
      select key, name, stock_quantity, low_stock_threshold, cost_cents from addon_stock
      where tenant_id = ${tenantId} ${only === undefined ? tx`` : tx`and key = ${only}`}
    `,
  ]);
  const by = new Map<
    string,
    {
      names: Map<string, number>;
      prices: Map<number, number>;
      soldOut: boolean;
      products: Map<string, string>;
    }
  >();
  for (const o of options) {
    const a = by.get(o.key) ?? {
      names: new Map(),
      prices: new Map(),
      soldOut: true,
      products: new Map(),
    };
    a.names.set(o.name, (a.names.get(o.name) ?? 0) + 1);
    a.prices.set(o.price_delta_cents, (a.prices.get(o.price_delta_cents) ?? 0) + 1);
    a.soldOut &&= o.status === 'sold_out';
    a.products.set(o.product_id, o.product_name);
    by.set(o.key, a);
  }
  const most = <K>(m: Map<K, number>) => [...m].sort((x, y) => y[1] - x[1])[0]![0];
  const stock = new Map(counted.map((c) => [c.key, c]));
  const keys = new Set([...by.keys(), ...stock.keys()]);
  const out: AdminAddon[] = [];
  for (const key of keys) {
    const a = by.get(key);
    const s = stock.get(key);
    out.push({
      key,
      name: a ? most(a.names) : s!.name,
      tracked: !!s,
      stockQuantity: s?.stock_quantity ?? null,
      lowStockThreshold: s?.low_stock_threshold ?? null,
      lowStock:
        !!s &&
        s.low_stock_threshold != null &&
        s.stock_quantity > 0 &&
        s.stock_quantity <= s.low_stock_threshold,
      costCents: s?.cost_cents ?? null,
      status: s?.stock_quantity === 0 || (a?.soldOut ?? false) ? 'sold_out' : 'active',
      priceDeltaCents: a ? most(a.prices) : 0,
      productCount: a?.products.size ?? 0,
      products: [...(a?.products ?? [])].slice(0, 5).map(([id, name]) => ({ id, name })),
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'pt-BR'));
}

function addonKey(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 80)
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an adicional's key`, { field });
  return v;
}

export function mountStock(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/stock/addons',
    read('manager', async (tx, t) => ({ addons: await listAddons(tx, t.id) })),
  );

  // start or stop counting, an absolute count, the low-stock alert, the unit cost
  admin.patch(
    '/stock/addons',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c);
      const key = addonKey(body.key, 'key');
      const next: Parameters<typeof setAddonStock>[3] = {};
      if (body.stockQuantity !== undefined)
        next.stockQuantity =
          body.stockQuantity === null
            ? null
            : int(body.stockQuantity, 'stockQuantity', 0, MAX_STOCK);
      if (body.lowStockThreshold !== undefined)
        next.lowStockThreshold =
          body.lowStockThreshold === null
            ? null
            : int(body.lowStockThreshold, 'lowStockThreshold', 0, MAX_STOCK) || null;
      if (body.costCents !== undefined)
        next.costCents =
          body.costCents === null ? null : int(body.costCents, 'costCents', 0, MAX_COST_CENTS);
      if (!Object.keys(next).length) throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const [before] = await listAddons(tx, t.id, key);
      if (!before) throw new HttpError(404, 'ADDON_NOT_FOUND', 'no adicional by that name');
      await setAddonStock(tx, t.id, key, next, m.name);
      const [addon] = await listAddons(tx, t.id, key);
      await audit(tx, t.id, m, {
        action: 'addon.stock',
        entity: 'addon',
        entityId: null,
        summary:
          next.stockQuantity === null
            ? `parou de contar o estoque do adicional "${before.name}"`
            : !before.tracked
              ? `começou a contar o adicional "${before.name}" (${next.stockQuantity})`
              : `alterou o estoque do adicional "${before.name}"`,
        before: {
          stockQuantity: before.stockQuantity,
          lowStockThreshold: before.lowStockThreshold,
          costCents: before.costCents,
        },
        after: addon
          ? {
              stockQuantity: addon.stockQuantity,
              lowStockThreshold: addon.lowStockThreshold,
              costCents: addon.costCents,
            }
          : null,
      });
      await emitAdminTx(tx, t.id, 'catalog');
      return { status: 200, body: { addon: addon ?? null } };
    }),
  );

  // the − / + taps, a delivery, a loss: relative, so a sale drawn meanwhile still counts
  admin.post(
    '/stock/addons/adjust',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c);
      if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > 100)
        throw new HttpError(422, 'BAD_REQUEST', 'changes must list 1–100 adicionais', {
          field: 'changes',
        });
      const adds = new Map<string, number>();
      const reasons = new Map<string, AdjustReason>();
      body.changes.forEach((x: unknown, i: number) => {
        if (!isObj(x))
          throw new HttpError(422, 'BAD_REQUEST', `changes[${i}] must be {key, add}`, {
            field: `changes[${i}]`,
          });
        const key = addonKey(x.key, `changes[${i}].key`);
        const add = int(x.add, `changes[${i}].add`, -MAX_STOCK, MAX_STOCK);
        const reason = oneOf(x.reason ?? 'adjust', `changes[${i}].reason`, ADJUST_REASONS);
        adds.set(key, (adds.get(key) ?? 0) + add);
        reasons.set(key, reasons.has(key) && reasons.get(key) !== reason ? 'adjust' : reason);
      });
      // key order, the same as checkout's row locks
      const keys = [...adds.keys()].filter((k) => adds.get(k) !== 0).sort();
      const stock: Record<string, number> = {};
      const before: Record<string, number> = {};
      for (const key of keys) {
        const r = await adjustAddonStock(tx, t.id, key, adds.get(key)!, {
          reason: reasons.get(key)!,
          by: m.name,
        });
        if (!r) continue;
        before[key] = r.before;
        stock[key] = r.after;
      }
      const changed = Object.keys(stock);
      if (changed.length) {
        await audit(tx, t.id, m, {
          action: 'addon.stock.adjust',
          entity: 'addon',
          entityId: null,
          summary:
            changed.length === 1
              ? `ajustou o estoque do adicional "${changed[0]}" (${before[changed[0]!]} → ${stock[changed[0]!]})`
              : `ajustou o estoque de ${changed.length} adicionais`,
          before,
          after: stock,
        });
        await emitAdminTx(tx, t.id, 'catalog');
      }
      return { status: 200, body: { stock } };
    }),
  );

  // one counted item's history, newest first
  admin.get(
    '/stock/movements',
    read('manager', async (tx, t, _m, c) => {
      const productId = c.req.query('productId');
      const key = c.req.query('addonKey');
      if ((productId === undefined) === (key === undefined))
        throw new HttpError(422, 'BAD_REQUEST', 'pass productId or addonKey', {
          field: 'productId',
        });
      if (productId !== undefined && !UUID_RE.test(productId))
        throw new HttpError(422, 'BAD_REQUEST', 'productId must be an id', { field: 'productId' });
      if (key !== undefined) addonKey(key, 'addonKey');
      const cursor = c.req.query('before');
      let after: { at: string; id: string } | null = null;
      if (cursor) {
        const [at, id] = cursor.split('|');
        if (!at || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(at)))
          throw new HttpError(422, 'BAD_REQUEST', 'before is not a cursor from this list', {
            field: 'before',
          });
        after = { at, id };
      }
      const rows = await tx<
        {
          id: string;
          created_at: Date;
          reason: string;
          delta: number;
          after: number | null;
          order_id: string | null;
          number: number | null;
          actor_label: string | null;
        }[]
      >`
        select s.id, s.created_at, s.reason, s.delta, s.after, s.order_id, o.number, s.actor_label
        from stock_movements s
          left join orders o on o.tenant_id = s.tenant_id and o.id = s.order_id
        where s.tenant_id = ${t.id}
          and ${productId !== undefined ? tx`s.product_id = ${productId}` : tx`s.addon_key = ${key!}`}
          ${after ? tx`and (s.created_at, s.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : tx``}
        order by s.created_at desc, s.id desc
        limit ${MOVES_PAGE + 1}
      `;
      const page = rows.slice(0, MOVES_PAGE);
      const last = page.at(-1);
      return {
        movements: page.map((r) => ({
          id: r.id,
          at: r.created_at.toISOString(),
          reason: r.reason,
          delta: r.delta,
          after: r.after,
          order: r.order_id && r.number != null ? { id: r.order_id, number: r.number } : null,
          by: r.actor_label,
        })),
        next:
          rows.length > MOVES_PAGE && last ? `${last.created_at.toISOString()}|${last.id}` : null,
      };
    }),
  );

  // what the counted stock is worth at cost, and what sold in the last 7 days (restock list)
  admin.get(
    '/stock/overview',
    read('manager', async (tx, t) => {
      const [[worth], sold] = await Promise.all([
        tx<{ value: string; costed: number; uncosted: number }[]>`
          with counted as (
            select stock_quantity, cost_cents from products
            where tenant_id = ${t.id} and deleted_at is null and stock_quantity is not null
            union all
            select stock_quantity, cost_cents from addon_stock where tenant_id = ${t.id}
          )
          select coalesce(sum(stock_quantity::bigint * cost_cents), 0)::text as value,
                 count(*) filter (where cost_cents is not null)::int as costed,
                 count(*) filter (where cost_cents is null)::int as uncosted
          from counted
        `,
        tx<{ product_id: string | null; addon_key: string | null; n: number }[]>`
          select product_id, addon_key, (-sum(delta))::int as n from stock_movements
          where tenant_id = ${t.id} and reason = 'sale' and created_at > now() - interval '7 days'
          group by product_id, addon_key
        `,
      ]);
      const products: Record<string, number> = {};
      const addons: Record<string, number> = {};
      for (const s of sold) {
        if (s.product_id) products[s.product_id] = s.n;
        else if (s.addon_key) addons[s.addon_key] = s.n;
      }
      return {
        valueCents: Number(worth!.value),
        costedItems: worth!.costed,
        uncostedItems: worth!.uncosted,
        sold7d: { products, addons },
      };
    }),
  );
}
