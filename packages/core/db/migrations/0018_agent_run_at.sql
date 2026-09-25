-- 0018_agent_run_at.sql — agent_runs.run_at: earliest-start for queued runs (delayed dispatch).
alter table agent_runs
  add column if not exists run_at timestamptz;
