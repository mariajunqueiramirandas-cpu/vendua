-- 0134_store_cep.sql — the store's own CEP:
--   store_settings.cep — 8 digits, or null (every store before this one, and a Core from before
--     it, which never reads it). The admin fills the city and address from it (ViaCEP), and
--     "achar pelo endereço" places the store's pin through it: OSM barely knows Brazilian CEPs,
--     ViaCEP's street and bairro it does (ADR 0024).

alter table store_settings add column if not exists cep text;
alter table store_settings drop constraint if exists store_settings_cep_check;
alter table store_settings add constraint store_settings_cep_check
  check (cep is null or cep ~ '^[0-9]{8}$');
