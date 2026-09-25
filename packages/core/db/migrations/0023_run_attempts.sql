-- agent_runs: attempts/max_attempts bound reclaims so a poisoned run fails instead of looping forever.
alter table agent_runs
  add column if not exists attempts int not null default 0,
  add column if not exists max_attempts int not null default 5;
alter table agent_runs
  add constraint agent_runs_attempts_nonneg check (attempts >= 0),
  add constraint agent_runs_max_attempts_min check (max_attempts >= 1);
