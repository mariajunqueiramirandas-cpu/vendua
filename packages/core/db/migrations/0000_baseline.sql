-- 0000_baseline.sql — FRESH-INSTALL SCHEMA (covers 0001–0017).
-- migrate() runs this file ONLY when schema_migrations is empty and marks
-- the covered deltas applied; existing databases never see it. Regenerate
-- by concatenating the covered files when squashing further.


-- ============ 0001_init.sql ============

-- 0001_init.sql — Core schema, Phase 0 skeleton.
--
-- Rule from docs/architecture/01-core.md: every tenant-owned row carries
-- tenant_id and Postgres row-level security enforces it as a second line of
-- defense. The application connects as `vendua_app` (a non-owner role), sets
-- `vendua.tenant_id` per transaction via SET LOCAL, and still scopes every
-- query explicitly.
--
-- `tenants` and `domains` are the exception: they are the resolver's routing
-- data, needed *before* a tenant context exists. They get a read-only
-- `USING (true)` policy for the app role and no write policy.

create extension if not exists pgcrypto;

-- App role: non-owner, subject to RLS. Local dev password; deployments inject
-- their own. DO-block keeps the migration idempotent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vendua_app') then
    create role vendua_app login password 'vendua_app';
  end if;
end
$$;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plan text not null default 'spike',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists domains (
  host text primary key,
  tenant_id uuid not null references tenants (id) on delete cascade
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  slug text not null,
  name text not null,
  sort int not null default 0,
  unique (tenant_id, slug)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  base_price_cents int not null check (base_price_cents >= 0),
  status text not null default 'active' check (status in ('active', 'sold_out', 'archived')),
  figure_variant text not null default 'default' check (figure_variant in ('default', 'alt')),
  tags jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  required boolean not null default false,
  min_select int not null default 0,
  max_select int not null default 1,
  sort int not null default 0
);

create table if not exists modifiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  group_id uuid not null references modifier_groups (id) on delete cascade,
  name text not null,
  price_delta_cents int not null default 0,
  status text not null default 'active' check (status in ('active', 'sold_out')),
  sort int not null default 0
);

create table if not exists store_settings (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  tagline text,
  description text,
  whatsapp text,
  instagram text,
  city text,
  address text,
  hours jsonb not null default '{"timezone": "America/Sao_Paulo", "windows": []}',
  status_override text check (status_override in ('paused', 'closed')),
  resumes_at timestamptz,
  prep_time_minutes int not null default 30,
  min_order_cents int not null default 0,
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  promo jsonb
);

create table if not exists delivery_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  kind text not null default 'neighborhood' check (kind in ('neighborhood', 'radius')),
  neighborhoods jsonb not null default '[]',
  fee_cents int not null default 0 check (fee_cents >= 0),
  min_order_cents int not null default 0,
  eta_min_minutes int not null default 30,
  eta_max_minutes int not null default 60,
  active boolean not null default true
);

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  session_hash text not null,
  status text not null default 'open' check (status in ('open', 'completed', 'abandoned')),
  delivery jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_hash)
);

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_id uuid not null references carts (id) on delete cascade,
  product_id uuid not null references products (id),
  qty int not null check (qty > 0),
  modifier_ids jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (cart_id, product_id, modifier_ids)
);

create table if not exists idempotency_keys (
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  cart_id uuid not null references carts (id),
  number int not null,
  customer jsonb not null,
  delivery jsonb not null,
  payment jsonb not null,
  state text not null default 'placed' check (state in (
    'placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
    'delivered', 'cancelled', 'refunded'
  )),
  subtotal_cents int not null,
  delivery_fee_cents int not null default 0,
  total_cents int not null,
  placed_at timestamptz not null default now(),
  unique (tenant_id, number)
);

create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  at timestamptz not null default now(),
  from_state text,
  to_state text not null,
  actor text not null default 'system',
  meta jsonb not null default '{}'
);

create table if not exists outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  topic text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Row-level security. Applied to every table with tenant-owned rows; the
-- resolver tables get read-only open policies instead (see header comment).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'users', 'categories', 'products', 'modifier_groups', 'modifiers',
    'store_settings', 'delivery_zones', 'carts', 'cart_items',
    'idempotency_keys', 'orders', 'order_events', 'outbox'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
  end loop;
