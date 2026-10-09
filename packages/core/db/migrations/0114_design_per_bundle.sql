-- 0114_design_per_bundle.sql — a store's saved design belongs to the storefront bundle it was
-- made for (ADR 0040): each storefront_templates / storefront_tokens row names its bundle, and a
-- store reads the rows of the bundle it runs. Switching between its own bundle (site sob medida)
-- and `_template` brings each side's layout and colors along, owner edits included.
-- Backfill: a row belongs to the bundle of the store's newest deployment started before it was
-- written; one older than every deployment to its first one's bundle (else the bundle it runs);
-- a 'site sob medida' row to the store's own bundle.
-- A writer that names no bundle (an older Core mid-deploy) gets the store's current one.
-- Re-runnable.

alter table storefront_templates add column if not exists bundle text
  check (bundle ~ '^[a-z0-9_][a-z0-9_-]{0,39}(/[a-z0-9_][a-z0-9_-]{0,39})?$');
alter table storefront_tokens add column if not exists bundle text
  check (bundle ~ '^[a-z0-9_][a-z0-9_-]{0,39}(/[a-z0-9_][a-z0-9_-]{0,39})?$');

update storefront_templates st set bundle = case
    when st.source = 'site sob medida' then t.slug
    else coalesce((
      select r.bundle from deployments d join releases r on r.id = d.release_id
      where d.tenant_id = st.tenant_id and d.started_at <= st.created_at
      order by d.started_at desc limit 1
    ), (
      select r.bundle from deployments d join releases r on r.id = d.release_id
      where d.tenant_id = st.tenant_id order by d.started_at limit 1
    ), (select o.bundle from storefront_ops o where o.tenant_id = st.tenant_id), '_template')
  end
from tenants t
where t.id = st.tenant_id and st.bundle is null;

update storefront_tokens sk set bundle = case
    when sk.source = 'site sob medida' then t.slug
    else coalesce((
      select r.bundle from deployments d join releases r on r.id = d.release_id
      where d.tenant_id = sk.tenant_id and d.started_at <= sk.created_at
      order by d.started_at desc limit 1
    ), (
      select r.bundle from deployments d join releases r on r.id = d.release_id
      where d.tenant_id = sk.tenant_id order by d.started_at limit 1
    ), (select o.bundle from storefront_ops o where o.tenant_id = sk.tenant_id), '_template')
  end
from tenants t
where t.id = sk.tenant_id and sk.bundle is null;

create or replace function vendua_design_bundle() returns trigger
language plpgsql as $$
begin
  if new.bundle is null then
    select o.bundle into new.bundle from storefront_ops o where o.tenant_id = new.tenant_id;
    new.bundle := coalesce(new.bundle, '_template');
  end if;
  return new;
end $$;

drop trigger if exists design_bundle on storefront_templates;
create trigger design_bundle before insert on storefront_templates
  for each row execute function vendua_design_bundle();
drop trigger if exists design_bundle on storefront_tokens;
create trigger design_bundle before insert on storefront_tokens
  for each row execute function vendua_design_bundle();

alter table storefront_templates alter column bundle set not null;
alter table storefront_tokens alter column bundle set not null;

create index if not exists storefront_templates_bundle_idx
  on storefront_templates (tenant_id, bundle, page, version desc);
create index if not exists storefront_tokens_bundle_idx
  on storefront_tokens (tenant_id, bundle, version desc);
