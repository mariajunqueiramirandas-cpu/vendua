-- backfill one inbox intent per run superseded by 0038's one-active-run index and release its consumed mail back to pending (notBefore preserves the canceled run's run_at)
insert into agent_inbox (lead_id, kind, payload)
select r.lead_id,
       case when r.params ? 'auto' or r.params->>'origin' = 'inbound'
            then 'event' else 'staff' end,
       jsonb_build_object(
         'text', 'retome o trabalho de uma run substituída (kind: ' || r.kind || ')' ||
                 coalesce(' — foco original: ' || left(r.params->>'focus', 300), ''),
         'requestedKind', r.kind,
         'threadId', r.thread_id,
         'params', r.params,
         'notBefore', r.run_at,
         'srcRunId', r.id,
         'src', 'migration-0039')
from agent_runs r
where r.error = 'superseded — single active run per lead'
  and r.lead_id is not null;

update agent_inbox i
set consumed_at = null, consumed_by_run = null,
    payload = i.payload || jsonb_build_object(
      'deliveries', coalesce((i.payload->>'deliveries')::int, 0) + 1)
    || case when i.payload ? 'resumed' then '{}'::jsonb
        else jsonb_build_object(
          'text', coalesce(i.payload->>'text', '') ||
            ' — (reentregue: a run anterior foi interrompida — confira o histórico antes de agir de novo)',
          'resumed', true)
        end
where i.consumed_by_run in (
  select id from agent_runs
  where error = 'superseded — single active run per lead')
  and coalesce((i.payload->>'deliveries')::int, 0) < 2;
