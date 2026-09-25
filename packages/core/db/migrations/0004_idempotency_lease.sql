-- 0004 — idempotency claims carry an owner token so a stale-claim steal can't double-commit
alter table idempotency_keys add column if not exists owner uuid;
create index if not exists idempotency_keys_created_idx on idempotency_keys (created_at);
