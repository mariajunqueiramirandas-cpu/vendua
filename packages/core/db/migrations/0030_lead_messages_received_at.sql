-- 0030_lead_messages_received_at.sql — server ingestion timestamp for
-- lead_messages. created_at carries the provider's sentAt (display order,
-- history imports preserve it); received_at carries when THIS server
-- ingested the row — the only clock a liveness check can trust, since a
-- delayed webhook or skewed provider clock can put a genuinely-new live
-- inbound before the run's claim stamp. Backfilled to created_at so
-- pre-upgrade rows keep their ordering.
alter table lead_messages add column if not exists received_at timestamptz;
update lead_messages set received_at = created_at where received_at is null;
alter table lead_messages alter column received_at set not null;
alter table lead_messages alter column received_at set default now();
