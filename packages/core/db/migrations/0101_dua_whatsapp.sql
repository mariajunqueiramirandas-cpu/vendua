-- 0101_dua_whatsapp.sql — Venduá's own WhatsApp on the gateway, and Duá by WhatsApp
-- (docs/features/dua-no-whatsapp.md, ADR 0034 amended 2026-10-07).
--   platform_wa_sessions     — a number Venduá itself runs ('vendua'): what the team wants, what the
--                              socket is doing, and the gateway's lease (as store_whatsapp)
--   platform_wa_auth         — that number's linked-device login, each row sealed (as store_wa_auth)
--   platform_wa_outbox       — every message from that number: sign-in codes, Duá, notices, the CRM
--   platform_wa_inbox        — every message to it, history at pairing and LID↔number pairs; Core's
--                              consumer routes each by sender (merchant phones → Duá, else the CRM)
--   platform_wa_media        — voice notes on the inbox, bounded like shopper_media
--   platform_wa_probes       — "is this number on WhatsApp?", asked by Core, answered by the gateway
--   platform_wa_dua_senders  — per merchant phone: the store it talks to, a pending store choice,
--                              the jid it writes from, the daily refusal and the rate window
--   copilot_messages.channel / kind — the door a message came through, and whether it was a voice note
--   copilot_actions.wa_ref   — the number a card got in a WhatsApp reply ("SIM 2")
--   store_settings.dua_whatsapp_managers — the owner lets managers use Duá by WhatsApp (default on)
-- Platform tables carry no tenant: control scope only (controlTx), like wa_gateways.

