-- 0079_closed_preorders.sql — a closed store stops taking orders
--   store_settings.preorders_while_closed — while closed, still take a cart made only of
--     encomendas (they're for a later date anyway); false = closed means no orders at all

alter table store_settings add column if not exists preorders_while_closed boolean not null default true;
