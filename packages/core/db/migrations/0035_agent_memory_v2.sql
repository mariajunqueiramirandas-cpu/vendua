-- Memory v2 (ADR 0014): flat agent_memory.facts → agent_memory_items (scoped
-- learnings/debriefs, cap 200/60, pinned exempt) + lead_facts (per-lead keyed
-- facts). Platform data — RLS keyed on `vendua.control`.

create table if not exists agent_memory_items (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('workspace', 'segment', 'debrief')),
  -- 'segment' scope requires segment; always lowercased for case-insensitive reads.
  segment text,
  content text not null check (char_length(content) <= 500),
  -- Staff pins are exempt from cap eviction.
  pinned boolean not null default false,
  source text not null check (source in ('agent', 'staff', 'debrief')),
  source_run_id uuid references agent_runs (id) on delete set null,
  uses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope <> 'segment' or segment is not null),
  check (segment is null or segment = lower(segment))
);
-- Dedupe key — writes upsert on it.
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

-- Backfill the legacy facts list: debrief-shaped rows → 'debrief', rest →
-- 'workspace'; all predate v2 so source='staff'; ordinality offsets preserve
-- append order; left() + on-conflict keep over-long/case-duped strings from failing.
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

-- Apply the 60-debrief cap here too (newest first) — the old list held 100 and
-- a migrated db must not carry an over-cap class into the first rememberTx.
delete from agent_memory_items
where id in (
  select id from agent_memory_items
  where scope = 'debrief'
  order by created_at desc, id asc
  offset 60
);

-- Settings row stays — v1 readers still read it until the runner cutover lands.

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
