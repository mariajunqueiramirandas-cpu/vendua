-- agent_runs.alive_at = heartbeat stamp; started_at stays the real start time
-- (journal writes were overwriting it before).
alter table agent_runs add column alive_at timestamptz;
update agent_runs set alive_at = started_at where alive_at is null;
