-- 0003_review_hardening.sql — invariants the PR-review findings need at the
-- database layer.

-- One order per cart, period. The checkout tx locks the cart row FOR UPDATE
-- before validating, but the index is the last line of defense if a path ever
-- skips the lock.
create unique index if not exists orders_cart_unique on orders (cart_id);

-- Line quantity cap enforced atomically — on-conflict increments can't bypass
-- the 99-per-line maximum the PATCH endpoint advertises. Violations surface
-- as INVALID_QTY (23514 check_violation).
alter table cart_items drop constraint if exists cart_items_qty_check;
alter table cart_items add constraint cart_items_qty_range check (qty > 0 and qty <= 99);
