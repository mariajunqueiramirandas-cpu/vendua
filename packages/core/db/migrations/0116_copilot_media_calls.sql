-- 0116_copilot_media_calls.sql — Duá Copilot's daily room for voice messages and photos.
--   copilot_media_calls — one row per transcription or photo reading a person asked for, written
--                         before the paid call (an unheard note counts too). "Nova conversa"
--                         deletes copilot_messages, never these, so it can't reset the room.
--                         Rows past two days are pruned by the writer. Re-runnable.

create table if not exists copilot_media_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  kind text not null check (kind in ('voice', 'image')),
  created_at timestamptz not null default now()
);
create index if not exists copilot_media_calls_by_user
  on copilot_media_calls (tenant_id, user_id, created_at);

alter table copilot_media_calls enable row level security;
drop policy if exists tenant_isolation on copilot_media_calls;
create policy tenant_isolation on copilot_media_calls
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on copilot_media_calls;
create policy control_access on copilot_media_calls for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on copilot_media_calls to vendua_app;
