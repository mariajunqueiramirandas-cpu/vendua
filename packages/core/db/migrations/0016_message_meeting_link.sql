-- lead_messages.meeting_id: lets dispatch/recovery suppress sends once the
-- linked meeting is no longer scheduled

alter table lead_messages
  add column if not exists meeting_id uuid references meetings(id) on delete set null;
