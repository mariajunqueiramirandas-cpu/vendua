-- 0149_telegram_voice_replies.sql — the manager on Telegram answers a voice note with one (ADR
-- 0048): `speak` holds what the voice note says until it's sent (then null, so a retried text
-- never sends it twice). Additive (ADR 0041): an older Core ignores it and sends the text alone.
-- Re-runnable.
alter table telegram_dm_outbox add column if not exists speak text
  check (speak is null or char_length(speak) between 1 and 2000);
