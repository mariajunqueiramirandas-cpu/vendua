-- 0152_lead_auto_reply.sql — a lead's machine answering our outreach (WhatsApp Business greeting or
-- away message, a chatbot menu) is context, not a reply: it wakes no turn, retires no follow-up and
-- resets no unanswered-touch count (crm/auto-reply.ts). Additive (ADR 0041): an older Core leaves it
-- false and treats the message as before. Re-runnable.
alter table lead_messages add column if not exists auto_reply boolean not null default false;
