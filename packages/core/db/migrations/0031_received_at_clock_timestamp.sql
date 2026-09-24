-- 0031_received_at_clock_timestamp.sql — now() is the transaction clock:
-- an inbound tx that opens before an outreach claims but commits after
-- stamps received_at BEFORE run.started_at, and the live-inbound probes
-- (mid-run self-cancel, dispatch-boundary refusal) would miss the message
-- they exist to catch. clock_timestamp() is the wall clock at statement
-- execution — the honest "this row was inserted" instant. The 0030
-- backfill (received_at = created_at for pre-upgrade rows) stays as-is.
alter table lead_messages alter column received_at set default clock_timestamp();