create table if not exists platform_wa_sessions (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{0,30}$'),
  -- what the team wants
  wanted boolean not null default false,
  -- import the bulk history WhatsApp sends at pairing (the CRM's leads), not only the bootstrap
  history boolean not null default true,
  pair_phone text check (pair_phone ~ '^\d{10,15}$'),
  pair_requested_at timestamptz,
  wipe_requested_at timestamptz,
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
  owner text check (char_length(owner) <= 120),
  lease_epoch bigint not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into platform_wa_sessions (name) values ('vendua') on conflict (name) do nothing;

create table if not exists platform_wa_auth (
  session text not null references platform_wa_sessions (name) on delete cascade,
  category text not null check (char_length(category) <= 40),
  name text not null check (char_length(name) <= 200),
  data text not null check (octet_length(data) <= 256 * 1024),
  updated_at timestamptz not null default now(),
  primary key (session, category, name)
);

create table if not exists platform_wa_outbox (
  id uuid primary key default gen_random_uuid(),
  session text not null default 'vendua' references platform_wa_sessions (name) on delete cascade,
  -- international digits, or a jid (a lead known only by its @lid)
  to_jid text not null check (char_length(to_jid) between 10 and 120),
  -- a CRM message may be as long as the thread allows (composeMessage: 8000)
  body text not null check (char_length(body) between 1 and 8000),
  -- the pump's order: otp > dua > notice > crm
  purpose text not null check (purpose in ('otp', 'dua', 'notice', 'crm')),
  -- what it answers for: the lead_messages id of a CRM send, the copilot_messages id of a reply
  ref text check (char_length(ref) <= 120),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'expired')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  expires_at timestamptz not null default now() + interval '6 hours',
  error text check (char_length(error) <= 200),
  wa_id text check (char_length(wa_id) <= 64),
  sent_at timestamptz,
  -- Core finished what follows a CRM send (the lead's state, the cadence)
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists platform_wa_outbox_due on platform_wa_outbox (session, next_attempt_at)
  where status in ('pending', 'sending');
create index if not exists platform_wa_outbox_unsettled on platform_wa_outbox (created_at)
  where purpose = 'crm' and settled_at is null and status in ('sent', 'failed', 'expired');
create index if not exists platform_wa_outbox_age on platform_wa_outbox (created_at);

create table if not exists platform_wa_media (
  id uuid primary key default gen_random_uuid(),
  session text not null references platform_wa_sessions (name) on delete cascade,
  mime text not null check (mime ~ '^[a-z]+/[a-z0-9.+-]{1,60}(;.{0,60})?$'),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  seconds int check (seconds between 0 and 600),
  created_at timestamptz not null default now()
);
create index if not exists platform_wa_media_age on platform_wa_media (created_at);

create table if not exists platform_wa_inbox (
  id uuid primary key default gen_random_uuid(),
  session text not null references platform_wa_sessions (name) on delete cascade,
  kind text not null check (kind in ('message', 'history', 'lid_mapping')),
  from_jid text check (char_length(from_jid) <= 120),
  alt_jid text check (char_length(alt_jid) <= 120),
  -- the sender's number in international digits, when the gateway could resolve it
  phone text check (phone ~ '^\d{10,15}$'),
  push_name text check (char_length(push_name) <= 100),
  body text check (char_length(body) <= 8000),
  media_id uuid references platform_wa_media (id) on delete set null,
  provider_id text check (char_length(provider_id) <= 128),
  from_me boolean not null default false,
  sent_at timestamptz,
  -- lid_mapping rows: [{lid, pn}]
  pairs jsonb check (pairs is null or (jsonb_typeof(pairs) = 'array' and octet_length(pairs::text) <= 65536)),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  error text check (char_length(error) <= 200),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists platform_wa_inbox_once on platform_wa_inbox (session, kind, provider_id)
  where provider_id is not null;
create index if not exists platform_wa_inbox_due on platform_wa_inbox (next_attempt_at, created_at)
  where status = 'pending';
create index if not exists platform_wa_inbox_by_phone on platform_wa_inbox (phone, created_at desc)
  where phone is not null;
create index if not exists platform_wa_inbox_age on platform_wa_inbox (created_at);

create table if not exists platform_wa_probes (
  id uuid primary key default gen_random_uuid(),
  session text not null default 'vendua' references platform_wa_sessions (name) on delete cascade,
  phone text not null check (phone ~ '^\d{10,15}$'),
  result boolean,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists platform_wa_probes_open on platform_wa_probes (session, created_at)
  where answered_at is null;

create table if not exists platform_wa_dua_senders (
  -- merchant_users.phone as stored (national digits)
  phone text primary key check (phone ~ '^\d{10,11}$'),
  -- the jid this person writes from: replies go back to it (the 9th digit may differ)
  jid text check (char_length(jid) <= 120),
  tenant_id uuid references tenants (id) on delete set null,
  user_id uuid references merchant_users (id) on delete set null,
  chosen_at timestamptz,
  -- a store list sent and not answered yet: [{tenantId, userId, name}]
  choices jsonb check (choices is null or (jsonb_typeof(choices) = 'array' and octet_length(choices::text) <= 8000)),
  -- the day the fixed "not for you yet" answer went out: once a day
  refused_on date,
  window_start timestamptz,
  window_count int not null default 0 check (window_count >= 0),
  calm_sent boolean not null default false,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['platform_wa_sessions', 'platform_wa_auth', 'platform_wa_outbox',
                           'platform_wa_media', 'platform_wa_inbox', 'platform_wa_probes',
                           'platform_wa_dua_senders']
  loop
    execute format('alter table %I enable row level security', t);
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

-- The gateway LISTENs on vendua_platform_wa ('<session>|send|want|probe'); Core LISTENs on
-- vendua_platform_wa_in (a new inbox row) and vendua_platform_wa_out ('<id>|<status>|<purpose>'
-- when a message settles: the signup code waits on it, CRM sends finish on it).
create or replace function platform_wa_notify() returns trigger
language plpgsql as $$
begin
  if tg_argv[0] = 'in' then
    perform pg_notify('vendua_platform_wa_in', new.id::text);
  elsif tg_argv[0] = 'out' then
    perform pg_notify('vendua_platform_wa_out', new.id::text || '|' || new.status || '|' || new.purpose);
  elsif tg_argv[0] = 'want' then
    perform pg_notify('vendua_platform_wa', new.name || '|want');
  else
    perform pg_notify('vendua_platform_wa', new.session || '|' || tg_argv[0]);
  end if;
  return null;
end
$$;

drop trigger if exists platform_wa_outbox_notify on platform_wa_outbox;
create trigger platform_wa_outbox_notify after insert on platform_wa_outbox
  for each row execute function platform_wa_notify('send');
drop trigger if exists platform_wa_outbox_settled on platform_wa_outbox;
create trigger platform_wa_outbox_settled after update of status on platform_wa_outbox
  for each row when (new.status in ('sent', 'failed', 'expired') and old.status is distinct from new.status)
  execute function platform_wa_notify('out');
drop trigger if exists platform_wa_inbox_notify on platform_wa_inbox;
create trigger platform_wa_inbox_notify after insert on platform_wa_inbox
  for each row execute function platform_wa_notify('in');
drop trigger if exists platform_wa_probes_notify on platform_wa_probes;
create trigger platform_wa_probes_notify after insert on platform_wa_probes
  for each row execute function platform_wa_notify('probe');
drop trigger if exists platform_wa_sessions_notify on platform_wa_sessions;
create trigger platform_wa_sessions_notify
  after insert or update of wanted, pair_requested_at, wipe_requested_at on platform_wa_sessions
  for each row execute function platform_wa_notify('want');

alter table copilot_messages
  add column if not exists channel text not null default 'admin'
    check (channel in ('admin', 'whatsapp')),
  add column if not exists kind text not null default 'text' check (kind in ('text', 'voice'));

alter table copilot_actions
  add column if not exists wa_ref smallint check (wa_ref between 1 and 20);

alter table store_settings
  add column if not exists dua_whatsapp_managers boolean not null default true;

-- Duá's reply to a question that came by WhatsApp, queued from the copilot transport's own
-- (tenant-scoped) transaction. The recipient is never an argument: it is the person whose
-- conversation the reply is in, at the jid they write from, and only while their switch is on.
create or replace function enqueue_dua_whatsapp(p_message uuid, p_body text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_to text;
  v_id uuid;
begin
  select coalesce(s.jid, '55' || u.phone) into v_to
  from copilot_messages m
  join merchant_users u on u.id = m.user_id and u.tenant_id = m.tenant_id
  left join platform_wa_dua_senders s on s.phone = u.phone
  where m.id = p_message
    and m.tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid
    and m.author = 'dua'
    and u.status = 'active'
    and coalesce((u.prefs ->> 'duaWhatsapp')::boolean, false);
  if v_to is null then
    return null;
  end if;
  insert into platform_wa_outbox (session, to_jid, body, purpose, ref, dedupe_key, expires_at)
  values ('vendua', v_to, left(p_body, 4000), 'dua', p_message::text, 'dua:' || p_message::text,
          now() + interval '30 minutes')
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function enqueue_dua_whatsapp(uuid, text) from public;
grant execute on function enqueue_dua_whatsapp(uuid, text) to vendua_app;
