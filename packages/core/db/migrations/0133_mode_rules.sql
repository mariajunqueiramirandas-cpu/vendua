-- 0133_mode_rules.sql — delivery and pickup each with their own rules:
--   store_settings.pickup_min_order_cents — pickup's minimum order (0 = none); null = the store's
--     min_order_cents, as before (rows that never set it, and a Core from before this one)
--   store_settings.payment_methods_off    — { "delivery": [...], "pickup": [...] }: methods the
--     store accepts but not for that mode; read via payment-adjustments.ts (never leaves a mode
--     without a method)

alter table store_settings
  add column if not exists pickup_min_order_cents int,
  add column if not exists payment_methods_off jsonb not null default '{}'::jsonb;
alter table store_settings drop constraint if exists store_settings_pickup_min_order_check;
alter table store_settings add constraint store_settings_pickup_min_order_check
  check (pickup_min_order_cents is null or pickup_min_order_cents between 0 and 10000000);
