-- Per-payment-method discount/surcharge (model gap 7) and the meal-voucher method.
--
--   store_settings.payment_adjustments — { "<method>": { "percentBps": int, "fixedCents": int } },
--     signed (negative = discount); Core validates bounds and methods (admin PATCH /payments)
--   orders.payment_adjustment_cents    — what that rule added to (or took off) this order's total
--
-- payment_methods keeps its default: meal_voucher is opt-in per store.

alter table store_settings
  add column if not exists payment_adjustments jsonb not null default '{}'
    check (jsonb_typeof(payment_adjustments) = 'object');

alter table orders
  add column if not exists payment_adjustment_cents integer not null default 0;
