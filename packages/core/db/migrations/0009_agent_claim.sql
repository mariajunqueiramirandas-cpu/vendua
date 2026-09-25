-- agent_runs.claim_token fences heartbeat/journal/finish writes to the owning
-- execution — a stale worker can no longer overwrite the live run.
alter table agent_runs add column if not exists claim_token text;
