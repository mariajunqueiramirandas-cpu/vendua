-- Switch the untouched setting inserted by 0043 to the new default.
-- Workspace settings with operator changes or migrated legacy policy keep their chosen mode.
update control_settings
set value = jsonb_set(value, '{level}', '"autopilot"')
where key = 'agent'
  and value = jsonb_build_object(
    'level', 'supervised',
    'jobs', '{"reply":true,"outreach":true,"discovery":true,"strategist":true}'::jsonb,
    'weeklyDiscoveryUsd', 0,
    'instructions', E'- nunca invente funcionalidades, prazos ou preços\n- nunca pressione quem disse não ou pediu para parar\n- uma mensagem por vez; sem listas longas ou jargão\n- não se identifique como IA a menos que perguntem — e se perguntarem, seja honesto')
  and not exists (select 1 from control_settings where key = 'agent_legacy');

alter table lead_messages add column if not exists send_after timestamptz;
alter table crm_turns add column if not exists outcome text;
