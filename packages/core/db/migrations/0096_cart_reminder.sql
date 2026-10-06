-- 0096_cart_reminder.sql — two messages a store starts from its own WhatsApp (ADR 0026), each one
-- a shopper asked for: one reminder about a bag left full (stores without the Vendedor, off by
-- default, only to a shopper who ticked it at checkout), and "avise-me quando abrir".
--   store_whatsapp.cart_reminder — the merchant's switch, beside the order steps
--   cart_reminders               — the shopper's consent, one per cart, and what became of it
--   store_wa_messages            — the two new kinds, and the cart a reminder is about
--   cart_shares.source_cart_id   — the bag a reminder's link was made from

alter table store_whatsapp add column if not exists cart_reminder boolean not null default false;

create table if not exists cart_reminders (
  cart_id uuid primary key references carts (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- null once withdrawn or forgotten: consent is the only reason to keep a number
  phone text check (phone ~ '^\d{10,11}$'),
  name text check (char_length(name) <= 80),
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- queued to the store's WhatsApp, in the same transaction: at most one per cart, ever
  sent_at timestamptz,
  -- why it never went: ordered, opted_out, vendedor_thread, recent, empty, expired, failed
  skipped text check (skipped ~ '^[a-z_]{1,30}$'),
  created_at timestamptz not null default now()
);
create index if not exists cart_reminders_due on cart_reminders (tenant_id, consented_at)
  where sent_at is null and withdrawn_at is null and skipped is null;
create index if not exists cart_reminders_by_phone on cart_reminders (tenant_id, phone)
  where phone is not null;
create index if not exists cart_reminders_age on cart_reminders (tenant_id, created_at);

alter table cart_reminders enable row level security;
drop policy if exists tenant_isolation on cart_reminders;
create policy tenant_isolation on cart_reminders
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on cart_reminders;
create policy control_access on cart_reminders for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on cart_reminders to vendua_app;

alter table store_wa_messages drop constraint if exists store_wa_messages_kind_check;
alter table store_wa_messages add constraint store_wa_messages_kind_check
  check (kind in ('order', 'opt_out', 'opt_in', 'test', 'agent', 'chat', 'cart_reminder',
                  'store_open'));
alter table store_wa_messages
  add column if not exists cart_id uuid references carts (id) on delete set null;
-- one reminder per cart, whichever Core replica's sweep got there first
create unique index if not exists store_wa_messages_cart_reminder on store_wa_messages (cart_id)
  where kind = 'cart_reminder' and cart_id is not null;

-- a reminder's link opened on the device that still holds that bag must not add it twice
alter table cart_shares
  add column if not exists source_cart_id uuid references carts (id) on delete set null;

-- the storefront's cached profile says whether the store offers the reminder (cartReminder):
-- notify (0088's function) when that answer can change, not on every lease renewal the gateway
-- writes — hence triggers of their own rather than 0088's every-row pair
drop trigger if exists store_whatsapp_cache_notify on store_whatsapp;
create trigger store_whatsapp_cache_notify after insert or delete on store_whatsapp
  for each row execute function vendua_store_cache_notify();
drop trigger if exists store_whatsapp_cache_notify_offer on store_whatsapp;
create trigger store_whatsapp_cache_notify_offer after update on store_whatsapp
  for each row
  when ((old.cart_reminder and old.wanted and old.state in ('open', 'connecting', 'error'))
        is distinct from
        (new.cart_reminder and new.wanted and new.state in ('open', 'connecting', 'error')))
  execute function vendua_store_cache_notify();
drop trigger if exists store_whatsapp_cache_notify_truncate on store_whatsapp;
create trigger store_whatsapp_cache_notify_truncate after truncate on store_whatsapp
  for each statement execute function vendua_store_cache_notify();
