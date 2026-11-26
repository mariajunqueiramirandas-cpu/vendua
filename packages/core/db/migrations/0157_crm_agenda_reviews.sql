-- 0157_crm_agenda_reviews.sql — the agenda hygiene's memory (crm/agenda-hygiene.ts): one row per
-- agent follow-up the model reviewed, so each one is judged once. A cancelled follow-up also leaves
-- a line on the lead's timeline. Additive (ADR 0041): an old Core never reads it. Re-runnable.
create table if not exists crm_agenda_reviews (
  -- the agent_mailbox timer it judged (deleted when cancelled, consumed when it fires)
  mailbox_id uuid primary key,
  lead_id uuid not null references leads (id) on delete cascade,
  verdict text not null check (verdict in ('keep', 'cancel')),
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists crm_agenda_reviews_created on crm_agenda_reviews (created_at);

alter table crm_agenda_reviews enable row level security;
drop policy if exists staff_all on crm_agenda_reviews;
create policy staff_all on crm_agenda_reviews for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on crm_agenda_reviews to vendua_app;
