-- 0014_pipeline_snapshots.sql — daily pipeline snapshots for deal-value
-- forecasting. The worker sweep writes one row per day (taken_on is unique):
-- the funnel's per-state count + deal value at that moment, the weighted
-- value under the configured stage probabilities, and the trailing 30d agent
-- spend — the "expected revenue vs. agent cost" pair the Reports view reads.
-- Re-runs on the same day UPDATE the row (a snapshot is a point-in-time
-- measurement, not an event log).
--
-- Same isolation posture as 0007: platform data, RLS keyed on vendua.control.

create table if not exists pipeline_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- the day the snapshot covers (server-local current_date) — one row/day.
  taken_on date not null unique,
  -- {"lead": {"count": n, "valueCents": n}, ...} — all four LEAD_STATES keys.
  by_state jsonb not null,
  -- sum(valueCents * stage probability) at snapshot time.
  weighted_cents int not null default 0,
  -- agent_runs cost_cents over the trailing 30d, frozen with the snapshot.
  agent_cost_cents int not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  execute format('alter table %I enable row level security', 'pipeline_snapshots');
  execute format('drop policy if exists staff_all on %I', 'pipeline_snapshots');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'pipeline_snapshots'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'pipeline_snapshots');
end
$$;
