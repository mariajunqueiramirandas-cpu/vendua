-- 0086_fleet_console.sql — the CRM's customer fleet (Visão, Lojas): per store, what staff need from
-- tables that stay behind tenant RLS — aggregates only, never a shopper's row.
--   store_fleet_facts() — billing_hold, the admins' latest visit and the latest counted order
--     (cancelled and refunded orders don't count, as in store_order_days). Empty outside
--     vendua.control.

create or replace function store_fleet_facts()
returns table (tenant_id uuid, billing_hold boolean, admin_last_seen_at timestamptz,
               last_order_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id,
    (select s.billing_hold from store_settings s where s.tenant_id = t.id),
    (select max(u.last_seen_at) from merchant_users u
      where u.tenant_id = t.id and u.status = 'active'),
    (select max(o.placed_at) from orders o
      where o.tenant_id = t.id and o.state <> all (array['cancelled', 'refunded']))
  from tenants t
  where current_setting('vendua.control', true) = '1'
$$;
revoke all on function store_fleet_facts() from public;
grant execute on function store_fleet_facts() to vendua_app;

-- the console's spend reads cross every store by type and time; agent_events_by_type leads with
-- tenant_id
create index if not exists agent_events_responded_at on agent_events (at)
  where type = 'model.responded';
