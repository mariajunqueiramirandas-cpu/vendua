import type { CartView } from '../modules/cart.ts';
import { liveStatus } from '../modules/catalog.ts';
import type { Sql } from '../platform/db.ts';
import { brl } from './cards.ts';
import type { StoreAgentSettings } from './settings.ts';

// Suggestions come from Core, not the model's taste (sales-agent.md §4.11): pinned pairings,
// what this store's shoppers buy together, a combo that holds what's in the cart with its exact
// saving, this customer's usual add-on. At most two, each with its reason and figures. Health
// facts never feed this.

export interface Suggestion {
  productId: string;
  slug: string;
  name: string;
  priceCents: number;
  source: 'pinned' | 'basket' | 'combo' | 'habit';
  reason: string;
  /** a combo's exact saving against the lines it would replace */
  savingCents: number | null;
}

const MIN_SUPPORT_ORDERS = 3;
const MIN_SUPPORT_SHARE = 0.1;

interface ProductLite {
  id: string;
  slug: string;
  name: string;
  base_price_cents: number;
  status: string;
  stock_quantity: number | null;
  category_id: string;
  kind: string;
}

export async function suggestFor(
  tx: Sql,
  tenantId: string,
  cart: CartView,
  o: { phone: string | null; settings: StoreAgentSettings; declined: readonly string[] },
): Promise<Suggestion[]> {
  if (!cart.items.length) return [];
  const inCart = new Set(cart.items.map((i) => i.productId));
  const products = await tx<ProductLite[]>`
    select id, slug, name, base_price_cents, status, stock_quantity, category_id, kind
    from products where tenant_id = ${tenantId} and status <> 'archived'`;
  const byId = new Map(products.map((p) => [p.id, p]));
  const offerable = (id: string) => {
    const p = byId.get(id);
    return (
      !!p &&
      !inCart.has(id) &&
      !o.declined.includes(id) &&
      liveStatus(p.status, p.stock_quantity) === 'active'
    );
  };
  const cartCategories = new Set(
    cart.items.map((i) => byId.get(i.productId)?.category_id).filter(Boolean),
  );
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (!out.some((x) => x.productId === s.productId)) out.push(s);
  };

  for (const pin of o.settings.pinnedPairings)
    if (cartCategories.has(pin.whenCategoryId) && offerable(pin.suggestProductId)) {
      const p = byId.get(pin.suggestProductId)!;
      add({
        productId: p.id,
        slug: p.slug,
        name: p.name,
        priceCents: p.base_price_cents,
        source: 'pinned',
        reason: 'a loja pediu para sugerir junto',
        savingCents: null,
      });
    }

  // a combo whose every slot can take something already in the cart, cheaper than the lines
  const slots = await tx<{ product_id: string; slot_id: string; item_id: string; delta: number }[]>`
    select s.product_id, s.id as slot_id, i.product_id as item_id, i.price_delta_cents as delta
    from combo_slots s join combo_slot_items i on i.slot_id = s.id
    where s.tenant_id = ${tenantId} and s.min_select > 0`;
  const unit = new Map<string, number>();
  for (const i of cart.items)
    unit.set(i.productId, Math.min(unit.get(i.productId) ?? Infinity, i.unitPriceCents));
  const combos = new Map<string, Map<string, { item: string; delta: number }[]>>();
  for (const r of slots) {
    const m = combos.get(r.product_id) ?? new Map();
    m.set(r.slot_id, [...(m.get(r.slot_id) ?? []), { item: r.item_id, delta: r.delta }]);
    combos.set(r.product_id, m);
  }
  for (const [comboId, slotMap] of combos) {
    const combo = byId.get(comboId);
    if (!combo || !offerable(comboId)) continue;
    let replaced = 0;
    let extra = 0;
    let ok = true;
    for (const options of slotMap.values()) {
      const hit = options
        .filter((x) => unit.has(x.item))
        .sort((a, b) => unit.get(b.item)! - unit.get(a.item)!)[0];
      if (!hit) {
        ok = false;
        break;
      }
      replaced += unit.get(hit.item)!;
      extra += hit.delta;
    }
    const saving = replaced - (combo.base_price_cents + extra);
    if (ok && saving > 0)
      add({
        productId: combo.id,
        slug: combo.slug,
        name: combo.name,
        priceCents: combo.base_price_cents + extra,
        source: 'combo',
        reason: `o combo sai ${brl(saving)} mais barato que os itens separados`,
        savingCents: saving,
      });
  }

  const ids = [...inCart];
  const together = await tx<{ product_id: string; with_n: number; base_n: number }[]>`
    with base as (
      select distinct o.id from orders o join order_items i on i.order_id = o.id
      where o.tenant_id = ${tenantId} and o.state <> 'cancelled' and o.placed_at > now() - interval '90 days'
        and i.product_id = any(${ids}::uuid[])
    )
    select i.product_id, count(distinct i.order_id)::int as with_n, (select count(*) from base)::int as base_n
    from order_items i where i.order_id in (select id from base) and not (i.product_id = any(${ids}::uuid[]))
    group by i.product_id order by with_n desc limit 10`;
  for (const t of together) {
    if (t.with_n < MIN_SUPPORT_ORDERS || t.base_n === 0 || t.with_n / t.base_n < MIN_SUPPORT_SHARE)
      continue;
    if (!offerable(t.product_id)) continue;
    const p = byId.get(t.product_id)!;
    add({
      productId: p.id,
      slug: p.slug,
      name: p.name,
      priceCents: p.base_price_cents,
      source: 'basket',
      reason: `pedido junto em ${Math.round((100 * t.with_n) / t.base_n)}% dos pedidos com esses itens nesta loja`,
      savingCents: null,
    });
  }

  if (o.phone && !o.phone.startsWith('+')) {
    const habit = await tx<{ product_id: string; n: number }[]>`
      select i.product_id, count(distinct o.id)::int as n
      from (select id from orders where tenant_id = ${tenantId} and customer_phone = ${o.phone}
            and state <> 'cancelled' order by placed_at desc limit 5) o
      join order_items i on i.order_id = o.id
      group by i.product_id having count(distinct o.id) >= 2 order by n desc limit 5`;
    for (const h of habit)
      if (offerable(h.product_id)) {
        const p = byId.get(h.product_id)!;
        add({
          productId: p.id,
          slug: p.slug,
          name: p.name,
          priceCents: p.base_price_cents,
          source: 'habit',
          reason: `costuma pedir junto (${h.n} dos últimos pedidos)`,
          savingCents: null,
        });
      }
  }

  const rank = { pinned: 0, combo: 1, basket: 2, habit: 3 } as const;
  return out.sort((a, b) => rank[a.source] - rank[b.source]).slice(0, 2);
}
