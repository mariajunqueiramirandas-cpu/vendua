-- Lead-wide agent pause: request_human on an unbound run (no "this thread")
-- hands the whole lead to a human, and staff resume it from the lead card.
-- Explicit marker — inferring 'all threads paused' can't tell a lead-wide
-- handoff apart from an ordinary single-thread pause.
alter table leads add column if not exists agent_paused_at timestamptz;
