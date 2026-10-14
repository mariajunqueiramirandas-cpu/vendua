-- 0120_referrals_partners.sql — stores bring stores, partners bring stores (the owner's decisions,
-- 2026-10-13):
--   * a store's link (its slug) gives the new store its first month free, on top of the trial; once
--     the new store pays its first month, the store that referred it gets its next month free
--   * a partner (an accountant, a supplier…) approved by staff earns 20% of every plan invoice the
--     stores it brought pay, for each store's first 12 months; staff pay it out by Pix
--   partners               — platform, control-only; a public application lands as 'pending'
--   store_referrals        — one per referred store: who referred it, the welcome days it got
--   billing_credits        — free months a store is owed; applied by moving a Pix plan's next
--                            charge a month on, or by refunding a card plan's next charge
--   invoices.credited_cents — what a credit gave back of this invoice (a refunded card charge)
--   partner_commissions    — one per paid invoice of a partner's store, while it earns
--   partner_payouts        — one Pix staff sent a partner, covering the commissions it settles
--   referral_lookup()      — what a code is (a partner's, or a store's slug), for anyone
--   record_store_referral()   — signup's only way to record one, in the new store's own tx
--   referral_on_paid()     — the invoice's commission and the referrer's credit, in the payer's tx
--   referrals_of()         — the stores a store referred, as the referrer sees them
-- Additive only. Re-runnable.

create table if not exists partners (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  name text not null check (char_length(name) between 2 and 80),
  kind text not null check (kind in ('contador', 'fornecedor', 'agencia', 'consultor', 'outro')),
  phone text not null unique check (phone ~ '^[0-9]{10,13}$'),
  email text check (char_length(email) between 3 and 120),
  city text check (char_length(city) <= 80),
  pix_key text check (char_length(pix_key) <= 120),
  note text check (char_length(note) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'paused', 'rejected')),
  commission_bps int not null default 2000 check (commission_bps between 0 and 5000),
  commission_months int not null default 12 check (commission_months between 1 and 60),
  approved_at timestamptz,
  approved_by text check (char_length(approved_by) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table partners enable row level security;
drop policy if exists partners_control on partners;
create policy partners_control on partners for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update on partners to vendua_app;

create table if not exists store_referrals (
  -- the referred store
  tenant_id uuid primary key references tenants (id) on delete cascade,
  referrer_tenant_id uuid references tenants (id) on delete set null,
  partner_id uuid references partners (id) on delete set null,
  code text not null check (char_length(code) between 3 and 40),
  -- phoneLockKey() of the new owner: a welcome month once per WhatsApp
  phone_key text not null check (phone_key ~ '^[0-9]{10,13}$'),
  welcome_days int not null default 0 check (welcome_days between 0 and 90),
  -- the referrer's free month was granted (the referred store paid its first month)
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_tenant_id is null or partner_id is null),
  check (referrer_tenant_id is null or referrer_tenant_id <> tenant_id)
);
create unique index if not exists store_referrals_one_welcome on store_referrals (phone_key)
  where welcome_days > 0;
create index if not exists store_referrals_by_referrer on store_referrals (referrer_tenant_id)
  where referrer_tenant_id is not null;
create index if not exists store_referrals_by_partner on store_referrals (partner_id)
  where partner_id is not null;
alter table store_referrals enable row level security;
drop policy if exists tenant_isolation on store_referrals;
create policy tenant_isolation on store_referrals
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on store_referrals;
create policy control_access on store_referrals for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select on store_referrals to vendua_app;

create table if not exists billing_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  reason text not null check (reason in ('referral')),
  -- the store whose payment earned it
  source_tenant_id uuid references tenants (id) on delete set null,
  months int not null default 1 check (months between 1 and 12),
  status text not null default 'pending' check (status in ('pending', 'applied', 'void')),
  applied_how text check (applied_how in ('period', 'refund')),
  invoice_id uuid references invoices (id) on delete set null,
  provider_refund_id text check (char_length(provider_refund_id) <= 80),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, reason, source_tenant_id)
);
create index if not exists billing_credits_pending on billing_credits (created_at)
  where status = 'pending';
