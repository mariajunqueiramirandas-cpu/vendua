-- Phase 3 + the rest of Track A (docs/roadmap.md, docs/merchant-admin.md, 13-payments.md).
--
-- Shopper → merchant (Mercado Pago marketplace, ADR 0009):
--   payment_connections — one MP account per store, tokens sealed (platform/secrets.ts)
--   payments            — one row per payment attempt on an order (Pix or card); the webhook is the truth
--   payment_refunds     — merchant-initiated refunds, confirmed by webhook
--   orders.rev          — bumps on payment changes so the live order stream sees them
--
-- Merchant → Venduá (the plan):
--   plans               — platform catalog (price in cents, per-order fee in basis points, features)
--   subscriptions       — one per store; card (MP assinatura) or Pix (monthly invoice)
--   invoices            — what the store was charged, paid or not
--   store_settings.billing_hold — a self-serve store stays paused until its first payment lands
--
-- Self-serve signup and the rest of Track A:
--   provision_store()   — the only way a store is born outside the seed; security definer
--   merchant_login_codes.purpose, merchant_login_links — signup codes and the email sign-in link
--   custom_domains, site_requests — PRO+ (own domain, a site made by our agent)
--   platform_incidents  — "a Venduá está com instabilidade" in Ajuda
--   push_attempts       — every alert sent, per device: a missed alert is visible
--   media_variants      — server-resized copies for Img's srcset
--   products.availability_schedule, store_settings.pickup_*  — scheduled products, pickup details

-- ── plans (platform catalog) ─────────────────────────────────────────────────

create table if not exists plans (
  id text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  price_cents int not null check (price_cents between 0 and 10000000),
  -- Venduá's cut of each store order (MP application_fee); 0 = none
  fee_bps int not null default 0 check (fee_bps between 0 and 2000),
  -- { customDomain: bool, customSite: bool }
  features jsonb not null default '{}',
  -- offered at signup and in "trocar de plano"
  public boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plans enable row level security;
drop policy if exists plans_read on plans;
create policy plans_read on plans for select using (true);
drop policy if exists plans_control on plans;
create policy plans_control on plans for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on plans to vendua_app;

-- the user's decision (2026-09-30): no per-order fee on either plan
insert into plans (id, name, price_cents, fee_bps, features, public, sort) values
  ('basic', 'Venduá Basic', 3990, 0, '{"customDomain": false, "customSite": false}', true, 1),
  ('pro_plus', 'Venduá PRO+', 9900, 0, '{"customDomain": true, "customSite": true}', true, 2)
on conflict (id) do nothing;

-- ── Mercado Pago connection per store ────────────────────────────────────────

create table if not exists payment_connections (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  provider text not null check (provider in ('mercadopago', 'fake')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 64),
  -- 13-payments.md: connected → expiring → disconnected; restricted = MP-side hold
  status text not null check (status in ('connected', 'expiring', 'disconnected', 'restricted')),
  -- { v, iv, tag, ct } from platform/secrets.ts; never the raw token
  access_token jsonb not null,
  refresh_token jsonb,
  public_key text check (char_length(public_key) <= 200),
  scope text check (char_length(scope) <= 300),
  live_mode boolean not null default true,
  expires_at timestamptz not null,
  connected_by uuid references merchant_users (id) on delete set null,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  status_changed_at timestamptz not null default now(),
  -- the last status the merchant was told about (WhatsApp + Início), so each change alerts once
  notified_status text
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  provider text not null check (provider in ('mercadopago', 'fake')),
  -- null until the provider answers; a card checkout gets it with the first webhook
  provider_payment_id text check (char_length(provider_payment_id) <= 64),
  -- card: the hosted checkout (MP preference) the shopper is sent to
  provider_checkout_id text check (char_length(provider_checkout_id) <= 120),
  kind text not null check (kind in ('pix', 'card')),
  status text not null default 'creating' check (status in (
    'creating', 'pending', 'approved', 'rejected', 'cancelled', 'expired',
    'refunded', 'partially_refunded', 'charged_back', 'in_mediation'
  )),
  status_detail text check (char_length(status_detail) <= 120),
  amount_cents int not null check (amount_cents > 0),
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  -- what MP kept and what reached the merchant (fee statement)
  provider_fee_cents int check (provider_fee_cents >= 0),
  net_cents int,
  application_fee_cents int not null default 0 check (application_fee_cents >= 0),
  pix_copy_paste text check (char_length(pix_copy_paste) <= 1000),
  pix_expires_at timestamptz,
  redirect_url text check (char_length(redirect_url) <= 1000),
  attempt int not null default 1 check (attempt between 1 and 20),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt)
);
create unique index if not exists payments_provider_id on payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists payments_by_tenant on payments (tenant_id, created_at desc);
create index if not exists payments_open on payments (status, created_at) where status in ('creating', 'pending');

