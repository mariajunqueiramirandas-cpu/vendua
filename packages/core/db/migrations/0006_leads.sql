-- 0006_leads.sql — Founder CRM v0 (docs/roadmap.md, Phase 1): Venduá's own
-- merchant-intake pipeline (lead → contacted → invited → live, notes per
-- merchant).
--
-- `leads` is a PLATFORM table like tenants/domains (see 0001): it is not
-- merchant data, so it carries no tenant_id. Access control lives at the
-- /control/v1 shared-secret gate — there is no tenant boundary for RLS to
-- enforce — so the app role gets one permissive policy covering staff
-- read+write.
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
  -- Mutations claim an Idempotency-Key like every other mutating endpoint —
  -- create stores its key on the row (replay returns the first write); PATCH
  -- keys live in mutation_keys (bounded); notes dedupe on a `key` inside the
  -- notes jsonb.
  idempotency_key text unique,
  mutation_keys jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leads enable row level security;
drop policy if exists staff_all on leads;
create policy staff_all on leads for all using (true) with check (true);

grant select, insert, update, delete on leads to vendua_app;
