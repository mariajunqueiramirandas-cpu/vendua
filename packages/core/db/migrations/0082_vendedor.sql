-- 0082_vendedor.sql — the Vendedor, an AI seller on the store's own WhatsApp (ADR 0031,
-- docs/features/sales-agent.md §4.3). Every table is store data under tenant RLS:
--   store_agent       — one row per store: the merchant's settings, onboarding progress, pack version
--   shopper_threads   — one conversation per (channel, address): who holds the floor, the cart,
--                       the open summary card, the order it became
--   shopper_messages  — every message in and out, merchant-typed included; drafts in Ensaio
--   shopper_media     — voice notes and photos, bounded, same retention as the messages
--   store_knowledge   — the merchant's answers and rules, unanswered questions, proposals
--   suggestion_events — each suggestion offered and whether it was taken
--   agent_incentives  — coupons the Vendedor granted from the merchant's budget
--   vendedor_demand   — asked-for items the menu lacks and deliveries outside every zone (no shopper data)
--   vendedor_runs     — Cliente oculto runs and their score
-- Also: orders.source and orders.thread_id (shared with the iFood work), products.dietary,
-- single-use sacola links on cart_shares, chat rows addressed by jid on store_wa_messages,
-- and the outbox cursors that let Core consume topics (control only).

create table if not exists store_agent (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 32000),
  onboarding jsonb not null default '{}'::jsonb
    check (jsonb_typeof(onboarding) = 'object' and octet_length(onboarding::text) <= 32000),
  -- bumped by admin writes that change what the store pack holds
  pack_version bigint not null default 1,
  enabled_at timestamptz,
  first_sale_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shopper_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'test', 'web', 'instagram')),
  -- a WhatsApp jid (LID or PN), a test or web session id
  address text not null check (char_length(address) between 1 and 120),
  -- national digits for Brazil, '+' and the full number for anyone else; null until it resolves
  phone text check (phone ~ '^(\d{10,11}|\+\d{8,15})$'),
  profile_name text check (char_length(profile_name) <= 80),
  owner text not null default 'open' check (owner in ('open', 'agent', 'human', 'muted')),
  owner_reason text check (char_length(owner_reason) <= 200),
  human_until timestamptz,
  -- a shopper waiting for the store since then (a handoff, or a question only it can answer)
  waiting_since timestamptz,
  class text not null default 'unknown' check (class in ('unknown', 'shopper', 'other')),
  cart_id uuid references carts (id) on delete set null,
  stage text not null default 'browsing'
    check (stage in ('browsing', 'building', 'checkout', 'confirming', 'paying', 'ordered', 'after')),
  -- the open summary card: { id, hash, totalCents, sentAt, unusual }
  summary jsonb check (summary is null or (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4000)),
  order_id uuid references orders (id) on delete set null,
  -- what checkout needs that a cart doesn't hold: { name, phone, payment: { method, changeForCents }, scheduledFor, notes }
  checkout jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checkout) = 'object' and octet_length(checkout::text) <= 4000),
  -- 'owner' for the admin's test chat, 'cliente_oculto' for its synthetic shoppers
  test_kind text check (test_kind in ('owner', 'cliente_oculto')),
  test_order jsonb check (test_order is null or octet_length(test_order::text) <= 32000),
  language text check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  last_in_at timestamptz,
  last_out_at timestamptz,
  last_merchant_at timestamptz,
  -- the oldest shopper message nobody has answered yet
  pending_since timestamptz,
  typing_at timestamptz,
  recovery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, channel, address)
);
create index if not exists shopper_threads_recent on shopper_threads (tenant_id, updated_at desc);
create index if not exists shopper_threads_by_phone on shopper_threads (tenant_id, phone) where phone is not null;
create index if not exists shopper_threads_waiting on shopper_threads (tenant_id, waiting_since)
  where waiting_since is not null;

create table if not exists shopper_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  thread_id uuid not null references shopper_threads (id) on delete cascade,
  author text not null check (author in ('shopper', 'agent', 'merchant', 'core')),
  kind text not null check (kind in ('text', 'audio', 'image', 'location', 'card', 'pix', 'sticker',
    'reaction', 'contact', 'document', 'video', 'other')),
  body text check (char_length(body) <= 4000),
  transcript text check (char_length(transcript) <= 4000),
  -- confidence, coordinates, caption, card data, the cited figures, a verdict on a draft
  meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 16000),
  wa_id text check (char_length(wa_id) <= 64),
  quoted_wa_id text check (char_length(quoted_wa_id) <= 64),
  status text not null default 'received' check (status in ('received', 'draft', 'queued', 'sent',
    'delivered', 'read', 'failed', 'blocked', 'skipped')),
  -- inbound only: Core turns media into text, then dispatches it to the thread's actor
  ingest text check (ingest in ('pending', 'done', 'skipped', 'failed')),
  ingest_attempts int not null default 0 check (ingest_attempts >= 0),
  ingest_lease_until timestamptz,
  -- outbound from a turn: unique per step, so a re-run step finds its row
  agent_step text check (char_length(agent_step) <= 200),
  merchant_user_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists shopper_messages_thread on shopper_messages (thread_id, created_at);
