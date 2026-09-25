-- 0041_agent_wakeups_requested_pending.sql — a requested callback is a
-- promise, not a plan. The one-pending-agent-wakeup index covered requested
-- rows too, so scheduleWakeupTx's replace could only keep an autonomous
-- reminder by canceling the lead's promised callback (and a later inbound
-- then retires the replacement as unrequested — the promise is gone).
-- Narrow the uniqueness to the replaceable class: one pending AUTONOMOUS
-- wakeup per lead, while requested callbacks coexist and stay under
-- retireWakeupsOnInboundTx's `not requested` protection.
drop index if exists agent_wakeups_one_pending_agent;
create unique index if not exists agent_wakeups_one_pending_agent
  on agent_wakeups (lead_id) where status = 'pending' and created_by = 'agent' and not requested;
