-- 0028_agent_runs_lead_idx.sql — per-lead lookups on agent_runs were all
-- seq scans: claimRun's busy-outreach check, the autocontact suppression
-- read, the inbound auto-cancel, and now leadLifetimeCostCapUsd's
-- sum(cost_cents) on every lead-bound insertRun.
create index if not exists agent_runs_lead on agent_runs (lead_id);
