-- 0040_agent_wakeups_fired_at.sql — an immutable fire timestamp.
-- updated_at is not one: cancelWakeup bumps it even on an already-fired
-- row, and fired_run_id's created_at predates a wakeup mailed into a
-- pre-existing run. Metrics (and any "when did this fire" question) need
-- a stamp written exactly once, at the flip.
alter table agent_wakeups add column if not exists fired_at timestamptz;

-- Best-effort backfill for rows fired before the column existed: for an
-- undisturbed fired row updated_at IS the flip's stamp; a row canceled
-- after firing loses that, but nothing better survives.
update agent_wakeups set fired_at = updated_at
  where status = 'fired' and fired_at is null;
