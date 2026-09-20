-- 0010_agent_goals.sql — goal-driven agent + scheduled discovery (AutoGTM
-- parity pass). `leads.agent_goal` is the standing objective staff picks at
-- dispatch time ('negotiation' closes in-thread, 'meeting' drives toward the
-- founders' Google Meet booking link); reply/outreach runs read it so
-- inbound replies stay on-goal. `fit_score`/`fit_reason` is the model-judged
-- ICP match — separate from the SQL completeness `score`. `email_bounced_at`
-- is the deliverability flag Resend bounce/failed events set, blocking later
-- email sends. `discovery_briefs` are the daily autopilot briefs — the worker
-- sweep enqueues one discovery run per due brief.
--
-- Same isolation posture as 0007: platform data, RLS keyed on vendua.control.

alter table leads
  add column if not exists agent_goal text not null default 'negotiation'
    check (agent_goal in ('negotiation', 'meeting')),
  add column if not exists fit_score int
    check (fit_score is null or fit_score between 0 and 10),
  add column if not exists fit_reason text,
  add column if not exists email_bounced_at timestamptz;

create table if not exists discovery_briefs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  query text not null,
  segment text,
  city text,
  -- target leads per daily run; the run prompt turns it into the stop
  -- condition and the guardrail cap still bounds it from above.
  target int check (target is null or (target between 1 and 1000)),
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  execute format('alter table %I enable row level security', 'discovery_briefs');
  execute format('drop policy if exists staff_all on %I', 'discovery_briefs');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'discovery_briefs'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'discovery_briefs');
end
$$;
