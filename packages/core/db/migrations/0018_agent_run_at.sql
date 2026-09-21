-- 0018_agent_run_at.sql — delayed dispatch. A queued run may carry an
-- earliest-start; the worker claims only rows whose run_at is due. Inbound
-- pacing (guardrails.inboundReplyDelayMin) and first-contact scheduling
-- (guardrails.firstContactDelayMin) ride the existing queue — no separate
-- scheduler table, and a pending run stays cancelable like any other.
alter table agent_runs
  add column if not exists run_at timestamptz;
