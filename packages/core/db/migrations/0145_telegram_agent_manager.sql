-- 0145_telegram_agent_manager.sql — Telegram DM sales-agent management (ADR 0047):
-- 1) telegram_dm_outbox: durable delivery for replies from the `crm-manager` Agent Runtime v3 actor
--    (written inside the agent step tx, deduped by agent_step, kicked via afterCommit + scheduler).
-- 2) telegram_prompts: short-lived ForceReply prompt targets so buttons ("reescrever", "responder ao
--    agente", "guiar agente", "ensinar regra") survive restarts and multiple replicas.
-- 3) telegram_proposals: 1-tap Confirm/Cancel cards proposed by the AI sales manager in DM.
-- Additive and re-runnable (ADR 0041).

create table if not exists telegram_dm_outbox (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null check (char_length(chat_id) between 1 and 32),
  text text not null check (char_length(text) between 1 and 4096),
  buttons jsonb not null default '[]'::jsonb,
  reply_to_message_id text check (char_length(reply_to_message_id) <= 32),
  agent_step text unique check (char_length(agent_step) <= 160),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists telegram_dm_outbox_due
  on telegram_dm_outbox (next_attempt_at, created_at)
  where state = 'pending';

alter table telegram_dm_outbox enable row level security;
drop policy if exists staff_all on telegram_dm_outbox;
create policy staff_all on telegram_dm_outbox for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on telegram_dm_outbox to vendua_app;

drop trigger if exists telegram_dm_outbox_notify on telegram_dm_outbox;
create trigger telegram_dm_outbox_notify after insert on telegram_dm_outbox
  for each statement
  execute function vendua_table_notify();

create table if not exists telegram_prompts (
  chat_id text not null check (char_length(chat_id) between 1 and 32),
  message_id text not null check (char_length(message_id) between 1 and 32),
  kind text not null check (
    kind in ('draft_rewrite', 'handoff_guide', 'handoff_direct', 'lead_guide', 'teach_rule')
  ),
  target_id text check (char_length(target_id) <= 80),
  meta jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists telegram_prompts_expires on telegram_prompts (expires_at);

alter table telegram_prompts enable row level security;
drop policy if exists staff_all on telegram_prompts;
create policy staff_all on telegram_prompts for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on telegram_prompts to vendua_app;

create table if not exists telegram_proposals (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null check (char_length(chat_id) between 1 and 32),
  turn_id text check (char_length(turn_id) <= 80),
  staff_name text not null check (char_length(staff_name) between 1 and 120),
  kind text not null check (
    kind in (
      'set_autonomy',
      'update_instructions',
      'delete_rule',
      'approve_draft',
      'direct_message',
      'board_run'
    )
  ),
  title text not null check (char_length(title) between 1 and 200),
  lines jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'cancelled', 'expired', 'failed')),
  result text,
  decided_by text check (char_length(decided_by) <= 120),
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists telegram_proposals_turn
  on telegram_proposals (chat_id, turn_id)
  where status = 'proposed';
create index if not exists telegram_proposals_expires on telegram_proposals (expires_at);

alter table telegram_proposals enable row level security;
drop policy if exists staff_all on telegram_proposals;
create policy staff_all on telegram_proposals for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on telegram_proposals to vendua_app;
