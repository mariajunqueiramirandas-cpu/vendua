-- 0079_kitchen.sql — the kitchen display ("Cozinha" in the admin). Orders move through the
-- usual transitions; the kitchen only adds what it alone knows:
--   store_settings.kitchen — { "stations": [{ "id": uuid, "name": text, "categoryIds": uuid[] }] },
--     which categories each station cooks; Core validates it (admin PUT /kitchen/stations)
--   kitchen_marks   — one row per order line the kitchen has made (unmarking deletes it)
--   kitchen_tickets — per-order kitchen flags (rush)

alter table store_settings
  add column if not exists kitchen jsonb not null default '{}'::jsonb
    check (jsonb_typeof(kitchen) = 'object');

create table if not exists kitchen_marks (
  order_item_id uuid primary key references order_items (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  done_at timestamptz not null default now(),
  done_by uuid references merchant_users (id) on delete set null
);
create index if not exists kitchen_marks_by_order on kitchen_marks (tenant_id, order_id);

create table if not exists kitchen_tickets (
  order_id uuid primary key references orders (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  rush boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists kitchen_tickets_by_tenant on kitchen_tickets (tenant_id);

do $$
declare
  t text;
begin
  foreach t in array array['kitchen_marks', 'kitchen_tickets']
  loop
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
