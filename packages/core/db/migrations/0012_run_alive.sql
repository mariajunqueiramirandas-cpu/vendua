-- 0012 — split the reclaim lease from the real start time.
-- started_at used to double as the lease: every journal write + heartbeat
-- overwrote it, so it was never the actual start (the launch stage's clock
-- and Runs detail's 'início' both read ≈0 elapsed). alive_at is the lease;
-- started_at now means "when this attempt began" and never moves again.
alter table agent_runs add column alive_at timestamptz;
update agent_runs set alive_at = started_at where alive_at is null;
