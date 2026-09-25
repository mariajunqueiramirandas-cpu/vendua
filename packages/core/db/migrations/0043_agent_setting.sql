-- ADR 0015: one `agent` setting replaces agent_autonomy + agent_playbooks + pitch.hardRules +
-- guardrails.firstContactDraftOnly. Per-kind step budget / monid cap / model become code constants.
do $$
declare
  auto jsonb := coalesce((select value from control_settings where key = 'agent_autonomy'), '{}');
  pb jsonb := coalesce((select value from control_settings where key = 'agent_playbooks'), '{}');
  pitch jsonb := coalesce((select value from control_settings where key = 'pitch'), '{}');
  gr jsonb := coalesce((select value from control_settings where key = 'guardrails'), '{}');
  lvl text := coalesce(auto->>'level', 'supervised');
  rules text;
  extra text;
begin
  if exists (select 1 from control_settings where key = 'agent') then
    return;
  end if;
  if lvl not in ('off', 'copilot', 'supervised', 'autopilot') then
    lvl := 'supervised';
  end if;
  -- supervised without the first-contact draft behaved exactly like autopilot
  if lvl = 'supervised' and gr->>'firstContactDraftOnly' = 'false' then
    lvl := 'autopilot';
  end if;

  if jsonb_typeof(pitch->'hardRules') = 'array' then
    select string_agg('- ' || r, e'\n' order by i) into rules
    from jsonb_array_elements_text(pitch->'hardRules') with ordinality t(r, i);
  else
    rules := e'- nunca invente funcionalidades, prazos ou preços\n'
      || e'- nunca pressione quem disse não ou pediu para parar\n'
      || e'- uma mensagem por vez; sem listas longas ou jargão\n'
      || '- não se identifique como IA a menos que perguntem — e se perguntarem, seja honesto';
  end if;

  -- per-playbook instructions survive, scoped by name, so nothing staff wrote is lost
  select string_agg(
           'Só em ' || l.label || ': ' || btrim(pb->l.kind->>'instructions'),
           e'\n\n' order by l.ord)
    into extra
  from (values ('triage', 'triagem', 1), ('reply', 'respostas', 2),
               ('outreach', 'prospecção/follow-up', 3), ('discovery', 'descoberta', 4),
               ('strategist', 'revisão semanal', 5)) l(kind, label, ord)
  where coalesce(btrim(pb->l.kind->>'instructions'), '') <> '';

  insert into control_settings (key, value) values ('agent', jsonb_build_object(
    'level', lvl,
    'jobs', jsonb_build_object(
      'reply', (pb->'reply'->'enabled') is distinct from 'false'::jsonb,
      'outreach', (pb->'outreach'->'enabled') is distinct from 'false'::jsonb,
      'discovery', (pb->'discovery'->'enabled') is distinct from 'false'::jsonb,
      'strategist', (pb->'strategist'->'enabled') is distinct from 'false'::jsonb),
    'instructions', left(concat_ws(e'\n\n', nullif(rules, ''), extra), 8000),
    'weeklyDiscoveryUsd', least(50, greatest(0,
      case when jsonb_typeof(auto->'strategistAutoApproveUsd') = 'number'
        then (auto->>'strategistAutoApproveUsd')::numeric else 0 end))
  ));
end $$;

-- lossless archive of everything folded above — `instructions` caps at 8000 chars, the old
-- fields allowed more (50×500 rules + 5×4000 playbook instructions)
insert into control_settings (key, value)
select 'agent_legacy', jsonb_build_object(
  'agent_autonomy', (select value from control_settings where key = 'agent_autonomy'),
  'agent_playbooks', (select value from control_settings where key = 'agent_playbooks'),
  'hardRules', (select value->'hardRules' from control_settings where key = 'pitch'),
  'firstContactDraftOnly', (select value->'firstContactDraftOnly' from control_settings where key = 'guardrails'))
where exists (select 1 from control_settings
              where key in ('agent_autonomy', 'agent_playbooks')
                 or (key = 'pitch' and value ? 'hardRules')
                 or (key = 'guardrails' and value ? 'firstContactDraftOnly'))
on conflict (key) do nothing;

delete from control_settings where key in ('agent_autonomy', 'agent_playbooks');

-- brief runs queued before the marker existed are automation — stamp them so switching
-- discovery off parks them (staff-triggered discovery never carries a briefId)
update agent_runs set params = params || '{"auto": "brief"}'::jsonb
where kind = 'discovery' and status = 'queued'
  and params ? 'briefId' and not params ? 'auto';
update control_settings set value = value - 'hardRules' where key = 'pitch';
update control_settings set value = value - 'firstContactDraftOnly' where key = 'guardrails';