create unique index if not exists shopper_messages_wa_id on shopper_messages (tenant_id, wa_id)
  where wa_id is not null;
create unique index if not exists shopper_messages_agent_step on shopper_messages (tenant_id, agent_step)
  where agent_step is not null;
create index if not exists shopper_messages_ingest on shopper_messages (created_at)
  where ingest = 'pending';
create index if not exists shopper_messages_age on shopper_messages (created_at);

create table if not exists shopper_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  message_id uuid not null references shopper_messages (id) on delete cascade,
  mime text not null check (mime ~ '^[a-z]+/[a-z0-9.+-]{1,60}(;.{0,60})?$'),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  seconds int check (seconds between 0 and 600),
  created_at timestamptz not null default now()
);
create index if not exists shopper_media_message on shopper_media (message_id);
create index if not exists shopper_media_age on shopper_media (created_at);

create table if not exists store_knowledge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  kind text not null check (kind in ('answer', 'rule', 'question')),
  status text not null check (status in ('live', 'proposed', 'open', 'dismissed')),
  source text not null check (source in ('merchant', 'interview', 'learned', 'unanswered', 'ensaio')),
  question text check (char_length(question) <= 500),
  answer text check (char_length(answer) <= 2000),
  -- a rule the system enforces, compiled from the merchant's words; null = guidance
  guard jsonb check (guard is null or (jsonb_typeof(guard) = 'object' and octet_length(guard::text) <= 2000)),
  asked_count int not null default 0 check (asked_count >= 0),
  used_count int not null default 0 check (used_count >= 0),
  last_asked_at timestamptz,
  thread_id uuid references shopper_threads (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_knowledge_by_kind on store_knowledge (tenant_id, kind, status);

create table if not exists suggestion_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  thread_id uuid references shopper_threads (id) on delete set null,
  product_id uuid references products (id) on delete set null,
  source text not null check (source in ('pinned', 'basket', 'combo', 'habit')),
  reason text not null check (char_length(reason) <= 300),
  price_cents int check (price_cents >= 0),
  outcome text not null default 'offered' check (outcome in ('offered', 'taken', 'declined')),
  order_id uuid references orders (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists suggestion_events_recent on suggestion_events (tenant_id, created_at desc);
create index if not exists suggestion_events_thread on suggestion_events (thread_id) where thread_id is not null;

create table if not exists agent_incentives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  thread_id uuid references shopper_threads (id) on delete set null,
  phone text check (phone ~ '^(\d{10,11}|\+\d{8,15})$'),
  reason text not null check (reason in ('recovery', 'first_order', 'hesitation')),
  coupon_id uuid references coupons (id) on delete set null,
  -- the most it can cost the store, counted against the monthly budget when granted
  value_cents int not null check (value_cents between 0 and 10000000),
  created_at timestamptz not null default now()
);
create index if not exists agent_incentives_month on agent_incentives (tenant_id, created_at);
create index if not exists agent_incentives_phone on agent_incentives (tenant_id, phone, created_at);

create table if not exists vendedor_demand (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  kind text not null check (kind in ('unmet', 'out_of_zone')),
  -- the folded item or neighbourhood, never who asked
  term text not null check (char_length(term) between 1 and 80),
  at timestamptz not null default now()
);
create index if not exists vendedor_demand_recent on vendedor_demand (tenant_id, kind, at desc);

create table if not exists vendedor_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  kind text not null default 'cliente_oculto' check (kind in ('cliente_oculto')),
  trigger text not null check (trigger in ('manual', 'menu_change', 'onboarding')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  scenarios jsonb not null default '[]'::jsonb check (octet_length(scenarios::text) <= 200000),
  results jsonb not null default '[]'::jsonb check (octet_length(results::text) <= 200000),
  passed int check (passed >= 0),
  total int check (total >= 0),
  error text check (char_length(error) <= 500),
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vendedor_runs_recent on vendedor_runs (tenant_id, created_at desc);
create index if not exists vendedor_runs_due on vendedor_runs (created_at) where status in ('queued', 'running');

-- where an order came from; today the only trace was order_events.meta.via
alter table orders
  add column if not exists source text not null default 'storefront'
    check (source ~ '^[a-z][a-z_]{1,29}$'),
  add column if not exists thread_id uuid references shopper_threads (id) on delete set null;
create index if not exists orders_by_source on orders (tenant_id, source, placed_at desc);
create index if not exists orders_by_thread on orders (thread_id) where thread_id is not null;

-- what a product states about allergens and diets; the Vendedor claims nothing it doesn't hold
alter table products
  add column if not exists dietary text[] not null default '{}'
    check (dietary <@ array['sem_gluten', 'contem_gluten', 'sem_lactose', 'contem_lactose',
      'vegano', 'vegetariano', 'contem_amendoim', 'contem_castanhas', 'contem_ovo',
      'contem_frutos_do_mar', 'apimentado']::text[]);

-- incentives the Vendedor grants are single-use coupons bound to the phone, minted by Core
alter table coupons drop constraint if exists coupons_source_check;
alter table coupons add constraint coupons_source_check
  check (source in ('staff', 'merchant', 'loyalty', 'agent'));

-- a sacola link: single-use and short-lived, and remembered on the thread that sent it
alter table cart_shares
  add column if not exists single_use boolean not null default false,
  add column if not exists consumed_at timestamptz,
  add column if not exists thread_id uuid references shopper_threads (id) on delete set null;
create index if not exists cart_shares_by_thread on cart_shares (thread_id) where thread_id is not null;

-- chat rows: a reply to a shopper, addressed by jid so LID-only and foreign senders can be answered
alter table store_wa_messages drop constraint if exists store_wa_messages_kind_check;
alter table store_wa_messages add constraint store_wa_messages_kind_check
  check (kind in ('order', 'opt_out', 'opt_in', 'test', 'agent', 'chat'));
alter table store_wa_messages alter column phone drop not null;
alter table store_wa_messages drop constraint if exists store_wa_messages_phone_check;
alter table store_wa_messages add constraint store_wa_messages_phone_check
  check (phone is null or phone ~ '^(\d{10,11}|\+\d{8,15})$');
alter table store_wa_messages
  add column if not exists jid text check (jid ~ '^[0-9:.]{1,40}@(s\.whatsapp\.net|lid)$'),
  add column if not exists shopper_message_id uuid references shopper_messages (id) on delete cascade,
  -- a voice reply: the shopper_media row the gateway sends as a PTT
  add column if not exists media_id uuid references shopper_media (id) on delete set null;
alter table store_wa_messages drop constraint if exists store_wa_messages_addressed;
alter table store_wa_messages add constraint store_wa_messages_addressed
  check (phone is not null or jid is not null);
create unique index if not exists store_wa_messages_shopper_message on store_wa_messages (shopper_message_id)
  where shopper_message_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['store_agent', 'shopper_threads', 'shopper_messages', 'shopper_media',
    'store_knowledge', 'suggestion_events', 'agent_incentives', 'vendedor_demand', 'vendedor_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)$p$, t);
    execute format('drop policy if exists control_access on %I', t);
    execute format($p$create policy control_access on %I for all
      using (current_setting('vendua.control', true) = '1')
      with check (current_setting('vendua.control', true) = '1')$p$, t);
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
grant usage on sequence vendedor_demand_id_seq to vendua_app;

-- Core consumes outbox topics (waitlist.restocked, order.*) from a cursor across stores
drop policy if exists control_access on outbox;
create policy control_access on outbox for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');

-- the cursor itself is platform data
create table if not exists outbox_cursors (
  consumer text primary key check (consumer ~ '^[a-z][a-z0-9_.-]{0,60}$'),
  last_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table outbox_cursors enable row level security;
drop policy if exists control_access on outbox_cursors;
create policy control_access on outbox_cursors for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on outbox_cursors to vendua_app;

-- a new inbound message wakes Core's ingest; an outbound chat row already wakes the gateway
create or replace function shopper_ingest_notify() returns trigger language plpgsql as $$
begin
  if new.ingest = 'pending' then
    perform pg_notify('vendua_shopper', new.tenant_id::text || '|' || new.id::text);
  end if;
  return null;
end
$$;
drop trigger if exists shopper_ingest_notify on shopper_messages;
create trigger shopper_ingest_notify after insert on shopper_messages
  for each row execute function shopper_ingest_notify();
