-- make received_at nullable: NULL marks legacy/backfilled rows — real ingests
-- ride the clock_timestamp() default and can never coincide like the old
-- `received_at = created_at` probe allowed
alter table lead_messages alter column received_at drop not null;
update lead_messages set received_at = null where received_at = created_at;
