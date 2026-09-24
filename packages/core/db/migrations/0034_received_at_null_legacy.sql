-- 0034_received_at_null_legacy.sql — NULL received_at is the legacy
-- marker. 0030 backfilled pre-upgrade rows with received_at = created_at,
-- and the liveness probes used `received_at <> created_at` as the "real
-- server ingest" test — but a JS-ms created_at CAN coincide exactly with
-- clock_timestamp() (~1-in-1000 when the microsecond tail lands on a ms
-- boundary), silently misclassifying a live reply as legacy. NULL is
-- explicit and coincidence-proof: every real ingest rides the
-- clock_timestamp() default and can never be NULL, so the probes become
-- `received_at is not null and received_at > <stamp>`.
-- Residual: a live row ingested between 0030 and this migration whose two
-- clocks already agreed to the microsecond is indistinguishable from a
-- backfill and gets NULLed — the same one-shot coincidence this removes,
-- bounded to that narrow window.
alter table lead_messages alter column received_at drop not null;
update lead_messages set received_at = null where received_at = created_at;
