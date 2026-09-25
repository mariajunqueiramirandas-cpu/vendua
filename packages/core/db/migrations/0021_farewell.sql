-- add lead_messages.is_farewell — the opt-out goodbye that survives the suppression re-check
alter table lead_messages add column if not exists is_farewell boolean not null default false;
