-- pipeline_snapshots: one row/day of per-state count + value, weighted value, and trailing-30d agent spend.

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
