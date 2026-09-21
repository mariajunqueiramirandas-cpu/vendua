-- 0017_lead_whatsapp_verified.sql — whatsapp provenance. Discovery auto-fills
-- whatsapp from a BR mobile phone (reachable, not proven); wa.me/api.whatsapp
-- links and explicit sets are verified evidence. Autocontact gates on the flag.
alter table leads
  add column if not exists whatsapp_verified boolean not null default false;

-- Rows that already carried whatsapp got it from real evidence (this flag
-- predates only the auto-fill path) — don't regress them to unverified.
update leads set whatsapp_verified = true where whatsapp is not null and whatsapp <> '';