end
$$;

alter table tenants enable row level security;
drop policy if exists resolver_read on tenants;
create policy resolver_read on tenants for select using (true);

alter table domains enable row level security;
drop policy if exists resolver_read on domains;
create policy resolver_read on domains for select using (true);

grant usage on schema public to vendua_app;
grant select, insert, update, delete on all tables in schema public to vendua_app;
grant usage on all sequences in schema public to vendua_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to vendua_app;
alter default privileges in schema public
  grant usage on sequences to vendua_app;

-- ============ 0002_store_surface_fields.sql ============

-- 0002 — store surface fields observed in the Phase-0 storefront spikes
-- (docs/phase-0-findings.md): currency (forn hardcoded BRL) and per-tenant
-- pt-BR vocabulary (quero-pudim's "doce"/"sacola" copy deck).
alter table store_settings add column currency text not null default 'BRL';
alter table store_settings add column vocabulary jsonb not null default '{}';

-- ============ 0003_review_hardening.sql ============

-- 0003_review_hardening.sql — invariants the PR-review findings need at the
-- database layer.

-- One order per cart, period. The checkout tx locks the cart row FOR UPDATE
-- before validating, but the index is the last line of defense if a path ever
-- skips the lock.
create unique index if not exists orders_cart_unique on orders (cart_id);

-- Line quantity cap enforced atomically — on-conflict increments can't bypass
-- the 99-per-line maximum the PATCH endpoint advertises. Violations surface
-- as INVALID_QTY (23514 check_violation).
alter table cart_items drop constraint if exists cart_items_qty_check;
alter table cart_items add constraint cart_items_qty_range check (qty > 0 and qty <= 99);

-- ============ 0004_idempotency_lease.sql ============

-- 0004_idempotency_lease.sql — idempotency claims carry an owner token so a
-- stale-claim steal can't let two handlers commit the same mutation.
alter table idempotency_keys add column if not exists owner uuid;
create index if not exists idempotency_keys_created_idx on idempotency_keys (created_at);

-- ============ 0005_cart_price_snapshots.sql ============

-- Cart items snapshot their price at add time: a catalog price edit must not
-- retroactively reprice lines a customer already accepted (order integrity).
-- Live availability still revalidates at checkout — this freezes only money.

alter table cart_items
  add column unit_price_cents integer,
  add column modifier_snapshot jsonb not null default '[]'::jsonb;

-- Backfill existing dev carts at current catalog prices (base + chosen deltas).
update cart_items ci
set unit_price_cents = p.base_price_cents + coalesce(
  (
    select sum(m.price_delta_cents)
    from modifiers m
    where m.tenant_id = ci.tenant_id
      and m.id in (select jsonb_array_elements_text(ci.modifier_ids)::uuid)
  ),
  0
)
from products p
where p.tenant_id = ci.tenant_id and p.id = ci.product_id;

update cart_items ci
set modifier_snapshot = coalesce(
  (
    select jsonb_agg(
      jsonb_build_object('id', m.id, 'name', m.name, 'priceDeltaCents', m.price_delta_cents)
      order by m.id
    )
    from modifiers m
    where m.tenant_id = ci.tenant_id
      and m.id in (select jsonb_array_elements_text(ci.modifier_ids)::uuid)
  ),
  '[]'::jsonb
);

alter table cart_items alter column unit_price_cents set not null;

-- ============ 0006_leads.sql ============

-- 0006_leads.sql — Founder CRM v0 (docs/roadmap.md, Phase 1): Venduá's own
-- merchant-intake pipeline (lead → contacted → invited → live, notes per
-- merchant).
--
-- `leads` is a PLATFORM table like tenants/domains (see 0001): it is not
-- merchant data, so it carries no tenant_id. But unlike a permissive
-- `using (true)` policy, its RLS keys on the `vendua.control` GUC — the
-- control routes set it `set local` inside their transactions, so a stray
-- vendua_app query on the tenant path can never read or write CRM data even
-- though the role carries the grant. The HTTP boundary stays the
-- /control/v1 shared-secret gate; RLS is the second line of defense, same
-- shape as the tenant GUC.
-- Mutations claim an Idempotency-Key like every other mutating endpoint.
-- Tenant mutations claim in idempotency_keys (tenant-scoped, FK to tenants) —
-- leads is a platform table, so its claims live here instead: key → stored
-- first response, never evicted, so a retried mutation replays rather than
-- re-applies.
create table if not exists control_idempotency_keys (
  key text primary key,
  response jsonb,
  status_code int,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text,
  phone text,
  email text,
  instagram text,
  city text,
  source text,
  state text not null default 'lead' check (state in ('lead', 'contacted', 'invited', 'live')),
  notes jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leads enable row level security;
drop policy if exists staff_all on leads;
create policy staff_all on leads for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');

alter table control_idempotency_keys enable row level security;
drop policy if exists staff_all on control_idempotency_keys;
create policy staff_all on control_idempotency_keys for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');

grant select, insert, update on leads to vendua_app;
grant select, insert on control_idempotency_keys to vendua_app;

-- ============ 0007_crm.sql ============

-- 0007_crm.sql — Founder CRM → full agentic CRM (docs/roadmap.md, Phase 1→4
-- bridge). Grows the v0 intake board into the tool the founder actually runs
-- the pipeline in: richer lead fields, an activity timeline, tasks, channel
-- threads/messages, state history for funnel metrics, agent runs, provider
-- integrations, and workspace settings.
--
-- Same isolation posture as 0006: every table here is PLATFORM data — no
-- tenant_id, RLS keyed on the `vendua.control` GUC, the /control/v1 gate is
-- the access boundary and RLS the second line of defense. Mutations keep
-- claiming Idempotency-Keys via control_idempotency_keys.
--
-- leads.notes (v0 jsonb) migrates into lead_activities rows below, and the
-- column is dropped — one timeline, not two shapes of history.

alter table leads
  add column if not exists whatsapp text,
  add column if not exists website text,
  add column if not exists segment text,
  add column if not exists deal_value_cents int,
  add column if not exists owner text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists next_action_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists archived_at timestamptz,
  add column if not exists agent_mode text not null default 'draft'
    check (agent_mode in ('off', 'draft', 'auto')),
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists discovered_via text;

create table if not exists lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  -- 'email'/'call'/'meeting' are staff-logged touchpoints; 'agent' marks
  -- runner actions; 'system' for imported/migrated events.
  kind text not null check (kind in ('note', 'call', 'meeting', 'state_change', 'agent', 'system')),
  body text,
  meta jsonb not null default '{}',
  created_by text not null default 'staff' check (created_by in ('staff', 'agent', 'system')),
  at timestamptz not null default now()
);
create index if not exists lead_activities_lead_at on lead_activities (lead_id, at desc);

create table if not exists lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  done_at timestamptz,
  created_by text not null default 'staff' check (created_by in ('staff', 'agent')),
  created_at timestamptz not null default now()
);
create index if not exists lead_tasks_open_due on lead_tasks (due_at) where done_at is null;

