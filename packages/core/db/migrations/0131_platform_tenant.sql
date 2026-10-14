-- 0131_platform_tenant.sql — Venduá's own tenant (ADR 0030 open decision 2, taken 2026-10-14: a
-- reserved platform tenant). The CRM agent runs on Agent Runtime v3, whose actors, mailbox, events
-- and memory are tenant rows under RLS; its tenant is this one, which is not a store. Its status is
-- 'platform' and its slug matches no store slug pattern, so no resolver, signup or fleet path can
-- reach it; store lists and counts skip status 'platform'.

alter table tenants drop constraint if exists tenants_status_check;
alter table tenants add constraint tenants_status_check
  check (status in ('active', 'suspended', 'platform'));

insert into tenants (id, slug, name, plan, status)
values ('00000000-0000-4000-8000-000000000001', '_platform', 'Venduá', 'platform', 'platform')
on conflict (id) do nothing;
