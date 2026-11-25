-- 0151_dua_voice.sql — Duá answers a voice message with one (ADR 0048), in the admin and on
-- Venduá's WhatsApp.
-- copilot_messages.speak: a reply to a voice message, said out loud. In the admin the reply plays,
-- its sound made the first time it's played and kept in copilot_audio (each person's own, like
-- copilot_media). On WhatsApp the reply's outbox row waits for its voice note:
-- platform_wa_outbox.voice is 'pending' until Core makes it (then media_id), 'working' meanwhile;
-- senders hold such a row a minute at most, then send its text.
-- Additive (ADR 0041): an older Core and gateway ignore all of it and send text. Re-runnable.
alter table copilot_messages add column if not exists speak boolean not null default false;

create table if not exists copilot_audio (
  message_id uuid primary key references copilot_messages (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  mime text not null check (mime in ('audio/mpeg', 'audio/ogg; codecs=opus')),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  seconds int check (seconds between 0 and 600),
  created_at timestamptz not null default now()
);
create index if not exists copilot_audio_age on copilot_audio (created_at);
alter table copilot_audio enable row level security;
drop policy if exists tenant_isolation on copilot_audio;
create policy tenant_isolation on copilot_audio
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on copilot_audio;
create policy control_access on copilot_audio for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on copilot_audio to vendua_app;

alter table platform_wa_outbox add column if not exists voice text
  check (voice in ('pending', 'working'));
alter table platform_wa_outbox add column if not exists voice_at timestamptz;
create index if not exists platform_wa_outbox_voice on platform_wa_outbox (created_at)
  where voice is not null and status = 'pending';

-- enqueue_dua_whatsapp with p_speak: the row waits for its voice note (0108's two-argument form
-- stays for an older Core)
create or replace function enqueue_dua_whatsapp(p_message uuid, p_body text, p_speak boolean)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_to text;
  v_id uuid;
begin
  select coalesce(s.jid, '55' || u.phone) into v_to
  from copilot_messages m
  join merchant_users u on u.id = m.user_id and u.tenant_id = m.tenant_id
  left join lateral (
    select jid from platform_wa_dua_senders
    where phone = any(br_phone_variants(u.phone))
    order by updated_at desc nulls last
    limit 1
  ) s on true
  where m.id = p_message
    and m.tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid
    and m.author = 'dua'
    and u.status = 'active'
    and coalesce((u.prefs ->> 'duaWhatsapp')::boolean, false);
  if v_to is null then
    return null;
  end if;
  insert into platform_wa_outbox (session, to_jid, body, purpose, ref, dedupe_key, expires_at, voice)
  values ('vendua', v_to, left(p_body, 4000), 'dua', p_message::text, 'dua:' || p_message::text,
          now() + interval '30 minutes', case when p_speak then 'pending' end)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function enqueue_dua_whatsapp(uuid, text, boolean) from public;
grant execute on function enqueue_dua_whatsapp(uuid, text, boolean) to vendua_app;
