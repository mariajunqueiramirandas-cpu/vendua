-- Track A (docs/merchant-admin.md): the store owner's admin.
--   merchant_users        — people who run a store, with a role (ADR 0020)
--   merchant_login_codes  — phone OTP challenges; pre-tenant, gated by the vendua.merchant_auth GUC
--   merchant_sessions     — one row per signed-in device, scoped to one tenant
--   merchant_memberships_for_phone() — the only cross-tenant read: which stores a verified phone belongs to
--   audit_log             — who changed what, before and after (Equipe feed, support)
--   media_objects         — uploaded photos (client-resized WebP/JPEG, EXIF gone with the re-encode)
--   push_subscriptions    — web push endpoints per merchant user (+ push_deliveries dedupe)
--   store_settings / products additions for hours, pause copy, special days, "esgotado hoje", ordering

create table if not exists merchant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  -- national digits (DDD + number), same normalization as orders.customer_phone
  phone text not null check (phone ~ '^\d{10,11}$'),
  email text check (char_length(email) <= 200),
  role text not null check (role in ('owner', 'manager', 'attendant')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  prefs jsonb not null default '{}',
  invited_by uuid references merchant_users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (tenant_id, phone)
);

create table if not exists merchant_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  -- sha256 of the cookie secret; the cookie itself never lands in the db
  secret_hash text not null,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists merchant_sessions_by_user on merchant_sessions (user_id);

create table if not exists merchant_login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^\d{10,11}$'),
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists merchant_login_codes_by_phone on merchant_login_codes (phone, created_at desc);

alter table merchant_login_codes enable row level security;
drop policy if exists merchant_auth on merchant_login_codes;
create policy merchant_auth on merchant_login_codes for all
  using (current_setting('vendua.merchant_auth', true) = '1')
  with check (current_setting('vendua.merchant_auth', true) = '1');
grant select, insert, update, delete on merchant_login_codes to vendua_app;

-- Login knows a verified phone but no tenant yet. This definer function answers
-- "which stores may this phone enter" and nothing else — RLS stays on for the rest.
create or replace function merchant_memberships_for_phone(p_phone text)
returns table (tenant_id uuid, slug text, name text, user_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, u.id, u.role
  from merchant_users u join tenants t on t.id = u.tenant_id
  where u.phone = p_phone and u.status = 'active' and t.status = 'active'
  order by t.name
$$;
revoke all on function merchant_memberships_for_phone(text) from public;
grant execute on function merchant_memberships_for_phone(text) to vendua_app;

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  actor_user_id uuid references merchant_users (id) on delete set null,
  -- frozen display name: the feed still reads after the user is removed
  actor_label text not null,
  action text not null check (char_length(action) <= 80),
  entity text not null check (char_length(entity) <= 40),
  entity_id text check (char_length(entity_id) <= 120),
  summary text check (char_length(summary) <= 300),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_log_by_tenant on audit_log (tenant_id, at desc);

create table if not exists media_objects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  mime text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) <= 2 * 1024 * 1024),
  width int check (width > 0 and width <= 4096),
  height int check (height > 0 and height <= 4096),
  -- '#rrggbb' sampled client-side: the tile placeholder while the photo loads
  dominant text check (dominant ~ '^#[0-9a-f]{6}$'),
  created_by uuid references merchant_users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text,
  unique (tenant_id, endpoint)
);

alter table store_settings
  add column if not exists logo_url text
    check (char_length(logo_url) <= 1000 and (logo_url like 'https://%' or logo_url like '/%')),
  add column if not exists pause_message text check (char_length(pause_message) <= 200),
  add column if not exists closed_message text check (char_length(closed_message) <= 200),
  -- [{ date: 'YYYY-MM-DD', closed: bool, open?: 'HH:MM', close?: 'HH:MM', label?: text }]
  add column if not exists special_days jsonb not null default '[]',
  add column if not exists accept_target_minutes int not null default 5
    check (accept_target_minutes between 1 and 120),
  add column if not exists email text check (char_length(email) <= 200),
  -- what checkout accepts; the admin's Pagamentos toggles these
  add column if not exists payment_methods jsonb not null default '["pix", "card_on_delivery", "cash"]';

alter table products
  add column if not exists sort int not null default 0,
  -- "esgotado hoje": a sweep flips the product back to active at this instant
  add column if not exists sold_out_until timestamptz;

-- one push fan-out per event across Core replicas: the first insert wins
create table if not exists push_deliveries (
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null check (char_length(key) <= 120),
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- a store renames itself from the admin; reads stay open for the resolver
drop policy if exists tenant_self_update on tenants;
create policy tenant_self_update on tenants for update
  using (id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant update (name) on tenants to vendua_app;

-- time-bounded order reads (Início, Relatórios)
create index if not exists orders_by_tenant_placed on orders (tenant_id, placed_at desc);

do $$
declare
  t text;
  tenant_tables text[] := array[
    'merchant_users', 'merchant_sessions', 'audit_log', 'media_objects', 'push_subscriptions',
    'push_deliveries'
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
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
grant usage on all sequences in schema public to vendua_app;
