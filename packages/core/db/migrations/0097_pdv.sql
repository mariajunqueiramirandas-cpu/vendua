-- 0097_pdv.sql — the PDV (ADR 0035): counter sales, mesas with comandas, and the caixa.
--   pdv_tables      — the store's tables (a label and a position); archived, never deleted
--   pdv_tabs        — a comanda, on a table or only labelled; its rounds are orders with its tab_id
--   cash_sessions   — a caixa: opened with a float, closed with the count per method
--   cash_movements  — sangria (money out) and suprimento (money in) in a caixa
--   pdv_payments    — every payment taken at the counter, into the caixa open at the time
--   orders.cart_id  — nullable: a PDV order has no cart (only source 'pdv' may leave it empty)
--   orders.tab_id   — the comanda a round belongs to
--   store_settings.pdv_service_bps — the service charge offered on comandas (0–20%)
--   plans.features  + pdv (Bandeira and Pangolim, owner's call 2026-10-06)

create table if not exists pdv_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  sort int not null default 0 check (sort between 0 and 100000),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists pdv_tables_label on pdv_tables (tenant_id, lower(label))
  where archived_at is null;

create table if not exists cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  opened_by text not null check (char_length(opened_by) between 1 and 80),
  opened_at timestamptz not null default now(),
  opening_cents int not null check (opening_cents between 0 and 100000000),
  closed_by text check (char_length(closed_by) between 1 and 80),
  closed_at timestamptz,
  -- frozen at closing: { method: cents }
  counted jsonb,
  expected jsonb,
  notes text check (char_length(notes) <= 500),
  check ((closed_at is null) = (counted is null))
);
create unique index if not exists cash_sessions_one_open on cash_sessions (tenant_id)
  where closed_at is null;
create index if not exists cash_sessions_by_tenant on cash_sessions (tenant_id, opened_at desc);

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  session_id uuid not null references cash_sessions (id) on delete cascade,
  kind text not null check (kind in ('sangria', 'suprimento')),
  amount_cents int not null check (amount_cents between 1 and 100000000),
  reason text not null check (char_length(reason) between 1 and 140),
  by_name text not null check (char_length(by_name) between 1 and 80),
  at timestamptz not null default now()
);
create index if not exists cash_movements_by_session on cash_movements (tenant_id, session_id, at);

create table if not exists pdv_tabs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  table_id uuid references pdv_tables (id),
  label text not null check (char_length(label) between 1 and 40),
  customer_name text check (char_length(customer_name) between 1 and 80),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  service_bps int not null default 0 check (service_bps between 0 and 2000),
  service_fee boolean not null default true,
  -- { kind: 'fixed' | 'percent', value, reason }; the cents are computed on read
  discount jsonb,
  -- frozen when it closes, for the caixa's report
  service_cents int check (service_cents >= 0),
  opened_by text not null check (char_length(opened_by) between 1 and 80),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text check (char_length(close_reason) <= 200)
);
create unique index if not exists pdv_tabs_one_per_table on pdv_tabs (tenant_id, table_id)
  where status = 'open' and table_id is not null;
create index if not exists pdv_tabs_open on pdv_tabs (tenant_id) where status = 'open';

create table if not exists pdv_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  session_id uuid not null references cash_sessions (id),
  order_id uuid references orders (id),
  tab_id uuid references pdv_tabs (id),
  method text not null check (method in ('cash', 'pix', 'credit', 'debit', 'voucher')),
  amount_cents int not null check (amount_cents between 1 and 100000000),
  tendered_cents int check (tendered_cents >= amount_cents and tendered_cents <= 100000000),
  change_cents int not null default 0 check (change_cents >= 0),
  by_name text not null check (char_length(by_name) between 1 and 80),
  at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text check (char_length(voided_by) between 1 and 80),
  void_reason text check (char_length(void_reason) <= 200),
  check ((order_id is null) <> (tab_id is null)),
  check (tendered_cents is null or method = 'cash')
);
create index if not exists pdv_payments_by_session on pdv_payments (tenant_id, session_id);
create index if not exists pdv_payments_by_tab on pdv_payments (tenant_id, tab_id) where tab_id is not null;
create index if not exists pdv_payments_by_order on pdv_payments (tenant_id, order_id) where order_id is not null;

alter table orders alter column cart_id drop not null;
alter table orders add column if not exists tab_id uuid references pdv_tabs (id);
alter table orders drop constraint if exists orders_cart_or_pdv;
alter table orders add constraint orders_cart_or_pdv check (cart_id is not null or source = 'pdv');
create index if not exists orders_by_tab on orders (tenant_id, tab_id) where tab_id is not null;

alter table store_settings
  add column if not exists pdv_service_bps int not null default 0
    check (pdv_service_bps between 0 and 2000);

do $$
declare t text;
begin
  foreach t in array array['pdv_tables', 'cash_sessions', 'cash_movements', 'pdv_tabs', 'pdv_payments']
  loop
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

update plans set features = coalesce(features, '{}'::jsonb)
  || jsonb_build_object('pdv', id in ('bandeira', 'pangolim'))
where not (coalesce(features, '{}'::jsonb) ? 'pdv');
