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
