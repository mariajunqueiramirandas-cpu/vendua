-- 0004_idempotency_lease.sql — idempotency claims carry an owner token so a
-- stale-claim steal can't let two handlers commit the same mutation.
alter table idempotency_keys add column if not exists owner uuid;
create index if not exists idempotency_keys_created_idx on idempotency_keys (created_at);
