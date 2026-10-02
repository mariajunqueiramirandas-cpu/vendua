-- 0076_web_analytics.sql — privacy-first page views for Venduá's own surfaces, read in the CRM
-- (docs/architecture/15-analytics.md "Platform-facing analytics").
--   web_analytics_events — one row per page view on the marketing site or the merchant admin
--     (platform table: no store owns it). No cookie, no IP, no user agent: `visitor` is a hash
--     of (today's salt, IP, user agent) that only dedupes a visitor within one day.
--   web_analytics_salts  — the day's salt; yesterday's is deleted when today's is minted, so a
--     stored hash can't be recomputed (or linked to another day's) once the day is over.
--   web_analytics_salt() — the collector's only way to the salt; minting a day also prunes raw
--     events past 13 months.
--   store_order_days()   — the CRM's order totals per store and day (aggregates, never rows).
--   analytics_events: the CRM reads it across stores (select only) and by time alone.

create table if not exists web_analytics_events (
  id bigint generated always as identity primary key,
  -- the page's own random id: a re-sent beacon is one view (sendBeacon can't send headers)
  beacon_id text not null unique check (beacon_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  property text not null check (property in ('site', 'admin')),
  -- Brazil's calendar day the view counts on (a visitor is unique per day)
  day date not null,
  at timestamptz not null default now(),
  path text not null check (path ~ '^/' and char_length(path) <= 200),
  referrer text check (char_length(referrer) between 1 and 100),
  utm_source text check (char_length(utm_source) between 1 and 60),
  utm_medium text check (char_length(utm_medium) between 1 and 60),
  utm_campaign text check (char_length(utm_campaign) between 1 and 60),
  device text not null check (device in ('mobile', 'tablet', 'desktop')),
  visitor text not null check (visitor ~ '^[0-9a-f]{16}$')
);
create index if not exists web_analytics_events_by_day on web_analytics_events (property, day);
create index if not exists web_analytics_events_at on web_analytics_events (at);

alter table web_analytics_events enable row level security;
drop policy if exists staff_all on web_analytics_events;
create policy staff_all on web_analytics_events for all
  using (current_setting('vendua.control', true) = '1')
  with check (current_setting('vendua.control', true) = '1');
-- the public collector writes page views and never reads them back
drop policy if exists collect_insert on web_analytics_events;
create policy collect_insert on web_analytics_events for insert with check (true);
grant select, insert, update, delete on web_analytics_events to vendua_app;

create table if not exists web_analytics_salts (
  day date primary key,
  salt text not null
);
-- no policy: only web_analytics_salt() (security definer) touches it
alter table web_analytics_salts enable row level security;

-- the day is the database's own (Brazil's calendar), never the caller's: a skewed replica clock
-- can't mint tomorrow's salt early or bring back a deleted one
drop function if exists web_analytics_salt(date);
create or replace function web_analytics_salt()
returns table (day date, salt text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d date := (now() at time zone 'America/Sao_Paulo')::date;
  s text;
begin
  insert into web_analytics_salts as w (day, salt)
  values (d, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict on constraint web_analytics_salts_pkey do nothing
  returning w.salt into s;
  if s is not null then
    delete from web_analytics_salts w where w.day <> d;
    delete from web_analytics_events where at < now() - interval '13 months';
  else
    select w.salt into s from web_analytics_salts w where w.day = d;
  end if;
  return query select d, s;
end
$$;
revoke all on function web_analytics_salt() from public;
grant execute on function web_analytics_salt() to vendua_app;

-- The CRM's order totals across stores: per store and day, aggregates only, so staff never get a
-- row-level read of orders (shoppers' names and phones stay behind tenant RLS). Cancelled and
-- refunded orders don't count, as in the merchant's own reports. Empty outside vendua.control.
create or replace function store_order_days(p_from date)
returns table (tenant_id uuid, day date, orders int, revenue_cents bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.tenant_id, (o.placed_at at time zone 'America/Sao_Paulo')::date,
    count(*)::int, coalesce(sum(o.total_cents), 0)::bigint
  from orders o
  where current_setting('vendua.control', true) = '1'
    and o.placed_at >= p_from::timestamp at time zone 'America/Sao_Paulo'
    and o.state <> all (array['cancelled', 'refunded'])
  group by 1, 2
$$;
revoke all on function store_order_days(date) from public;
grant execute on function store_order_days(date) to vendua_app;

drop policy if exists control_read on analytics_events;
create policy control_read on analytics_events for select
  using (current_setting('vendua.control', true) = '1');
create index if not exists analytics_events_at on analytics_events (at);
