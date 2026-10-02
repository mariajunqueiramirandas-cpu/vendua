-- 0074_store_onboarding.sql — what a store sells and where its setup stands (signup → onboarding)
--   store_settings.segment — what the store sells (the admin's list: doces, pizzaria, …); null = not told
--   store_settings.onboarding — the Bem-vindo wizard's place, so it resumes on any device:
--     { from?: 'signup', step?, skipped?: [], finishedAt?, dismissedAt? }

alter table store_settings add column if not exists segment text
  check (segment is null or segment ~ '^[a-z_]{2,24}$');
alter table store_settings add column if not exists onboarding jsonb not null default '{}'::jsonb;
