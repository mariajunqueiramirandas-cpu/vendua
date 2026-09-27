-- Phase 1b (roadmap): the data that makes storefronts updatable without code.
--   storefront_templates — page composition, versioned (docs/architecture/17)
--   storefront_tokens    — design tokens as store data, versioned; an edit queues a rebuild
--   storefront_ops       — release ring + v.js kill switch per tenant
--   storefront_builds    — artifact manifests the train records (kernel version per store)
--   template_migration_runs — per-store outcome of each applied template migration
--   notify_requests      — "avise-me" subscriptions (NotifyMeButton)
--   analytics_events     — the Kernel beacon's funnel events (docs/architecture/15)

create table if not exists storefront_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  page text not null,
  version int not null check (version > 0),
  template jsonb not null,
  -- 'seed' | 'staff' | 'merchant' | 'migration:<id>' | 'rollback:<version>'
  source text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, page, version)
);

create table if not exists storefront_tokens (
  tenant_id uuid not null references tenants (id) on delete cascade,
  version int not null check (version > 0),
  tokens jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, version)
);

create table if not exists storefront_ops (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  ring text not null default 'stable' check (ring in ('canary', 'early', 'stable')),
  loader_state text not null default 'normal' check (loader_state in ('normal', 'maintenance')),
  loader_title text,
  loader_message text,
  loader_href text,
  updated_at timestamptz not null default now()
);

create table if not exists storefront_builds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  kernel_version text not null,
  contract int not null,
  manifest jsonb not null,
  recorded_at timestamptz not null default now()
);
create index if not exists storefront_builds_latest on storefront_builds (tenant_id, recorded_at desc);

create table if not exists template_migration_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  migration_id text not null,
  page text not null,
  status text not null check (status in ('applied', 'skipped', 'conflict', 'rolled_back')),
  reason text,
  from_version int,
  to_version int,
  created_at timestamptz not null default now()
);
create index if not exists template_migration_runs_by_id on template_migration_runs (migration_id, tenant_id);

create table if not exists notify_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  subject text not null check (subject in ('store', 'product')),
  product_id uuid references products (id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  contact text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  check ((subject = 'product') = (product_id is not null))
);
-- one pending subscription per contact+subject (a null product_id must dedupe too)
create unique index if not exists notify_requests_pending
  on notify_requests (tenant_id, subject, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), contact)
  where notified_at is null;

create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  at timestamptz not null,
  session_id text not null,
  props jsonb not null default '{}',
  received_at timestamptz not null default now()
);
create index if not exists analytics_events_tenant_at on analytics_events (tenant_id, at desc);

-- new notice kind (high_demand) is driven by this merchant-side switch
alter table store_settings add column if not exists demand_level text not null default 'normal'
  check (demand_level in ('normal', 'high'));

do $$
declare
  t text;
  tenant_tables text[] := array[
    'storefront_templates', 'storefront_tokens', 'storefront_ops', 'storefront_builds',
    'template_migration_runs', 'notify_requests', 'analytics_events'
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
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;
