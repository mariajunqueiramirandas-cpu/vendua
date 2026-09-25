-- re-arm still-pending intents left drainable by the first shipped 0039
with src as (
  select r.lead_id, r.id::text as run_id, r.kind, r.thread_id, r.params, r.run_at,
         row_number() over (
           partition by r.lead_id, r.kind, r.thread_id, r.params
           order by r.run_at, r.id) as n
  from agent_runs r
  where r.error = 'superseded — single active run per lead'
    and r.lead_id is not null
    and r.run_at > now()
),
items as (
  select i.id, i.lead_id,
         i.payload->>'requestedKind' as kind,
         coalesce(i.payload->>'threadId', '') as thread_id,
         i.payload->'params' as params,
         i.payload->>'srcRunId' as src_run,
         row_number() over (
           partition by i.lead_id, i.payload->>'requestedKind',
                        coalesce(i.payload->>'threadId', ''), i.payload->'params'
           order by i.id) as n
  from agent_inbox i
  where i.consumed_at is null
    and i.payload->>'src' = 'migration-0039'
    and i.payload->>'notBefore' is null
),
match as (
  select it.id, s.run_at
  from items it
  join src s on s.run_id = it.src_run
  union all
  select it.id, s.run_at
  from items it
  join src s
    on s.lead_id = it.lead_id
   and s.kind = it.kind
   and coalesce(s.thread_id::text, '') = it.thread_id
   and s.params = it.params
   and s.n = it.n
   and it.src_run is null
)
update agent_inbox i
set payload = i.payload || jsonb_build_object('notBefore', m.run_at)
from match m
where i.id = m.id;
