-- 0124_status_do_dia.sql — Status do dia S0 + S1 (docs/features/status-do-dia.md): a `ref` code
-- from a link carried to the order, and the store's daily Status, prepared by Core and posted by
-- the owner from their phone (share sheet). Nothing here goes over the store's WhatsApp transport.
--   orders.ref     — the link the shopper came from (a Status post, the bag card), or null
--   status_plans   — the store's daily Status: on, the hour, the weekdays, picks, caption
--   status_posts   — one prepared Status a day: its products, its ref code, shared or skipped

alter table orders add column if not exists ref text check (ref ~ '^[a-z0-9]{6,12}$');
create index if not exists orders_by_ref on orders (tenant_id, ref) where ref is not null;

create table if not exists status_plans (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  enabled boolean not null default false,
  post_at time not null default '10:30',
  -- 0 = Sunday, as store hours
  days int[] not null default '{0,1,2,3,4,5,6}' check (days <@ '{0,1,2,3,4,5,6}'::int[]),
  -- 'auto': Core picks from today's sales; 'pinned': these products, in this order
  mode text not null default 'auto' check (mode in ('auto', 'pinned')),
  picks uuid[] not null default '{}' check (cardinality(picks) <= 3),
  caption text check (char_length(caption) <= 300),
  updated_at timestamptz not null default now()
);
alter table status_plans enable row level security;
drop policy if exists tenant_isolation on status_plans;
create policy tenant_isolation on status_plans
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on status_plans to vendua_app;

create table if not exists status_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  day date not null,
  product_ids uuid[] not null check (cardinality(product_ids) between 1 and 3),
  ref_code text not null unique check (ref_code ~ '^[a-z0-9]{6,12}$'),
  caption text not null check (char_length(caption) <= 400),
  state text not null default 'ready' check (state in ('ready', 'shared', 'skipped')),
  created_at timestamptz not null default now(),
  shared_at timestamptz,
  unique (tenant_id, day)
);
alter table status_posts enable row level security;
drop policy if exists tenant_isolation on status_posts;
create policy tenant_isolation on status_posts
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
grant select, insert, update, delete on status_posts to vendua_app;
