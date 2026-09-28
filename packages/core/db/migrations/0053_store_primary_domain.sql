-- A store's public address comes from its domains rows, never from its slug: a store
-- served at pudim.vendua.com.br must not share links to quero-pudim.vendua.com.br.
--   domains.is_primary — the one host every link Core builds points at (at most one per tenant)

alter table domains add column if not exists is_primary boolean not null default false;
create unique index if not exists domains_one_primary on domains (tenant_id) where is_primary;

-- backfill: each tenant's shortest public host (dev/loopback hosts never qualify)
update domains d set is_primary = true
from (
  select distinct on (tenant_id) tenant_id, host from domains
  where host !~ '(^|\.)localhost(:|$)' and host !~ '^127\.' and host !~ ':'
  order by tenant_id, length(host), host
) pick
where d.host = pick.host
  and not exists (select 1 from domains p where p.tenant_id = d.tenant_id and p.is_primary);
