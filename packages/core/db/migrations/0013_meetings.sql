-- CRM-native meeting booking; unique (lead_id, starts_at) partial index makes booking replay-safe.

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
  -- set once each reminder went out so the sweep never re-sends
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
create unique index if not exists meetings_lead_slot
  on meetings (lead_id, starts_at) where status = 'scheduled' and lead_id is not null;
create index if not exists meetings_reminders on meetings (status, starts_at);

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
