-- 0103_site_builder.sql — the "site sob medida" builder: Duá writes a DesignSpec from the owner's
-- brief, Core fires a coding routine that opens a PR, GitHub's webhooks drive the task, staff
-- approve the green PR, the merged storefront's design lands as store data.
--   site_requests.spec…     — the current DesignSpec, its version, the one included revision
--   site_tasks              — one build of a request (generate or revision); one live per request
--   site_task_events        — the CRM timeline of a task
--   github_deliveries       — webhook deliveries already handled (platform, pruned after 30 days)
--   copilot_actions.kind    — Duá's two site cards
-- Additive only. Re-runnable.

alter table site_requests
  add column if not exists spec jsonb check (spec is null or octet_length(spec::text) <= 16000),
  add column if not exists spec_version int not null default 0,
  add column if not exists revisions_used int not null default 0
    check (revisions_used between 0 and 1),
  add column if not exists delivered_at timestamptz;

create table if not exists site_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  site_request_id uuid not null references site_requests (id) on delete cascade,
  kind text not null check (kind in ('generate', 'revision')),
  -- who caused it (owner, copilot, staff): requestSiteTaskTx is the only insert
  source text not null check (source ~ '^[a-z_]{1,20}$'),
  spec jsonb not null check (octet_length(spec::text) <= 16000),
  note text check (char_length(note) <= 1000),
  runner text not null default 'claude_routine' check (runner in ('claude_routine', 'human')),
  status text not null default 'queued' check (status in ('queued', 'firing', 'running',
    'pr_open', 'approved', 'merged', 'delivered', 'escalated', 'cancelled')),
  attempt int not null default 1 check (attempt between 1 and 1000),
  branch text not null check (char_length(branch) between 1 and 120),
  session_id text check (char_length(session_id) <= 200),
  session_url text check (char_length(session_url) <= 500),
  pr_number int,
  pr_url text check (char_length(pr_url) <= 500),
  head_sha text check (char_length(head_sha) <= 64),
  ci text check (ci in ('pending', 'success', 'failure')),
  -- failed CI runs on distinct head shas
  iterations int not null default 0,
  merge_sha text check (char_length(merge_sha) <= 64),
  merged_at timestamptz,
  -- templates + tokens read from GitHub at the merge sha
  design jsonb check (design is null or octet_length(design::text) <= 600000),
  design_applied_at timestamptz,
  due_at timestamptz not null,
  due_soon_at timestamptz,
  overdue_at timestamptz,
  escalated_reason text check (char_length(escalated_reason) <= 300),
  approved_at timestamptz,
  approved_by text check (char_length(approved_by) <= 80),
  fired_at timestamptz,
  delivered_at timestamptz,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  attempts int not null default 0,
  last_error text check (char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists site_tasks_one_live on site_tasks (site_request_id)
  where status not in ('delivered', 'cancelled');
create index if not exists site_tasks_by_tenant on site_tasks (tenant_id, created_at desc);
create index if not exists site_tasks_open on site_tasks (due_at)
  where status not in ('delivered', 'cancelled');
create index if not exists site_tasks_by_branch on site_tasks (branch)
  where status in ('running', 'pr_open', 'approved');

create table if not exists site_task_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  task_id uuid not null references site_tasks (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (char_length(kind) between 1 and 40),
  detail jsonb not null default '{}' check (octet_length(detail::text) <= 4096)
);
create index if not exists site_task_events_by_task on site_task_events (task_id, id);
create index if not exists site_task_events_by_tenant on site_task_events (tenant_id);

do $$
declare
  t text;
begin
  foreach t in array array['site_tasks', 'site_task_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    execute format('drop policy if exists control_access on %I', t);
    execute format(
      'create policy control_access on %I for all
         using (current_setting(''vendua.control'', true) = ''1'')
         with check (current_setting(''vendua.control'', true) = ''1'')',
      t
    );
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end
$$;

-- platform: staff only, like releases
create table if not exists github_deliveries (
  delivery_id text primary key check (char_length(delivery_id) between 1 and 100),
  event text not null check (char_length(event) <= 60),
  received_at timestamptz not null default now()
);
create index if not exists github_deliveries_age on github_deliveries (received_at);
alter table github_deliveries enable row level security;
drop policy if exists staff_all on github_deliveries;
create policy staff_all on github_deliveries for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on github_deliveries to vendua_app;

alter table copilot_actions drop constraint if exists copilot_actions_kind_check;
alter table copilot_actions add constraint copilot_actions_kind_check
  check (kind in ('store.pause', 'store.resume', 'store.operations', 'store.special_day',
    'product.update', 'products.price', 'coupon.create', 'coupon.update', 'site.build',
    'site.revise'));
