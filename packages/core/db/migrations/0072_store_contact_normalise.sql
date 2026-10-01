-- 0072_store_contact_normalise.sql — the store's WhatsApp and Instagram in one form, the one
-- Core now writes (modules/store.ts whatsappDigits / instagramHandle) and /storefront/v1/store
-- serves: WhatsApp as digits with the country code (55 + DDD + number), Instagram as the bare
-- handle. Older rows held whatever was typed ("(22) 98144-8322", "@foo", a profile link).
-- Idempotent: a normalised row maps to itself.

-- whatsapp: digits only, no leading zeros; 10–11 digits gain 55, 12–13 starting 55 stay;
-- anything else is left as it was
with n as (
  select tenant_id, ltrim(regexp_replace(whatsapp, '\D', '', 'g'), '0') as d
  from store_settings
  where whatsapp is not null
)
update store_settings s
set whatsapp = case when length(n.d) in (10, 11) then '55' || n.d else n.d end
from n
where s.tenant_id = n.tenant_id
  and (length(n.d) in (10, 11) or (length(n.d) in (12, 13) and n.d like '55%'))
  and s.whatsapp is distinct from (case when length(n.d) in (10, 11) then '55' || n.d else n.d end);

-- instagram: no profile-link prefix, nothing after the handle (a trailing / or ?query), no @;
-- only where that leaves a real handle — anything else (another site's link) is left as typed,
-- and /storefront/v1/store reads it as null
with n as (
  select tenant_id,
    regexp_replace(
      regexp_replace(
        regexp_replace(btrim(instagram, E' \t\r\n'), '^(https?://)?(www\.)?instagram\.com/', '', 'i'),
        '/?([?#].*)?$', ''),
      '^@+', '') as handle
  from store_settings
  where instagram is not null
)
update store_settings s
set instagram = n.handle
from n
where s.tenant_id = n.tenant_id
  and n.handle ~ '^[A-Za-z0-9._]{1,30}$'
  and s.instagram is distinct from n.handle;
