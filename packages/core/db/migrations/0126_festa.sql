-- 0126_festa.sql — Festa calculada F0 + F1 (docs/features/festa-calculada.md): a ceiling on a
-- day's encomendas, the reminder the day before, and party profiles whose per-guest rules turn
-- "40 pessoas, aniversário" into an ordinary cart of the store's products. Paid in full: the
-- sinal (F2) waits on its legal review.
--   store_settings.encomenda_capacity — orders a day: per weekday, and per date (a date wins)
--   store_settings.encomenda_reminder — the D−1 message from the store's WhatsApp
--   party_profiles / party_groups / party_group_products — the calculator's rules
--   carts.party / orders.party — the guests a cart was built for, and the order's frozen units

alter table store_settings
  add column if not exists encomenda_capacity jsonb,
  add column if not exists encomenda_reminder boolean not null default true;
alter table store_settings drop constraint if exists store_settings_encomenda_capacity_check;
alter table store_settings add constraint store_settings_encomenda_capacity_check
  check (encomenda_capacity is null or (jsonb_typeof(encomenda_capacity) = 'object'
         and pg_column_size(encomenda_capacity) <= 4096));

create table if not exists party_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 200),
  -- how much a child counts, in basis points of an adult (5000 = half)
  child_factor_bps int not null default 5000 check (child_factor_bps between 0 and 10000),
  min_guests int not null default 10 check (min_guests between 1 and 1000),
  max_guests int not null default 200 check (max_guests between 1 and 1000),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (min_guests <= max_guests)
);
create index if not exists party_profiles_by_tenant on party_profiles (tenant_id, sort);
alter table party_profiles enable row level security;
drop policy if exists tenant_isolation on party_profiles;
create policy tenant_isolation on party_profiles
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on party_profiles to vendua_app;

create table if not exists party_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  profile_id uuid not null references party_profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- thousandths of a piece per guest: 15 salgados = 15000, a slice = 1000
  per_guest_milli int not null check (per_guest_milli between 1 and 100000),
  max_choices int not null default 3 check (max_choices between 1 and 10),
  required boolean not null default true,
  -- pieces of this group the kitchen makes a day across party orders; null = no ceiling
  daily_cap_units int check (daily_cap_units between 1 and 1000000),
  sort int not null default 0
);
create index if not exists party_groups_by_profile on party_groups (profile_id, sort);
alter table party_groups enable row level security;
drop policy if exists tenant_isolation on party_groups;
create policy tenant_isolation on party_groups
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on party_groups to vendua_app;

-- a product sits in one group per profile, so an order's units never count twice
create table if not exists party_group_products (
  tenant_id uuid not null references tenants (id) on delete cascade,
  profile_id uuid not null references party_profiles (id) on delete cascade,
  group_id uuid not null references party_groups (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  -- pieces in one sale of the product: 100 for a cento, 25 for a cake for 25
  units_per_sale int not null check (units_per_sale between 1 and 1000),
  sort int not null default 0,
  primary key (group_id, product_id),
  unique (profile_id, product_id)
);
alter table party_group_products enable row level security;
drop policy if exists tenant_isolation on party_group_products;
create policy tenant_isolation on party_group_products
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on party_group_products to vendua_app;

alter table carts add column if not exists party jsonb
  check (party is null or pg_column_size(party) <= 1024);
alter table orders add column if not exists party jsonb
  check (party is null or pg_column_size(party) <= 4096);
-- a day's encomendas, counted under the checkout lock
create index if not exists orders_by_scheduled_day on orders (tenant_id, scheduled_for)
  where scheduled_for is not null;
