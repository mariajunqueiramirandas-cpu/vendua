-- CRM quality of life (apps/control).
--   control_saved_views — a staff member's named pipeline filters, kept server-side because the
--                         team uses the CRM on several devices. Platform data like leads: no
--                         tenant, RLS keyed on the vendua.control GUC like the other CRM tables.
--                         `member` names whose views they are (staff share one sign-in key).
--   staff_events_tenant — the store page's event timeline pages one store's events by id.

create table if not exists control_saved_views (
  id uuid primary key default gen_random_uuid(),
  member text not null check (char_length(member) between 1 and 80),
  name text not null check (char_length(name) between 1 and 60),
  params jsonb not null default '{}'
    check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists control_saved_views_name
  on control_saved_views (member, lower(name));

alter table control_saved_views enable row level security;
drop policy if exists staff_all on control_saved_views;
create policy staff_all on control_saved_views for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on control_saved_views to vendua_app;

create index if not exists staff_events_tenant on staff_events (tenant_id, id desc)
  where tenant_id is not null;
