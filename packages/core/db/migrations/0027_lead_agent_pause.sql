-- add leads.agent_paused_at — explicit lead-wide human-handoff marker
alter table leads add column if not exists agent_paused_at timestamptz;
