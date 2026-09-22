-- 0022_run_attempts.sql — attempt ledger for the reclaim path. drain()
-- requeues a 'running' run whose worker went silent past the lease; without
-- a bound a poisoned run loops forever and starves the queue ahead of
-- healthy work. attempts counts consumed executions (each reclaim +1);
-- max_attempts bounds them — the run that exhausts it lands 'failed' with
-- its journal kept, instead of requeuing.
alter table agent_runs
  add column if not exists attempts int not null default 0,
  add column if not exists max_attempts int not null default 5;
alter table agent_runs
  add constraint agent_runs_attempts_nonneg check (attempts >= 0),
  add constraint agent_runs_max_attempts_min check (max_attempts >= 1);
