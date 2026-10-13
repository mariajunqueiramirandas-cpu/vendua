-- 0125_freio.sql — Freio automático (docs/features/freio-automatico.md, F0–F3): promises from the
-- kitchen's real queue, a brake that slows delivery intake in steps (never closes the store), and
-- an honest message before a late order is asked about, with an apology coupon from a budget.
--   store_settings.kitchen_capacity / dispatch_buffer_minutes / max_promise_minutes — the model
--   store_settings.freio_mode            — off | suggest (default) | auto
--   store_settings.freio_level*          — the level the sweep last saw, and since when
--   store_settings.freio_backlog_minutes — the queue's wait, rounded to 5 (the storefront reads it)
--   store_settings.delivery_paused_until — the brake: delivery off until then; never rewrites
--                                          delivery_enabled, the owner's own setting
--   store_settings.freio_suggestion      — Sugerir: what Duá proposes now, until it's decided
--   store_settings.freio_hold_until      — after an undo, the brake leaves the store alone
--   store_settings.late_mode / apology_* — late orders: the mode and the apology's form and budget
--   freio_events                         — every level change (the hourly cap reads it)
--   order_late_notices                   — at most one late notice per order
--   coupons.source 'apology'

alter table store_settings
  add column if not exists kitchen_capacity int not null default 3
    check (kitchen_capacity between 1 and 20),
  add column if not exists dispatch_buffer_minutes int not null default 5
    check (dispatch_buffer_minutes between 0 and 60),
  add column if not exists max_promise_minutes int not null default 90
    check (max_promise_minutes between 30 and 240),
  add column if not exists freio_mode text not null default 'suggest'
    check (freio_mode in ('off', 'suggest', 'auto')),
  add column if not exists freio_level text not null default 'normal'
    check (freio_level in ('normal', 'busy', 'full', 'pickup_only')),
  add column if not exists freio_level_since timestamptz,
  add column if not exists freio_backlog_minutes int not null default 0
    check (freio_backlog_minutes between 0 and 600),
  add column if not exists delivery_paused_until timestamptz,
  add column if not exists freio_suggestion jsonb,
  add column if not exists freio_hold_until timestamptz,
  add column if not exists late_mode text not null default 'suggest'
    check (late_mode in ('off', 'suggest', 'auto')),
  add column if not exists apology_kind text not null default 'free_delivery'
    check (apology_kind in ('free_delivery', 'fixed')),
  add column if not exists apology_value_cents int not null default 0
    check (apology_value_cents between 0 and 10000),
  add column if not exists apology_budget_cents int not null default 0
    check (apology_budget_cents between 0 and 1000000);

create table if not exists freio_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  at timestamptz not null default now(),
  from_level text not null,
  to_level text not null,
  -- 'freio': the sweep (Automático); 'owner': a tap (Sugerir's "aplicar", an undo)
  actor text not null check (actor in ('freio', 'owner')),
  paused_until timestamptz
);
create index if not exists freio_events_recent on freio_events (tenant_id, at desc);
alter table freio_events enable row level security;
drop policy if exists tenant_isolation on freio_events;
create policy tenant_isolation on freio_events
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on freio_events to vendua_app;
grant usage on sequence freio_events_id_seq to vendua_app;

create table if not exists order_late_notices (
  order_id uuid primary key references orders (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- minutes past the promise the sweep predicted
  predicted_minutes int not null check (predicted_minutes between 1 and 600),
  mode text not null check (mode in ('suggest', 'auto')),
  state text not null default 'suggested' check (state in ('suggested', 'sent', 'dismissed')),
  coupon_id uuid references coupons (id) on delete set null,
  -- the coupon's face value at mint: the month's apology budget counts it
  coupon_cents int not null default 0 check (coupon_cents >= 0),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists order_late_notices_open on order_late_notices (tenant_id, created_at desc);
alter table order_late_notices enable row level security;
drop policy if exists tenant_isolation on order_late_notices;
create policy tenant_isolation on order_late_notices
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on order_late_notices to vendua_app;

alter table coupons drop constraint if exists coupons_source_check;
alter table coupons add constraint coupons_source_check
  check (source in ('staff', 'merchant', 'loyalty', 'agent', 'apology'));