-- One thread per lead per channel; external_id is the provider-side chat /
-- conversation id when one exists (baileys jid, resend thread).
create table if not exists lead_threads (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'manual')),
  subject text,
  external_id text,
  agent_enabled boolean not null default true,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, channel)
);

create table if not exists lead_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lead_threads (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('staff', 'agent', 'lead', 'system')),
  body text not null,
  -- drafts wait in the Approvals queue; 'rejected' keeps the audit trail.
  -- 'sending' = dispatch in flight: a crash between provider call and status
  -- write lands here, never back in 'queued' — at-most-once delivery.
  status text not null check (status in ('draft', 'queued', 'sending', 'sent', 'delivered', 'received', 'failed', 'rejected')),
  -- Channel-namespaced on write ('whatsapp:AB12…') — a provider id must be
  -- unique per channel, but ids across providers share no namespace, so the
  -- unique index below can't let one channel's ids suppress another's.
  provider_message_id text,
  -- run that authored this message — lets a re-executed agent run recognize
  -- its own already-queued send instead of composing a duplicate.
  agent_run_id uuid,
  -- why a 'failed' send failed — kept out of provider_message_id, which is
  -- unique and would collide on repeated same-reason failures.
  error text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_messages_thread_at on lead_messages (thread_id, created_at);
