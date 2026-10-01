-- Menu import ("cole o link do seu cardápio", docs/menu-import.md §4.4).
--
--   menu_imports        — one paste: reading → ready → applying → applied (or failed / expired).
--                         `doc` is the validated import document (never the platform's raw
--                         payload); it is cleared when a ready import expires.
--   menu_import_images  — photo, logo and cover downloads queued by apply; each lands as a
--                         media_objects row and is pointed at by the product / store.
--
-- The import job claims rows across stores under vendua.control (like the fleet loop) and does
-- each piece of work under the row's tenant.

create table if not exists menu_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  created_by uuid references merchant_users (id) on delete set null,
  platform text not null check (char_length(platform) <= 30),
  source_url text not null check (char_length(source_url) <= 500),
  source_ref text not null check (char_length(source_ref) <= 200),
  status text not null default 'reading'
    check (status in ('reading', 'ready', 'failed', 'applying', 'applied', 'expired')),
  error_code text check (error_code in ('NOT_FOUND', 'BLOCKED', 'UNREADABLE', 'TOO_LARGE', 'TIMEOUT')),
  doc jsonb check (doc is null or octet_length(doc::text) <= 2 * 1024 * 1024),
  counts jsonb,
  mode text check (mode in ('add', 'replace')),
  sections jsonb,
  -- what apply wrote: categories created/reused, products, archived, images queued
  result jsonb,
  images_total int not null default 0 check (images_total >= 0),
  images_done int not null default 0 check (images_done >= 0),
  attempts int not null default 0,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  applied_at timestamptz,
  finished_at timestamptz
);
create index if not exists menu_imports_by_tenant on menu_imports (tenant_id, created_at desc);
create index if not exists menu_imports_reading on menu_imports (created_at) where status = 'reading';
create index if not exists menu_imports_ready on menu_imports (read_at) where status = 'ready';

create table if not exists menu_import_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  import_id uuid not null references menu_imports (id) on delete cascade,
  -- product photo (product_id + sort), option picture, store logo or home cover
  kind text not null check (kind in ('product', 'option', 'logo', 'cover')),
  product_id uuid references products (id) on delete cascade,
  modifier_id uuid references modifiers (id) on delete cascade,
  sort int not null default 0,
  subject text check (char_length(subject) <= 200),
  source_url text not null check (char_length(source_url) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  lease_until timestamptz,
  media_id uuid references media_objects (id) on delete set null,
  error text check (char_length(error) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists menu_import_images_pending on menu_import_images (created_at)
  where status = 'pending';
create index if not exists menu_import_images_by_import on menu_import_images (import_id);

do $$
declare
  t text;
begin
  foreach t in array array['menu_imports', 'menu_import_images'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I
         using (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)
         with check (tenant_id = nullif(current_setting(''vendua.tenant_id'', true), '''')::uuid)',
      t
    );
    -- the import job claims work across stores, then does it under the row's tenant
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
