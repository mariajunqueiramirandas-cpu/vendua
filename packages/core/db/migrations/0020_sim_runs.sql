-- agent/sim — negotiation simulation results.
-- Scenarios live in code (src/agent/sim-scenarios.ts); each run persists its
-- transcript + judge verdict here for quality tracking over time.
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
