-- sim_runs: negotiation-simulation transcripts + judge verdicts
-- (scenarios live in src/agent/sim-scenarios.ts)
create table if not exists sim_runs (
  id uuid primary key default gen_random_uuid(),
  scenario text not null,
  lead_id uuid references leads (id) on delete set null,
  outcome text not null default 'stalled',
  score int check (score between 1 and 5),
  judge jsonb not null default '{}',
  transcript jsonb not null default '[]',
  turns int not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  llm text,
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists sim_runs_created on sim_runs (created_at desc);

do $$
begin
  execute format('alter table %I enable row level security', 'sim_runs');
  execute format('drop policy if exists staff_all on %I', 'sim_runs');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'sim_runs'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'sim_runs');
end
$$;
