-- 0121_customer_contacts.sql — the customer list a store brings from its old system (Clientes →
-- Importar). Customers are phones (ADR 0019) and the list is built from orders; a contact is a
-- phone the store already knew before its first order here, keyed the same way. It gives Clientes a
-- name and a "desde" for people who haven't ordered yet. It is not consent: nothing writes to an
-- imported phone on its own (the opt-in rule, ADR 0031 §5). The LGPD export carries it and the
-- forget deletes it.

create table if not exists customer_contacts (
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null check (phone ~ '^\d{10,11}$'),
  name text not null check (char_length(name) between 1 and 80),
  source text not null default 'import' check (source in ('import')),
  created_by uuid references merchant_users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

alter table customer_contacts enable row level security;
drop policy if exists tenant_isolation on customer_contacts;
create policy tenant_isolation on customer_contacts
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on customer_contacts to vendua_app;