create index if not exists lead_messages_pending_drafts on lead_messages (created_at) where status = 'draft';
-- Provider retries must never insert a second copy of the same inbound.
create unique index if not exists lead_messages_provider_id on lead_messages (provider_message_id) where provider_message_id is not null;

create table if not exists lead_state_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor text not null default 'staff' check (actor in ('staff', 'agent', 'system')),
  at timestamptz not null default now()
);
create index if not exists lead_state_history_lead on lead_state_history (lead_id, at);

-- Funnel reads `everReached` from this table only, so pre-existing leads
-- need their history backfilled: every stage up to their current state,
-- stamped at created_at. Leads with an out-of-funnel state are untouched.
insert into lead_state_history (lead_id, from_state, to_state, actor, at)
select l.id, prev.s, cur.s, 'system', l.created_at
from leads l
join lateral (
  select s, ord
  from (values ('lead', 1), ('contacted', 2), ('invited', 3), ('live', 4)) v(s, ord)
  where v.ord <= (
    select o.ord from (values ('lead', 1), ('contacted', 2), ('invited', 3), ('live', 4)) o(s, ord)
    where o.s = l.state
  )
) cur on true
left join lateral (
  select s from (values ('lead', 1), ('contacted', 2), ('invited', 3), ('live', 4)) p(s, ord)
  where p.ord = cur.ord - 1
) prev on true;

-- Agent harness queue: every run is an auditable row. steps[] is the full
-- tool-call + model-io transcript; tokens/cost make spend a first-class read.
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('triage', 'reply', 'outreach', 'discovery')),
  lead_id uuid references leads (id) on delete set null,
  thread_id uuid references lead_threads (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  params jsonb not null default '{}',
  steps jsonb not null default '[]',
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_cents int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists agent_runs_queue on agent_runs (created_at) where status = 'queued';

-- Modular provider configs. secret_ref is the NAME of an env var holding the
-- credential — values never live in this table.
create table if not exists control_integrations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('llm', 'email', 'whatsapp', 'discovery')),
  driver text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}',
  secret_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, driver)
);

-- Baileys auth state: the driver's multi-key credential store (replaces
-- useMultiFileAuthState so the socket survives rebuilds and restarts).
-- Keyed the way SignalKeyStore addresses keys: (account, category, name).
create table if not exists wa_auth_state (
  account_id text not null,
  category text not null,
  name text not null,
  data jsonb not null,
  primary key (account_id, category, name)
);

-- Workspace-level knobs: 'guardrails', 'pitch', 'autopilot_default'.
create table if not exists control_settings (
  key text primary key,
  value jsonb not null
);

-- Fold v0 notes into the timeline, then drop the jsonb column.
insert into lead_activities (lead_id, kind, body, created_by, at)
select id, 'note', n ->> 'body', 'staff', (n ->> 'at')::timestamptz
from leads, jsonb_array_elements(notes) n
where jsonb_array_length(notes) > 0
on conflict do nothing;

alter table leads drop column if exists notes;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_activities', 'lead_tasks', 'lead_threads', 'lead_messages',
    'lead_state_history', 'agent_runs', 'control_integrations',
    'wa_auth_state', 'control_settings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;

-- ============ 0008_message_subject.sql ============

