-- add lead_messages.received_at — server ingestion time; provider-skew-proof liveness clock
alter table lead_messages add column if not exists received_at timestamptz;
update lead_messages set received_at = created_at where received_at is null;
alter table lead_messages alter column received_at set not null;
alter table lead_messages alter column received_at set default now();
