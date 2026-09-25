-- 0002 — add store currency + pt-BR vocabulary columns
alter table store_settings add column currency text not null default 'BRL';
alter table store_settings add column vocabulary jsonb not null default '{}';
