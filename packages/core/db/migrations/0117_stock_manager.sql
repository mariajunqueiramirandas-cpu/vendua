-- 0117_stock_manager.sql — adicionais with their own stock, a stock history, unit costs and the
-- pricing calculator.
--   vendua_stock_key(text)   — an option name folded for matching: case, accents and spacing out
--   modifiers.stock_key      — generated from the name: every "Bacon extra" in the store is one
--                              adicional for stock, whatever product or group it sits in
--   addon_stock              — the counted adicionais (a row = counted); 0 reads sold out
--   stock_movements          — every change to a counted product's or adicional's stock and why
--   products.cost_cents      — unit cost; products.pricing — the calculator's inputs
--   store_settings.pricing_defaults — the fee/tax/margin last saved, for the next product
--   orders.addon_stock_drawn — {key: units} an order took from addon_stock, for a cancel
-- Additive only. Re-runnable.

create or replace function vendua_stock_key(t text) returns text
language sql immutable parallel safe as $$
  select translate(lower(regexp_replace(btrim(t), '\s+', ' ', 'g')),
                   'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;

alter table modifiers
  add column if not exists stock_key text generated always as (vendua_stock_key(name)) stored;
create index if not exists modifiers_by_stock_key on modifiers (tenant_id, stock_key);

create table if not exists addon_stock (
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 80),
  name text not null check (char_length(name) between 1 and 80),
  stock_quantity integer not null check (stock_quantity between 0 and 1000000),
  low_stock_threshold integer check (low_stock_threshold between 1 and 1000000),
  cost_cents integer check (cost_cents between 0 and 10000000),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid references products (id) on delete cascade,
  addon_key text check (char_length(addon_key) <= 80),
  reason text not null
    check (reason in ('sale', 'cancel', 'delivery', 'count', 'adjust', 'loss', 'start', 'stop')),
  delta integer not null,
  after integer,
  -- no FK: a sale's row is written before its order row, in the same transaction
  order_id uuid,
  actor_label text check (char_length(actor_label) <= 120),
  created_at timestamptz not null default now(),
  check ((product_id is null) <> (addon_key is null))
);
create index if not exists stock_movements_by_product
  on stock_movements (tenant_id, product_id, created_at desc) where product_id is not null;
create index if not exists stock_movements_by_addon
  on stock_movements (tenant_id, addon_key, created_at desc) where addon_key is not null;
create index if not exists stock_movements_sales
  on stock_movements (tenant_id, created_at) where reason = 'sale';

alter table products
  add column if not exists cost_cents integer check (cost_cents between 0 and 10000000),
  add column if not exists pricing jsonb;

alter table store_settings add column if not exists pricing_defaults jsonb;

alter table orders add column if not exists addon_stock_drawn jsonb;

do $$
declare t text;
begin
  foreach t in array array['addon_stock', 'stock_movements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)$p$, t);
    execute format('drop policy if exists control_access on %I', t);
    execute format($p$create policy control_access on %I for all
      using (current_setting('vendua.control', true) = '1')
      with check (current_setting('vendua.control', true) = '1')$p$, t);
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end $$;

-- a counted adicional at 0 reads sold out on the storefront: its cached catalog must drop
drop trigger if exists store_cache_notify on addon_stock;
create trigger store_cache_notify after insert or update or delete on addon_stock
  for each row execute function vendua_store_cache_notify();
drop trigger if exists store_cache_notify_truncate on addon_stock;
create trigger store_cache_notify_truncate after truncate on addon_stock
  for each statement execute function vendua_store_cache_notify();
