-- 0158_encomendas_vehicles.sql — encomenda dates, encomendas past stock, delivery vehicles.
-- store_settings.blocked_dates: local dates (YYYY-MM-DD) the store takes no scheduled order on
--   (modules/preorder.ts). The shopper's calendar leaves them out and checkout refuses them; the
--   store's hours don't change (closing a whole day is a special day).
-- products.preorder_when_sold_out: sold from stock while it lasts; past it, with a date or with
--   the store closed, the line is an encomenda made for its date. requires_preorder still means
--   "always".
-- products.delivery_vehicle / store_settings.vehicle_fees / orders.delivery_vehicle
--   (modules/vehicles.ts): an item that only travels by moto or by car, the extra the store
--   charges on the delivery fee for each, and the vehicle a placed delivery needs.
-- Additive (ADR 0041): an old Core never reads them. Re-runnable.
alter table store_settings
  add column if not exists blocked_dates jsonb not null default '[]',
  add column if not exists vehicle_fees jsonb not null default '{}';
alter table store_settings drop constraint if exists store_settings_blocked_dates_check;
alter table store_settings add constraint store_settings_blocked_dates_check
  check (jsonb_typeof(blocked_dates) = 'array' and jsonb_array_length(blocked_dates) <= 120);
alter table store_settings drop constraint if exists store_settings_vehicle_fees_check;
alter table store_settings add constraint store_settings_vehicle_fees_check
  check (jsonb_typeof(vehicle_fees) = 'object');

alter table products
  add column if not exists preorder_when_sold_out boolean not null default false,
  add column if not exists delivery_vehicle text;
alter table products drop constraint if exists products_delivery_vehicle_check;
alter table products add constraint products_delivery_vehicle_check
  check (delivery_vehicle in ('moto', 'car')) not valid;

alter table orders add column if not exists delivery_vehicle text;
alter table orders drop constraint if exists orders_delivery_vehicle_check;
-- not valid: the column is new (all null), so there is nothing to scan under the table's lock
alter table orders add constraint orders_delivery_vehicle_check
  check (delivery_vehicle in ('moto', 'car')) not valid;
