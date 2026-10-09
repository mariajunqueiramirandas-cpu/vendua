-- 0092_vendedor_qol.sql — the merchant supervising Duá (ADR 0031), day to day:
--   shopper_threads.seen_at  — when the store last opened the conversation: "unread" is a shopper
--                              message after it, not just "the shopper spoke last"
--   store_agent.paused_until — "pausar 1 h / até amanhã": Duá stays out until then and comes back
--                              on his own; a gate on the floor, never a turn
--   vendedor_quick_replies   — the store's own short replies, put into the composer with a tap

alter table shopper_threads add column if not exists seen_at timestamptz;
alter table store_agent add column if not exists paused_until timestamptz;

create table if not exists vendedor_quick_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  position int not null default 0 check (position between 0 and 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendedor_quick_replies_by_store
  on vendedor_quick_replies (tenant_id, position, created_at);

alter table vendedor_quick_replies enable row level security;
drop policy if exists tenant_isolation on vendedor_quick_replies;
create policy tenant_isolation on vendedor_quick_replies
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on vendedor_quick_replies;
create policy control_access on vendedor_quick_replies for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on vendedor_quick_replies to vendua_app;
