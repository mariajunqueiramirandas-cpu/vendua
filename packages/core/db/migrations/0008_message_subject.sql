-- Per-message subject snapshot so a later thread override can't rewrite an in-flight send.

alter table lead_messages add column if not exists subject text;

-- Only dispatchable rows inherit the thread subject; stamping sent rows would fabricate history.
update lead_messages m
set subject = t.subject
from lead_threads t
where m.thread_id = t.id
  and m.direction = 'out'
  and m.status in ('draft', 'queued')
  and m.subject is null;
