-- ADR 0023: staff events — what happened across the stack, recorded in the same transaction as
-- the change, delivered to Discord by the `discord` scheduler job.
--
--   staff_events          — the event log and its Discord delivery state (platform table)
--   control_integrations  — kind 'discord' (driver 'bot': application id, public key, guild)
--   wake triggers         — a new event (or a Discord config change) wakes the scheduler

create table if not exists staff_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]+\.[a-z_]+$' and char_length(kind) <= 60),
  -- the store it concerns (null = platform-wide)
  tenant_id uuid references tenants (id) on delete cascade,
  severity text not null default 'info'
    check (severity in ('info', 'success', 'warning', 'critical')),
  -- events about one thing share it: the first posts a card, the rest edit it
  anchor text check (char_length(anchor) between 1 and 120),
  -- at most one event per key (a replayed webhook, a re-run sweep)
  dedupe_key text unique check (char_length(dedupe_key) between 1 and 200),
  data jsonb not null default '{}'
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 16000),
  created_at timestamptz not null default now(),
  state text not null default 'pending'
    check (state in ('pending', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text check (char_length(last_error) <= 500),
  channel_id text check (char_length(channel_id) <= 32),
  message_id text check (char_length(message_id) <= 32),
  delivered_at timestamptz
);
create index if not exists staff_events_due on staff_events (next_attempt_at)
  where state = 'pending';
create index if not exists staff_events_anchor on staff_events (anchor, id)
  where anchor is not null;
create index if not exists staff_events_recent on staff_events (created_at);
create index if not exists staff_events_kind_recent on staff_events (kind, created_at desc);

alter table staff_events enable row level security;
drop policy if exists staff_all on staff_events;
create policy staff_all on staff_events for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
-- a store's own transaction records events about itself: insert only, it never reads them back
drop policy if exists tenant_insert on staff_events;
create policy tenant_insert on staff_events for insert
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on staff_events to vendua_app;
grant usage on all sequences in schema public to vendua_app;

alter table control_integrations drop constraint if exists control_integrations_kind_check;
alter table control_integrations add constraint control_integrations_kind_check
  check (kind in ('llm', 'email', 'whatsapp', 'instagram', 'discovery', 'discord'));

-- payload-free wake (ADR 0017): the table name is all the scheduler needs; statement-level on
-- staff_events so a burst of inserts in one transaction is one notification
create or replace function vendua_table_notify() returns trigger
language plpgsql as $$
begin
  perform pg_notify('vendua_agent', json_build_object('t', TG_TABLE_NAME, 'l', null)::text);
  return null;
end $$;

drop trigger if exists staff_events_notify on staff_events;
create trigger staff_events_notify after insert on staff_events
  for each statement execute function vendua_table_notify();

drop trigger if exists discord_notify on control_integrations;
create trigger discord_notify after insert or update on control_integrations
  for each row
  when (new.kind = 'discord')
  execute function vendua_table_notify();

-- the digest hour and routing live in the 'discord' setting
drop trigger if exists agent_notify on control_settings;
create trigger agent_notify after insert or update on control_settings
  for each row
  when (new.key in ('agent', 'guardrails', 'digest', 'meeting', 'discord'))
  execute function vendua_agent_notify();
