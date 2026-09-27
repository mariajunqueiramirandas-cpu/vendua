-- Phase 2 (roadmap): Core expresses everything the Quero Pudim reference needs.
--   2a order lifecycle — order_items, notes, structured address (jsonb), phone index, schedule
--   2b catalog depth   — product_media, stock, combos (combo_slots/_items), preorder
--   2c growth          — coupons (+ redemptions), loyalty program, cart_shares, pix, distance zones

-- ── 2a ──────────────────────────────────────────────────────────────────────

alter table orders
  add column if not exists notes text check (char_length(notes) <= 500),
  add column if not exists scheduled_for date,
  add column if not exists discount_cents int not null default 0 check (discount_cents >= 0),
  add column if not exists coupon_code text,
  -- digits only; the orders-by-phone read and loyalty stamps key on it
  add column if not exists customer_phone text,
  add column if not exists updated_at timestamptz not null default now();

-- national number: a leading 55 country code collapses onto the bare DDD+number form
update orders set customer_phone = regexp_replace(
  regexp_replace(customer ->> 'phone', '\D', '', 'g'), '^55(\d{10,11})$', '\1')
where customer_phone is null;
create index if not exists orders_by_phone on orders (tenant_id, customer_phone, placed_at desc);

-- the purchased lines, frozen at checkout (names/prices never follow catalog edits)
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  -- set null: a product deleted later must not erase order history
  product_id uuid references products (id) on delete set null,
  slug text not null,
  name text not null,
  qty int not null check (qty > 0 and qty <= 99),
  unit_price_cents int not null check (unit_price_cents >= 0),
  modifiers jsonb not null default '[]',
  combo jsonb not null default '[]',
  line_total_cents int not null check (line_total_cents >= 0),
  sort int not null default 0
);
create index if not exists order_items_by_order on order_items (order_id, sort);

-- ── 2b ──────────────────────────────────────────────────────────────────────

create table if not exists product_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  url text not null check (char_length(url) <= 1000 and (url like 'https://%' or url like '/%')),
  alt text check (char_length(alt) <= 200),
  width int check (width > 0),
  height int check (height > 0),
  sort int not null default 0
);
create index if not exists product_media_by_product on product_media (product_id, sort);

alter table products
  -- null = not tracked (made to order); 0 = sold out by stock
  add column if not exists stock_quantity int check (stock_quantity >= 0),
  add column if not exists low_stock_threshold int check (low_stock_threshold >= 0),
  add column if not exists kind text not null default 'simple' check (kind in ('simple', 'combo')),
  add column if not exists requires_preorder boolean not null default false,
  add column if not exists preorder_lead_days int not null default 0
    check (preorder_lead_days between 0 and 60);

create table if not exists combo_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  name text not null,
  min_select int not null default 1 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1),
  -- how many of the same item one slot may take ("até 2 de cada")
  qty_per_item int not null default 1 check (qty_per_item >= 1),
  sort int not null default 0,
  check (min_select <= max_select)
);
create index if not exists combo_slots_by_product on combo_slots (product_id, sort);

create table if not exists combo_slot_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  slot_id uuid not null references combo_slots (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  price_delta_cents int not null default 0,
  sort int not null default 0,
  unique (slot_id, product_id)
);

alter table cart_items
  add column if not exists combo_selections jsonb not null default '[]',
  add column if not exists combo_snapshot jsonb not null default '[]';
-- same product + modifiers but a different kit composition is a different line
alter table cart_items drop constraint if exists cart_items_cart_id_product_id_modifier_ids_key;
create unique index if not exists cart_items_line_unique
  on cart_items (cart_id, product_id, modifier_ids, combo_selections);

alter table store_settings
  add column if not exists preorder_payment_methods jsonb not null default '["pix"]',
  add column if not exists preorder_max_days int not null default 30
    check (preorder_max_days between 1 and 120);

-- ── 2c ──────────────────────────────────────────────────────────────────────

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind text not null check (kind in ('percent', 'fixed', 'free_delivery')),
  -- percent: 1..100; fixed: cents; free_delivery: ignored
  value int not null default 0 check (value >= 0),
  label text check (char_length(label) <= 120),
  min_subtotal_cents int not null default 0 check (min_subtotal_cents >= 0),
  max_discount_cents int check (max_discount_cents > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions int check (max_redemptions > 0),
  per_phone_limit int check (per_phone_limit > 0),
  first_order_only boolean not null default false,
  -- bound to one customer (loyalty rewards); null = anyone
  phone text,
  source text not null default 'staff' check (source in ('staff', 'merchant', 'loyalty')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  check (kind <> 'percent' or value between 1 and 100)
);

create table if not exists coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  coupon_id uuid not null references coupons (id) on delete cascade,
  order_id uuid not null unique references orders (id) on delete cascade,
  phone text not null,
  discount_cents int not null check (discount_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists coupon_redemptions_by_coupon on coupon_redemptions (coupon_id, phone);

alter table carts add column if not exists coupon_code text;

-- { stampsRequired, minOrderCents, reward: { kind, value, label }, rewardValidDays } — null = no program
alter table store_settings add column if not exists loyalty jsonb;

create table if not exists cart_shares (
  tenant_id uuid not null references tenants (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9]{6,16}$'),
  items jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, code)
);

alter table store_settings
  add column if not exists pix_key text check (char_length(pix_key) <= 77),
  add column if not exists pix_key_type text
    check (pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random')),
  add column if not exists pix_beneficiary text check (char_length(pix_beneficiary) <= 25),
  add column if not exists pix_city text check (char_length(pix_city) <= 15),
  add column if not exists latitude double precision check (latitude between -90 and 90),
  add column if not exists longitude double precision check (longitude between -180 and 180);

alter table delivery_zones
  -- kind='radius': serves addresses within max_distance_km of the store
  add column if not exists max_distance_km numeric(6, 2) check (max_distance_km > 0),
  add column if not exists fee_per_km_cents int not null default 0 check (fee_per_km_cents >= 0),
  add column if not exists free_delivery_over_cents int check (free_delivery_over_cents > 0);

do $$
declare
  t text;
  tenant_tables text[] := array[
    'order_items', 'product_media', 'combo_slots', 'combo_slot_items',
    'coupons', 'coupon_redemptions', 'cart_shares'
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
