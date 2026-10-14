-- 0127_plans.sql — Plano semanal: the store's fixed baskets a shopper gets every week. The first
-- order is an ordinary checkout with the shopper's yes; the store's WhatsApp confirms the number
-- (ASSINAR), and each week Core places the next order itself, paid like any encomenda (the order
-- page's Pix, or on delivery). PULAR skips a week, CANCELAR PLANO ends it.
--   shopper_plans — what the store offers: lines, an optional weekday, how many days ahead
--   plan_subscriptions — one shopper's plan: where it goes, how it's paid, the next date
--   plan_cycles — one row per subscription and date: the guard that places one order a week
--   carts.plan_id — a cart built from a plan, whose checkout offers the subscription

create table if not exists shopper_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 200),
  -- the plan's day (0 = Sunday); null = the day of the shopper's first order
  weekday smallint check (weekday between 0 and 6),
  -- the week's order is placed this many days before its date, from 09:00 store time
  lead_days smallint not null default 2 check (lead_days between 1 and 6),
  -- [{ productId, qty }]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20
                              and pg_column_size(items) <= 4096),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shopper_plans_by_tenant on shopper_plans (tenant_id, sort);
alter table shopper_plans enable row level security;
drop policy if exists tenant_isolation on shopper_plans;
create policy tenant_isolation on shopper_plans
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on shopper_plans to vendua_app;

create table if not exists plan_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  plan_id uuid not null references shopper_plans (id) on delete restrict,
  phone text not null check (phone ~ '^\d{10,11}$'),
  name text not null check (char_length(name) between 1 and 200),
  -- the checkout's delivery and payment, replayed each week
  delivery jsonb not null check (jsonb_typeof(delivery) = 'object' and pg_column_size(delivery) <= 4096),
  payment jsonb not null check (jsonb_typeof(payment) = 'object' and pg_column_size(payment) <= 512),
  notes text check (char_length(notes) <= 500),
  -- pending: waiting for the number's ASSINAR; paused: the store's or SAIR's
  state text not null check (state in ('pending', 'active', 'paused', 'cancelled')),
  weekday smallint not null check (weekday between 0 and 6),
  next_on date,
  first_order_id uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  -- 'shopper' | 'store' | 'not_confirmed'
  cancelled_by text check (char_length(cancelled_by) <= 20),
  last_error text check (char_length(last_error) <= 200)
);
-- one live subscription of a plan per number
create unique index if not exists plan_subscriptions_live on plan_subscriptions (tenant_id, plan_id, phone)
  where state <> 'cancelled';
create index if not exists plan_subscriptions_due on plan_subscriptions (tenant_id, next_on)
  where state = 'active';
create index if not exists plan_subscriptions_by_phone on plan_subscriptions (tenant_id, phone);
alter table plan_subscriptions enable row level security;
drop policy if exists tenant_isolation on plan_subscriptions;
create policy tenant_isolation on plan_subscriptions
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on plan_subscriptions to vendua_app;

create table if not exists plan_cycles (
  tenant_id uuid not null references tenants (id) on delete cascade,
  subscription_id uuid not null references plan_subscriptions (id) on delete cascade,
  day date not null,
  order_id uuid,
  state text not null check (state in ('placed', 'skipped', 'failed')),
  -- a failure's error code, or who skipped it
  reason text check (char_length(reason) <= 80),
  created_at timestamptz not null default now(),
  primary key (subscription_id, day)
);
create index if not exists plan_cycles_by_order on plan_cycles (tenant_id, order_id)
  where order_id is not null;
alter table plan_cycles enable row level security;
drop policy if exists tenant_isolation on plan_cycles;
create policy tenant_isolation on plan_cycles
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on plan_cycles to vendua_app;

alter table carts add column if not exists plan_id uuid references shopper_plans (id) on delete set null;
