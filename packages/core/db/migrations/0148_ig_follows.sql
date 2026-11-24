-- 0148_ig_follows.sql — the CRM's Instagram account follows every lead it finds there and
-- everyone it DMs (crm/ig-follows.ts → the ig-sidecar's POST /v1/follow). One row per handle:
-- the queue and the record of what was done. Additive (ADR 0041): an old Core never reads it.
-- Re-runnable.
create table if not exists ig_follows (
  handle text primary key check (handle ~ '^[a-z0-9._]{1,30}$'),
  -- the lead that queued it, for the timeline
  lead_id uuid references leads (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'following', 'requested', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  -- the sidecar's code and message from the last failed try
  error_code text check (char_length(error_code) <= 60),
  error text check (char_length(error) <= 500),
  fbid text check (fbid ~ '^[0-9]{1,40}$'),
  -- when this account sent the follow (the daily cap counts these); null when it already followed
  followed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ig_follows_due on ig_follows (next_at) where status = 'pending';
create index if not exists ig_follows_followed on ig_follows (followed_at)
  where followed_at is not null;
create index if not exists ig_follows_fbid on ig_follows (fbid) where fbid is not null;

alter table ig_follows enable row level security;
drop policy if exists staff_all on ig_follows;
create policy staff_all on ig_follows for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on ig_follows to vendua_app;
