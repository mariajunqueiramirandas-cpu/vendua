-- leads.agent_plan: the negotiation checklist the agent ticks across replies —
-- persists on the lead (unlike run-scoped plan/book memory that dies with the run).
alter table leads
  add column if not exists agent_plan jsonb not null default '[]'::jsonb;
