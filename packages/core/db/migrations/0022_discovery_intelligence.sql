-- 0022_discovery_intelligence.sql — the discovery-intelligence schema round:
--
-- 1) agent_runs gains a 'strategist' kind — the weekly-cadence run that reads
--    segmentStats + agent_memory and proposes new discovery_briefs as
--    disabled drafts (staff approves; the agent never enables).
-- 2) discovery_briefs gains `note` (the auto-pause reason or a proposal's
--    rationale, surfaced on the board), `created_by` ('staff' vs
--    'strategist' provenance — the board badges proposals with it), and
--    `rearmed_at` (the streak boundary: staff re-enabling or editing a
--    brief starts a fresh evaluation window, so the auto-pause check only
--    counts runs that finished after it — old zero-yield history can't
--    instantly re-pause a revived brief).
-- 3) leads gains intent_score/intent_reason beside fit_score/fit_reason —
--    ICP match and buying intent stay separate numbers.

alter table agent_runs drop constraint if exists agent_runs_kind_check;
alter table agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('triage', 'reply', 'outreach', 'discovery', 'strategist'));

alter table discovery_briefs
  add column if not exists note text,
  add column if not exists created_by text not null default 'staff'
    check (created_by in ('staff', 'strategist')),
  add column if not exists rearmed_at timestamptz;

alter table leads
  add column if not exists intent_score int
    check (intent_score is null or intent_score between 0 and 10),
  add column if not exists intent_reason text;
