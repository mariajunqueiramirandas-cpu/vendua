-- 0155_lead_masked_contacts.sql — CRM agents stored the model gateway's contact mask ('⟦tel57⟧')
-- as a lead's whatsapp/phone/email when the model wrote a token it was never shown in that call.
-- No number stands behind such a token, so the field is cleared; the lead keeps its other channels.
update leads
set
  whatsapp = case when whatsapp like '%⟦%' then null else whatsapp end,
  whatsapp_verified = case when whatsapp like '%⟦%' then false else whatsapp_verified end,
  phone = case when phone like '%⟦%' then null else phone end,
  email = case when email like '%⟦%' then null else email end,
  updated_at = now()
where whatsapp like '%⟦%' or phone like '%⟦%' or email like '%⟦%';
