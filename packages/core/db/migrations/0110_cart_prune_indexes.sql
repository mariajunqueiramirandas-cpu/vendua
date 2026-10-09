-- 0110_cart_prune_indexes.sql — the columns that point at a cart, indexed, so the retention sweep
-- (admin/workers.ts) can delete carts that never held a line: each deleted cart's foreign-key
-- check (and its `on delete set null`) would otherwise scan the whole table.
--   shopper_threads.cart_id, cart_shares.source_cart_id, store_wa_messages.cart_id

create index if not exists shopper_threads_by_cart on shopper_threads (cart_id)
  where cart_id is not null;
create index if not exists cart_shares_by_source_cart on cart_shares (source_cart_id)
  where source_cart_id is not null;
create index if not exists store_wa_messages_by_cart on store_wa_messages (cart_id)
  where cart_id is not null;
