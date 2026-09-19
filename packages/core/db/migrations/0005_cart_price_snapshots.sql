-- Cart items snapshot their price at add time: a catalog price edit must not
-- retroactively reprice lines a customer already accepted (order integrity).
-- Live availability still revalidates at checkout — this freezes only money.

alter table cart_items
  add column unit_price_cents integer,
  add column modifier_snapshot jsonb not null default '[]'::jsonb;

-- Backfill existing dev carts at current catalog prices (base + chosen deltas).
update cart_items ci
set unit_price_cents = p.base_price_cents + coalesce(
  (
    select sum(m.price_delta_cents)
    from modifiers m
    where m.tenant_id = ci.tenant_id
      and m.id in (select jsonb_array_elements_text(ci.modifier_ids)::uuid)
  ),
  0
)
from products p
where p.tenant_id = ci.tenant_id and p.id = ci.product_id;

update cart_items ci
set modifier_snapshot = coalesce(
  (
    select jsonb_agg(
      jsonb_build_object('id', m.id, 'name', m.name, 'priceDeltaCents', m.price_delta_cents)
      order by m.id
    )
    from modifiers m
    where m.tenant_id = ci.tenant_id
      and m.id in (select jsonb_array_elements_text(ci.modifier_ids)::uuid)
  ),
  '[]'::jsonb
);

alter table cart_items alter column unit_price_cents set not null;
