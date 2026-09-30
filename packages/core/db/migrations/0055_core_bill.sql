-- Plan billing (CORE-BILL): a Pix invoice can be issued more than once (it expired, the price
-- changed); each issue is its own provider attempt with a stable idempotency key
-- `invoice:<id>:<pix_attempt>`, so a retried request returns the same Pix, never a second one.
alter table invoices
  add column if not exists pix_attempt int not null default 0 check (pix_attempt between 0 and 1000);

-- a downgrade takes effect at the end of the period it was asked in (the period end then);
-- it applies once the store's paid period starts at or after this instant
alter table subscriptions
  add column if not exists pending_plan_at timestamptz;

-- the jobs' sweeps: open invoices by due date, subscriptions by period end
create index if not exists invoices_open_due on invoices (due_at) where status = 'open';
create index if not exists subscriptions_period_end on subscriptions (current_period_end)
  where status in ('active', 'past_due');

-- every Pix ever issued for an invoice stays payable until it expires: its id is kept so a
-- late payment of a superseded Pix (old price, expired-and-reissued) still settles the invoice
alter table invoices
  add column if not exists pix_superseded text[] not null default '{}';

-- what the MP assinatura is set to charge; the jobs push the plan's price when they differ
alter table subscriptions
  add column if not exists charge_cents int check (charge_cents >= 0);

-- A domain claim is not ownership: several stores may be waiting on the same host, and the one
-- whose TXT record verifies wins (at most one verified or live row per host). Waiting claims
-- no longer block anyone.
alter table custom_domains drop constraint if exists custom_domains_host_key;
create unique index if not exists custom_domains_verified_host on custom_domains (host)
  where status in ('dns_ok', 'active');
create unique index if not exists custom_domains_tenant_host on custom_domains (tenant_id, host);
create index if not exists custom_domains_by_host on custom_domains (host);

-- signup codes cost a WhatsApp message each: a durable per-IP daily cap beside the in-memory
-- per-minute limiter (pre-tenant, behind vendua.merchant_auth like merchant_login_codes)
create table if not exists signup_otp_sends (
  id bigint generated always as identity primary key,
  ip_hash text not null check (char_length(ip_hash) = 64),
  created_at timestamptz not null default now()
);
create index if not exists signup_otp_sends_by_ip on signup_otp_sends (ip_hash, created_at desc);
alter table signup_otp_sends enable row level security;
drop policy if exists merchant_auth on signup_otp_sends;
create policy merchant_auth on signup_otp_sends for all
  using (current_setting('vendua.merchant_auth', true) = '1')
  with check (current_setting('vendua.merchant_auth', true) = '1');
grant select, insert, delete on signup_otp_sends to vendua_app;
grant usage on all sequences in schema public to vendua_app;
