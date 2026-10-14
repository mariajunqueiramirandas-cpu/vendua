-- 0128_sinal.sql — Festa calculada F2 (docs/features/festa-calculada.md): a sinal by Pix locks a
-- party's date (and a big encomenda's, from an amount the store sets); the rest is paid by Pix
-- before the date or at the caixa. One order, two charges: the sinal is fixed when the order is
-- placed and the rest is always total − sinal, so the two can't drift from the total.
--   store_settings.deposit_bps — the sinal's share of the total (0 = off)
--   store_settings.deposit_min_cents — encomendas from this total ask for it too (null = parties only)
--   store_settings.deposit_policy — the store's own cancellation words, shown as the store's
--   orders.deposit_cents — the order's sinal (null = paid in one go, as before)
--   payments.charge — which part an attempt pays (null = the whole order, as before)
-- What has been paid lives in orders.payment.sinal; an order without one keeps today's path.

alter table store_settings
  add column if not exists deposit_bps int not null default 0,
  add column if not exists deposit_min_cents int,
  add column if not exists deposit_policy text;
alter table store_settings drop constraint if exists store_settings_deposit_check;
alter table store_settings add constraint store_settings_deposit_check
  check (deposit_bps between 0 and 9000
         and (deposit_min_cents is null or deposit_min_cents between 100 and 100000000)
         and (deposit_policy is null or char_length(deposit_policy) <= 600));

-- new and null on every existing row: added unvalidated so the deploy never scans orders/payments
alter table orders add column if not exists deposit_cents int;
alter table orders drop constraint if exists orders_deposit_check;
alter table orders add constraint orders_deposit_check
  check (deposit_cents is null or (deposit_cents > 0 and deposit_cents < total_cents)) not valid;

alter table payments add column if not exists charge text;
alter table payments drop constraint if exists payments_charge_check;
alter table payments add constraint payments_charge_check
  check (charge is null or charge in ('deposit', 'balance')) not valid;
