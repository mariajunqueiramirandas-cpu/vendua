-- 0091_customer_notes.sql — what the store writes down about a customer (Clientes).
-- Customers are phones (ADR 0019): a row is keyed the same way the list groups orders,
-- (tenant_id, customer_phone). The note and tags are the store's own words about a person, so
-- the LGPD export carries them and the forget deletes the row.
--   customer_notes   — one free-text note (≤ 2000) and ≤ 10 lowercase tags (≤ 24 chars each)

create table if not exists customer_notes (
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null check (phone ~ '^\d{10,11}$'),
  note text not null default '' check (char_length(note) <= 2000),
  tags text[] not null default '{}'
    check (cardinality(tags) <= 10 and char_length(array_to_string(tags, '|')) <= 260),
  updated_by uuid references merchant_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);
create index if not exists customer_notes_tags on customer_notes using gin (tags);

alter table customer_notes enable row level security;
drop policy if exists tenant_isolation on customer_notes;
create policy tenant_isolation on customer_notes
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on customer_notes to vendua_app;
