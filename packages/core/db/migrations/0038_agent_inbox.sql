-- 0038_agent_inbox.sql — per-lead agent mailbox plus one active run per
-- lead. Anything that wants the agent's attention for a lead (an inbound
-- message, a fired wakeup, a staff nudge, a scheduled event) enqueues an
-- item here instead of racing to own a run. The lead's active run drains
-- pending items between steps and renders them to the model; items stay
-- pending until a run's fenced journal commit stamps consumed_by_run —
-- a run that dies without draining hands the mail to the next run via
-- the orphan sweep in drain().
create table if not exists agent_inbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  kind text not null check (kind in ('inbound', 'wakeup', 'staff', 'event')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  consumed_by_run uuid references agent_runs (id) on delete set null,
  consumed_at timestamptz
);
create index if not exists agent_inbox_pending
  on agent_inbox (lead_id, created_at) where consumed_at is null;
create index if not exists agent_inbox_run on agent_inbox (consumed_by_run)
  where consumed_by_run is not null;

-- One active (queued|running) run per lead. Old coalescing allowed
-- parallel active rows; retire the extras first (earliest wins — it owns
-- the most context) so the unique index can build on real world data.
-- Cancelling a 'running' row flips its claim fence: the owning worker's
-- next persist no-ops and the attempt unwinds — a clean stop, not a kill.
update agent_runs set
  status = 'canceled',
  error = 'superseded — single active run per lead',
  finished_at = now()
where id in (
  select id from (
    select id, row_number() over (partition by lead_id order by created_at, id) as rn
    from agent_runs
    where lead_id is not null and status in ('queued', 'running')
  ) d
  where rn > 1
);
create unique index if not exists agent_runs_one_active_per_lead
  on agent_runs (lead_id) where status in ('queued', 'running');

do $$
begin
  execute format('alter table %I enable row level security', 'agent_inbox');
  execute format('drop policy if exists staff_all on %I', 'agent_inbox');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'agent_inbox'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'agent_inbox');
end $$;
