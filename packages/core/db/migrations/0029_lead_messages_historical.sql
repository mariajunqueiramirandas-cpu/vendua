-- 0029_lead_messages_historical.sql — history-imported inbounds are context
-- only: they carry the provider's sentAt as created_at, so a "live reply"
-- probe keyed on created_at alone would read a re-imported old message (or a
-- provider clock ahead of ours) as a fresh reply. The flag is what the run
-- loop's auto-outreach self-cancel filters on.
alter table lead_messages add column if not exists historical boolean not null default false;
