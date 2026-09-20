-- 0013_meetings.sql — CRM-native meeting booking. `meetings` is platform
-- data like the rest of the CRM: no tenant_id, RLS keyed on the
-- `vendua.control` GUC, the /control/v1 gate + booking tokens are the access
-- boundary.
--
-- Meetings are booked three ways: the public token-guarded link the agent
-- sends ('link'), staff on the Calendar view ('staff'), and future agent
-- tools ('agent'). The unique partial index on (lead_id, starts_at) makes
-- POST /book/v1/book replay-safe — a retried submission returns the same
-- row instead of double-booking the slot.

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'done', 'no_show')),
  room_url text,
  booker_name text,
  booker_contact text,
  source text not null default 'link' check (source in ('link', 'staff', 'agent')),
  gcal_event_id text,
  -- send markers: set once the 24h / 1h reminder went out so the worker
  -- sweep never re-sends.
  reminder_24h_at timestamptz,
  reminder_1h_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists meetings_lead on meetings (lead_id);
create index if not exists meetings_starts on meetings (starts_at);
create index if not exists meetings_status on meetings (status);
-- One scheduled meeting per (lead, slot) — the idempotent-booking anchor.
create unique index if not exists meetings_lead_slot
  on meetings (lead_id, starts_at) where status = 'scheduled' and lead_id is not null;
-- Reminder sweep reads scheduled meetings approaching their start.
create index if not exists meetings_reminders on meetings (status, starts_at);

-- Meeting lifecycle events on the lead timeline get their own kinds so the
-- UI can label them distinctly from a staff-logged 'meeting' touchpoint.
alter table lead_activities drop constraint if exists lead_activities_kind_check;
alter table lead_activities
  add constraint lead_activities_kind_check
  check (kind in (
    'note', 'call', 'meeting', 'state_change', 'agent', 'system',
    'meeting_booked', 'meeting_done', 'meeting_no_show', 'meeting_cancelled'
  ));

do $$
begin
  execute format('alter table %I enable row level security', 'meetings');
  execute format('drop policy if exists staff_all on %I', 'meetings');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'meetings'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'meetings');
end
$$;
