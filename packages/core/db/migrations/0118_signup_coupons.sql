-- 0118_signup_coupons.sql — coupons for Venduá signups (ADR 0042): staff make them in the CRM, a
-- new owner types one on the last signup step.
--   signup_coupons             — platform catalog, control-only: the code, the plans it works on,
--                                free days and/or a % or R$ discount on the first N paid months,
--                                max uses (1 = one-time), expiry, on/off
--   signup_coupon_redemptions  — one per store, at most one per coupon and owner phone; keeps the
--                                terms as redeemed, so editing the coupon never changes a store
--   invoices.discount_cents    — what a coupon took off this invoice (0 = none); a discounted
--                                period counts against the coupon's months
--   signup_coupon_price()      — the one place a discounted price is computed
--   period_charge_cents()      — what a store's period starting then costs: the plan price, less
--                                its coupon while discounted months are left
--   redeem_signup_coupon()     — signup's only way to use a coupon (security definer: a coupon's
--                                uses and other stores' redemptions are outside the new store's RLS)
-- Additive only. Re-runnable.

create table if not exists signup_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  note text check (char_length(note) <= 200),
  -- null = every plan a store can pick
  plan_ids text[] check (cardinality(plan_ids) between 1 and 20),
  free_days int not null default 0 check (free_days between 0 and 365),
  discount_kind text check (discount_kind in ('percent', 'amount')),
  discount_value int not null default 0,
  discount_months int not null default 0 check (discount_months between 0 and 24),
  -- null = unlimited
  max_uses int check (max_uses between 1 and 100000),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signup_coupons_discount check (
    (discount_kind is null and discount_value = 0 and discount_months = 0)
    or (discount_kind = 'percent' and discount_value between 1 and 99 and discount_months >= 1)
    or (discount_kind = 'amount' and discount_value between 1 and 10000000 and discount_months >= 1)
  ),
  constraint signup_coupons_grants_something check (free_days > 0 or discount_kind is not null)
);
alter table signup_coupons enable row level security;
drop policy if exists signup_coupons_control on signup_coupons;
create policy signup_coupons_control on signup_coupons for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update on signup_coupons to vendua_app;

create table if not exists signup_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references tenants (id) on delete cascade,
  coupon_id uuid not null references signup_coupons (id),
  -- phoneLockKey(): both 9th-digit spellings of one WhatsApp are one key
  phone_key text not null check (phone_key ~ '^[0-9]{10,13}$'),
  plan_id text not null,
  code text not null,
  free_days int not null check (free_days between 0 and 365),
  discount_kind text check (discount_kind in ('percent', 'amount')),
  discount_value int not null default 0,
  discount_months int not null default 0,
  created_at timestamptz not null default now(),
  unique (coupon_id, phone_key)
);
create index if not exists signup_coupon_redemptions_by_coupon
  on signup_coupon_redemptions (coupon_id, created_at desc);
alter table signup_coupon_redemptions enable row level security;
drop policy if exists tenant_isolation on signup_coupon_redemptions;
create policy tenant_isolation on signup_coupon_redemptions
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on signup_coupon_redemptions;
create policy control_access on signup_coupon_redemptions for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select on signup_coupon_redemptions to vendua_app;

alter table invoices add column if not exists discount_cents int not null default 0
  check (discount_cents >= 0);

-- never below R$ 1,00 (Pix and the MP assinatura need an amount), never above the price
create or replace function signup_coupon_price(p_price int, p_kind text, p_value int)
returns int
language sql immutable parallel safe as $$
  select case
    when p_kind = 'percent' then least(p_price, greatest(100, p_price - (p_price * p_value + 50) / 100))
    when p_kind = 'amount' then least(p_price, greatest(100, p_price - p_value))
    else p_price
  end
$$;

-- invoker's rights: under a store's tx it reads only that store; under vendua.control, any.
-- 'infinity' asks for the card's next charge (every discounted period so far counts).
create or replace function period_charge_cents(p_tenant uuid, p_price int, p_start timestamptz)
returns int
language sql stable as $$
  select coalesce((
    select signup_coupon_price(p_price, r.discount_kind, r.discount_value)
    from signup_coupon_redemptions r
    where r.tenant_id = p_tenant and r.discount_kind is not null
      and (select count(*) from invoices i
           where i.tenant_id = p_tenant and i.kind = 'period' and i.discount_cents > 0
             and i.status <> 'void' and i.period_start < p_start) < r.discount_months
  ), p_price)
$$;
grant execute on function period_charge_cents(uuid, int, timestamptz) to vendua_app;
grant execute on function signup_coupon_price(int, text, int) to vendua_app;

-- 'ok' (redeemed: the row is readable under the store's RLS), or why not: 'invalid' (unknown or
-- off), 'expired', 'used_up', 'plan', 'phone' (this owner already used it). Only the store's own
-- transaction redeems for it. The coupon row lock serializes max_uses.
create or replace function redeem_signup_coupon(p_code text, p_tenant uuid, p_phone_key text,
                                                p_plan text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c signup_coupons%rowtype;
begin
  if p_tenant is null or p_tenant::text is distinct from current_setting('vendua.tenant_id', true) then
    raise exception 'redeem_signup_coupon: not this store''s transaction';
  end if;
  select * into c from signup_coupons where code = p_code for update;
  if not found or not c.active then return 'invalid'; end if;
  if c.expires_at is not null and c.expires_at <= now() then return 'expired'; end if;
  if c.plan_ids is not null and not (p_plan = any (c.plan_ids)) then return 'plan'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then return 'used_up'; end if;
  if exists (select 1 from signup_coupon_redemptions
             where coupon_id = c.id and phone_key = p_phone_key) then
    return 'phone';
  end if;
  insert into signup_coupon_redemptions (tenant_id, coupon_id, phone_key, plan_id, code, free_days,
                                         discount_kind, discount_value, discount_months)
  values (p_tenant, c.id, p_phone_key, p_plan, c.code, c.free_days, c.discount_kind,
          c.discount_value, c.discount_months);
  update signup_coupons set uses = uses + 1, updated_at = now() where id = c.id;
  return 'ok';
end
$$;
revoke all on function redeem_signup_coupon(text, uuid, text, text) from public;
grant execute on function redeem_signup_coupon(text, uuid, text, text) to vendua_app;
