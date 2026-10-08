-- 0102_domain_automation.sql — own domains with no staff step, and Pangolim's included .com.br
-- (ADR 0038).
--   custom_domains.source / method   — the owner's domain or the one Venduá bought; CNAME/A records
--                                       at the owner's DNS, or nameservers delegated to Venduá's zone
--   custom_domains.alias_host        — the www./root counterpart, routed too and redirected to host
--   custom_domains.zone_id …         — the Cloudflare zone, its nameservers and the owner's records
--   custom_domains.registrar_ref …   — the registrar's id and the registry expiry
--   statuses ordering / repairing / lapsed / removing
--   domain_orders                    — every registration and renewal Venduá pays for, with the
--                                       holder the owner confirmed
--   unroute_custom_domain(), store_primary() — the jobs move a store off a host it can't serve

alter table custom_domains
  add column if not exists source text not null default 'connected'
    check (source in ('connected', 'included')),
  add column if not exists method text not null default 'cname' check (method in ('cname', 'ns')),
  add column if not exists alias_host text
    check (alias_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and char_length(alias_host) <= 253),
  -- the alias resolves to Venduá, so it gets a route and a certificate
  add column if not exists alias_ok boolean not null default false,
  add column if not exists zone_id text check (zone_id ~ '^[a-zA-Z0-9]{1,64}$'),
  add column if not exists name_servers text[] not null default '{}'
    check (cardinality(name_servers) <= 8),
  -- [{type, name, value, priority?}]: what the zone holds besides Venduá's root and www
  add column if not exists records jsonb not null default '[]'
    check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 50
      and octet_length(records::text) <= 64 * 1024),
  add column if not exists records_confirmed_at timestamptz,
  add column if not exists records_updated_at timestamptz,
  add column if not exists records_synced_at timestamptz,
  add column if not exists dnssec_signed boolean not null default false,
  add column if not exists registrar_ref text check (char_length(registrar_ref) <= 64),
  add column if not exists expires_at timestamptz,
  add column if not exists rdap_checked_at timestamptz,
  add column if not exists dns_ok_at timestamptz,
  add column if not exists tls_ok_at timestamptz,
  -- consecutive re-checks of a live domain that found it not pointing at Venduá
  add column if not exists miss_count int not null default 0 check (miss_count >= 0),
  add column if not exists lapsed_at timestamptz,
  -- the last expiry notice sent to a lapsed included domain's owners (30, 7 or 1 days before)
  add column if not exists expiry_notice int check (expiry_notice in (30, 7, 1));

alter table custom_domains drop constraint if exists custom_domains_status_check;
alter table custom_domains add constraint custom_domains_status_check check (status in (
  'ordering', 'pending_dns', 'dns_ok', 'active', 'repairing', 'lapsed', 'failed', 'removing'
));

-- a host is held from the moment it's ordered or verified until it's gone, alias included
drop index if exists custom_domains_verified_host;
create unique index if not exists custom_domains_verified_host on custom_domains (host)
  where status in ('ordering', 'dns_ok', 'active', 'repairing', 'lapsed', 'removing');
create unique index if not exists custom_domains_alias_host on custom_domains (alias_host)
  where alias_host is not null
    and status in ('ordering', 'dns_ok', 'active', 'repairing', 'lapsed', 'removing');
-- one zone per name in Venduá's Cloudflare account: the row that created it owns it
create unique index if not exists custom_domains_zone_host on custom_domains (host)
  where zone_id is not null;
create index if not exists custom_domains_by_alias on custom_domains (alias_host)
  where alias_host is not null;

-- A name is one store's whether it's a row's host or its alias: `loja.com.br` held as one row's
-- host and another's `www.` alias would route the pair to two stores. Rows naming the same pair
-- serialize on its root, then the check sees what the other committed. Security definer: the
-- check must see every store's rows, not only the caller's.
create or replace function custom_domain_names_free() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('ordering', 'dns_ok', 'active', 'repairing', 'lapsed', 'removing') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'custom-domain:' || least(new.host, coalesce(new.alias_host, new.host)), 0));
  if exists (
    select 1 from custom_domains c
    where c.id <> new.id and c.status in ('ordering', 'dns_ok', 'active', 'repairing', 'lapsed', 'removing')
      and (c.host in (new.host, new.alias_host) or c.alias_host in (new.host, new.alias_host))
  ) then
    raise exception 'custom domain % is held by another row', new.host using errcode = '23505';
  end if;
  return new;
end
$$;
revoke all on function custom_domain_names_free() from public;
drop trigger if exists custom_domain_names_free on custom_domains;
create trigger custom_domain_names_free
  before insert or update of status, host, alias_host on custom_domains
  for each row execute function custom_domain_names_free();

