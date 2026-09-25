-- Add 'requested' to next_action_source — a lead-asked date is a promised
-- callback that survives an inbound reply, like 'staff' (cadence/agent still clear).
alter table leads drop constraint leads_next_action_source_check;
alter table leads add constraint leads_next_action_source_check
  check (next_action_source in ('cadence', 'agent', 'staff', 'requested'));
