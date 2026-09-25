-- agent_wakeups.fired_at: immutable fire timestamp (updated_at moves on cancel, created_at predates late mails).
alter table agent_wakeups add column if not exists fired_at timestamptz;

-- Best-effort backfill: updated_at is the flip's stamp for undisturbed fired rows.
update agent_wakeups set fired_at = updated_at
  where status = 'fired' and fired_at is null;
