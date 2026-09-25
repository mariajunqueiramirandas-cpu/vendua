-- 0037_agent_run_steps.sql — per-entry journal table: every agent_runs.steps
-- entry is also written here so the trajectory is queryable without
-- unpacking the jsonb array. Replay still reads agent_runs.steps — this
-- table is a shadow index, dual-written at each journal commit.
-- seq is the entry's index in the committed journal snapshot; step is the
-- model-step a tool call belongs to (ctx.step). A pending tool row is
-- upserted with its result at the same seq once the call resolves.
create table if not exists agent_run_steps (
  run_id uuid not null references agent_runs (id) on delete cascade,
  step integer,
  seq integer not null,
  kind text not null,
  name text,
  call_id text,
  args jsonb,
  out jsonb,
  cost_cents integer,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, seq)
);
create unique index if not exists agent_run_steps_call_uq
  on agent_run_steps (run_id, step, call_id) where call_id is not null;
create index if not exists agent_run_steps_name on agent_run_steps (name) where name is not null;

-- Backfill historical journals: finished runs never get another journal
-- write, so without this their trajectories stay invisible to the shadow
-- table. seq = ordinality - 1 to match syncRunStepsTx; cost_cents maps only
-- model usage (real USD) — readSpent is a fetch count, monid_spend markers
-- are cumulative snapshots, neither is a per-row cost.
insert into agent_run_steps (run_id, step, seq, kind, name, call_id, args, out, cost_cents)
select r.id,
       case when jsonb_typeof(e.v->'step') = 'number' then (e.v->>'step')::int end,
       e.i - 1,
       coalesce(e.v->>'type', 'unknown'),
       e.v->>'name',
       e.v->>'callId',
       e.v->'args',
       e.v->'out',
       case when e.v->>'type' = 'model' and jsonb_typeof(e.v->'usage'->'costUsd') = 'number'
            then round((e.v->'usage'->>'costUsd')::numeric * 100)::int end
from agent_runs r
cross join lateral jsonb_array_elements(r.steps) with ordinality as e(v, i)
where jsonb_typeof(r.steps) = 'array'
on conflict (run_id, seq) do nothing;

do $$
begin
  execute format('alter table %I enable row level security', 'agent_run_steps');
  execute format('drop policy if exists staff_all on %I', 'agent_run_steps');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'agent_run_steps'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'agent_run_steps');
end $$;
