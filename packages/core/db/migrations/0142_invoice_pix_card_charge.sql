-- Keep the original card charge associated with an invoice when a one-off Pix replaces it.
alter table invoices
  add column if not exists fallback_card_charge_id text check (char_length(fallback_card_charge_id) <= 64);

create index if not exists invoices_fallback_card_charge
  on invoices (provider, fallback_card_charge_id)
  where fallback_card_charge_id is not null;