-- 0008_message_subject.sql — outbound subject snapshots on the message row.
-- lead_threads.subject is the conversation default; a queued message keeps the
-- subject effective at compose time so a later override can't rewrite an
-- in-flight send (dispatch reads m.subject, falling back to the thread's).

alter table lead_messages add column if not exists subject text;

-- Only rows that can still dispatch inherit the thread's current subject —
-- a completed send used whatever the thread said back then, so stamping it
-- now would fabricate history.
update lead_messages m
set subject = t.subject
from lead_threads t
where m.thread_id = t.id
  and m.direction = 'out'
  and m.status in ('draft', 'queued')
  and m.subject is null;

-- ============ 0009_agent_claim.sql ============

-- agent_runs.claim_token fences writes to the running execution that owns
-- the row: the reclaimer clears it, each new claim mints one, and the
-- worker's heartbeat/journal/finish writes are conditioned on it — so a
-- stale worker waking after its run was requeued can no longer overwrite
-- the live execution's status or journal.
alter table agent_runs add column if not exists claim_token text;

-- ============ 0010_agent_goals.sql ============

-- 0010_agent_goals.sql — goal-driven agent + scheduled discovery (AutoGTM
-- parity pass). `leads.agent_goal` is the standing objective staff picks at
-- dispatch time ('negotiation' closes in-thread, 'meeting' drives toward the
-- founders' Google Meet booking link); reply/outreach runs read it so
-- inbound replies stay on-goal. `fit_score`/`fit_reason` is the model-judged
-- ICP match — separate from the SQL completeness `score`. `email_bounced_at`
-- is the deliverability flag Resend bounce/failed events set, blocking later
-- email sends. `discovery_briefs` are the daily autopilot briefs — the worker
-- sweep enqueues one discovery run per due brief.
--
-- Same isolation posture as 0007: platform data, RLS keyed on vendua.control.

alter table leads
  add column if not exists agent_goal text not null default 'negotiation'
    check (agent_goal in ('negotiation', 'meeting')),
  add column if not exists fit_score int
    check (fit_score is null or fit_score between 0 and 10),
  add column if not exists fit_reason text,
  add column if not exists email_bounced_at timestamptz;

create table if not exists discovery_briefs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  query text not null,
  segment text,
  city text,
  -- target leads per daily run; the run prompt turns it into the stop
  -- condition and the guardrail cap still bounds it from above.
  target int check (target is null or (target between 1 and 1000)),
  enabled boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  execute format('alter table %I enable row level security', 'discovery_briefs');
  execute format('drop policy if exists staff_all on %I', 'discovery_briefs');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'discovery_briefs'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'discovery_briefs');
end
$$;

-- ============ 0011_provider_events.sql ============

-- Delivery events can beat dispatch's finalize — Resend emits
-- email.delivered/bounced before our send call returns the provider id. When
-- no lead_messages row carries the pmid yet, the event is parked here; the
-- dispatch finalize drains pending rows once the pmid lands. Keyed by
-- (channel, provider_id, event) so provider retries dedupe.
create table provider_events (
  id bigserial primary key,
  channel text not null,
  provider_id text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel, provider_id, event)
);

create index provider_events_lookup on provider_events (channel, provider_id);

do $$
begin
  execute format('alter table %I enable row level security', 'provider_events');
  execute format('drop policy if exists staff_all on %I', 'provider_events');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'provider_events'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'provider_events');
end
$$;

-- ============ 0012_run_alive.sql ============

-- 0012 — split the reclaim lease from the real start time.
-- started_at used to double as the lease: every journal write + heartbeat
-- overwrote it, so it was never the actual start (the launch stage's clock
-- and Runs detail's 'início' both read ≈0 elapsed). alive_at is the lease;
-- started_at now means "when this attempt began" and never moves again.
alter table agent_runs add column alive_at timestamptz;
update agent_runs set alive_at = started_at where alive_at is null;

-- ============ 0013_meetings.sql ============

-- 0013_meetings.sql — CRM-native meeting booking. `meetings` is platform
-- data like the rest of the CRM: no tenant_id, RLS keyed on the
-- `vendua.control` GUC, the /control/v1 gate + booking tokens are the access
-- boundary.
--
-- Meetings are booked three ways: the public token-guarded link the agent
-- sends ('link'), staff on the Calendar view ('staff'), and future agent
-- tools ('agent'). The unique partial index on (lead_id, starts_at) makes
-- POST /book/v1/book replay-safe — a retried submission returns the same
-- row instead of double-booking the slot.

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'done', 'no_show')),
  room_url text,
  booker_name text,
  booker_contact text,
  source text not null default 'link' check (source in ('link', 'staff', 'agent')),
  gcal_event_id text,
  -- send markers: set once the 24h / 1h reminder went out so the worker
  -- sweep never re-sends.
  reminder_24h_at timestamptz,
  reminder_1h_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists meetings_lead on meetings (lead_id);
create index if not exists meetings_starts on meetings (starts_at);
create index if not exists meetings_status on meetings (status);
-- One scheduled meeting per (lead, slot) — the idempotent-booking anchor.
create unique index if not exists meetings_lead_slot
  on meetings (lead_id, starts_at) where status = 'scheduled' and lead_id is not null;
