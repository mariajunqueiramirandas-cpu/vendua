-- 0085_payer_document.sql — the plan payer's CPF or CNPJ. Mercado Pago's anti-fraud scores the
-- payer's identification on a Pix, and refused the plan Pix that carried none. Signup asks for it;
-- the owner can change it in Conta. The kind follows from the length: 11 digits are a CPF, 14
-- characters a CNPJ (alphanumeric since July 2026: 12 letters or digits, then 2 check digits).
--   subscriptions.payer_document — normalized, check digits verified by Core (billing/input.ts)

alter table subscriptions
  add column if not exists payer_document text
    check (payer_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');
