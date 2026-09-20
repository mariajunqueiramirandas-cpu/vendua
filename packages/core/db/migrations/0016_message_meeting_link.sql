-- 0016_message_meeting_link.sql — durable link between an outbound message
-- and the meeting it belongs to. Confirmations and reminders carry it so the
-- dispatch claim (and the stranded-message recovery in drain()) can suppress
-- sends once the meeting is no longer scheduled — a caller-supplied guard
-- never reaches the recovery path.

alter table lead_messages
  add column if not exists meeting_id uuid references meetings(id) on delete set null;
