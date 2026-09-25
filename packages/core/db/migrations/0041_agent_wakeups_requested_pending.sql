-- 0041 — narrow one-pending-agent-wakeup uniqueness to autonomous wakeups so
-- scheduling can't cancel a lead's requested callback
drop index if exists agent_wakeups_one_pending_agent;
create unique index if not exists agent_wakeups_one_pending_agent
  on agent_wakeups (lead_id) where status = 'pending' and created_by = 'agent' and not requested;
