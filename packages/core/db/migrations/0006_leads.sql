-- leads + control_idempotency_keys: platform CRM tables — RLS keys on the
-- vendua.control GUC (second line of defense behind the /control/v1 gate)
create table if not exists control_idempotency_keys (
  key text primary key,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text,
  phone text,
  email text,
  instagram text,
  city text,
  source text,
  state text not null default 'lead' check (state in ('lead', 'contacted', 'invited', 'live')),
  notes jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leads enable row level security;
drop policy if exists staff_all on leads;
create policy staff_all on leads for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');

alter table control_idempotency_keys enable row level security;
drop policy if exists staff_all on control_idempotency_keys;
create policy staff_all on control_idempotency_keys for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');

grant select, insert, update on leads to vendua_app;
grant select, insert on control_idempotency_keys to vendua_app;
