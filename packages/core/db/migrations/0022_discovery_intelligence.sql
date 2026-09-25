-- 0022_discovery_intelligence.sql — 'strategist' run kind; discovery_briefs
-- note/created_by/rearmed_at; leads intent_score/intent_reason.

alter table agent_runs drop constraint if exists agent_runs_kind_check;
alter table agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('triage', 'reply', 'outreach', 'discovery', 'strategist'));

alter table discovery_briefs
  add column if not exists note text,
  add column if not exists created_by text not null default 'staff'
    check (created_by in ('staff', 'strategist')),
  -- streak boundary: auto-pause only counts runs finished after a re-arm
  add column if not exists rearmed_at timestamptz;

alter table leads
  add column if not exists intent_score int
    check (intent_score is null or intent_score between 0 and 10),
  add column if not exists intent_reason text;
