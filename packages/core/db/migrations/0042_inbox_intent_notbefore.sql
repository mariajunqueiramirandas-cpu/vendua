-- 0042_inbox_intent_notbefore.sql — the first shipped 0039 dropped each
-- superseded run's run_at, so on databases that already applied it the
-- backfilled intents (future first-contacts, scheduled replies) became
-- immediately drainable. Re-arm the still-pending ones.
--
-- Pairing rules, exact before positional:
--   1. Items stamped with 'srcRunId' (fixed 0039 onward) link straight to
--      their source run — no identity ambiguity at all.
--   2. Old rows have no link, so same-identity groups pair POSITIONALLY:
--      the k-th earliest-inserted item takes the k-th earliest future
--      run_at. Deadlines keep their multiplicity — one past-due item
--      doesn't stretch to a later sibling's deadline, and leftovers
--      (fewer source rows than items) stay eligible-now instead of
--      inheriting a deadline that may not be theirs.
-- Runs whose run_at already passed can't defer anything — excluded; the
-- item stays eligible. Consumed items already acted; skipped.
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
