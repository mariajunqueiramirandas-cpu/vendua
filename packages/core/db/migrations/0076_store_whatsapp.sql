-- 0076_store_whatsapp.sql — each store's own WhatsApp, linked as a device and run by the
-- wa-gateway process (ADR 0026). Core writes what the merchant wants (pair, disconnect, which
-- messages); the gateway holding the store's lease writes what the socket is doing. Nothing
-- crosses between them but these rows: the queue survives either side restarting.

create table if not exists store_whatsapp (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  -- what the merchant wants
  wanted boolean not null default false,
  pair_phone text check (pair_phone ~ '^\d{10,11}$'),
  pair_requested_at timestamptz,
  wipe_requested_at timestamptz,
  events text[] not null
    default array['placed', 'paid', 'confirmed', 'ready', 'out_for_delivery', 'cancelled']
    check (events <@ array['placed', 'paid', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
                           'delivered', 'cancelled']),
  -- what the gateway reports
  state text not null default 'off'
    check (state in ('off', 'connecting', 'pairing', 'open', 'logged_out', 'banned', 'error')),
  detail text check (detail ~ '^[a-z_]{1,40}$'),
  pair_code text check (pair_code ~ '^[A-Z0-9]{8}$'),
  pair_code_expires_at timestamptz,
  phone text check (phone ~ '^\d{10,15}$'),
  account_name text check (char_length(account_name) <= 100),
  connected_at timestamptz,
  state_changed_at timestamptz not null default now(),
  -- set when the team heard "caiu": one card per outage, and "voltou" closes it
  outage_since timestamptz,
  -- the gateway that runs this store's socket; epoch fences its writes (auth-store.ts)
  owner text check (char_length(owner) <= 120),
  lease_epoch bigint not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_whatsapp_claimable on store_whatsapp (lease_until)
  where wanted or wipe_requested_at is not null;

-- the linked device's Signal state, each row AES-GCM sealed (platform/secrets.ts)
create table if not exists store_wa_auth (
  tenant_id uuid not null references tenants (id) on delete cascade,
  category text not null check (char_length(category) <= 40),
  name text not null check (char_length(name) <= 200),
  data text not null check (octet_length(data) <= 256 * 1024),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, category, name)
);

-- messages to shoppers: Core enqueues in the order's own transaction, the gateway sends
create table if not exists store_wa_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid references orders (id) on delete cascade,
  kind text not null check (kind in ('order', 'opt_out', 'opt_in', 'test')),
  event text check (event ~ '^[a-z_]{1,30}$'),
  phone text not null check (phone ~ '^\d{10,11}$'),
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'expired', 'skipped')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  expires_at timestamptz not null default now() + interval '6 hours',
  error text check (char_length(error) <= 200),
  wa_id text check (char_length(wa_id) <= 64),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
-- one message per order and step: a replayed transition never texts twice
create unique index if not exists store_wa_messages_once on store_wa_messages (order_id, event)
  where order_id is not null;
create index if not exists store_wa_messages_due on store_wa_messages (tenant_id, next_attempt_at)
  where status in ('pending', 'sending');
create index if not exists store_wa_messages_recent on store_wa_messages (tenant_id, created_at desc);
create index if not exists store_wa_messages_by_phone on store_wa_messages (tenant_id, phone);
create index if not exists store_wa_messages_by_wa_id on store_wa_messages (tenant_id, wa_id)
  where wa_id is not null;
create index if not exists store_wa_messages_age on store_wa_messages (created_at);

-- shoppers who answered SAIR: no more automatic messages from this store
create table if not exists store_wa_optouts (
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null check (phone ~ '^\d{10,11}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

do $$
declare
  t text;
begin
  foreach t in array array['store_whatsapp', 'store_wa_auth', 'store_wa_messages', 'store_wa_optouts']
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

-- live gateway processes: a heartbeat Core reads to tell "no gateway" from "store offline".
-- Platform data, no tenant rows.
create table if not exists wa_gateways (
  id text primary key check (char_length(id) <= 120),
  version text check (char_length(version) <= 60),
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  sessions int not null default 0,
  open_sessions int not null default 0
);
alter table wa_gateways enable row level security;
drop policy if exists control_access on wa_gateways;
create policy control_access on wa_gateways for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
drop policy if exists public_read on wa_gateways;
create policy public_read on wa_gateways for select using (true);
grant select, insert, update, delete on wa_gateways to vendua_app;

-- the gateway LISTENs on vendua_wa: 'tenant|send' when a message is queued, 'tenant|want' when the
-- merchant pairs or disconnects. Its own state writes don't touch these columns, so no echo.
create or replace function store_wa_notify() returns trigger
language plpgsql as $$
begin
  perform pg_notify('vendua_wa', new.tenant_id::text || '|' || tg_argv[0]);
  return null;
end
$$;

drop trigger if exists store_wa_messages_notify on store_wa_messages;
create trigger store_wa_messages_notify after insert on store_wa_messages
  for each row execute function store_wa_notify('send');

drop trigger if exists store_whatsapp_notify on store_whatsapp;
create trigger store_whatsapp_notify
  after insert or update of wanted, pair_requested_at, wipe_requested_at on store_whatsapp
  for each row execute function store_wa_notify('want');
