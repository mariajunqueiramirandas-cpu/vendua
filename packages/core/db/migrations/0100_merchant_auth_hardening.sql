-- 0100_merchant_auth_hardening.sql — merchant sign-in hardening.
--   merchant_login_failures        — each wrong WhatsApp code with a hash of the IP that sent it: the
--                                    daily cap counts per (phone, ip), so a stranger's guesses don't
--                                    lock the owner out of their own phone
--   merchant_login_codes.ip_hash   — who asked for the code: past the phone's cap, its asker still
--                                    gets one clean try
--   merchant_login_links.purpose   — 'email_change': the link that proves a member's new address
--                                    (tenant_id + user_id say whose); 'login' links carry neither
--   merchant_users.pending_email   — an address typed in Perfil, not yet proven
--   media_*_by_tenant              — the per-store media quota sums by tenant

create table if not exists merchant_login_failures (
  id bigint generated always as identity primary key,
  phone text not null check (phone ~ '^\d{10,11}$'),
  ip_hash text not null check (char_length(ip_hash) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists merchant_login_failures_by_phone
  on merchant_login_failures (phone, created_at desc);
alter table merchant_login_failures enable row level security;
drop policy if exists merchant_auth on merchant_login_failures;
create policy merchant_auth on merchant_login_failures for all
  using (current_setting('vendua.merchant_auth', true) = '1')
  with check (current_setting('vendua.merchant_auth', true) = '1');
grant select, insert, delete on merchant_login_failures to vendua_app;

alter table merchant_login_codes
  add column if not exists ip_hash text check (char_length(ip_hash) <= 64);

alter table merchant_login_links
  add column if not exists purpose text not null default 'login'
    check (purpose in ('login', 'email_change')),
  add column if not exists tenant_id uuid references tenants (id) on delete cascade,
  add column if not exists user_id uuid references merchant_users (id) on delete cascade;
alter table merchant_login_links drop constraint if exists merchant_login_links_change_owner;
alter table merchant_login_links
  add constraint merchant_login_links_change_owner
  check ((purpose = 'email_change') = (tenant_id is not null and user_id is not null));
create index if not exists merchant_login_links_by_user
  on merchant_login_links (user_id, created_at desc) where user_id is not null;

alter table merchant_users
  add column if not exists pending_email text check (char_length(pending_email) <= 200);

-- POST /media sums a store's stored bytes against its quota
create index if not exists media_objects_by_tenant on media_objects (tenant_id);
create index if not exists media_variants_by_tenant on media_variants (tenant_id);
