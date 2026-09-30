-- Phase 4 — Control Plane v0 (docs/architecture/08-control-plane.md, ADR 0022).
--
--   releases           — immutable storefront artifacts, one per bundle + content hash (platform)
--   storefront_ops.*   — each store's bundle, release policy and live release pointer
--   deployments        — every pointer flip (promote, rollback, provision), verified by a probe
--   fleet_probes       — per live host: the synthetic probe's last result, schedule and lease
--   health_checks      — probe failures and recoveries (the history; passes only update the probe)
--   fleet_incidents    — operations incidents: probe failing, deployment failed, provisioning stuck
--   provisionings      — the provisioner's state machine, one per store (signup or staff invite)
--   leads.tenant_id    — a lead graduates into the store it became
--   provision_store()  — also opens the store's provisioning; staff invites pass the lead

create table if not exists releases (
  id text primary key check (id ~ '^[0-9a-f]{20}$'),
  bundle text not null
    check (bundle ~ '^[a-z0-9_][a-z0-9_-]{0,39}(/[a-z0-9_][a-z0-9_-]{0,39})?$'),
  -- the tenant the bundle is built for (package.json vendua.tenant); `_template` serves many
  tenant_slug text not null check (char_length(tenant_slug) between 1 and 60),
  kernel_version text not null check (kernel_version ~ '^\d+\.\d+\.\d+'),
  contract int not null check (contract between 1 and 99),
  commit text not null check (char_length(commit) between 1 and 64),
  artifact_uri text not null check (char_length(artifact_uri) between 1 and 500),
  -- storefront.manifest.json without its file index (that stays in the artifact store)
  manifest jsonb not null,
  qa_status text not null check (qa_status in ('passed', 'failed')),
  qa_report jsonb not null default '[]',
  built_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- bumped by every publish of the same content: auto stores follow the newest publish, so a
  -- revert to an older build (same id) deploys again
  published_at timestamptz not null default now()
);
create index if not exists releases_by_bundle on releases (bundle, published_at desc);

alter table storefront_ops
  add column if not exists bundle text not null default '_template'
    check (bundle ~ '^[a-z0-9_][a-z0-9_-]{0,39}(/[a-z0-9_][a-z0-9_-]{0,39})?$'),
  -- staff chose the bundle: a publish naming this store as its tenant doesn't move it
  add column if not exists bundle_locked boolean not null default false,
  -- auto: the newest passed release of the bundle; pinned: stays put (rollback pins)
  add column if not exists release_policy text not null default 'auto'
    check (release_policy in ('auto', 'pinned')),
  add column if not exists pinned_reason text check (char_length(pinned_reason) <= 300),
  add column if not exists live_release_id text references releases (id),
  add column if not exists live_since timestamptz,
  -- the live release's Kernel, readable as the store: token edits need a rebuild only below 1.10
  add column if not exists live_kernel_version text;

-- every store has its ops row from now on (the seed never created one)
insert into storefront_ops (tenant_id) select id from tenants on conflict do nothing;

-- Kernel 1.10 applies a store's tokens at runtime (the edge injects them) and this deploy's
-- publish rebuilds every bundle on it: the token rebuilds still queued are moot.
update outbox set published_at = now()
  where topic = 'storefront.rebuild_requested' and published_at is null
    and payload->>'reason' = 'tokens';

create table if not exists deployments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  release_id text not null references releases (id),
  previous_release_id text references releases (id),
  kind text not null check (kind in ('promote', 'rollback', 'auto', 'provision')),
  -- live = a probe saw the edge serve it; rolled_back = a later rollback moved off it
  status text not null default 'pending'
    check (status in ('pending', 'live', 'failed', 'rolled_back', 'superseded')),
  actor text not null check (char_length(actor) between 1 and 80),
  reason text check (char_length(reason) <= 300),
  detail text check (char_length(detail) <= 500),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists deployments_by_tenant on deployments (tenant_id, started_at desc);
create unique index if not exists deployments_one_pending on deployments (tenant_id)
  where status = 'pending';

create table if not exists fleet_probes (
  host text primary key references domains (host) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  status text not null default 'unknown' check (status in ('unknown', 'ok', 'failing')),
  failures int not null default 0,
  failing_since timestamptz,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  last_release_id text,
  latency_ms int,
  -- the probe's one cart: re-attached on every run, so probing never piles up carts
  checkout_token text check (char_length(checkout_token) <= 600),
  next_check_at timestamptz not null default now(),
  lease_until timestamptz
);
create index if not exists fleet_probes_due on fleet_probes (next_check_at);

