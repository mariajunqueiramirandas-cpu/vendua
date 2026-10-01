-- Timed promotions: a lower price on some weekdays and hours, in store time
-- ({ priceCents, windows: [{ days, from?, to? }] }). Core applies it to the price the shopper
-- pays while a window holds and the promo price is below base_price_cents; outside, nothing.

alter table products
  add column if not exists promo_schedule jsonb
    check (promo_schedule is null or jsonb_typeof(promo_schedule) = 'object');
