-- add leads.whatsapp_verified — evidence-backed whatsapp vs discovery auto-fill
alter table leads
  add column if not exists whatsapp_verified boolean not null default false;

-- pre-existing whatsapp values came from real evidence — keep them verified
update leads set whatsapp_verified = true where whatsapp is not null and whatsapp <> '';