-- Domains connected before this migration get their www./root alias (checked by the jobs before
-- it's routed), unless another row already uses that name.
update custom_domains c set alias_host = a.alias
from (
  select id, case
    when host like 'www.%' then substr(host, 5)
    else 'www.' || host
  end as alias, case when host like 'www.%' then substr(host, 5) else host end as root
  from custom_domains where alias_host is null
) a
where c.id = a.id
  and (array_length(string_to_array(a.root, '.'), 1) = 2
    or (array_length(string_to_array(a.root, '.'), 1) = 3
      and split_part(a.root, '.', 2) || '.' || split_part(a.root, '.', 3) in (
        'com.br', 'net.br', 'org.br', 'art.br', 'adv.br', 'app.br', 'arq.br', 'blog.br', 'eco.br',
        'emp.br', 'eng.br', 'ind.br', 'log.br', 'med.br', 'psi.br', 'rec.br', 'srv.br', 'tec.br',
        'tur.br', 'dev.br', 'nom.br', 'agr.br', 'esp.br', 'etc.br', 'far.br', 'imb.br', 'inf.br',
        'radio.br', 'tmp.br', 'tv.br', 'b.br', 'co.uk', 'org.uk', 'com.ar', 'com.pt', 'com.mx',
        'com.co', 'com.uy', 'com.py', 'co.za')))
  and a.root not in (
    'com.br', 'net.br', 'org.br', 'co.uk', 'org.uk', 'com.ar', 'com.pt', 'com.mx', 'com.co')
  and not exists (
    select 1 from custom_domains o
    where o.id <> c.id and (o.host = a.alias or o.alias_host = a.alias))
  and not exists (select 1 from domains d where d.host = a.alias and d.tenant_id <> c.tenant_id);
create index if not exists custom_domains_by_status on custom_domains (status);

create table if not exists domain_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  custom_domain_id uuid references custom_domains (id) on delete set null,
  kind text not null check (kind in ('register', 'renew')),
  host text not null
    check (host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      and char_length(host) <= 253),
  status text not null check (status in (
    'awaiting_payment', 'queued', 'pending', 'registered', 'renewed', 'conflict', 'failed',
    'cancelled'
  )),
  holder_kind text check (holder_kind in ('cnpj', 'cpf')),
  holder_document text check (holder_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  holder_name text check (char_length(holder_name) between 1 and 200),
  holder_email text check (char_length(holder_email) between 3 and 254),
  holder_phone text check (holder_phone ~ '^[0-9]{10,11}$'),
  -- {street, number, complement?, district, city, state, postalCode}
  holder_address jsonb check (jsonb_typeof(holder_address) = 'object'
    and octet_length(holder_address::text) <= 2048),
  confirmed_by uuid references merchant_users (id) on delete set null,
  confirmed_at timestamptz,
  registrar_ref text check (char_length(registrar_ref) <= 64),
  holder_handle text check (char_length(holder_handle) <= 64),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  -- a worker is at the registrar's door until then: the owner can't cancel or retry meanwhile
  claimed_until timestamptz,
  -- a renewal: the registry expiry before it was asked, so a retry can tell it already went through
  expires_before timestamptz,
  conflict_since timestamptz,
  last_error text check (char_length(last_error) <= 300),
  -- what the registrar charged Venduá, in that currency's minor unit
  cost_cents int check (cost_cents >= 0),
  cost_currency text check (cost_currency ~ '^[A-Z]{3}$'),
  placed_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'renew' or (holder_kind is not null and holder_document is not null
    and holder_name is not null and holder_email is not null and holder_phone is not null
    and holder_address is not null and confirmed_at is not null))
);
create unique index if not exists domain_orders_one_open on domain_orders (tenant_id)
  where kind = 'register' and status in ('awaiting_payment', 'queued', 'pending', 'conflict');
create unique index if not exists domain_orders_one_renewal on domain_orders (custom_domain_id)
  where kind = 'renew' and status in ('queued', 'pending');
create index if not exists domain_orders_due on domain_orders (status, next_attempt_at);
create index if not exists domain_orders_by_tenant on domain_orders (tenant_id, created_at desc);

alter table domain_orders enable row level security;
drop policy if exists tenant_isolation on domain_orders;
create policy tenant_isolation on domain_orders
  using (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('vendua.tenant_id', true), '')::uuid);
drop policy if exists control_access on domain_orders;
create policy control_access on domain_orders for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
grant select, insert, update, delete on domain_orders to vendua_app;

-- A host the store can't serve any more (lapsed, removed): it leaves the resolver, and when it
-- was the primary, `p_fallback` (the platform host) becomes it.
create or replace function unroute_custom_domain(p_tenant uuid, p_host text, p_fallback text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vendua.control', true) is distinct from '1' then
    raise exception 'control only' using errcode = '42501';
  end if;
  delete from domains where tenant_id = p_tenant and host = lower(p_host);
  if not exists (select 1 from domains where tenant_id = p_tenant and is_primary) then
    insert into domains (host, tenant_id, is_primary) values (lower(p_fallback), p_tenant, true)
      on conflict (host) do update set is_primary = true where domains.tenant_id = p_tenant;
  end if;
end
$$;
revoke all on function unroute_custom_domain(uuid, text, text) from public;
grant execute on function unroute_custom_domain(uuid, text, text) to vendua_app;

-- Which of the store's hosts every link uses (a domain under repair hands it to the platform host
-- and gets it back when it points at Venduá again). The host must already be the store's.
create or replace function store_primary(p_tenant uuid, p_host text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('vendua.control', true) is distinct from '1' then
    raise exception 'control only' using errcode = '42501';
  end if;
  if not exists (select 1 from domains where tenant_id = p_tenant and host = lower(p_host)) then
    insert into domains (host, tenant_id) values (lower(p_host), p_tenant)
      on conflict (host) do nothing;
    if not exists (select 1 from domains where tenant_id = p_tenant and host = lower(p_host)) then
      return;
    end if;
  end if;
  update domains set is_primary = false where tenant_id = p_tenant and is_primary
    and host <> lower(p_host);
  update domains set is_primary = true where tenant_id = p_tenant and host = lower(p_host);
end
$$;
revoke all on function store_primary(uuid, text) from public;
grant execute on function store_primary(uuid, text) to vendua_app;
