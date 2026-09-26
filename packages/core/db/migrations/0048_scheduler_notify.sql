-- ADR 0017: the scheduler sleeps until the next due time and is woken by these
-- notifications instead of polling. pg_notify inside a trigger is delivered on commit,
-- so a listener never sees work its transaction can't read yet. Payload: table + lead.
create or replace function vendua_agent_notify() returns trigger
language plpgsql as $$
declare
  lead uuid;
begin
  if TG_TABLE_NAME = 'lead_messages' then
    select t.lead_id into lead from lead_threads t where t.id = new.thread_id;
  elsif TG_TABLE_NAME = 'leads' then
    lead := new.id;
  elsif TG_TABLE_NAME in ('control_settings', 'discovery_briefs') then
    lead := null;
  else
    lead := new.lead_id;
  end if;
  perform pg_notify(
    'vendua_agent',
    json_build_object('t', TG_TABLE_NAME, 'l', lead)::text
  );
  return null;
end $$;

-- a new or re-timed queued run, and every status change (a finish frees the lead)
drop trigger if exists agent_notify on agent_runs;
create trigger agent_notify after insert or update of status, run_at on agent_runs
  for each row execute function vendua_agent_notify();

-- new mail, or mail released back to pending by a dead/retired run
drop trigger if exists agent_notify_ins on agent_inbox;
create trigger agent_notify_ins after insert on agent_inbox
  for each row execute function vendua_agent_notify();
drop trigger if exists agent_notify_upd on agent_inbox;
create trigger agent_notify_upd after update of consumed_at on agent_inbox
  for each row
  when (old.consumed_at is not null and new.consumed_at is null)
  execute function vendua_agent_notify();

drop trigger if exists agent_notify on agent_wakeups;
create trigger agent_notify after insert or update of at, status on agent_wakeups
  for each row execute function vendua_agent_notify();

-- the switches that park or release a lead's queued work
drop trigger if exists agent_notify on leads;
create trigger agent_notify after update on leads
  for each row
  when (old.agent_paused_at is distinct from new.agent_paused_at
     or old.agent_mode is distinct from new.agent_mode
     or old.archived_at is distinct from new.archived_at
     or old.unsubscribed_at is distinct from new.unsubscribed_at)
  execute function vendua_agent_notify();

drop trigger if exists agent_notify on lead_threads;
create trigger agent_notify after update of agent_enabled on lead_threads
  for each row
  when (old.agent_enabled is distinct from new.agent_enabled)
  execute function vendua_agent_notify();

-- outbound sends the recovery pass watches (stranded 'queued', dead 'sending', a 'failed'
-- that frees an answered item's mail)
drop trigger if exists agent_notify on lead_messages;
create trigger agent_notify after insert or update of status on lead_messages
  for each row
  when (new.status in ('queued', 'sending', 'failed'))
  execute function vendua_agent_notify();

-- config only: runtime state (digest_state, wa_qr, …) lives in the same table
drop trigger if exists agent_notify on control_settings;
create trigger agent_notify after insert or update on control_settings
  for each row
  when (new.key in ('agent', 'guardrails', 'digest', 'meeting'))
  execute function vendua_agent_notify();

drop trigger if exists agent_notify on discovery_briefs;
create trigger agent_notify after insert or update of enabled, last_run_at, rearmed_at on discovery_briefs
  for each row execute function vendua_agent_notify();

drop trigger if exists agent_notify on meetings;
create trigger agent_notify after insert or update of status, starts_at, reminder_24h_at, reminder_1h_at on meetings
  for each row execute function vendua_agent_notify();

-- next-due lookups
create index if not exists agent_runs_running on agent_runs (coalesce(alive_at, started_at))
  where status = 'running';
create index if not exists agent_runs_scheduled on agent_runs (run_at)
  where status = 'queued' and run_at is not null;
create index if not exists lead_messages_queued_at on lead_messages (created_at)
  where status = 'queued';
create index if not exists lead_messages_sending_at on lead_messages (updated_at)
  where status = 'sending';