create table if not exists health_checks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  host text not null check (char_length(host) <= 260),
  at timestamptz not null default now(),
  ok boolean not null,
  latency_ms int,
  release_id text,
  checks jsonb not null default '[]'
);
create index if not exists health_checks_by_tenant on health_checks (tenant_id, at desc);

create table if not exists fleet_incidents (
  id uuid primary key default gen_random_uuid(),
  -- null = the whole fleet
  tenant_id uuid references tenants (id) on delete cascade,
  kind text not null
    check (kind in ('probe_failing', 'deployment_failed', 'provisioning_stuck', 'fleet_degraded')),
  severity text not null default 'warning' check (severity in ('warning', 'critical')),
  -- what it is about: a host, a deployment id, a provisioning id, 'fleet'
  subject text not null check (char_length(subject) between 1 and 260),
  summary text not null check (char_length(summary) between 1 and 300),
  detail jsonb not null default '{}',
  opened_at timestamptz not null default now(),
  acked_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists fleet_incidents_open on fleet_incidents (kind, subject)
  where resolved_at is null;
create index if not exists fleet_incidents_recent on fleet_incidents (opened_at desc);

create table if not exists provisionings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants (id) on delete cascade,
  source text not null check (source in ('signup', 'invite')),
  lead_id uuid references leads (id) on delete set null,
  state text not null default 'release' check (state in ('release', 'verify', 'invite', 'live')),
  attempts int not null default 0,
  last_error text check (char_length(last_error) <= 300),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  -- [{ at, state, note }] — newest last, capped by the provisioner
  log jsonb not null default '[]',
  created_by text check (char_length(created_by) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  live_at timestamptz
);
create index if not exists provisionings_due on provisionings (next_attempt_at) where state <> 'live';

alter table leads add column if not exists tenant_id uuid references tenants (id) on delete set null;
create index if not exists leads_by_tenant on leads (tenant_id) where tenant_id is not null;

-- platform tables: staff only (the edge reads through Core, never the database)
do $$
declare
  t text;
begin
  foreach t in array array['releases', 'fleet_incidents', 'provisionings'] loop
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

do $$
declare
  t text;
begin
  foreach t in array array['deployments', 'fleet_probes', 'health_checks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
  -- the fleet loop and the CRM read and write across stores under vendua.control
  foreach t in array array['deployments', 'fleet_probes', 'health_checks', 'storefront_ops'] loop
    execute format('drop policy if exists control_access on %I', t);
    execute format(
      'create policy control_access on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
  end loop;
end
$$;
grant usage on all sequences in schema public to vendua_app;

-- provision_store() also opens the provisioning. A staff invite (vendua.control only) passes
-- its source, the lead it graduates and who asked; signup keeps calling the 7-argument form.
drop function if exists provision_store(text, text, text, text, text, text, text);
create or replace function provision_store(
  p_slug text, p_name text, p_plan text, p_host text,
  p_owner_name text, p_owner_phone text, p_owner_email text,
  p_source text default 'signup', p_lead uuid default null, p_actor text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  if (p_source <> 'signup' or p_lead is not null or p_actor is not null)
     and current_setting('vendua.control', true) is distinct from '1' then
    raise exception 'control only' using errcode = '42501';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'invalid slug' using errcode = '22023';
  end if;
  if not exists (select 1 from plans where id = p_plan) then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  insert into tenants (slug, name, plan) values (p_slug, p_name, p_plan) returning id into v_tenant;
  insert into domains (host, tenant_id, is_primary) values (lower(p_host), v_tenant, true);
  perform set_config('vendua.tenant_id', v_tenant::text, true);
  insert into store_settings (tenant_id, hours, pickup_enabled, delivery_enabled, status_override,
                              pause_message, billing_hold, email)
  values (v_tenant, '{"timezone": "America/Sao_Paulo", "windows": []}', false, false, 'paused',
          'A loja abre em breve.', true, p_owner_email);
  insert into merchant_users (tenant_id, name, phone, email, role)
  values (v_tenant, p_owner_name, p_owner_phone, p_owner_email, 'owner');
  insert into storefront_ops (tenant_id, ring) values (v_tenant, 'stable') on conflict do nothing;
  insert into provisionings (tenant_id, source, lead_id, created_by, log)
  values (v_tenant, p_source, p_lead, p_actor,
          jsonb_build_array(jsonb_build_object('at', now(), 'state', 'release',
            'note', 'loja criada em ' || lower(p_host))));
  if p_lead is not null then
    update leads set tenant_id = v_tenant, updated_at = now() where id = p_lead;
  end if;
  return v_tenant;
end
$$;
revoke all on function provision_store(text, text, text, text, text, text, text, text, uuid, text)
  from public;
grant execute on function provision_store(text, text, text, text, text, text, text, text, uuid, text)
  to vendua_app;
