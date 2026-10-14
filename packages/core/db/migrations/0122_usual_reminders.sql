-- 0122_usual_reminders.sql — "o de sempre" (the owner, 2026-10-13: opt-in and caps): a store may
-- remind a shopper of their usual order, from its own WhatsApp (ADR 0026), only a shopper who
-- asked for it — the tick at checkout or a LEMBRAR reply. At most one a week per shopper, a daily
-- ceiling per store, spaced out, only while open, and PARAR stops it with every other notice.
-- This amends ADR 0031 §5's "re-engagement waits for the official API" for this one opt-in kind.
--   store_whatsapp.usual_reminder / usual_per_day — the merchant's switch and daily ceiling
--   usual_reminders                               — the shopper's consent, one per phone
--   store_wa_messages                             — the new kind

alter table store_whatsapp add column if not exists usual_reminder boolean not null default false;
alter table store_whatsapp add column if not exists usual_per_day int not null default 20
  check (usual_per_day between 1 and 200);

create table if not exists usual_reminders (
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null check (phone ~ '^\d{10,11}$'),
  name text check (char_length(name) <= 80),
  source text not null check (source in ('checkout', 'whatsapp')),
  consented_at timestamptz not null default now(),
  last_sent_at timestamptz,
  primary key (tenant_id, phone)
);
alter table usual_reminders enable row level security;
drop policy if exists tenant_isolation on usual_reminders;
create policy tenant_isolation on usual_reminders
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on usual_reminders to vendua_app;

alter table store_wa_messages drop constraint if exists store_wa_messages_kind_check;
alter table store_wa_messages add constraint store_wa_messages_kind_check
  check (kind in ('order', 'opt_out', 'opt_in', 'test', 'agent', 'chat', 'cart_reminder',
                  'store_open', 'usual_reminder'));

-- the storefront's cached profile says whether checkout offers the tick (usualReminder)
drop trigger if exists store_whatsapp_cache_notify_usual on store_whatsapp;
create trigger store_whatsapp_cache_notify_usual after update on store_whatsapp
  for each row
  when ((old.usual_reminder and old.wanted and old.state in ('open', 'connecting', 'error'))
        is distinct from
        (new.usual_reminder and new.wanted and new.state in ('open', 'connecting', 'error')))
  execute function vendua_store_cache_notify();
