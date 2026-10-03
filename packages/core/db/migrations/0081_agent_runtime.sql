-- 0081_agent_runtime.sql — Agent Runtime v3 (ADR 0030, docs/architecture/18-agent-runtime.md §4).
-- A durable actor per conversation:
--   agent_actors   — one row per (agent, subject): version pin, the fenced lease, next_wake_at,
--                    a cached projection of the log and the seq it reflects
--   agent_mailbox  — everything that wakes an actor; written only by dispatchTx, unique per
--                    (tenant_id, dedupe_key)
--   agent_events   — the append-only log, the only state; partitioned by month
--   agent_memory   — semantic memory, accepted proposals, keyed per scope
--   agent_version_pins — a store pinned to one agent version (staff)
--   agent_versions — deployed definitions and their ring stage: platform data, control only
-- The CRM agent's tables (agent_runs, agent_inbox, agent_wakeups, agent_run_steps) stay until
-- its port ends (migration step 4).

create table if not exists agent_versions (
  version text primary key check (version ~ '^v_[0-9a-f]{20}$'),
  agent_id text not null check (agent_id ~ '^[a-z][a-z0-9_-]{0,40}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 1000000),
  stage text not null default 'candidate'
    check (stage in ('candidate', 'canary', 'early', 'share', 'all', 'rolled_back', 'retired')),
  share_pct int not null default 0 check (share_pct between 0 and 100),
  evals_passed_at timestamptz,
  evals_report jsonb check (evals_report is null or octet_length(evals_report::text) <= 200000),
  stage_since timestamptz not null default now(),
  rollback_reason text check (char_length(rollback_reason) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists agent_versions_by_agent on agent_versions (agent_id, created_at desc);
alter table agent_versions enable row level security;
drop policy if exists control_access on agent_versions;
create policy control_access on agent_versions for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on agent_versions to vendua_app;

create table if not exists agent_actors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  agent_id text not null check (agent_id ~ '^[a-z][a-z0-9_-]{0,40}$'),
  subject_kind text not null check (subject_kind ~ '^[a-z][a-z0-9_]{0,40}$'),
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  lane text not null check (lane in ('interactive', 'followup', 'background')),
  version_pin text references agent_versions (version) on delete set null,
  seq bigint not null default 0 check (seq >= 0),
  projection jsonb check (projection is null or octet_length(projection::text) <= 4000000),
  projection_seq bigint not null default 0 check (projection_seq >= 0),
  next_wake_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  owner text check (char_length(owner) <= 120),
  lease_epoch bigint not null default 0,
  lease_until timestamptz,
  last_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, agent_id, subject_kind, subject_id)
);
create index if not exists agent_actors_due on agent_actors (lane, next_wake_at)
  where next_wake_at is not null;
create index if not exists agent_actors_leased on agent_actors (lane, tenant_id)
  where lease_until is not null;

create table if not exists agent_mailbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  actor_id uuid not null references agent_actors (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]*\.[a-z0-9_.]+$' and char_length(kind) <= 80),
  payload jsonb not null default 'null'::jsonb check (octet_length(payload::text) <= 32000),
  source text not null check (char_length(source) between 1 and 120),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  deliver_at timestamptz not null default now(),
  consumed_by_turn uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);
create index if not exists agent_mailbox_pending on agent_mailbox (actor_id, deliver_at)
  where consumed_by_turn is null;
create index if not exists agent_mailbox_turn on agent_mailbox (actor_id, consumed_by_turn)
  where consumed_by_turn is not null;
create index if not exists agent_mailbox_age on agent_mailbox (created_at)
  where consumed_by_turn is not null;

-- unique (actor_id, seq) holds because seq is allocated from agent_actors.seq under the fence;
-- a partitioned table's keys must include the partition column
create table if not exists agent_events (
  tenant_id uuid not null references tenants (id) on delete cascade,
  actor_id uuid not null references agent_actors (id) on delete cascade,
  seq bigint not null check (seq > 0),
  turn_id uuid,
  step text check (char_length(step) <= 80),
  type text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' and char_length(type) <= 80),
  payload jsonb not null check (octet_length(payload::text) <= 256000),
  version text not null check (char_length(version) <= 40),
  at timestamptz not null default now(),
  primary key (actor_id, seq, at)
) partition by range (at);
create table if not exists agent_events_default partition of agent_events default;
create index if not exists agent_events_by_turn on agent_events (actor_id, turn_id);
create index if not exists agent_events_by_type on agent_events (tenant_id, type, at);

-- the app role can't create tables: partitions come from this definer function, called ahead of
-- each month by the host
create or replace function agent_events_partition(month date) returns text
language plpgsql security definer set search_path = public as $$
declare
  start date := date_trunc('month', month)::date;
  name text := format('agent_events_y%sm%s', to_char(start, 'YYYY'), to_char(start, 'MM'));
begin
  if to_regclass(name) is null then
    execute format(
      'create table %I partition of agent_events for values from (%L) to (%L)',
      name, start, (start + interval '1 month')::date
    );
  end if;
  return name;
end
$$;
revoke all on function agent_events_partition(date) from public;
grant execute on function agent_events_partition(date) to vendua_app;
select agent_events_partition(now()::date);
select agent_events_partition((now() + interval '1 month')::date);

create table if not exists agent_memory (
  tenant_id uuid not null references tenants (id) on delete cascade,
  scope text not null check (char_length(scope) between 1 and 200),
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$' and char_length(key) <= 120),
  value jsonb not null check (octet_length(value::text) <= 2000),
  confidence real not null check (confidence between 0 and 1),
  provenance text not null check (char_length(provenance) <= 120),
  sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);

create table if not exists agent_version_pins (
  tenant_id uuid not null references tenants (id) on delete cascade,
  agent_id text not null check (agent_id ~ '^[a-z][a-z0-9_-]{0,40}$'),
  version text not null references agent_versions (version) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (tenant_id, agent_id)
);

do $$
declare
  t text;
begin
  foreach t in array array['agent_actors', 'agent_mailbox', 'agent_events', 'agent_memory', 'agent_version_pins']
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

-- a mailbox row makes its actor due and wakes the scheduler on commit (the 0048 pattern)
create or replace function agent_runtime_wake() returns trigger language plpgsql as $$
declare
  l text;
begin
  update agent_actors
     set next_wake_at = least(coalesce(next_wake_at, new.deliver_at), new.deliver_at),
         updated_at = now()
   where id = new.actor_id
  returning lane into l;
  perform pg_notify('vendua_agent_runtime', coalesce(l, ''));
  return null;
end
$$;
drop trigger if exists agent_runtime_wake on agent_mailbox;
create trigger agent_runtime_wake after insert on agent_mailbox
  for each row execute function agent_runtime_wake();

-- the store's WhatsApp outbox carries agent replies (ADR 0026's gateway sends them like any row);
-- agent_step makes a re-run step unable to queue a second copy
alter table store_wa_messages drop constraint if exists store_wa_messages_kind_check;
alter table store_wa_messages add constraint store_wa_messages_kind_check
  check (kind in ('order', 'opt_out', 'opt_in', 'test', 'agent'));
alter table store_wa_messages
  add column if not exists agent_step text check (char_length(agent_step) <= 200);
create unique index if not exists store_wa_messages_agent_step on store_wa_messages (tenant_id, agent_step)
  where agent_step is not null;
