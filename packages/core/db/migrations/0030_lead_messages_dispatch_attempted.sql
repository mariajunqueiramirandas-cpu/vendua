-- lead_messages.dispatch_attempted_at: stamps the queued→sending transition so "never left" (retryable) is told apart from "maybe sent".

alter table lead_messages add column if not exists dispatch_attempted_at timestamptz;

-- Unclassifiable legacy 'failed' rows are stamped attempted: maybe-sent is the safe side.
update lead_messages
set dispatch_attempted_at = updated_at
where status = 'failed' and dispatch_attempted_at is null;
