-- 0022_observability.sql — channel-health observability. Every guardrail
-- block of an agent send now lands on lead_activities with kind 'blocked'
-- (meta.channel + meta.reason) so the per-channel rollup can count them
-- alongside lead_messages failures and email bounces.

alter table lead_activities
  drop constraint if exists lead_activities_kind_check,
  add constraint lead_activities_kind_check check (
    kind in ('note', 'call', 'meeting', 'state_change', 'agent', 'system',
             'meeting_booked', 'meeting_done', 'meeting_no_show',
             'meeting_cancelled', 'blocked')
  );

create index if not exists lead_activities_blocked
  on lead_activities (at) where kind = 'blocked';
