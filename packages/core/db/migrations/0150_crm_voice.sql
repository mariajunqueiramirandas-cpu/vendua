-- 0150_crm_voice.sql — the CRM sales agent hears and sends WhatsApp voice notes (ADR 0048).
-- lead_messages.audio: in, the lead sent a voice note (the body is its transcript, marked
-- "[áudio]"); out, the agent says the body as a voice note, whose sound lead_audio holds once made.
-- platform_wa_outbox.media_id: the voice note a gateway sends in place of the body's text.
-- Additive (ADR 0041): an older Core ignores them and sends the text. Re-runnable.
alter table lead_messages add column if not exists audio boolean not null default false;

create table if not exists lead_audio (
  message_id uuid primary key references lead_messages (id) on delete cascade,
  mime text not null check (mime ~ '^[a-z]+/[a-z0-9.+-]{1,60}(;.{0,60})?$'),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  seconds int check (seconds between 0 and 600),
  created_at timestamptz not null default now()
);
-- staff scope, like lead_messages (0007)
alter table lead_audio enable row level security;
drop policy if exists staff_all on lead_audio;
create policy staff_all on lead_audio for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on lead_audio to vendua_app;
create index if not exists lead_audio_age on lead_audio (created_at);

alter table platform_wa_outbox add column if not exists media_id uuid
  references platform_wa_media (id) on delete set null;
