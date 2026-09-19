-- agent_runs.claim_token fences writes to the running execution that owns
-- the row: the reclaimer clears it, each new claim mints one, and the
-- worker's heartbeat/journal/finish writes are conditioned on it — so a
-- stale worker waking after its run was requeued can no longer overwrite
-- the live execution's status or journal.
alter table agent_runs add column if not exists claim_token text;
