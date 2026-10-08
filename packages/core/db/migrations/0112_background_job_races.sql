-- 0112_background_job_races.sql — two background jobs that raced across Core replicas.
--   vendedor_runs_one_open — at most one queued or running Cliente oculto run per store: the
--   menu-change sweep on two Cores could queue two paid runs
--   platform_wa_outbox.settle_attempts / settle_retry_at — a CRM row whose settle keeps failing
--   backs off, then is given up, instead of holding back the rows behind it
-- Re-runnable.

-- a store that already has two open runs keeps one (a running one first, else the oldest)
update vendedor_runs r set status = 'failed', error = 'Substituída por outra rodada.',
  finished_at = now()
from (
  select id, row_number() over (
    partition by tenant_id order by (status = 'running') desc, created_at, id) as n
  from vendedor_runs where status in ('queued', 'running')
) d
where r.id = d.id and d.n > 1;
create unique index if not exists vendedor_runs_one_open on vendedor_runs (tenant_id)
  where status in ('queued', 'running');

alter table platform_wa_outbox
  add column if not exists settle_attempts int not null default 0
    check (settle_attempts >= 0),
  add column if not exists settle_retry_at timestamptz;
