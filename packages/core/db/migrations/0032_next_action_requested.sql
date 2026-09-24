-- 0032_next_action_requested.sql — split provenance for leads.next_action_at.
-- update_lead stamps 'requested' when the model marks nextActionRequested:
-- the LEAD named the date ("me chama terça") — a promised callback that
-- survives an inbound reply exactly like 'staff'. 'cadence' and 'agent'
-- stay the automation's own scheduling and are still cleared on reply.
alter table leads drop constraint leads_next_action_source_check;
alter table leads add constraint leads_next_action_source_check
  check (next_action_source in ('cadence', 'agent', 'staff', 'requested'));
