-- 0089_copilot.sql — Duá Copilot (ADR 0034): Duá working for the store's own people inside the
-- admin. One conversation per merchant user; Duá answers from the admin's own reads and prepares
-- changes as proposals that only a tap on "Confirmar" applies.
--   copilot_messages  — the conversation: the merchant's words and Duá's replies. A reply's
--                       agent_step is unique per store, so a re-run step finds its row.
--   copilot_actions   — a proposed change: which admin route it replays (kind + input), what
--                       the card shows (title, lines), and how it ended. Applying it re-runs the
--                       route's own handler, so validation, audit and live updates are the route's.
--   plans.features    + copilot (Pangolim only, owner's call 2026-10-06)

create table if not exists copilot_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  author text not null check (author in ('merchant', 'dua')),
  body text not null check (char_length(body) between 1 and 4000),
  -- the admin path the merchant was on ("/pedidos/<id>"), so "este pedido" means something
  screen text check (char_length(screen) <= 200),
  turn_id text check (char_length(turn_id) <= 120),
  agent_step text check (char_length(agent_step) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists copilot_messages_by_user on copilot_messages (tenant_id, user_id, created_at desc);
create unique index if not exists copilot_messages_step on copilot_messages (tenant_id, agent_step)
  where agent_step is not null;

alter table copilot_messages enable row level security;
drop policy if exists tenant_isolation on copilot_messages;
create policy tenant_isolation on copilot_messages
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on copilot_messages;
create policy control_access on copilot_messages for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on copilot_messages to vendua_app;

create table if not exists copilot_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references merchant_users (id) on delete cascade,
  -- the turn that proposed it; its reply message is linked once written
  turn_id text check (char_length(turn_id) <= 120),
  message_id uuid references copilot_messages (id) on delete cascade,
  kind text not null check (kind in ('store.pause', 'store.resume', 'store.operations',
    'store.special_day', 'product.update', 'products.price', 'coupon.create', 'coupon.update')),
  input jsonb not null check (octet_length(input::text) <= 16000),
  title text not null check (char_length(title) between 1 and 120),
  -- [{ label, from, to }] as Core formatted them
  lines jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'
    and octet_length(lines::text) <= 16000),
  link text check (char_length(link) <= 200),
  money boolean not null default false,
  min_role text not null check (min_role in ('owner', 'manager', 'attendant')),
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'declined', 'expired', 'failed')),
  error text check (char_length(error) <= 300),
  done text check (char_length(done) <= 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  decided_at timestamptz,
  decided_by uuid references merchant_users (id) on delete set null
);
create index if not exists copilot_actions_by_user on copilot_actions (tenant_id, user_id, created_at desc);
create index if not exists copilot_actions_by_turn on copilot_actions (tenant_id, turn_id)
  where message_id is null;

alter table copilot_actions enable row level security;
drop policy if exists tenant_isolation on copilot_actions;
create policy tenant_isolation on copilot_actions
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on copilot_actions;
create policy control_access on copilot_actions for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on copilot_actions to vendua_app;

update plans set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('copilot', id = 'pangolim')
where not (coalesce(features, '{}'::jsonb) ? 'copilot');
