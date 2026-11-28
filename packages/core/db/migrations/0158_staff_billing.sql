-- 0158_staff_billing.sql — what the team gives a store from the CRM (control-store-billing.ts):
--   ai_credits.source = 'staff'  — Duá conversations given without an invoice (invoice_id null);
--                                  unlike a paid pack they also count during a trial
--   ai_credits.note              — why, as the team typed it
--   billing_credits.reason       — gains 'staff': free months the team gave (one row a month, so a
--                                  card plan gives back one charge per row, as a referral's)
--   billing_credits.note         — why, as the team typed it
-- Additive (ADR 0041): a previous Core never writes 'staff' rows nor reads the new columns, and
-- counts a staff credit as it counts a pack or a referral month. Re-runnable.

alter table ai_credits alter column invoice_id drop not null;
alter table ai_credits
  add column if not exists source text not null default 'pack' check (source in ('pack', 'staff')),
  add column if not exists note text check (char_length(note) <= 200);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_credits_invoice_or_staff') then
    alter table ai_credits add constraint ai_credits_invoice_or_staff
      check (invoice_id is not null or source = 'staff');
  end if;
end $$;

alter table billing_credits drop constraint if exists billing_credits_reason_check;
alter table billing_credits add constraint billing_credits_reason_check
  check (reason in ('referral', 'staff'));
alter table billing_credits add column if not exists note text check (char_length(note) <= 200);
