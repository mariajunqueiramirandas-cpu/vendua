-- adds 'auto' next_action_source for agent self-scheduled dates (legacy 'agent' rows stay valid — 0025's backfill made their provenance unrecoverable)
alter table leads drop constraint leads_next_action_source_check;
alter table leads add constraint leads_next_action_source_check
  check (next_action_source in ('cadence', 'agent', 'staff', 'requested', 'auto'));

-- strip params.auto='agent' from still-live outreach runs so a reply can't cancel a possible promise; code exempts the marker at every disposable-auto predicate
update agent_runs
set params = params - 'auto'
where kind = 'outreach' and status in ('queued', 'running')
  and params->>'auto' = 'agent';
