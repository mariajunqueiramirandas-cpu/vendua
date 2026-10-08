-- 0111_notify_store_caps.sql — "avise-me quando abrir" takes any number, and the store's own
-- WhatsApp messages every one of them: new store subscriptions are capped per store and per
-- client network a day.
--   notify_requests.ip_hash — sha256 of the client's network (an IPv6 /64) that subscribed;
--     null for subscriptions made in-process (the Vendedor) and before this column
alter table notify_requests add column if not exists ip_hash text;
create index if not exists notify_requests_store_by_day
  on notify_requests (tenant_id, created_at) where subject = 'store';
