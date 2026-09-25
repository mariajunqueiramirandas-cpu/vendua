-- unique orders.cart_id + cart_items qty range check (PR-review hardening).

-- Backstop for the checkout FOR UPDATE lock — no path may skip it.
create unique index if not exists orders_cart_unique on orders (cart_id);

-- Atomic 99-per-line cap so on-conflict increments can't bypass it (23514 → INVALID_QTY).
alter table cart_items drop constraint if exists cart_items_qty_check;
alter table cart_items add constraint cart_items_qty_range check (qty > 0 and qty <= 99);
