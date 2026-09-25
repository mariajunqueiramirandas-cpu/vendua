-- leads.next_action_source: provenance (cadence/agent/staff) — inbound
-- replies clear only 'cadence' dates; agent/staff-set dates keep standing
alter table leads
  add column if not exists next_action_source text
    check (next_action_source in ('cadence', 'agent', 'staff'));

update leads set next_action_source = 'agent'
  where next_action_at is not null and next_action_source is null;

alter table leads alter column next_action_source set default 'agent';
