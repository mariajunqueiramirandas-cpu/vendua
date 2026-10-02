-- 0075_plan_trials.sql — a free trial before the first charge (ADR 0025): Venduá Basic starts with
-- 14 days free and no card; one trial per owner phone; an unpaid end pauses the store.
--   plans.trial_days — how long a new store of this plan trials (0 = none); staff edit it in the CRM
--   subscriptions.status 'trialing' — the free first period: current_period_end = trial_ends_at
--   subscriptions.trial_ends_at — when the trial ends (kept after it converts: it marks the trial used)
--   subscriptions.trial_reminded — which "your trial ends" notices went out (claimed atomically)

alter table plans add column if not exists trial_days int not null default 0
  check (trial_days between 0 and 60);
update plans set trial_days = 14 where id = 'basic' and trial_days = 0;

alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check
  check (status in ('pending', 'trialing', 'active', 'past_due', 'cancelled'));
alter table subscriptions add column if not exists trial_ends_at timestamptz;
alter table subscriptions add column if not exists trial_reminded text[] not null default '{}';
create index if not exists subscriptions_trial_end on subscriptions (trial_ends_at)
  where status = 'trialing';

-- Signup knows a verified phone but no tenant yet: "did this phone already own a store that
-- trialed?" and nothing else — the twin of merchant_memberships_for_phone, RLS stays on otherwise.
create or replace function phone_had_trial(p_phone text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from merchant_users u join subscriptions s on s.tenant_id = u.tenant_id
    where u.phone = p_phone and u.role = 'owner' and s.trial_ends_at is not null
  )
$$;
revoke all on function phone_had_trial(text) from public;
grant execute on function phone_had_trial(text) to vendua_app;
