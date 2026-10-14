-- 0129_job_leases.sql — background jobs that must run in one Core at a time (payment reconcile,
-- domains, the admin sweeper, the Instagram reconcile). A deploy runs two Cores for seconds and a
-- second replica runs them for as long as it lives: the owner renews its row on every tick, the
-- other Core skips while the row is live, and takes over once it lapses (platform/job-lease.ts).
-- Additive only. Re-runnable.

create table if not exists job_leases (
  name text primary key check (char_length(name) between 1 and 80),
  owner text not null check (char_length(owner) between 1 and 80),
  until timestamptz not null
);
alter table job_leases enable row level security;
drop policy if exists job_leases_control on job_leases;
create policy job_leases_control on job_leases for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on job_leases to vendua_app;
