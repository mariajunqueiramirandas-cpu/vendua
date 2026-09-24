-- 0030_lead_messages_dispatch_attempted.sql — a 'failed' send can come from
-- two places: a deterministic pre-wire refusal (no email, paused, suppressed)
-- or a provider call that threw after 'sending' — the second may already be
-- on the wire. Stamping the queued→sending transition keeps the distinction
-- durable, so a retried agent send can tell "never left" (retryable) from
-- "maybe sent" (must not compose a duplicate).

alter table lead_messages add column if not exists dispatch_attempted_at timestamptz;
