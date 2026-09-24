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
