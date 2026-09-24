-- 0035_agent_memory_v2.sql — memory v2 (ADR 0014): the flat
-- control_settings.agent_memory.facts string list becomes two real tables.
--
-- agent_memory_items — workspace learnings, per-segment learnings, and
-- discovery debriefs as first-class rows: pinned items staff never want
-- evicted, a uses counter so the run-reader can prefer proven learnings,
-- and dedupe on (scope, segment, lower(content)). Learnings (workspace +
-- segment) cap at 200, debriefs at 60 — debriefs can no longer flush the
-- learnings the way the shared 100-string list let them.
--
-- lead_facts — structured per-lead facts (keyed snake_case), the deeper
-- per-lead memory docs/agent-improvements.md calls out over notes+plan.
--
-- Both are PLATFORM data — no tenant_id, RLS keyed on `vendua.control`
-- (same posture as the other control tables); /control/v1 is the access
-- boundary and RLS the second line.

create table if not exists agent_memory_items (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('workspace', 'segment', 'debrief')),
  -- 'segment'-scoped learnings must carry their segment; other scopes may
  -- too (a debrief can tag the segment its run covered). Always lowercased
  -- so reads match case-insensitively.
  segment text,
  content text not null check (char_length(content) <= 500),
  -- staff pins are exempt from cap eviction.
  pinned boolean not null default false,
  source text not null check (source in ('agent', 'staff', 'debrief')),
  source_run_id uuid references agent_runs (id) on delete set null,
  uses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope <> 'segment' or segment is not null),
  check (segment is null or segment = lower(segment))
);
-- Same learning can't exist twice in a scope — writes upsert on this key.
create unique index if not exists agent_memory_items_dedupe
  on agent_memory_items (scope, coalesce(segment, ''), lower(content));
create index if not exists agent_memory_items_feed
  on agent_memory_items (scope, created_at desc);

create table if not exists lead_facts (
  lead_id uuid not null references leads (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  value text not null check (char_length(value) <= 500),
  confidence numeric(3, 2) not null default 1 check (confidence between 0 and 1),
  source text not null check (source in ('agent', 'staff')),
  source_run_id uuid references agent_runs (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (lead_id, key)
);

-- Backfill the old facts list. Discovery debriefs (writeDebrief's
-- `run <seg>[/cidade]: N leads …` shape) classify as scope='debrief';
-- everything else is a workspace learning. All predate memory v2, so
-- source='staff' and no segment/run attribution. The array is
-- append-ordered (oldest→newest); ordinality micro-offsets preserve that
-- order in created_at so "latest debriefs" still means latest. Truncation
-- + on-conflict keep a stray over-long or case-duped legacy string from
-- failing the migration on the new checks.
insert into agent_memory_items (scope, segment, content, pinned, source, created_at, updated_at)
select
  case when e.fact ~ '^run .+: [0-9]+ leads' then 'debrief' else 'workspace' end,
  null,
  left(e.fact, 500),
  false,
  'staff',
  now() + (e.ord * interval '1 microsecond'),
  now() + (e.ord * interval '1 microsecond')
from control_settings s
cross join lateral (
  select v #>> '{}' as fact, ord
  from jsonb_array_elements(
    case
      when jsonb_typeof(s.value -> 'facts') = 'array' then s.value -> 'facts'
      else '[]'::jsonb
    end
  ) with ordinality as x(v, ord)
  where jsonb_typeof(v) = 'string'
) e
where s.key = 'agent_memory'
order by e.ord
on conflict do nothing;

-- The old list could hold 100 strings — more than the 60 debrief cap.
-- Apply it here too (newest first, same ordering as runtime eviction) so a
-- migrated db doesn't carry an over-cap class into the first rememberTx.
delete from agent_memory_items
where id in (
  select id from agent_memory_items
  where scope = 'debrief'
  order by created_at desc, id asc
  offset 60
);

-- The settings row stays: the v1 readers still read it until the runner
-- cutover lands (parent session removes them).

do $$
declare
  t text;
begin
  foreach t in array array['agent_memory_items', 'lead_facts']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
