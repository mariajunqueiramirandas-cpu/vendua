-- add agent_wakeups — agent-booked future work; one pending agent wakeup per lead
create table if not exists agent_wakeups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete cascade,
  kind text not null default 'outreach'
    check (kind in ('triage', 'reply', 'outreach', 'discovery', 'strategist')),
  at timestamptz not null,
  focus text not null check (length(focus) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'fired', 'canceled')),
  created_by text not null default 'agent' check (created_by in ('agent', 'staff')),
  -- lead-requested date survives the lead's next message
  requested boolean not null default false,
  created_by_run_id uuid references agent_runs (id) on delete set null,
  fired_run_id uuid references agent_runs (id) on delete set null,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_wakeups_due on agent_wakeups (at) where status = 'pending';
create index if not exists agent_wakeups_lead on agent_wakeups (lead_id, status);
create unique index if not exists agent_wakeups_one_pending_agent
  on agent_wakeups (lead_id) where status = 'pending' and created_by = 'agent';

do $$
begin
  execute format('alter table %I enable row level security', 'agent_wakeups');
  execute format('drop policy if exists staff_all on %I', 'agent_wakeups');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'agent_wakeups'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'agent_wakeups');
end $$;
