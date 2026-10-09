-- 0104_orders_stock_drawn.sql — what an order took from stock, so a cancel gives back exactly that.
--   orders.stock_drawn — {productId: units} drawn at checkout or the PDV (tracked products only);
--                        null on orders placed before it existed (restoreStock reads their lines)
-- Additive only. Re-runnable.

alter table orders add column if not exists stock_drawn jsonb;