create table if not exists payment_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  payment_id uuid not null references payments (id) on delete cascade,
  provider_refund_id text check (char_length(provider_refund_id) <= 64),
  amount_cents int not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text check (char_length(reason) <= 200),
  requested_by uuid references merchant_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_refunds_provider_id on payment_refunds (provider_refund_id)
  where provider_refund_id is not null;

-- live order stream: version = order_events + rev, so a payment landing wakes the shopper's page
alter table orders add column if not exists rev int not null default 0;

-- ── the plan: subscriptions and invoices ─────────────────────────────────────

create table if not exists subscriptions (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  plan_id text not null references plans (id),
  -- a downgrade waits for the end of the paid period
  pending_plan_id text references plans (id),
  method text not null check (method in ('card', 'pix')),
  status text not null check (status in ('pending', 'active', 'past_due', 'cancelled')),
  provider text not null check (provider in ('mercadopago', 'fake')),
  -- card: MP assinatura (preapproval) id
  provider_subscription_id text unique check (char_length(provider_subscription_id) <= 64),
  -- card: where the owner authorizes the recurring charge, while pending
  checkout_url text check (char_length(checkout_url) <= 1000),
  payer_email text check (char_length(payer_email) <= 200),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  number int not null check (number > 0),
  plan_id text not null references plans (id),
  amount_cents int not null check (amount_cents >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  method text not null check (method in ('card', 'pix')),
  status text not null default 'open' check (status in ('open', 'paid', 'failed', 'void')),
  provider text not null check (provider in ('mercadopago', 'fake')),
  provider_payment_id text check (char_length(provider_payment_id) <= 64),
  pix_copy_paste text check (char_length(pix_copy_paste) <= 1000),
  pix_expires_at timestamptz,
  due_at timestamptz not null,
  paid_at timestamptz,
  -- reminders sent: 'due_soon' | 'due' | 'overdue'
  reminded text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant_id, number),
  unique (tenant_id, period_start)
);
create unique index if not exists invoices_provider_id on invoices (provider, provider_payment_id)
  where provider_payment_id is not null;

alter table store_settings
  -- a self-serve store opens when its plan is paid; the admin can't un-pause past it
  add column if not exists billing_hold boolean not null default false,
  add column if not exists pickup_address text check (char_length(pickup_address) <= 200),
  add column if not exists pickup_instructions text check (char_length(pickup_instructions) <= 300);

-- ── PRO+: own domain, a site made by our agent ───────────────────────────────

create table if not exists custom_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  host text not null unique check (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(host) <= 253),
  -- pending_dns → dns_ok (checked by Core) → active (the team turns TLS on) ; failed = gave up
  status text not null default 'pending_dns' check (status in ('pending_dns', 'dns_ok', 'active', 'failed')),
  verify_token text not null check (char_length(verify_token) between 16 and 64),
  last_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 200),
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists custom_domains_by_tenant on custom_domains (tenant_id);

