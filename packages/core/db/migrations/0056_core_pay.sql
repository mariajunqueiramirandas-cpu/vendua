-- CORE-PAY follow-up to 0054.
--
-- payment_refunds.request_key: a refund is reserved (row committed) before Mercado Pago is
-- called, keyed by the admin request's Idempotency-Key; MP's own idempotency key is derived from
-- the reservation id, so a retry after a crash re-sends the same refund instead of a new one.
--
-- payments.review: money we could not verify or settle automatically (no usable token, amount
-- that doesn't match the order, an auto-refund MP refused) — surfaced in Pagamentos, never dropped.

alter table payment_refunds
  add column if not exists request_key text check (char_length(request_key) <= 240);
create unique index if not exists payment_refunds_request
  on payment_refunds (payment_id, request_key) where request_key is not null;

alter table payments
  add column if not exists review text check (char_length(review) <= 60);
create index if not exists payments_review on payments (tenant_id, updated_at desc)
  where review is not null;
