-- Core keeps public storefront reads (store profile, catalog, zones, design) in memory per store
-- (platform/read-cache.ts). Every table those reads touch notifies on commit, whoever writes it:
-- payload `<tenant id>|<table>`, `*` for a table without a store (plans) or a TRUNCATE.
-- Identical payloads in one transaction collapse into one notify, so a bulk import sends one.
create or replace function vendua_store_cache_notify() returns trigger
language plpgsql as $$
declare
  tenant text;
begin
  if TG_LEVEL = 'STATEMENT' or TG_TABLE_NAME = 'plans' then
    tenant := '*';
  elsif TG_TABLE_NAME = 'tenants' then
    if TG_OP = 'DELETE' then tenant := old.id; else tenant := new.id; end if;
  elsif TG_OP = 'DELETE' then
    tenant := old.tenant_id;
  else
    tenant := new.tenant_id;
  end if;
  perform pg_notify('vendua_store_cache', coalesce(tenant, '*') || '|' || TG_TABLE_NAME);
  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'plans', 'subscriptions', 'domains', 'store_settings', 'payment_connections',
    'store_agent', 'delivery_zones', 'categories', 'products', 'product_media',
    'modifier_groups', 'modifiers', 'combo_slots', 'combo_slot_items', 'notify_requests',
    'storefront_templates', 'storefront_tokens', 'storefront_ops'
  ] loop
    execute format('drop trigger if exists store_cache_notify on %I', t);
    execute format(
      'create trigger store_cache_notify after insert or update or delete on %I
         for each row execute function vendua_store_cache_notify()', t);
    execute format('drop trigger if exists store_cache_notify_truncate on %I', t);
    execute format(
      'create trigger store_cache_notify_truncate after truncate on %I
         for each statement execute function vendua_store_cache_notify()', t);
  end loop;
end $$;
