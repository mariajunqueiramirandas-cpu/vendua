-- 0119_mirim_trial.sql — Mirim starts with the same 14-day trial as Bandeira, no card (the owner's
-- decision, 2026-10-13, amending ADR 0032): a store sells before it pays on either open plan. One
-- trial per owner phone still holds. Pangolim stays without a trial of its own.
update plans set trial_days = 14, updated_at = now() where id = 'mirim' and trial_days = 0;
