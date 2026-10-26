-- 0139_billing_day.sql — a plan month ends on the day it was first paid, in São Paulo. Each
-- period started at the last one's end + interval '1 month' in the server's zone (UTC), so a
-- store that paid on 31 January was billed on the 28th from February on, and one that paid at
-- 22h on the 30th (01h UTC on the 31st) ended a day off.
--   subscriptions.billing_day — the São Paulo day of the month the plan was paid on (1–31); null
--                               for a subscription never paid, whose month keeps its start's day
--   billing_month_after(from, day, months) — `months` plan months after `from`, on `day` (or the
--                               month's last day when it has fewer), at from's São Paulo time
-- Additive: a Core from before this one never reads the column or calls the function.

alter table subscriptions
  add column if not exists billing_day smallint check (billing_day between 1 and 31);

-- the day each paid subscription was anchored on: its first paid month's start (activate moves an
-- invoice's period_start to the moment it was paid)
update subscriptions s set billing_day = x.day
from (
  select i.tenant_id,
         extract(day from min(i.period_start) at time zone 'America/Sao_Paulo')::smallint as day
  from invoices i
  where i.status = 'paid' and i.kind = 'period'
  group by i.tenant_id
) x
where x.tenant_id = s.tenant_id and s.billing_day is null;

create or replace function billing_month_after(p_from timestamptz, p_day int, p_months int default 1)
returns timestamptz
language sql stable set search_path = public as $$
  select (m + make_interval(days => least(
            coalesce(p_day, extract(day from l)::int),
            extract(day from m + interval '1 month' - interval '1 day')::int) - 1)
          + (l - date_trunc('day', l))) at time zone 'America/Sao_Paulo'
  from (select p_from at time zone 'America/Sao_Paulo' as l) a,
       lateral (select date_trunc('month', a.l) + make_interval(months => p_months) as m) b
$$;
grant execute on function billing_month_after(timestamptz, int, int) to vendua_app;
