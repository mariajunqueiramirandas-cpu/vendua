-- 0007_crm.sql — Founder CRM → full agentic CRM (docs/roadmap.md, Phase 1→4
-- bridge). Grows the v0 intake board into the tool the founder actually runs
-- the pipeline in: richer lead fields, an activity timeline, tasks, channel
-- threads/messages, state history for funnel metrics, agent runs, provider
-- integrations, and workspace settings.
--
-- Same isolation posture as 0006: every table here is PLATFORM data — no
-- tenant_id, RLS keyed on the `vendua.control` GUC, the /control/v1 gate is
-- the access boundary and RLS the second line of defense. Mutations keep
-- claiming Idempotency-Keys via control_idempotency_keys.
--
-- leads.notes (v0 jsonb) migrates into lead_activities rows below, and the
-- column is dropped — one timeline, not two shapes of history.

alter table leads
  add column if not exists whatsapp text,
  add column if not exists website text,
  add column if not exists segment text,
  add column if not exists deal_value_cents int,
  add column if not exists owner text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists next_action_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists archived_at timestamptz,
  add column if not exists agent_mode text not null default 'draft'
    check (agent_mode in ('off', 'draft', 'auto')),
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists discovered_via text;

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  -- 'email'/'call'/'meeting' are staff-logged touchpoints; 'agent' marks
  -- runner actions; 'system' for imported/migrated events.
  kind text not null check (kind in ('note', 'call', 'meeting', 'state_change', 'agent', 'system')),
  body text,
  meta jsonb not null default '{}',
  created_by text not null default 'staff' check (created_by in ('staff', 'agent', 'system')),
  at timestamptz not null default now()
);
create index if not exists lead_activities_lead_at on lead_activities (lead_id, at desc);

-- Provider retries must never insert a second copy of the same inbound.
create unique index if not exists lead_messages_provider_id
  on lead_messages (provider_message_id) where provider_message_id is not null;

create table if not exists lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  done_at timestamptz,
  created_by text not null default 'staff' check (created_by in ('staff', 'agent')),
  created_at timestamptz not null default now()
);
create index if not exists lead_tasks_open_due on lead_tasks (due_at) where done_at is null;

-- One thread per lead per channel; external_id is the provider-side chat /
-- conversation id when one exists (baileys jid, resend thread).
create table if not exists lead_threads (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'manual')),
  subject text,
  external_id text,
  agent_enabled boolean not null default true,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, channel)
);

create table if not exists lead_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lead_threads (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('staff', 'agent', 'lead', 'system')),
  body text not null,
  -- drafts wait in the Approvals queue; 'rejected' keeps the audit trail.
  status text not null check (status in ('draft', 'queued', 'sent', 'delivered', 'received', 'failed', 'rejected')),
  provider_message_id text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_messages_thread_at on lead_messages (thread_id, created_at);
create index if not exists lead_messages_pending_drafts on lead_messages (created_at) where status = 'draft';
create index if not exists lead_messages_provider_id on lead_messages (provider_message_id) where provider_message_id is not null;

create table if not exists lead_state_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor text not null default 'staff' check (actor in ('staff', 'agent', 'system')),
  at timestamptz not null default now()
);
create index if not exists lead_state_history_lead on lead_state_history (lead_id, at);

-- Agent harness queue: every run is an auditable row. steps[] is the full
-- tool-call + model-io transcript; tokens/cost make spend a first-class read.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('triage', 'reply', 'outreach', 'discovery')),
  lead_id uuid references leads (id) on delete set null,
  thread_id uuid references lead_threads (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  params jsonb not null default '{}',
  steps jsonb not null default '[]',
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_cents int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists agent_runs_queue on agent_runs (created_at) where status = 'queued';

-- Modular provider configs. secret_ref is the NAME of an env var holding the
-- credential — values never live in this table.
create table if not exists control_integrations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('llm', 'email', 'whatsapp', 'discovery')),
  driver text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}',
  secret_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, driver)
);

-- Baileys auth state: the driver's multi-key credential store (replaces
-- useMultiFileAuthState so the socket survives rebuilds and restarts).
-- Keyed the way SignalKeyStore addresses keys: (account, category, name).
create table if not exists wa_auth_state (
  account_id text not null,
  category text not null,
  name text not null,
  data jsonb not null,
  primary key (account_id, category, name)
);

-- Workspace-level knobs: 'guardrails', 'pitch', 'autopilot_default'.
create table if not exists control_settings (
  key text primary key,
  value jsonb not null
);

-- Fold v0 notes into the timeline, then drop the jsonb column.
insert into lead_activities (lead_id, kind, body, created_by, at)
select id, 'note', n ->> 'body', 'staff', (n ->> 'at')::timestamptz
from leads, jsonb_array_elements(notes) n
where jsonb_array_length(notes) > 0
on conflict do nothing;

alter table leads drop column if exists notes;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_activities', 'lead_tasks', 'lead_threads', 'lead_messages',
    'lead_state_history', 'agent_runs', 'control_integrations',
    'wa_auth_state', 'control_settings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
