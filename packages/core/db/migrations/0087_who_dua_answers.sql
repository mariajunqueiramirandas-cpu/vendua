-- 0087_who_dua_answers.sql — who Duá answers on a store number that is also the owner's own
-- (ADR 0033). A new number is checked before Duá speaks: its chat's last messages are read from
-- WhatsApp on demand, judged friend or customer, and dropped.
--   shopper_threads.class        + checking (verdict in flight), personal (never answered), ask
--                                  (the owner decides); class_source/class_reason are codes, never
--                                  model text; asked_at is the last "é cliente?" push
--   shopper_messages.ingest      + held (waits for the verdict or the owner)
--   shopper_messages.kind        + command (#pessoal, #cliente, #dua typed on the owner's phone)
--   store_wa_history_requests    — Core asks the gateway for one chat's latest messages; the
--                                  gateway answers in `messages`, Core nulls it once classified

alter table shopper_threads drop constraint if exists shopper_threads_class_check;
alter table shopper_threads add constraint shopper_threads_class_check
  check (class in ('unknown', 'shopper', 'other', 'checking', 'personal', 'ask'));
alter table shopper_threads
  add column if not exists class_source text check (class_source in ('orders', 'owner', 'command',
    'history', 'new_contact', 'message', 'setting', 'content')),
  add column if not exists class_reason text check (class_reason in ('ordered_before', 'owner_marked',
    'no_prior_chat', 'looks_personal', 'looks_customer', 'unclear', 'history_unavailable',
    'known_only', 'everyone', 'not_a_shopper')),
  add column if not exists class_at timestamptz,
  add column if not exists asked_at timestamptz;
create index if not exists shopper_threads_by_class on shopper_threads (tenant_id, class, updated_at desc)
  where class in ('ask', 'personal', 'checking');

alter table shopper_messages drop constraint if exists shopper_messages_ingest_check;
alter table shopper_messages add constraint shopper_messages_ingest_check
  check (ingest in ('pending', 'done', 'skipped', 'failed', 'held'));
alter table shopper_messages drop constraint if exists shopper_messages_kind_check;
alter table shopper_messages add constraint shopper_messages_kind_check
  check (kind in ('text', 'audio', 'image', 'location', 'card', 'pix', 'sticker', 'reaction',
    'contact', 'document', 'video', 'other', 'command'));
create index if not exists shopper_messages_held on shopper_messages (thread_id, created_at)
  where ingest = 'held';

create table if not exists store_wa_history_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  thread_id uuid not null references shopper_threads (id) on delete cascade,
  address text not null check (char_length(address) between 1 and 120),
  anchor_wa_id text not null check (char_length(anchor_wa_id) between 1 and 200),
  anchor_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'fetching', 'done', 'empty', 'failed')),
  failure text check (char_length(failure) <= 60),
  -- ≤ 10 items, oldest first: { fromMe, at, text ≤ 500 }; nulled as soon as Core has a verdict
  messages jsonb check (messages is null
    or (jsonb_typeof(messages) = 'array' and octet_length(messages::text) <= 16000)),
  -- Core's own: the triage worker's lease, and when it applied the verdict
  lease_until timestamptz,
  triaged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists store_wa_history_requests_open on store_wa_history_requests (thread_id)
  where status in ('pending', 'fetching');
create index if not exists store_wa_history_requests_due on store_wa_history_requests (tenant_id, created_at)
  where status in ('pending', 'fetching');
create index if not exists store_wa_history_requests_answered on store_wa_history_requests (created_at)
  where triaged_at is null and status in ('done', 'empty', 'failed');
create index if not exists store_wa_history_requests_held_text on store_wa_history_requests (created_at)
  where messages is not null;

alter table store_wa_history_requests enable row level security;
drop policy if exists tenant_isolation on store_wa_history_requests;
create policy tenant_isolation on store_wa_history_requests
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on store_wa_history_requests;
create policy control_access on store_wa_history_requests for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on store_wa_history_requests to vendua_app;

-- Before this, any first message that didn't read as a supplier made a number a shopper, the
-- owner's friends included. A WhatsApp shopper with no order goes through the check again at
-- its next message; numbers that ordered keep their class (and say why).
update shopper_threads t set class = 'shopper', class_source = 'orders',
    class_reason = 'ordered_before', class_at = now()
  where t.channel = 'whatsapp' and t.class = 'shopper' and t.class_source is null
    and t.phone is not null
    and exists (select 1 from orders o where o.tenant_id = t.tenant_id and o.customer_phone = t.phone);
update shopper_threads t set class = 'unknown'
  where t.channel = 'whatsapp' and t.class = 'shopper' and t.class_source is null;
