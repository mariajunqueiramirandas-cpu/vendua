-- 0107_merchant_proven_phone.sql — which stores a phone belongs to, counting only memberships whose phone
-- its person proved (signed in with a WhatsApp code at least once).
--   merchant_memberships_for_proven_phone() — like merchant_memberships_for_phone, but an owner
--     typing someone's number into Equipe doesn't make that person's WhatsApp messages the store's
--     (Duá by WhatsApp) or hide them from Venduá's own sales inbox.
-- Additive only. Re-runnable.

create or replace function merchant_memberships_for_proven_phone(p_phone text)
returns table (tenant_id uuid, slug text, name text, user_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.slug, t.name, u.id, u.role
  from merchant_users u join tenants t on t.id = u.tenant_id
  where u.phone = p_phone and u.status = 'active' and t.status = 'active'
    and exists (
      select 1 from merchant_sessions s
      where s.tenant_id = u.tenant_id and s.user_id = u.id
        and s.proof_kind = 'phone' and s.proof_subject = u.phone
    )
  order by t.name
$$;
revoke all on function merchant_memberships_for_proven_phone(text) from public;
grant execute on function merchant_memberships_for_proven_phone(text) to vendua_app;
