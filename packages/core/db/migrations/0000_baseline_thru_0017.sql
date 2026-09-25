-- Fresh-install schema covering 0001–0017; runs only when schema_migrations is empty. Regenerate by concatenating the covered files.

-- 0001_init.sql — core schema. Every tenant-owned table gets tenant_id + RLS as a second line of defense;
-- resolver tables tenants/domains get read-only USING (true) policies (needed before a tenant context exists).

create extension if not exists pgcrypto;

-- vendua_app: non-owner role subject to RLS (dev password; DO-block keeps this idempotent).
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

-- Tenant-isolation RLS on every tenant-owned table.

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

-- 0002_store_surface_fields.sql — store_settings.currency + vocabulary (per-tenant pt-BR copy deck).

alter table store_settings add column currency text not null default 'BRL';
alter table store_settings add column vocabulary jsonb not null default '{}';

-- 0003_review_hardening.sql — DB-layer invariants.

-- one order per cart — the index backs the checkout tx's FOR UPDATE lock
create unique index if not exists orders_cart_unique on orders (cart_id);

-- atomic 99-per-line qty cap — on-conflict increments can't bypass it (violations surface as INVALID_QTY)
alter table cart_items drop constraint if exists cart_items_qty_check;
alter table cart_items add constraint cart_items_qty_range check (qty > 0 and qty <= 99);

-- 0004_idempotency_lease.sql — claims carry an owner token so a stale-claim steal can't double-commit a mutation.

alter table idempotency_keys add column if not exists owner uuid;
create index if not exists idempotency_keys_created_idx on idempotency_keys (created_at);

-- 0005_cart_price_snapshots.sql — cart items snapshot price at add time so catalog edits can't reprice accepted lines.

alter table cart_items
  add column unit_price_cents integer,
  add column modifier_snapshot jsonb not null default '[]'::jsonb;

-- backfill dev carts at current catalog prices (base + chosen deltas)
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

-- 0006_leads.sql — founder CRM v0 intake pipeline. Platform tables (no tenant_id): RLS keys on the vendua.control
-- GUC instead, so stray tenant-path queries can't touch CRM data; control mutations claim keys in control_idempotency_keys.

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

-- 0007_crm.sql — v0 intake → agentic CRM: richer leads, activity timeline, tasks, threads/messages, state history,
-- agent runs, integrations, settings. Same posture as 0006: platform data, vendua.control-gated RLS.
-- leads.notes (v0 jsonb) folds into lead_activities and drops — one timeline, not two shapes of history.

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
  -- kinds: staff touchpoints (note/call/meeting), runner actions (agent), imported events (system)
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

-- one thread per (lead, channel); external_id = provider-side conversation id (baileys jid, resend thread)
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
  -- 'sending' = dispatch in flight: a crash lands here, never back in 'queued' (at-most-once delivery)
  status text not null check (status in ('draft', 'queued', 'sending', 'sent', 'delivered', 'received', 'failed', 'rejected')),
  -- channel-namespaced on write ('whatsapp:AB12…') so provider ids can't collide across channels in the unique index
  provider_message_id text,
  -- lets a re-executed run recognize its own already-queued send instead of composing a duplicate
  agent_run_id uuid,
  -- failure reason kept out of provider_message_id, which is unique and would collide on repeated failures
  error text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_messages_thread_at on lead_messages (thread_id, created_at);
create index if not exists lead_messages_pending_drafts on lead_messages (created_at) where status = 'draft';
-- provider retries must never insert a second copy of the same inbound
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

-- backfill every funnel stage up to each lead's current state (stamped at created_at); out-of-funnel states untouched
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

-- agent run queue; steps[] = tool-call + model-io transcript, tokens/cost = spend ledger
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

-- secret_ref names the env var holding the credential — values never live in this table
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

-- Baileys credential store keyed like SignalKeyStore: (account, category, name); survives rebuilds/restarts
create table if not exists wa_auth_state (
  account_id text not null,
  category text not null,
  name text not null,
  data jsonb not null,
  primary key (account_id, category, name)
);

