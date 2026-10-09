-- 0115_dua_voice_photos.sql — voice messages and photos for Duá in the admin and on the site.
--   copilot_messages.kind  + 'image': a photo the person sent (admin or WhatsApp); its body is
--                            the caption, '' when there is none
--   copilot_media          — the photo itself (re-encoded WebP, no metadata), shown again in the
--                            conversation; it goes with its message ("Nova conversa" deletes both)
-- The storefront chat's voice notes and photos are shopper_messages + shopper_media rows, as on
-- WhatsApp: no schema change. Re-runnable.

alter table copilot_messages drop constraint if exists copilot_messages_kind_check;
alter table copilot_messages add constraint copilot_messages_kind_check
  check (kind in ('text', 'voice', 'image'));
alter table copilot_messages drop constraint if exists copilot_messages_body_check;
alter table copilot_messages add constraint copilot_messages_body_check
  check (char_length(body) between 1 and 4000 or (kind = 'image' and body = ''));

create table if not exists copilot_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  message_id uuid not null references copilot_messages (id) on delete cascade,
  mime text not null check (mime in ('image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 2097152),
  created_at timestamptz not null default now()
);
create unique index if not exists copilot_media_message on copilot_media (message_id);
create index if not exists copilot_media_by_user on copilot_media (tenant_id, user_id, created_at desc);

alter table copilot_media enable row level security;
drop policy if exists tenant_isolation on copilot_media;
create policy tenant_isolation on copilot_media
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on copilot_media;
create policy control_access on copilot_media for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on copilot_media to vendua_app;
