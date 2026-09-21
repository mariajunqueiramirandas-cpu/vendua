-- lead_messages.is_farewell — the opt-out goodbye. unsubscribe() composes the
-- farewell and stamps unsubscribed_at inside the same send-lock claim, then
-- dispatches it through the one path that survives the suppression re-check.
-- Every other outbound still dies on unsubscribed_at.
alter table lead_messages add column if not exists is_farewell boolean not null default false;
