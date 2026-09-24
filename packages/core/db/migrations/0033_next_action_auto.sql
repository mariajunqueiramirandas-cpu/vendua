-- 0033_next_action_auto.sql — 'auto' provenance for the agent's own
-- self-scheduled next_action_at dates. 'agent' stays valid for legacy
-- rows: migration 0025 backfilled EVERY pre-existing dated lead to
-- 'agent', mixing self-scheduled nudges with lead-requested callbacks —
-- provenance is unrecoverable, so legacy 'agent' rows are treated as
-- preserved (inbound never clears them, sweeps materialize them unmarked).
-- New agent writes stamp 'auto', which inbound clears like 'cadence'.
alter table leads drop constraint leads_next_action_source_check;
alter table leads add constraint leads_next_action_source_check
  check (next_action_source in ('cadence', 'agent', 'staff', 'requested', 'auto'));

-- Pre-'auto' sweeps stamped params.auto = 'agent' on materialized runs —
-- the same unrecoverable mix (self-schedule or lead-asked callback). Strip
-- the marker from still-live rows so a reply can't cancel a possible
-- promise; they become unmarked like post-deploy 'agent' sweeps. Code
-- also exempts the marker at every disposable-auto predicate (cancel,
-- supersede, mid-run abort, send guard), covering rows an old worker may
-- stamp during a rolling deploy. Terminal rows keep their history.
update agent_runs
set params = params - 'auto'
where kind = 'outreach' and status in ('queued', 'running')
  and params->>'auto' = 'agent';
