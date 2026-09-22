-- 0025_next_action_source.sql — provenance for leads.next_action_at. The
-- cadence floor stamps 'cadence'; the agent's own scheduling lands 'agent'
-- (deliberate — "me chama semana que vem" survives a reply); staff/API writes
-- land 'staff'. Inbound replies clear only 'cadence' rows: the floor exists
-- for unanswered sends, so a reply means it did its job — while an
-- agent- or staff-set date keeps standing.
alter table leads
  add column if not exists next_action_source text
    check (next_action_source in ('cadence', 'agent', 'staff'));

-- Legacy values were all written by the agent prompt before this column
-- existed — mark them 'agent' so an inbound reply doesn't silently drop a
-- scheduled follow-up that was set with intent.
update leads set next_action_source = 'agent'
  where next_action_at is not null and next_action_source is null;

alter table leads alter column next_action_source set default 'agent';
