-- 0144_telegram_bot.sql — staff events move from Discord to per-member Telegram DMs (ADR 0047).
-- Zero-downtime safe (ADR 0041): keeps 'discord' valid in control_integrations and the wake
-- trigger so an old Core draining during deploy keeps working; a later PR drops the Discord rows.
-- Re-runnable.

alter table control_integrations drop constraint if exists control_integrations_kind_check;
alter table control_integrations add constraint control_integrations_kind_check
  check (kind in ('llm', 'email', 'whatsapp', 'instagram', 'discovery', 'discord', 'telegram'));

-- Per-recipient DM messages sent for each staff event so living cards (orders, drafts, handoffs,
-- incidents, onboarding) update in sync across every linked team member's Telegram DM.
create table if not exists staff_event_messages (
  event_id bigint not null references staff_events (id) on delete cascade,
  anchor text check (char_length(anchor) between 1 and 120),
  chat_id text not null check (char_length(chat_id) <= 32),
  message_id text not null check (char_length(message_id) <= 32),
  created_at timestamptz not null default now(),
  primary key (event_id, chat_id)
);
create index if not exists staff_event_messages_anchor
  on staff_event_messages (anchor, event_id desc)
  where anchor is not null;

alter table staff_event_messages enable row level security;
drop policy if exists staff_all on staff_event_messages;
create policy staff_all on staff_event_messages for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on staff_event_messages to vendua_app;

-- Wake the scheduler when the Telegram integration or its settings/team roster change.
drop trigger if exists telegram_notify on control_integrations;
create trigger telegram_notify after insert or update on control_integrations
  for each row
  when (new.kind = 'telegram')
  execute function vendua_table_notify();

drop trigger if exists agent_notify on control_settings;
create trigger agent_notify after insert or update on control_settings
  for each row
  when (new.key in ('agent', 'guardrails', 'meeting', 'discord', 'telegram', 'staff'))
  execute function vendua_agent_notify();

-- Retired Discord scheduler rows so a previously failing one never lingers in the daily summary.
delete from scheduled_jobs where name in ('discord', 'discord-digest');
