-- 0077_printing.sql — thermal printing through a store's own print agent (ADR 0027). Core renders
-- each ticket to ESC/POS bytes; an agent on the store's PC or tablet holds an SSE stream open,
-- writes the bytes to the local printer and reports back. Jobs are rows, so a sleeping tablet
-- prints its backlog when it wakes.

-- what the store's paired computers and tablets are. The credential is `<tenant>.<id>.<secret>`
-- and only sha256(secret) is kept; null until the agent collects it after approval.
create table if not exists print_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  platform text not null check (platform in ('windows', 'android', 'linux')),
  agent_version text check (agent_version ~ '^[0-9A-Za-z.+-]{1,30}$'),
  token_hash text check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references merchant_users (id) on delete set null,
  -- online = a stream opened after the last one closed, and it beat recently (a crashed Core
  -- never writes disconnected_at)
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists print_devices_by_tenant on print_devices (tenant_id, created_at);

-- printers an agent reports (source 'agent') or the merchant adds by IP (source 'manual')
create table if not exists printers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  device_id uuid not null references print_devices (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  kind text not null check (kind in ('spooler', 'tcp', 'serial', 'usb', 'bluetooth')),
  name text not null check (char_length(name) between 1 and 200),
  address text not null check (char_length(address) between 1 and 200),
  source text not null default 'agent' check (source in ('agent', 'manual')),
  -- the agent saw it in its last report (manual printers are always present)
  present boolean not null default true,
  label text check (char_length(label) between 1 and 60),
  auto boolean not null default false,
  paper smallint not null default 80 check (paper in (58, 80)),
  codepage text not null default 'cp850' check (codepage in ('cp850', 'cp860', 'ascii')),
  copies smallint not null default 1 check (copies between 1 and 3),
  cut boolean not null default true,
  last_ok_at timestamptz,
  last_error text check (char_length(last_error) <= 200),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, key)
);
create index if not exists printers_by_tenant on printers (tenant_id);

create table if not exists print_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  printer_id uuid not null references printers (id) on delete cascade,
  device_id uuid not null references print_devices (id) on delete cascade,
  order_id uuid references orders (id) on delete cascade,
  kind text not null check (kind in ('order', 'test')),
  trigger text not null check (trigger in ('placed', 'confirmed', 'manual', 'test')),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'done', 'failed', 'expired')),
  attempts int not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  finished_at timestamptz,
  error text check (char_length(error) <= 200),
  requested_by uuid references merchant_users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- a ticket nobody printed for two hours is noise in the kitchen, not a backlog
  expires_at timestamptz not null default now() + interval '2 hours'
);
-- one automatic ticket per printer and order, whichever step queued it: a replayed transition,
-- or a store switching when it prints mid-order, never prints twice
create unique index if not exists print_jobs_once on print_jobs (printer_id, order_id)
  where trigger in ('placed', 'confirmed');
create index if not exists print_jobs_open on print_jobs (device_id, created_at)
  where status in ('pending', 'sent');
create index if not exists print_jobs_by_order on print_jobs (tenant_id, order_id);
create index if not exists print_jobs_age on print_jobs (created_at);

alter table store_settings add column if not exists print_on text not null default 'confirmed'
  check (print_on in ('placed', 'confirmed'));

do $$
declare
  t text;
begin
  foreach t in array array['print_devices', 'printers', 'print_jobs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    execute format('drop policy if exists control_access on %I', t);
    execute format(
      'create policy control_access on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;

-- an agent asks for a code before anyone knows its store: pre-tenant rows behind their own GUC
-- (like merchant_login_codes). tenant_id/device_id are filled when a merchant approves.
create table if not exists print_pairings (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique check (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code text not null unique check (user_code ~ '^[A-Z0-9]{8}$'),
  platform text not null check (platform in ('windows', 'android', 'linux')),
  device_name text not null check (char_length(device_name) between 1 and 60),
  agent_version text check (agent_version ~ '^[0-9A-Za-z.+-]{1,30}$'),
  tenant_id uuid references tenants (id) on delete cascade,
  device_id uuid references print_devices (id) on delete cascade,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists print_pairings_age on print_pairings (expires_at);
alter table print_pairings enable row level security;
drop policy if exists print_pairing on print_pairings;
create policy print_pairing on print_pairings for all
  using (current_setting('vendua.print_pairing', true) = '1')
  with check (current_setting('vendua.print_pairing', true) = '1');
grant select, insert, update, delete on print_pairings to vendua_app;

-- streams LISTEN on vendua_print: 'tenant|device|job' when a job is queued
create or replace function print_jobs_notify() returns trigger
language plpgsql as $$
begin
  perform pg_notify('vendua_print', new.tenant_id::text || '|' || new.device_id::text || '|job');
  return null;
end
$$;

drop trigger if exists print_jobs_notify on print_jobs;
create trigger print_jobs_notify after insert on print_jobs
  for each row execute function print_jobs_notify();