-- Reminder sweep reads scheduled meetings approaching their start.
create index if not exists meetings_reminders on meetings (status, starts_at);

-- Meeting lifecycle events on the lead timeline get their own kinds so the
-- UI can label them distinctly from a staff-logged 'meeting' touchpoint.
alter table lead_activities drop constraint if exists lead_activities_kind_check;
alter table lead_activities
  add constraint lead_activities_kind_check
  check (kind in (
    'note', 'call', 'meeting', 'state_change', 'agent', 'system',
    'meeting_booked', 'meeting_done', 'meeting_no_show', 'meeting_cancelled'
  ));

do $$
begin
  execute format('alter table %I enable row level security', 'meetings');
  execute format('drop policy if exists staff_all on %I', 'meetings');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'meetings'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'meetings');
end
$$;

-- ============ 0014_pipeline_snapshots.sql ============

-- 0014_pipeline_snapshots.sql — daily pipeline snapshots for deal-value
-- forecasting. The worker sweep writes one row per day (taken_on is unique):
-- the funnel's per-state count + deal value at that moment, the weighted
-- value under the configured stage probabilities, and the trailing 30d agent
-- spend — the "expected revenue vs. agent cost" pair the Reports view reads.
-- Re-runs on the same day UPDATE the row (a snapshot is a point-in-time
-- measurement, not an event log).
--
-- Same isolation posture as 0007: platform data, RLS keyed on vendua.control.

create table if not exists pipeline_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- the day the snapshot covers (server-local current_date) — one row/day.
  taken_on date not null unique,
  -- {"lead": {"count": n, "valueCents": n}, ...} — all four LEAD_STATES keys.
  by_state jsonb not null,
  -- sum(valueCents * stage probability) at snapshot time.
  weighted_cents int not null default 0,
  -- agent_runs cost_cents over the trailing 30d, frozen with the snapshot.
  agent_cost_cents int not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  execute format('alter table %I enable row level security', 'pipeline_snapshots');
  execute format('drop policy if exists staff_all on %I', 'pipeline_snapshots');
  execute format(
    'create policy staff_all on %I for all
       using (current_setting(''vendua.control'', true) = ''1'')
       with check (current_setting(''vendua.control'', true) = ''1'')',
    'pipeline_snapshots'
  );
  execute format('grant select, insert, update, delete on %I to vendua_app', 'pipeline_snapshots');
end
$$;

-- ============ 0015_lead_history_value.sql ============

-- 0015_lead_history_value.sql — deal-value snapshot per state transition.
-- Stamps the lead's deal_value_cents onto the history row so won30d reports
-- the value effective at win time — editing the deal later can't rewrite
-- already-reported revenue.

alter table lead_state_history add column if not exists value_cents int;

-- Freeze pre-column rows at the best estimate available — the deal value
-- current at migration — so wins already reported keep reporting the same
-- number and later edits can't move it. A null deal value stays null
-- (unknown at transition), which after this stamp reads as "captured null",
-- not "missing column", so won30d can drop its coalesce entirely.
update lead_state_history h
set value_cents = l.deal_value_cents
from leads l
where h.lead_id = l.id and h.value_cents is null;

-- ============ 0016_message_meeting_link.sql ============

-- 0016_message_meeting_link.sql — durable link between an outbound message
-- and the meeting it belongs to. Confirmations and reminders carry it so the
-- dispatch claim (and the stranded-message recovery in drain()) can suppress
-- sends once the meeting is no longer scheduled — a caller-supplied guard
-- never reaches the recovery path.

alter table lead_messages
  add column if not exists meeting_id uuid references meetings(id) on delete set null;

-- ============ 0017_lead_whatsapp_verified.sql ============

-- 0017_lead_whatsapp_verified.sql — whatsapp provenance. Discovery auto-fills
-- whatsapp from a BR mobile phone (reachable, not proven); wa.me/api.whatsapp
-- links and explicit sets are verified evidence. Autocontact gates on the flag.
alter table leads
  add column if not exists whatsapp_verified boolean not null default false;

-- Rows that already carried whatsapp got it from real evidence (this flag
-- predates only the auto-fill path) — don't regress them to unverified.
update leads set whatsapp_verified = true where whatsapp is not null and whatsapp <> '';
