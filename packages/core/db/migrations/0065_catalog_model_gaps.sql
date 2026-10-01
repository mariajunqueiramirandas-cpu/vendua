-- Catalog model gaps (menu import): promo price, option quantity, per-group pricing rule,
-- category description, option description and photo.

-- display-only strike-through; base_price_cents stays the selling price
alter table products
  add column if not exists compare_at_price_cents integer
    check (compare_at_price_cents is null
           or (compare_at_price_cents > base_price_cents and compare_at_price_cents <= 10000000));

-- 1 = a toggle (one unit), as before
alter table modifiers
  add column if not exists max_qty integer not null default 1 check (max_qty between 1 and 20),
  add column if not exists description text check (char_length(description) <= 200),
  add column if not exists image_url text check (char_length(image_url) <= 1000);

alter table modifier_groups
  add column if not exists pricing_rule text not null default 'sum'
    check (pricing_rule in ('sum', 'average', 'most_expensive'));

alter table categories
  add column if not exists description text check (char_length(description) <= 500);

-- { "<modifierId>": qty } for options taken more than once; modifier_ids stays the distinct list
alter table cart_items
  add column if not exists modifier_qty jsonb not null default '{}'::jsonb;

-- the same options at different quantities are different lines
drop index if exists cart_items_line_unique;
create unique index if not exists cart_items_line_unique
  on cart_items (cart_id, product_id, modifier_ids, modifier_qty, combo_selections);