alter table billing_credits enable row level security;
drop policy if exists tenant_isolation on billing_credits;
create policy tenant_isolation on billing_credits
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on billing_credits;
create policy control_access on billing_credits for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, update on billing_credits to vendua_app;

alter table invoices add column if not exists credited_cents int not null default 0
  check (credited_cents >= 0);

create table if not exists partner_payouts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id),
  total_cents int not null check (total_cents > 0),
  commissions int not null check (commissions > 0),
  note text check (char_length(note) <= 300),
  paid_by text not null check (char_length(paid_by) between 1 and 80),
  paid_at timestamptz not null default now()
);
alter table partner_payouts enable row level security;
drop policy if exists partner_payouts_control on partner_payouts;
create policy partner_payouts_control on partner_payouts for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert on partner_payouts to vendua_app;

create table if not exists partner_commissions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id),
  tenant_id uuid not null references tenants (id) on delete cascade,
  invoice_id uuid not null unique references invoices (id) on delete cascade,
  paid_cents int not null check (paid_cents > 0),
  commission_cents int not null check (commission_cents >= 0),
  status text not null default 'due' check (status in ('due', 'paid', 'void')),
  payout_id uuid references partner_payouts (id),
  created_at timestamptz not null default now()
);
create index if not exists partner_commissions_due on partner_commissions (partner_id)
  where status = 'due';
alter table partner_commissions enable row level security;
drop policy if exists partner_commissions_control on partner_commissions;
create policy partner_commissions_control on partner_commissions for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, update on partner_commissions to vendua_app;

