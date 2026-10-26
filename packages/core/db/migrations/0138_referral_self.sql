-- 0138_referral_self.sql — a referral that pays its own owner is 'self' (0120 checked only a store
-- referring a store by the owner's phone):
--   record_store_referral — a partner signing up a store on its own WhatsApp records nothing, as a
--                           store's owner referring their own new store already didn't
--   referral_on_paid      — on the first paid invoice, a referee paying with the referrer's CPF/CNPJ
--                           or e-mail (a second WhatsApp, the same payer) earns no free month, and
--                           one paying with its partner's e-mail no commission
-- Same signatures and grants: a Core from before this one calls them unchanged.

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
  if r.kind = 'partner' and exists (
    select 1 from partners p where p.id = r.partner_id and p.phone = any (p_phones)
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
       and coalesce(i.paid_at, now()) < r.created_at + make_interval(months => p.commission_months)
       and not exists (
         select 1 from subscriptions s
         where s.tenant_id = i.tenant_id and p.email is not null
           and lower(s.payer_email) = lower(p.email)
       ) then
      insert into partner_commissions (partner_id, tenant_id, invoice_id, paid_cents, commission_cents)
      values (p.id, i.tenant_id, i.id, v_paid, (v_paid * p.commission_bps + 5000) / 10000)
      on conflict (invoice_id) do nothing;
    end if;
    return null;
  end if;
  if r.referrer_tenant_id is null or r.rewarded_at is not null or i.kind <> 'period' then
    return null;
  end if;
  -- left unrewarded (the owner's list would say it paid a month): a later invoice asks again
  if exists (
    select 1 from subscriptions a, subscriptions b
    where a.tenant_id = r.tenant_id and b.tenant_id = r.referrer_tenant_id
      and (a.payer_document = b.payer_document or lower(a.payer_email) = lower(b.payer_email))
  ) then
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
