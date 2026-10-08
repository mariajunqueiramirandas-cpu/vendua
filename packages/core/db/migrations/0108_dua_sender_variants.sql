-- 0108_dua_sender_variants.sql — Duá's WhatsApp reply finds the sender under either 9th-digit spelling.
--   br_phone_variants() — both spellings of a Brazilian mobile (store-whatsapp/text.ts phoneVariants)
--   enqueue_dua_whatsapp() — joins platform_wa_dua_senders on either spelling: an owner of two
--     stores that hold different spellings of their number got store A's replies at the wrong JID
-- Re-runnable.

create or replace function br_phone_variants(p text) returns text[]
language sql immutable as $$
  select case
    when length(p) = 11 and substr(p, 3, 1) = '9' then array[p, substr(p, 1, 2) || substr(p, 4)]
    when length(p) = 10 and substr(p, 3, 1) between '6' and '9'
      then array[p, substr(p, 1, 2) || '9' || substr(p, 3)]
    else array[p]
  end
$$;

create or replace function enqueue_dua_whatsapp(p_message uuid, p_body text)
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
  insert into platform_wa_outbox (session, to_jid, body, purpose, ref, dedupe_key, expires_at)
  values ('vendua', v_to, left(p_body, 4000), 'dua', p_message::text, 'dua:' || p_message::text,
          now() + interval '30 minutes')
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function enqueue_dua_whatsapp(uuid, text) from public;
grant execute on function enqueue_dua_whatsapp(uuid, text) to vendua_app;
