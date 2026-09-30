-- Staff (CRM) sign-ins: one random session per device instead of a cookie derived from
-- CONTROL_SECRET, so a lost device is revoked by logging it out. Only the sha256 of the
-- token is stored. Platform table: RLS keys on the vendua.control GUC like the CRM tables.
create table if not exists control_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text check (char_length(user_agent) <= 300)
);
create index if not exists control_sessions_expires on control_sessions (expires_at);
alter table control_sessions enable row level security;
drop policy if exists staff_all on control_sessions;
create policy staff_all on control_sessions for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on control_sessions to vendua_app;

-- An idempotent replay is only served to the caller that made the first request:
-- sha256(method, path, credential). Null on rows written before this column (replayable).
alter table idempotency_keys
  add column if not exists fingerprint text check (char_length(fingerprint) = 64);
