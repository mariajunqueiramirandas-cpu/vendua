-- 0026_unsubscribed_queued_runs.sql — queued runs parked under leads that
-- unsubscribed before the enqueue/suppression gates landed. The claim gate
-- holds suppressed leads 'queued' forever by design (flags may lift), but
-- unsubscribed_at never lifts — these rows are dead weight. 'off' and
-- archived stay queued: both flags are reversible and resume is intended.
update agent_runs
set status = 'canceled', finished_at = now(), error = 'descadastrado'
where status = 'queued'
  and lead_id in (select id from leads where unsubscribed_at is not null);
