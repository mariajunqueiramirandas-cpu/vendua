-- 0156_lead_closes_conversation.sql — where a conversation ended. On our side, the sales agent's
-- goodbye (send_message closing): no cadence follow-up is booked after it. On the lead's side, a
-- last word the agent judged needs no answer (end_conversation: "obrigada, pra vocês também ❤️"):
-- the inbox stops asking for a reply. Additive (ADR 0041): an older Core leaves it false.
-- Re-runnable.
alter table lead_messages add column if not exists closes_conversation boolean not null default false;
