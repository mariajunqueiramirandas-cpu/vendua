-- First observed read receipt for an outbound CRM message.
alter table lead_messages add column if not exists seen_at timestamptz;
