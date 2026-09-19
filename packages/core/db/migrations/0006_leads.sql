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
