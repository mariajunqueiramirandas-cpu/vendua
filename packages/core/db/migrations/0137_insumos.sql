-- 0137_insumos.sql — insumos, fichas técnicas and CMV (ADR 0046, modules/insumos.ts).
--   ingredients            — an insumo (bought: cheese, boxes) or a preparo (made here from other
--                            ingredients: a sauce, a dough). Quantities are thousandths of the unit
--                            (g, ml, un); cost_per_k_cents is the average cost of 1000 units (a kg,
--                            a litre, a thousand units). stock_milli null = not counted, and may go
--                            below zero: a sale is never refused for an insumo.
--   recipe_lines           — a ficha's line: what a product, an option, a preparo or every order
--                            (per_order: bags, napkins) uses of an ingredient; mode limits a line
--                            to delivery, pickup or dine_in orders (packaging per channel)
--   ingredient_movements   — every change to a counted ingredient's stock, and every purchase
--   orders.ingredients_drawn — {ingredientId: milli} an order took, for a cancel
--   orders.cost_cents, order_items.cost_cents — what the sale cost at the time (the CMV); null =
--                            no ficha and no stated cost
-- Additive only: a Core from before this one never reads these.

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  kind text not null default 'insumo' check (kind in ('insumo', 'preparo')),
  name text not null check (char_length(name) between 1 and 80),
  unit text not null check (unit in ('g', 'ml', 'un')),
  stock_milli bigint check (stock_milli between -1000000000000 and 1000000000000),
  low_milli bigint check (low_milli between 1 and 1000000000000),
  par_milli bigint check (par_milli between 1 and 1000000000000),
  cost_per_k_cents bigint check (cost_per_k_cents between 0 and 1000000000),
  yield_milli bigint check (yield_milli between 1 and 1000000000),
  pack_milli bigint check (pack_milli between 1 and 1000000000),
  pack_name text check (char_length(pack_name) between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'preparo') = (yield_milli is not null)),
  check (kind = 'insumo' or cost_per_k_cents is null)
);
create unique index if not exists ingredients_name
  on ingredients (tenant_id, vendua_stock_key(name));

create table if not exists recipe_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid references products (id) on delete cascade,
  modifier_id uuid references modifiers (id) on delete cascade,
  preparo_id uuid references ingredients (id) on delete cascade,
  per_order boolean not null default false,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  qty_milli bigint not null check (qty_milli between 1 and 1000000000),
  mode text check (mode in ('delivery', 'pickup', 'dine_in')),
  sort integer not null default 0,
  check (num_nonnulls(product_id, modifier_id, preparo_id) + per_order::int = 1),
  check (preparo_id is null or mode is null),
  check (preparo_id is distinct from ingredient_id)
);
create index if not exists recipe_lines_by_product
  on recipe_lines (tenant_id, product_id) where product_id is not null;
create index if not exists recipe_lines_by_modifier
  on recipe_lines (tenant_id, modifier_id) where modifier_id is not null;
create index if not exists recipe_lines_by_preparo
  on recipe_lines (tenant_id, preparo_id) where preparo_id is not null;
create index if not exists recipe_lines_per_order on recipe_lines (tenant_id) where per_order;
create index if not exists recipe_lines_by_ingredient on recipe_lines (tenant_id, ingredient_id);

create table if not exists ingredient_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete cascade,
  reason text not null check (reason in ('sale', 'cancel', 'purchase', 'count', 'adjust', 'loss',
                                         'made', 'used', 'start', 'stop')),
  delta_milli bigint not null,
  after_milli bigint,
  -- a purchase: what was paid; otherwise the movement's value at the average cost then
  cost_cents integer check (cost_cents between -2000000000 and 2000000000),
  -- no FK: a sale's row is written before its order row, in the same transaction
  order_id uuid,
  actor_label text check (char_length(actor_label) <= 120),
  note text check (char_length(note) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists ingredient_movements_by_ingredient
  on ingredient_movements (tenant_id, ingredient_id, created_at desc);
create index if not exists ingredient_movements_by_time
  on ingredient_movements (tenant_id, created_at);

alter table orders
  add column if not exists ingredients_drawn jsonb,
  add column if not exists cost_cents integer;
alter table order_items add column if not exists cost_cents integer;

do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipe_lines', 'ingredient_movements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)$p$, t);
    execute format('drop policy if exists control_access on %I', t);
    execute format($p$create policy control_access on %I for all
      using (current_setting('vendua.control', true) = '1')
      with check (current_setting('vendua.control', true) = '1')$p$, t);
    execute format('grant select, insert, update, delete on %I to vendua_app', t);
  end loop;
end $$;
