-- 0153_crm_campaigns.sql — Autonomous Campaign Mode (`crm-campaign` actor on Agent Runtime v3):
-- Goal-directed multi-day sales campaigns launched from Telegram DM or the CRM. The director actor
-- watches active WIP, dispatches discovery hunts and existing-lead outreach within hard budget/time/
-- pacing caps, adapts strategy via its playbook, and stops automatically the moment the goal lands.
-- Additive and re-runnable (ADR 0041).

create table if not exists crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  objective text not null check (char_length(objective) between 1 and 2000),
  goal_kind text not null default 'signup'
    check (goal_kind in ('signup', 'meeting', 'reply')),
  goal_target int not null default 1 check (goal_target between 1 and 100),
  goal_progress int not null default 0 check (goal_progress >= 0),
  goal_scope text not null default 'any'
    check (goal_scope in ('any', 'campaign_only')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'won', 'stopped', 'exhausted')),
  stop_reason text check (char_length(stop_reason) <= 400),
  focus_segment text check (char_length(focus_segment) <= 120),
  focus_city text check (char_length(focus_city) <= 120),
  playbook text not null default '' check (char_length(playbook) <= 4000),
  budget_cents int not null default 2000 check (budget_cents between 100 and 100000),
  spent_cents int not null default 0 check (spent_cents >= 0),
  max_days int not null default 7 check (max_days between 1 and 60),
  expires_at timestamptz not null,
  max_hunts_per_day int not null default 3 check (max_hunts_per_day between 1 and 12),
  target_wip int not null default 15 check (target_wip between 3 and 80),
  check_interval_min int not null default 180 check (check_interval_min between 15 and 1440),
  allow_existing_leads boolean not null default true,
  created_by text not null check (char_length(created_by) between 1 and 120),
  chat_id text check (char_length(chat_id) <= 32),
  hunts_launched int not null default 0 check (hunts_launched >= 0),
  leads_enrolled int not null default 0 check (leads_enrolled >= 0),
  last_tick_at timestamptz,
  next_tick_at timestamptz,
  last_progress_report_at timestamptz,
  won_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_campaigns_open
  on crm_campaigns (status, created_at desc)
  where status in ('active', 'paused');

alter table crm_campaigns enable row level security;
drop policy if exists staff_all on crm_campaigns;
create policy staff_all on crm_campaigns for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on crm_campaigns to vendua_app;

create table if not exists crm_campaign_leads (
  campaign_id uuid not null references crm_campaigns (id) on delete cascade,
  lead_id uuid not null references leads (id) on delete cascade,
  origin text not null check (origin in ('discovered', 'revived', 'matched')),
  hunt_turn_id uuid,
  note text check (char_length(note) <= 400),
  enrolled_at timestamptz not null default now(),
  converted_at timestamptz,
  primary key (campaign_id, lead_id)
);

create index if not exists crm_campaign_leads_lead
  on crm_campaign_leads (lead_id, enrolled_at desc);

alter table crm_campaign_leads enable row level security;
drop policy if exists staff_all on crm_campaign_leads;
create policy staff_all on crm_campaign_leads for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on crm_campaign_leads to vendua_app;

create table if not exists crm_campaign_hunts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references crm_campaigns (id) on delete cascade,
  hunt_subject_id uuid not null unique,
  query text not null check (char_length(query) between 1 and 500),
  segment text check (char_length(segment) <= 120),
  city text check (char_length(city) <= 120),
  target int check (target between 1 and 50),
  status text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  turn_id uuid,
  leads_created int not null default 0 check (leads_created >= 0),
  cost_cents int not null default 0 check (cost_cents >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists crm_campaign_hunts_campaign
  on crm_campaign_hunts (campaign_id, created_at desc);

alter table crm_campaign_hunts enable row level security;
drop policy if exists staff_all on crm_campaign_hunts;
create policy staff_all on crm_campaign_hunts for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on crm_campaign_hunts to vendua_app;

-- Link crm_turns to campaigns and allow 'campaign' director turns in crm_turns.kind
alter table crm_turns
  add column if not exists campaign_id uuid references crm_campaigns (id) on delete set null;

create index if not exists crm_turns_campaign
  on crm_turns (campaign_id, finished_at desc)
  where campaign_id is not null;

alter table crm_turns drop constraint if exists crm_turns_kind_check;
alter table crm_turns add constraint crm_turns_kind_check
  check (kind in ('triage', 'reply', 'outreach', 'discovery', 'strategist', 'campaign'));

-- Allow Telegram 1-tap start_campaign proposals and campaign_guide ForceReply prompts
alter table telegram_proposals drop constraint if exists telegram_proposals_kind_check;
alter table telegram_proposals add constraint telegram_proposals_kind_check
  check (
    kind in (
      'set_autonomy',
      'update_instructions',
      'delete_rule',
      'approve_draft',
      'direct_message',
      'board_run',
      'start_campaign'
    )
  );

alter table telegram_prompts drop constraint if exists telegram_prompts_kind_check;
alter table telegram_prompts add constraint telegram_prompts_kind_check
  check (
    kind in (
      'draft_rewrite',
      'handoff_guide',
      'handoff_direct',
      'lead_guide',
      'teach_rule',
      'campaign_guide'
    )
  );
