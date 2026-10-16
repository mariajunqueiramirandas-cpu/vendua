-- 0135_push_devices.sql — the merchant admin as an iOS and Android app (ADR 0044):
--   push_devices — one row per installed app that turned its order alerts on: its APNs or FCM
--                  token, tied to the merchant session that registered it. Ending that session
--                  (sair, "encerrar sessão", removed from the team) deletes the row in the same
--                  transaction, and the cascade covers a session row that is ever deleted.
--   push_attempts.device_id — which app an alert went to (subscription_id stays the browser's).
--   tenants.is_demo — a demo store: the only kind the App Review sign-in
--                  (VENDUA_REVIEW_LOGIN) may open. Off for every store before this one.
-- Additive only: a Core from before this one never reads either table's new parts.

create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  session_id uuid not null references merchant_sessions (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  -- APNs tokens are 64 hex today and FCM's ~160 characters; both may grow
  token text not null check (char_length(token) between 8 and 4096),
  app_version text check (char_length(app_version) <= 80),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text check (char_length(last_error) <= 200),
  unique (tenant_id, token)
);
create index if not exists push_devices_by_session on push_devices (session_id);
create index if not exists push_devices_by_user on push_devices (tenant_id, user_id);

alter table push_devices enable row level security;
drop policy if exists tenant_isolation on push_devices;
create policy tenant_isolation on push_devices
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on push_devices to vendua_app;

alter table push_attempts
  add column if not exists device_id uuid references push_devices (id) on delete set null;

alter table tenants add column if not exists is_demo boolean not null default false;
