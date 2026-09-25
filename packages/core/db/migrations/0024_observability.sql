-- adds 'blocked' to lead_activities kinds (+ index) so channel health can count guardrail-blocked sends

alter table lead_activities
  drop constraint if exists lead_activities_kind_check,
  add constraint lead_activities_kind_check check (
    kind in ('note', 'call', 'meeting', 'state_change', 'agent', 'system',
             'meeting_booked', 'meeting_done', 'meeting_no_show',
             'meeting_cancelled', 'blocked')
  );

create index if not exists lead_activities_blocked
  on lead_activities (at) where kind = 'blocked';
