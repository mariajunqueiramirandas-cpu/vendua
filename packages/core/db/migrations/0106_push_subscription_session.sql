-- 0106_push_subscription_session.sql — a device's push goes with the session that turned it on.
--   push_subscriptions.session_id — the merchant session that subscribed this endpoint; revoking
--                                   that session (sair, "encerrar sessão") deletes the endpoint, so a
--                                   signed-out device stops getting the store's orders. Null on rows
--                                   from before it existed.
-- Additive only. Re-runnable.

alter table push_subscriptions
  add column if not exists session_id uuid references merchant_sessions (id) on delete cascade;
create index if not exists push_subscriptions_by_session on push_subscriptions (session_id)
  where session_id is not null;