-- workspace knobs: 'guardrails', 'pitch', 'autopilot_default'
create table if not exists control_settings (
  key text primary key,
  value jsonb not null
);

-- fold v0 notes into the timeline, then drop the jsonb column
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

-- 0008_message_subject.sql — snapshot the compose-time thread subject onto the message so a later override can't rewrite an in-flight send.

alter table lead_messages add column if not exists subject text;

-- only still-dispatchable rows inherit — stamping a completed send would fabricate history
update lead_messages m
set subject = t.subject
from lead_threads t
where m.thread_id = t.id
  and m.direction = 'out'
  and m.status in ('draft', 'queued')
  and m.subject is null;

-- 0009_agent_claim.sql — claim_token fences heartbeat/journal/finish writes to the owning execution; a stale worker can't overwrite a requeued run.

alter table agent_runs add column if not exists claim_token text;

-- 0010_agent_goals.sql — leads.agent_goal (reply/outreach runs stay on-goal), model fit_score/fit_reason,
-- email_bounced_at deliverability flag, daily discovery_briefs. Platform data, vendua.control-gated RLS.

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
  -- target leads per daily run; the guardrail cap still bounds it from above
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

-- 0011_provider_events.sql — parks delivery events that beat dispatch's finalize (pmid not yet on the message);
-- the finalize drains them once it lands; (channel, provider_id, event) key dedupes provider retries.

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

-- 0012_run_alive.sql — split the reclaim lease from the real start: alive_at is the lease (heartbeats move it);
-- started_at is when the attempt began and never moves again.

alter table agent_runs add column alive_at timestamptz;
update agent_runs set alive_at = started_at where alive_at is null;

-- 0013_meetings.sql — CRM meeting booking (link/staff/agent sources); the unique (lead_id, starts_at) partial index
-- makes POST /book/v1/book replay-safe. Platform data, vendua.control-gated RLS.

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
  -- set once the 24h/1h reminder went out so the sweep never re-sends
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
-- one scheduled meeting per (lead, slot) — the idempotent-booking anchor
create unique index if not exists meetings_lead_slot
  on meetings (lead_id, starts_at) where status = 'scheduled' and lead_id is not null;
-- reminder sweep reads scheduled meetings approaching their start
create index if not exists meetings_reminders on meetings (status, starts_at);

-- meeting lifecycle kinds stay distinct from a staff-logged 'meeting' touchpoint
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

-- 0014_pipeline_snapshots.sql — one row/day: funnel count + deal value, probability-weighted value, trailing 30d agent
-- spend (the Reports "expected revenue vs agent cost" pair). Same-day re-runs update the row. vendua.control-gated RLS.

create table if not exists pipeline_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- the covered day (server-local current_date) — one row/day
  taken_on date not null unique,
  -- {"lead": {"count": n, "valueCents": n}, ...} — all four LEAD_STATES keys
  by_state jsonb not null,
  -- sum(valueCents * stage probability) at snapshot time
  weighted_cents int not null default 0,
  -- agent_runs cost_cents over the trailing 30d, frozen with the snapshot
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

-- 0015_lead_history_value.sql — stamps deal_value_cents on each history row so later edits can't rewrite reported revenue.

alter table lead_state_history add column if not exists value_cents int;

-- freeze pre-column rows at the current deal value; null stays null ("captured null", not "missing column")
update lead_state_history h
set value_cents = l.deal_value_cents
from leads l
where h.lead_id = l.id and h.value_cents is null;

-- 0016_message_meeting_link.sql — durable message→meeting link; confirmations/reminders and drain() recovery suppress sends once the meeting isn't scheduled.

alter table lead_messages
  add column if not exists meeting_id uuid references meetings(id) on delete set null;

-- 0017_lead_whatsapp_verified.sql — whatsapp provenance: auto-filled BR mobiles are unverified; wa.me links/explicit sets are verified (autocontact gates on it).

alter table leads
  add column if not exists whatsapp_verified boolean not null default false;

-- pre-existing whatsapp values came from real evidence — don't regress them to unverified
update leads set whatsapp_verified = true where whatsapp is not null and whatsapp <> '';
