-- adds lead_messages.historical — marks re-imported context-only inbounds the live-reply probe ignores
alter table lead_messages add column if not exists historical boolean not null default false;