create table if not exists site_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'delivered', 'cancelled')),
  -- what the owner told us about the site they want
  brief text check (char_length(brief) <= 2000),
  staff_note text check (char_length(staff_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists site_requests_one_open on site_requests (tenant_id)
  where status in ('requested', 'in_progress');

-- ── incidents (platform-wide, shown in Ajuda) ────────────────────────────────

create table if not exists platform_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text check (char_length(body) <= 1000),
  severity text not null default 'degraded' check (severity in ('info', 'degraded', 'outage')),
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table platform_incidents enable row level security;
drop policy if exists incidents_read on platform_incidents;
create policy incidents_read on platform_incidents for select using (true);
drop policy if exists incidents_control on platform_incidents;
create policy incidents_control on platform_incidents for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on platform_incidents to vendua_app;

-- ── sign-in and signup ───────────────────────────────────────────────────────

alter table merchant_login_codes
  add column if not exists purpose text not null default 'login' check (purpose in ('login', 'signup'));

create table if not exists merchant_login_links (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 200),
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists merchant_login_links_by_email on merchant_login_links (email, created_at desc);
alter table merchant_login_links enable row level security;
drop policy if exists merchant_auth on merchant_login_links;
create policy merchant_auth on merchant_login_links for all
  using (current_setting('vendua.merchant_auth', true) = '1')
  with check (current_setting('vendua.merchant_auth', true) = '1');
grant select, insert, update, delete on merchant_login_links to vendua_app;

-- the email twin of merchant_memberships_for_phone: which stores this address may enter
create or replace function merchant_memberships_for_email(p_email text)
returns table (tenant_id uuid, slug text, name text, user_id uuid, role text, phone text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, u.id, u.role, u.phone
  from merchant_users u join tenants t on t.id = u.tenant_id
  where lower(u.email) = lower(p_email) and u.status = 'active' and t.status = 'active'
  order by t.name
$$;
revoke all on function merchant_memberships_for_email(text) from public;
grant execute on function merchant_memberships_for_email(text) to vendua_app;

alter table merchant_users
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_channels text[] not null default '{}',
  add column if not exists invite_error text check (char_length(invite_error) <= 200);

-- Self-serve signup: vendua_app can't insert tenants or domains (RLS: read-only), so the
-- birth of a store is this one function. It creates the smallest store that renders: the
-- tenant, its primary <slug>.<store domain> host, settings (paused behind billing_hold until
-- the plan is paid) and the owner. Everything else is data the owner adds in /bem-vindo.
create or replace function provision_store(
  p_slug text, p_name text, p_plan text, p_host text,
  p_owner_name text, p_owner_phone text, p_owner_email text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'invalid slug' using errcode = '22023';
  end if;
  if not exists (select 1 from plans where id = p_plan) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  insert into tenants (slug, name, plan) values (p_slug, p_name, p_plan) returning id into v_tenant;
  insert into domains (host, tenant_id, is_primary) values (lower(p_host), v_tenant, true);
  perform set_config('vendua.tenant_id', v_tenant::text, true);
  insert into store_settings (tenant_id, hours, pickup_enabled, delivery_enabled, status_override,
                              pause_message, billing_hold, email)
  values (v_tenant, '{"timezone": "America/Sao_Paulo", "windows": []}', false, false, 'paused',
          'A loja abre em breve.', true, p_owner_email);
  insert into merchant_users (tenant_id, name, phone, email, role)
  values (v_tenant, p_owner_name, p_owner_phone, p_owner_email, 'owner');
  insert into storefront_ops (tenant_id, ring) values (v_tenant, 'stable') on conflict do nothing;
  return v_tenant;
end
$$;
revoke all on function provision_store(text, text, text, text, text, text, text) from public;
grant execute on function provision_store(text, text, text, text, text, text, text) to vendua_app;

-- A plan change is the store's own (Conta → trocar de plano); only plan, never slug/status.
grant update (plan) on tenants to vendua_app;

-- The team turns a verified custom domain on: it joins the resolver's hosts as the primary.
create or replace function activate_custom_domain(p_tenant uuid, p_host text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vendua.control', true) is distinct from '1' then
    raise exception 'control only' using errcode = '42501';
  end if;
  update domains set is_primary = false where tenant_id = p_tenant and is_primary;
  insert into domains (host, tenant_id, is_primary) values (lower(p_host), p_tenant, true)
    on conflict (host) do update set is_primary = true where domains.tenant_id = p_tenant;
  update custom_domains set status = 'active', activated_at = now()
    where tenant_id = p_tenant and host = lower(p_host);
end
$$;
revoke all on function activate_custom_domain(uuid, text) from public;
grant execute on function activate_custom_domain(uuid, text) to vendua_app;

-- ── alerts, media, products ──────────────────────────────────────────────────

create table if not exists push_attempts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  subscription_id uuid references push_subscriptions (id) on delete set null,
  user_id uuid references merchant_users (id) on delete set null,
  -- 'order.placed' | 'payment.received' | 'test' | 'order.whatsapp' …
  event text not null check (char_length(event) <= 40),
  ref text check (char_length(ref) <= 120),
  channel text not null default 'push' check (channel in ('push', 'whatsapp')),
  result text not null check (result in ('ok', 'error', 'gone')),
  detail text check (char_length(detail) <= 200),
  at timestamptz not null default now()
);
create index if not exists push_attempts_by_tenant on push_attempts (tenant_id, at desc);

create table if not exists media_variants (
  tenant_id uuid not null references tenants (id) on delete cascade,
  media_id uuid not null references media_objects (id) on delete cascade,
  width int not null check (width > 0 and width <= 4096),
  mime text not null check (mime in ('image/webp', 'image/jpeg')),
  bytes bytea not null check (octet_length(bytes) <= 2 * 1024 * 1024),
  primary key (media_id, width)
);

alter table products
  -- { windows: [{ days: [0..6], from?: 'HH:MM', to?: 'HH:MM' }], outside: 'unavailable' | 'hidden' }
  add column if not exists availability_schedule jsonb;

do $$
declare
  t text;
  tenant_tables text[] := array[
    'payment_connections', 'payments', 'payment_refunds', 'subscriptions', 'invoices',
    'custom_domains', 'site_requests', 'push_attempts', 'media_variants'
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

-- The staff console reads across stores (Lojas: plans, payments health, domains, site requests)
-- under vendua.control, like the rest of the CRM.
do $$
declare
  t text;
  control_tables text[] := array[
    'payment_connections', 'subscriptions', 'invoices', 'custom_domains', 'site_requests'
  ];
begin
  foreach t in array control_tables loop
    execute format('drop policy if exists control_access on %I', t);
    execute format(
      'create policy control_access on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
  end loop;
end
$$;
grant usage on all sequences in schema public to vendua_app;
