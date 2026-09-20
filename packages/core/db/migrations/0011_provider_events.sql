-- Delivery events can beat dispatch's finalize — Resend emits
-- email.delivered/bounced before our send call returns the provider id. When
-- no lead_messages row carries the pmid yet, the event is parked here; the
-- dispatch finalize drains pending rows once the pmid lands. Keyed by
-- (channel, provider_id, event) so provider retries dedupe.
create table provider_events (
  id bigserial primary key,
  channel text not null,
  provider_id text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel, provider_id, event)
);

create index provider_events_lookup on provider_events (channel, provider_id);

do $$
begin
  execute format('alter table %I enable row level security', 'provider_events');
  execute format('drop policy if exists staff_all on %I', 'provider_events');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'provider_events'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'provider_events');
end
$$;
