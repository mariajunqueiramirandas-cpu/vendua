-- ADR 0026 (amended 2026-10-08): a SAIR from a shopper whose WhatsApp hides their number (a LID
-- with no number mapping) is kept by the chat's address; and the 90-day SAIR window outlives the
-- queue rows (kept 30 days) through a slim last-contacted record per address.
alter table store_wa_optouts drop constraint if exists store_wa_optouts_pkey;
alter table store_wa_optouts alter column phone drop not null;
alter table store_wa_optouts
  add column if not exists jid text check (jid ~ '^[0-9:.]{1,40}@(s\.whatsapp\.net|lid)$');
alter table store_wa_optouts drop constraint if exists store_wa_optouts_addressed;
alter table store_wa_optouts add constraint store_wa_optouts_addressed
  check (phone is not null or jid is not null);
create unique index if not exists store_wa_optouts_by_phone on store_wa_optouts (tenant_id, phone)
  where phone is not null;
create unique index if not exists store_wa_optouts_by_jid on store_wa_optouts (tenant_id, jid)
  where jid is not null;

-- the last time the store texted an address (a phone or a chat jid), carried over from the
-- queue rows housekeeping deletes; dropped after the SAIR window
create table if not exists store_wa_contacts (
  tenant_id uuid not null references tenants (id) on delete cascade,
  address text not null check (char_length(address) <= 60),
  last_at timestamptz not null,
  primary key (tenant_id, address)
);
create index if not exists store_wa_contacts_age on store_wa_contacts (last_at);

alter table store_wa_contacts enable row level security;
drop policy if exists tenant_isolation on store_wa_contacts;
create policy tenant_isolation on store_wa_contacts
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on store_wa_contacts;
create policy control_access on store_wa_contacts for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on store_wa_contacts to vendua_app;
