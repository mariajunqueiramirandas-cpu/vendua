-- received_at default -> clock_timestamp(): now()'s tx clock can predate run.started_at and evade live-inbound probes.
alter table lead_messages alter column received_at set default clock_timestamp();
