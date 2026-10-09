-- 0095_item_notes.sql — a note on one line of the order ("sem cebola"), typed by the shopper (or
-- the Vendedor) and carried from the bag to the order, the kitchen and the ticket.

-- '' = no note: the line's identity includes it, and a unique index treats NULLs as distinct
alter table cart_items
  add column if not exists note text not null default ''
    check (char_length(note) <= 140);

alter table order_items
  add column if not exists note text check (char_length(note) <= 140);

-- the same product and options with a different note is another line; the same note merges
drop index if exists cart_items_line_unique;
create unique index if not exists cart_items_line_unique
  on cart_items (cart_id, product_id, modifier_ids, modifier_qty, combo_selections, note);
