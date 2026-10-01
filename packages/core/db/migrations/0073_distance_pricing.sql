-- 0073_distance_pricing.sql — delivery priced by road distance (ADR 0024).
--   store_settings.distance_pricing — on: an address with a confirmed pin is priced
--     base + R$/started km (never below the minimum fee), refused past delivery_max_km;
--     delivery_zones then only price addresses without a pin. Off (the default): zones as before.
--   carts.delivery_route — the road leg Core fetched for this store → this pin
--     ({ from: [lat,lng], to: [lat,lng], meters, seconds }), so checkout charges what the
--     quote showed without asking the routing provider again.

alter table store_settings
  add column if not exists distance_pricing boolean not null default false,
  add column if not exists delivery_base_fee_cents integer not null default 0
    check (delivery_base_fee_cents between 0 and 100000),
  add column if not exists delivery_fee_per_km_cents integer not null default 0
    check (delivery_fee_per_km_cents between 0 and 100000),
  add column if not exists delivery_min_fee_cents integer not null default 0
    check (delivery_min_fee_cents between 0 and 100000),
  add column if not exists delivery_max_km numeric(4, 1) not null default 8
    check (delivery_max_km > 0 and delivery_max_km <= 100),
  add column if not exists delivery_free_over_cents integer
    check (delivery_free_over_cents is null or delivery_free_over_cents between 0 and 10000000);

alter table carts add column if not exists delivery_route jsonb;
