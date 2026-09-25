-- Index agent_runs.lead_id — per-lead lookups (busy-outreach check, suppression
-- read, inbound auto-cancel, lifetime cost sum) were all seq scans.
create index if not exists agent_runs_lead on agent_runs (lead_id);