-- What a link's code is. A partner's code (upper case) wins over a store's slug (lower case); a
-- paused or rejected partner and an inactive store are no one's. Slugs and partner names are
-- public already (store addresses, the partner's own link).
create or replace function referral_lookup(p_code text)
returns table (kind text, referrer_tenant_id uuid, partner_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select x.kind, x.referrer, x.partner, x.name from (
    select 'partner'::text as kind, null::uuid as referrer, p.id as partner, p.name, 1 as o
    from partners p where p.code = upper(btrim(p_code)) and p.status = 'active'
    union all
    select 'store'::text, t.id, null::uuid, t.name, 2
    from tenants t where t.slug = lower(btrim(p_code)) and t.status = 'active'
  ) x order by x.o limit 1
$$;
revoke all on function referral_lookup(text) from public;
grant execute on function referral_lookup(text) to vendua_app;

-- 'ok' (welcome days as asked), 'ok_no_welcome' (recorded, but this WhatsApp already had its
-- welcome month, or a partner's code), 'self' (the new owner owns the referring store), 'invalid'
-- (no one's code), 'exists' (this store already has one).
-- Only the new store's own transaction records it, once.
create or replace function record_store_referral(p_tenant uuid, p_code text, p_phones text[],
                                                 p_phone_key text, p_welcome_days int)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_welcome int := greatest(0, least(coalesce(p_welcome_days, 0), 90));
begin
  if p_tenant is null or p_tenant::text is distinct from current_setting('vendua.tenant_id', true) then
    raise exception 'record_store_referral: not this store''s transaction';
  end if;
  select * into r from referral_lookup(p_code);
  if not found then return 'invalid'; end if;
  if r.kind = 'store' and (
    r.referrer_tenant_id = p_tenant or exists (
      select 1 from merchant_users u
      where u.tenant_id = r.referrer_tenant_id and u.role = 'owner' and u.phone = any (p_phones))
  ) then
    return 'self';
  end if;
  -- partners bring a store; the welcome month is a store's gift to a store
  if r.kind <> 'store' then v_welcome := 0; end if;
  if v_welcome > 0 and exists (
    select 1 from store_referrals where phone_key = p_phone_key and welcome_days > 0
  ) then
    v_welcome := 0;
  end if;
  insert into store_referrals (tenant_id, referrer_tenant_id, partner_id, code, phone_key, welcome_days)
  values (p_tenant, r.referrer_tenant_id, r.partner_id, lower(btrim(p_code)), p_phone_key, v_welcome)
  on conflict (tenant_id) do nothing;
  if not found then return 'exists'; end if;
  return case when v_welcome > 0 or p_welcome_days = 0 then 'ok' else 'ok_no_welcome' end;
end
$$;
revoke all on function record_store_referral(uuid, text, text[], text, int) from public;
grant execute on function record_store_referral(uuid, text, text[], text, int) to vendua_app;

-- A plan invoice of the current store was paid: its partner's commission (while the partner is
-- active and the store is in its first commission_months), and, on its first paid month, the
-- referring store's free month. Returns the referrer to credit, null otherwise. Idempotent.
create or replace function referral_on_paid(p_invoice uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i invoices%rowtype;
  r store_referrals%rowtype;
  p partners%rowtype;
  v_paid int;
begin
  select * into i from invoices where id = p_invoice;
  if not found or i.tenant_id::text is distinct from current_setting('vendua.tenant_id', true) then
    raise exception 'referral_on_paid: not this store''s invoice';
  end if;
  if i.status <> 'paid' or i.kind not in ('period', 'upgrade') then return null; end if;
  v_paid := i.amount_cents - i.credited_cents;
  if v_paid <= 0 then return null; end if;
  select * into r from store_referrals where tenant_id = i.tenant_id;
  if not found then return null; end if;
  if r.partner_id is not null then
    select * into p from partners where id = r.partner_id;
    if found and p.status = 'active'
       and coalesce(i.paid_at, now()) < r.created_at + make_interval(months => p.commission_months) then
      insert into partner_commissions (partner_id, tenant_id, invoice_id, paid_cents, commission_cents)
      values (p.id, i.tenant_id, i.id, v_paid, (v_paid * p.commission_bps + 5000) / 10000)
      on conflict (invoice_id) do nothing;
    end if;
    return null;
  end if;
  if r.referrer_tenant_id is null or r.rewarded_at is not null or i.kind <> 'period' then
    return null;
  end if;
  update store_referrals set rewarded_at = now() where tenant_id = r.tenant_id and rewarded_at is null;
  if not found then return null; end if;
  insert into billing_credits (tenant_id, reason, source_tenant_id)
  values (r.referrer_tenant_id, 'referral', r.tenant_id)
  on conflict (tenant_id, reason, source_tenant_id) do nothing;
  return r.referrer_tenant_id;
end
$$;
revoke all on function referral_on_paid(uuid) from public;
grant execute on function referral_on_paid(uuid) to vendua_app;

-- The stores this store referred, as its owner sees them: the name, when it joined and whether it
-- paid its first month yet (which gave this store its free month). Nothing else of theirs.
create or replace function referrals_of(p_tenant uuid)
returns table (name text, joined_at timestamptz, rewarded boolean)
language sql stable security definer set search_path = public as $$
  select t.name, r.created_at, r.rewarded_at is not null
  from store_referrals r join tenants t on t.id = r.tenant_id
  where r.referrer_tenant_id = p_tenant
    and p_tenant::text = current_setting('vendua.tenant_id', true)
  order by r.created_at desc
  limit 200
$$;
revoke all on function referrals_of(uuid) from public;
grant execute on function referrals_of(uuid) to vendua_app;

-- A partner's application from the site: lands 'pending' for staff to approve. One per phone; a
-- repeat answers the same (nothing about the existing row leaks). The code is staff's to change.
create or replace function apply_partner(p_name text, p_kind text, p_phone text, p_email text,
                                         p_city text, p_note text, p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into partners (code, name, kind, phone, email, city, note)
  values (p_code, p_name, p_kind, p_phone, p_email, p_city, p_note)
  on conflict do nothing;
end
$$;
revoke all on function apply_partner(text, text, text, text, text, text, text) from public;
grant execute on function apply_partner(text, text, text, text, text, text, text) to vendua_app;

-- Signup asks before the store exists: has this WhatsApp had its welcome month already?
create or replace function phone_had_welcome(p_phone_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from store_referrals where phone_key = p_phone_key and welcome_days > 0)
$$;
revoke all on function phone_had_welcome(text) from public;
grant execute on function phone_had_welcome(text) to vendua_app;
