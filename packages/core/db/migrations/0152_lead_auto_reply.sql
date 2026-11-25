-- 0152_lead_auto_reply.sql — a lead's machine answering our outreach (WhatsApp Business greeting or
-- away message, a chatbot menu) is context, not a reply. The sales agent judges it and marks it
-- (mark_auto_reply): from then on it resets no unanswered-touch count, supersedes no send and
-- needs no reply in the inbox. Additive (ADR 0041): an older Core leaves it false. Re-runnable.
alter table lead_messages add column if not exists auto_reply boolean not null default false;
