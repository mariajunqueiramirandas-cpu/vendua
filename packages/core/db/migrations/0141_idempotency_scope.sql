-- 0141_idempotency_scope.sql — control_idempotency_keys.scope: the staff route (method and
-- path, hashed) that claimed a key. The same key on another route or target is 422, where it
-- replayed that one's result and never ran. The key stays bare, as the previous Core claims and
-- reads it (ADR 0041: both run on this schema during a deploy, and either may take a retry of a
-- request the other one claimed). Additive: the previous Core neither writes nor reads the
-- column, and a null scope (its rows, a job's) replays as before.

alter table control_idempotency_keys
  add column if not exists scope text check (scope ~ '^[0-9a-f]{32}$');
