-- ADR 0016: the scheduler records every job's last run so the CRM can show whether the
-- agent's routines are healthy (and since when one has been failing).
create table if not exists scheduled_jobs (
  name text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_ok boolean,
  last_error text,
  last_result int,
  -- last run that actually did something (result > 0)
  last_work_at timestamptz,
  -- first failure of the current streak; null while healthy
  failing_since timestamptz,
  runs bigint not null default 0,
  failures bigint not null default 0
);

do $$
begin
  execute format('alter table %I enable row level security', 'scheduled_jobs');
  execute format('drop policy if exists staff_all on %I', 'scheduled_jobs');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'scheduled_jobs'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'scheduled_jobs');
end $$;
