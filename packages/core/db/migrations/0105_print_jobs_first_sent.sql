-- 0105_print_jobs_first_sent.sql — when a job first reached an agent.
--   print_jobs.first_sent_at — set on the first hand-over, kept on resends; a job is given up
--                              by its age since then, not by how often it was resent (an agent
--                              may hold it behind a slow printer). Null on jobs never sent, and
--                              on jobs sent before it existed (sent_at stands in).
-- Additive only. Re-runnable.

alter table print_jobs add column if not exists first_sent_at timestamptz;
