-- Indexes for lookups that scanned whole tables shared by every store. Plain, not concurrent:
-- migrations run in one transaction, so each build briefly holds writes on its table.

-- the shopper's order page polls its version every few seconds; the admin home lists the day
create index if not exists order_events_by_order on order_events (order_id, at, id);
create index if not exists order_events_by_tenant_at on order_events (tenant_id, at desc);

-- every catalog row asks whether its product has choices; the product page loads them
create index if not exists modifier_groups_by_product on modifier_groups (product_id, sort);
create index if not exists modifiers_by_group on modifiers (group_id, sort);

-- the payment reconcile loop looks for pending refunds per payment
create index if not exists payment_refunds_by_payment on payment_refunds (payment_id);

-- the orders board and the unaccepted-order sweep filter by state; placed_at alone walks history
create index if not exists orders_by_tenant_state on orders (tenant_id, state, placed_at);

-- the live "sacolas abertas" count skips abandoned carts
create index if not exists carts_open_recent on carts (tenant_id, updated_at) where status = 'open';

-- the minute sweep checks each fresh order for a delivered push
create index if not exists push_attempts_by_ref on push_attempts (tenant_id, ref)
  where event = 'order.placed';

-- product sales history, and the FK checks when a product is deleted
create index if not exists order_items_by_product on order_items (product_id);
create index if not exists cart_items_by_product on cart_items (product_id);

-- the storefront rebuild queue reads only unpublished rows
create index if not exists outbox_unpublished on outbox (tenant_id, topic, id)
  where published_at is null;

-- a lead's tasks, and the cascade when a lead is deleted
create index if not exists lead_tasks_by_lead on lead_tasks (lead_id);
