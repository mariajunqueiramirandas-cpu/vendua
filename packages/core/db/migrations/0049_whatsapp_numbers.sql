-- 0049_whatsapp_numbers.sql — inbound whatsapp leads stored the raw phone jid
-- ('5511…@s.whatsapp.net') as whatsapp (and as name when no pushName came);
-- the lead holds a number ('+5511…') like every other source.
update leads
set
  name = case when name = whatsapp
    then '+' || regexp_replace(split_part(split_part(whatsapp, '@', 1), ':', 1), '\D', '', 'g')
    else name end,
  whatsapp = '+' || regexp_replace(split_part(split_part(whatsapp, '@', 1), ':', 1), '\D', '', 'g')
where whatsapp like '%@s.whatsapp.net'
  and regexp_replace(split_part(split_part(whatsapp, '@', 1), ':', 1), '\D', '', 'g') <> '';
