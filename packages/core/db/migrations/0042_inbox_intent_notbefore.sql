-- 0042_inbox_intent_notbefore.sql — the first shipped 0039 dropped each
-- superseded run's run_at, so on databases that already applied it the
-- backfilled intents (future first-contacts, scheduled replies) became
-- immediately drainable. Re-arm the still-pending ones: match each
-- 'migration-0039' item back to its canceled source run — same lead, kind,
-- thread, params — and stamp notBefore with the deadline the cancel
-- erased. Identical intents collapse onto the LATEST run_at (deferring
-- further is the safe side); consumed items already acted and can't be
-- undeferred, and a run_at already past changes nothing — both skipped.
update agent_inbox i
set payload = i.payload || jsonb_build_object('notBefore', src.run_at)
from (
  select r.lead_id, r.kind, r.thread_id, r.params, max(r.run_at) as run_at
  from agent_runs r
  where r.error = 'superseded — single active run per lead'
    and r.lead_id is not null
    and r.run_at > now()
  group by r.lead_id, r.kind, r.thread_id, r.params
) src
where i.lead_id = src.lead_id
  and i.consumed_at is null
  and i.payload->>'src' = 'migration-0039'
  and i.payload->>'notBefore' is null
  and i.payload->>'requestedKind' = src.kind
  and coalesce(i.payload->>'threadId', '') = coalesce(src.thread_id::text, '')
  and i.payload->'params' = src.params;
