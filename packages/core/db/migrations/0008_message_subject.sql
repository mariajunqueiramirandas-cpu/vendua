-- 0008_message_subject.sql — outbound subject snapshots on the message row.
-- lead_threads.subject is the conversation default; a queued message keeps the
-- subject effective at compose time so a later override can't rewrite an
-- in-flight send (dispatch reads m.subject, falling back to the thread's).

alter table lead_messages add column if not exists subject text;

-- Only rows that can still dispatch inherit the thread's current subject —
-- a completed send used whatever the thread said back then, so stamping it
-- now would fabricate history.
update lead_messages m
set subject = t.subject
from lead_threads t
where m.thread_id = t.id
  and m.direction = 'out'
  and m.status in ('draft', 'queued')
  and m.subject is null;
