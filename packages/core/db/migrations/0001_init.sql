-- 0001_init.sql — Core schema, Phase 0 skeleton.
--
-- Rule from docs/architecture/01-core.md: every tenant-owned row carries
-- tenant_id and Postgres row-level security enforces it as a second line of
-- defense. The application connects as `vendua_app` (a non-owner role), sets
-- `vendua.tenant_id` per transaction via SET LOCAL, and still scopes every
-- query explicitly.
--
-- `tenants` and `domains` are the exception: they are the resolver's routing
-- data, needed *before* a tenant context exists. They get a read-only
-- `USING (true)` policy for the app role and no write policy.

create extension if not exists pgcrypto;

-- App role: non-owner, subject to RLS. Local dev password; deployments inject
-- their own. DO-block keeps the migration idempotent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vendua_app') then
    create role vendua_app login password 'vendua_app';
  end if;
end
$$;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'spike',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists domains (
  host text primary key,
  tenant_id uuid not null references tenants (id) on delete cascade
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  slug text not null,
  name text not null,
  sort int not null default 0,
  unique (tenant_id, slug)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  base_price_cents int not null check (base_price_cents >= 0),
  status text not null default 'active' check (status in ('active', 'sold_out', 'archived')),
  figure_variant text not null default 'default' check (figure_variant in ('default', 'alt')),
  tags jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  required boolean not null default false,
  min_select int not null default 0,
  max_select int not null default 1,
  sort int not null default 0
);

create table if not exists modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  group_id uuid not null references modifier_groups (id) on delete cascade,
  name text not null,
  price_delta_cents int not null default 0,
  status text not null default 'active' check (status in ('active', 'sold_out')),
  sort int not null default 0
);

create table if not exists store_settings (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  tagline text,
  description text,
  whatsapp text,
  instagram text,
  city text,
  address text,
  hours jsonb not null default '{"timezone": "America/Sao_Paulo", "windows": []}',
  status_override text check (status_override in ('paused', 'closed')),
  resumes_at timestamptz,
  prep_time_minutes int not null default 30,
  min_order_cents int not null default 0,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  promo jsonb
);

create table if not exists delivery_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  kind text not null default 'neighborhood' check (kind in ('neighborhood', 'radius')),
  neighborhoods jsonb not null default '[]',
  fee_cents int not null default 0 check (fee_cents >= 0),
  min_order_cents int not null default 0,
  eta_min_minutes int not null default 30,
  eta_max_minutes int not null default 60,
  active boolean not null default true
);

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  session_hash text not null,
  status text not null default 'open' check (status in ('open', 'completed', 'abandoned')),
  delivery jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_hash)
);

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_id uuid not null references carts (id) on delete cascade,
  product_id uuid not null references products (id),
  qty int not null check (qty > 0),
  modifier_ids jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (cart_id, product_id, modifier_ids)
);

create table if not exists idempotency_keys (
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_id uuid not null references carts (id),
  number int not null,
  customer jsonb not null,
  delivery jsonb not null,
  payment jsonb not null,
  state text not null default 'placed' check (state in (
    'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
    'delivered', 'cancelled', 'refunded'
  )),
  subtotal_cents int not null,
  delivery_fee_cents int not null default 0,
  total_cents int not null,
  placed_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  at timestamptz not null default now(),
  from_state text,
  to_state text not null,
  actor text not null default 'system',
  meta jsonb not null default '{}'
);

create table if not exists outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Row-level security. Applied to every table with tenant-owned rows; the
-- resolver tables get read-only open policies instead (see header comment).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'users', 'categories', 'products', 'modifier_groups', 'modifiers',
    'store_settings', 'delivery_zones', 'carts', 'cart_items',
    'idempotency_keys', 'orders', 'order_events', 'outbox'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
  end loop;
end
$$;

alter table tenants enable row level security;
drop policy if exists resolver_read on tenants;
create policy resolver_read on tenants for select using (true);

alter table domains enable row level security;
drop policy if exists resolver_read on domains;
create policy resolver_read on domains for select using (true);

grant usage on schema public to vendua_app;
grant select, insert, update, delete on all tables in schema public to vendua_app;
grant usage on all sequences in schema public to vendua_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to vendua_app;
alter default privileges in schema public
  grant usage on sequences to vendua_app;
