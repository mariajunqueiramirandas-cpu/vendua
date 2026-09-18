-- 0002 — store surface fields observed in the Phase-0 storefront spikes
-- (docs/phase-0-findings.md): currency (forn hardcoded BRL) and per-tenant
-- pt-BR vocabulary (quero-pudim's "doce"/"sacola" copy deck).
alter table store_settings add column currency text not null default 'BRL';
alter table store_settings add column vocabulary jsonb not null default '{}';
