-- 0136_store_delete.sql — staff delete a store from the CRM (modules/store-reset.ts).
--   delete_store() — the app role has no delete policy on tenants, so this owner-run function
--                    removes the row, in the control scope only, and only when the caller names
--                    the store by both id and slug. Every tenant FK cascades (platform links —
--                    leads, referrals, Duá senders — are set null), so the store goes in one
--                    statement. The platform tenant is never deleted.
-- Additive only: a Core from before this one never calls it.

create or replace function delete_store(p_tenant uuid, p_slug text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vendua.control', true) is distinct from '1' then
    raise exception 'control only' using errcode = '42501';
  end if;
  delete from tenants where id = p_tenant and slug = p_slug and status <> 'platform';
  return found;
end
$$;
revoke all on function delete_store(uuid, text) from public;
grant execute on function delete_store(uuid, text) to vendua_app;
