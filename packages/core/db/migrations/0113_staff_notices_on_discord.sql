-- 0113_staff_notices_on_discord.sql — staff hear about things only on Discord (ADR 0023): the
-- email/WhatsApp staff notices and the daily summary by email are gone. Drops what they left:
-- the `digest` job's row (a failing one would sit in Discord's summary forever), the `digest`
-- and `digest_state` settings, and `digest` from the keys that wake the scheduler. A stored
-- `staff.events` is dropped on the team's next save.
-- Re-runnable.
delete from scheduled_jobs where name = 'digest';
delete from control_settings where key in ('digest', 'digest_state');

drop trigger if exists agent_notify on control_settings;
create trigger agent_notify after insert or update on control_settings
  for each row
  when (new.key in ('agent', 'guardrails', 'meeting', 'discord'))
  execute function vendua_agent_notify();
