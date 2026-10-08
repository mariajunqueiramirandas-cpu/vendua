import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { addDays, localDateOf, type LocalDate } from '../platform/tz.ts';
import { isDate, need, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { storeTz } from './routes-orders.ts';

// Relatórios read orders directly over the (tenant_id, placed_at) index. At pilot
// volume (hundreds of orders/month) a year-range query is milliseconds; the rollup
// tables the plan mentions become worth it when a store crosses ~100k orders.

const MAX_DAYS = 366;
export const PERIODS = ['hoje', 'ontem', '7d', '30d', 'mes', 'mes-passado'] as const;
export type Period = (typeof PERIODS)[number];

const iso = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
/** the 1st of `d`'s month, `back` months earlier */
function monthStart(d: LocalDate, back = 0): LocalDate {
  const m = new Date(Date.UTC(d.year, d.month - 1 - back, 1));
  return { year: m.getUTCFullYear(), month: m.getUTCMonth() + 1, day: 1, weekday: m.getUTCDay() };
}
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * A preset's days in the store's own calendar, and what it's compared with: the same number of
 * days before it, except months, which compare with the month before (to the same day, for this one).
 */
export function presetRange(period: Period, tz: string, now = new Date()) {
  const today = localDateOf(now, tz);
  const back = (from: LocalDate, to: LocalDate) => {
    const n = spanDays(iso(from), iso(to));
    return [from, to, addDays(from, -n), addDays(from, -1)] as const;
  };
  const [from, to, prevFrom, prevTo] = (() => {
    switch (period) {
      case 'hoje':
        return back(today, today);
      case 'ontem':
        return back(addDays(today, -1), addDays(today, -1));
      case '7d':
        return back(addDays(today, -6), today);
      case '30d':
        return back(addDays(today, -29), today);
      case 'mes': {
        const prevEnd = addDays(monthStart(today), -1);
        const prevStart = monthStart(today, 1);
        return [
          monthStart(today),
          today,
          prevStart,
          today.day < prevEnd.day ? addDays(prevStart, today.day - 1) : prevEnd,
        ] as const;
      }
      case 'mes-passado':
        return [
          monthStart(today, 1),
          addDays(monthStart(today), -1),
          monthStart(today, 2),
          addDays(monthStart(today, 1), -1),
        ] as const;
    }
  })();
  return {
    from: iso(from),
    to: iso(to),
    days: spanDays(iso(from), iso(to)),
    prevFrom: iso(prevFrom),
    prevTo: iso(prevTo),
  };
}

/** `?period=` (a preset, in the store's calendar) or `?from=&to=` (a custom range). */
function range(c: Context, tz: string) {
  const period = c.req.query('period');
  if (period !== undefined && period !== 'custom') {
    if (!(PERIODS as readonly string[]).includes(period))
      throw new HttpError(400, 'BAD_REQUEST', `period must be one of ${PERIODS.join(', ')}`);
    return { period, ...presetRange(period as Period, tz) };
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isDate(from) || !isDate(to))
    throw new HttpError(400, 'BAD_REQUEST', 'from and to are required (YYYY-MM-DD)');
  const days = spanDays(from, to);
  if (!(days >= 1 && days <= MAX_DAYS))
    throw new HttpError(400, 'BAD_REQUEST', `the range must be 1–${MAX_DAYS} days`);
  const prevTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * 86_400_000).toISOString().slice(0, 10);
  if (!isDate(prevFrom)) throw new HttpError(400, 'BAD_REQUEST', 'from is out of range');
  return { period: 'custom', from, to, days, prevFrom, prevTo };
}

// Spreadsheet downloads open in Excel/Sheets with the pt-BR locale: semicolons, a BOM, comma
// decimals. Money is formatted here, from integer cents, so no client ever does the arithmetic.
export const csvMoney = (cents: number) => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
};

export function csvCell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  // formula injection guard for spreadsheet apps, which skip leading blanks/controls
  // (a plain signed amount like -1,50 is a number, not a formula)
  const safe = !/^-\d+(,\d+)?$/.test(s) && /^[\s\x00-\x1f\x7f]*[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";,\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvResponse(c: Context, filename: string, head: string[], rows: unknown[][]) {
  c.header('content-type', 'text/csv; charset=utf-8');
  c.header('content-disposition', `attachment; filename="${filename}"`);
  c.header('cache-control', 'no-store');
  return c.body(
    '\uFEFF' + [head.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))].join('\r\n'),
  );
}

// money the store kept: an online refund or a chargeback leaves the order's state alone
const kept = (tx: Sql, a = '') =>
  tx.unsafe(
    `${a}state not in ('cancelled', 'refunded') and coalesce(${a}payment ->> 'status', '') not in ('refunded', 'charged_back')`,
  );
const net = (tx: Sql, a = '') =>
  tx.unsafe(
    `(${a}total_cents - least(${a}total_cents, coalesce((${a}payment ->> 'refundedCents')::int, 0)))`,
  );

async function kpis(tx: Sql, tenantId: string, tz: string, from: string, to: string) {
  return (
    await tx<
      {
        revenueCents: number;
        orders: number;
        avgTicketCents: number;
        customers: number;
        newCustomers: number;
        cancelled: number;
        deliveryShare: number;
      }[]
    >`
      with o as (
        select * from orders
        where tenant_id = ${tenantId}
          and (placed_at at time zone ${tz})::date between ${from}::date and ${to}::date
      ), ok as (select * from o where ${kept(tx)})
      select
        coalesce((select sum(${net(tx)}) from ok), 0)::int as "revenueCents",
        (select count(*) from ok)::int as orders,
        coalesce((select round(avg(${net(tx)})) from ok), 0)::int as "avgTicketCents",
        (select count(distinct customer_phone) from ok)::int as customers,
        (select count(distinct customer_phone) from ok
          where not exists (
            select 1 from orders p where p.tenant_id = ${tenantId} and p.customer_phone = ok.customer_phone
              and p.placed_at < (${from}::date::timestamp at time zone ${tz})
          ))::int as "newCustomers",
        (select count(*) from o where state = 'cancelled')::int as cancelled,
        coalesce((select round(100.0 * count(*) filter (where delivery ->> 'mode' = 'delivery') / nullif(count(*), 0))
                  from ok), 0)::int as "deliveryShare"
    `
  )[0]!;
}

export function mountReports(d: AdminDeps) {
  const { admin, sql } = d;
  const { read, named } = handlers(d);

  admin.get(
    '/reports',
    named('reports').read('manager', async (tx, t, _m, c) => {
      const tz = await storeTz(tx, t.id);
      const r = range(c, tz);
      const current = await kpis(tx, t.id, tz, r.from, r.to);
      const previous = await kpis(tx, t.id, tz, r.prevFrom, r.prevTo);
      const series = await tx`
        select d::date::text as date,
               coalesce(sum(${net(tx, 'o.')}) filter (where ${kept(tx, 'o.')}), 0)::int as "revenueCents",
               count(o.id) filter (where ${kept(tx, 'o.')})::int as orders
        from generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d
        left join orders o on o.tenant_id = ${t.id} and (o.placed_at at time zone ${tz})::date = d::date
        group by d order by d
      `;
      const hours = await tx`
        select extract(dow from placed_at at time zone ${tz})::int as dow,
               extract(hour from placed_at at time zone ${tz})::int as hour,
               count(*)::int as orders
        from orders
        where tenant_id = ${t.id} and ${kept(tx)}
          and (placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        group by 1, 2
      `;
      const products = await tx`
        select coalesce(i.product_id::text, i.name) as key, (array_agg(i.name))[1] as name,
               sum(i.qty)::int as qty,
               -- a partial refund comes off each line in proportion, as it does off the order
               sum(case when o.total_cents > 0
                        then round(i.line_total_cents::numeric * ${net(tx, 'o.')} / o.total_cents)
                        else i.line_total_cents end)::int as "revenueCents",
               (select url from product_media m where m.product_id = i.product_id order by sort limit 1) as "imageUrl"
        from order_items i join orders o on o.id = i.order_id
        where o.tenant_id = ${t.id} and ${kept(tx, 'o.')}
          and (o.placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        group by 1, i.product_id order by qty desc limit 10
      `;
      const funnel = (
        await tx<
          {
            visits: number;
            productViews: number;
            carts: number;
            checkouts: number;
            orders: number;
          }[]
        >`
          select
            count(distinct session_id) filter (where name = 'page_view')::int as visits,
            count(distinct session_id) filter (where name = 'product_view')::int as "productViews",
            count(distinct session_id) filter (where name = 'add_to_cart')::int as carts,
            count(distinct session_id) filter (where name = 'checkout_start')::int as checkouts,
            count(distinct session_id) filter (where name = 'order_placed')::int as orders
          from analytics_events
          where tenant_id = ${t.id}
            and (at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        `
      )[0]!;
      const orderZones = await tx<
        { name: string; orders: number; revenueCents: number; feesCents: number }[]
      >`
        select case when delivery ->> 'mode' = 'pickup' then 'Retirada'
                    else coalesce(delivery ->> 'zoneName', delivery ->> 'neighborhood', 'Entrega') end as name,
               count(*)::int as orders, sum(${net(tx)})::int as "revenueCents",
               coalesce(sum(delivery_fee_cents), 0)::int as "feesCents"
        from orders
        where tenant_id = ${t.id} and ${kept(tx)}
          and (placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        group by 1 order by orders desc limit 20
      `;
      // zone conversion: carts that asked for delivery there (Core's delivery_quoted, one
      // session = one cart) and how many of those carts became an order
      const quoted = await tx<{ zone: string; quotes: number; converted: number }[]>`
        with q as (
          select distinct session_id, props ->> 'zone' as zone from analytics_events
          where tenant_id = ${t.id} and name = 'delivery_quoted' and (props ->> 'eligible')::boolean
            and props ->> 'zone' is not null
            and (at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        )
        select q.zone, count(*)::int as quotes,
               count(o.id) filter (where ${kept(tx, 'o.')})::int as converted
        from q left join orders o on o.tenant_id = ${t.id} and o.cart_id::text = q.session_id
        group by q.zone
      `;
      const byZone = new Map(quoted.map((q) => [q.zone, q]));
      const zones = orderZones.map((z) => {
        const q = byZone.get(z.name);
        byZone.delete(z.name);
        return {
          ...z,
          quotes: q?.quotes ?? 0,
          conversion: q?.quotes ? Math.round((1000 * q.converted) / q.quotes) / 1000 : null,
        };
      });
      for (const q of byZone.values())
        zones.push({
          name: q.zone,
          orders: 0,
          revenueCents: 0,
          feesCents: 0,
          quotes: q.quotes,
          conversion: Math.round((1000 * q.converted) / q.quotes) / 1000,
        });
      const outOfZone = await tx<{ neighborhood: string; quotes: number }[]>`
        select (array_agg(nb order by at desc))[1] as neighborhood, count(distinct session_id)::int as quotes
        from (
          select session_id, at, trim(props ->> 'neighborhood') as nb from analytics_events
          where tenant_id = ${t.id} and name = 'delivery_quoted' and not (props ->> 'eligible')::boolean
            and coalesce(trim(props ->> 'neighborhood'), '') <> ''
            and (at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        ) x
        group by lower(nb) order by quotes desc, neighborhood limit 10
      `;
      // a counter sale split across methods counts under each of them (its payment.pdv split), and
      // a comanda round under what its comanda was paid with, pro rata (the leftover cent to the
      // largest), so neither shows up as "mixed" or "tab"; an open comanda's rounds stay "tab"
      const payments = await tx`
        with o as (
          select id, tab_id, payment, ${net(tx)}::bigint as cents from orders
          where tenant_id = ${t.id} and ${kept(tx)}
            and (placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        ),
        tab_pay as (
          select tab_id, method, sum(amount_cents)::bigint as paid,
                 (sum(sum(amount_cents)) over (partition by tab_id))::bigint as tab_paid
          from pdv_payments
          where tenant_id = ${t.id} and voided_at is null
            and tab_id in (select tab_id from o where payment ->> 'method' = 'tab')
            -- an open comanda's part payments don't say yet what paid its rounds: they stay 'tab'
            and tab_id in (select id from pdv_tabs where tenant_id = ${t.id} and status = 'closed')
          group by 1, 2
        ),
        tab_parts as (
          select o.id, tp.method, o.cents, tp.paid, o.cents * tp.paid / tp.tab_paid as base
          from o join tab_pay tp on tp.tab_id = o.tab_id
          where o.payment ->> 'method' = 'tab'
        ),
        parts as (
          select o.id, x.method, x.cents::bigint as cents
          from o cross join jsonb_to_recordset(
            case jsonb_typeof(o.payment -> 'pdv') when 'array' then o.payment -> 'pdv' else '[]' end
          ) as x(method text, cents int)
          where o.payment ->> 'method' = 'mixed' and (o.payment -> 'pdv' -> 0) is not null
          union all
          select id, method, base + case when row_number() over (partition by id order by paid desc, method) = 1
                                         then cents - sum(base) over (partition by id) else 0 end
          from tab_parts
          union all
          select o.id, o.payment ->> 'method', o.cents from o
          where not (o.payment ->> 'method' = 'mixed' and (o.payment -> 'pdv' -> 0) is not null)
            and not exists (select 1 from tab_parts tp where tp.id = o.id)
        )
        select method, count(distinct id)::int as orders, sum(cents)::int as "revenueCents"
        from parts group by 1 order by orders desc, method
      `;
      const coupons = await tx`
        select o.coupon_code as code, count(*)::int as orders, sum(o.discount_cents)::int as "discountCents",
               sum(${net(tx, 'o.')})::int as "revenueCents"
        from orders o
        where o.tenant_id = ${t.id} and o.coupon_code is not null and ${kept(tx, 'o.')}
          and (o.placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        group by 1 order by orders desc limit 10
      `;
      const repeat = (
        await tx<{ customers: number; returning: number }[]>`
          select count(*)::int as customers, count(*) filter (where n >= 2)::int as returning from (
            select customer_phone, count(*) as n from orders
            where tenant_id = ${t.id} and customer_phone is not null and ${kept(tx)}
              and (placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
            group by customer_phone
          ) x
        `
      )[0]!;
      return {
        range: r,
        current,
        previous,
        series,
        hours,
        products,
        funnel,
        zones,
        outOfZone,
        payments,
        coupons,
        repeat,
      };
    }),
  );

  // CSV of the orders in range — opens in Excel/Sheets (semicolons, BOM, comma decimals: pt-BR locale)
  admin.get('/reports/orders.csv', async (c) => {
    need(c, 'manager');
    const t = c.get('tenant');
    const { r, rows } = await withTenant(sql, t.id, async (tx) => {
      const tz = await storeTz(tx, t.id);
      const r = range(c, tz);
      const rows = await tx<
        {
          number: number;
          placed: string;
          state: string;
          name: string;
          phone: string | null;
          mode: string;
          zone: string | null;
          method: string;
          pstatus: string;
          items: string;
          subtotal: number;
          fee: number;
          discount: number;
          adjustment: number;
          total: number;
          coupon: string | null;
        }[]
      >`
        select o.number, to_char(o.placed_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as placed, o.state,
               o.customer ->> 'name' as name, o.customer_phone as phone, o.delivery ->> 'mode' as mode,
               o.delivery ->> 'zoneName' as zone, o.payment ->> 'method' as method, o.payment ->> 'status' as pstatus,
               coalesce((select string_agg(i.qty || 'x ' || i.name, ', ' order by i.sort) from order_items i where i.order_id = o.id), '') as items,
               o.subtotal_cents as subtotal, o.delivery_fee_cents as fee, o.discount_cents as discount,
               o.payment_adjustment_cents as adjustment, o.total_cents as total, o.coupon_code as coupon
        from orders o
        where o.tenant_id = ${t.id}
          and (o.placed_at at time zone ${tz})::date between ${r.from}::date and ${r.to}::date
        order by o.placed_at
        limit 20000
      `;
      return { r, rows };
    });
    const head = [
      'pedido',
      'data',
      'situação',
      'cliente',
      'telefone',
      'modo',
      'área',
      'pagamento',
      'status pagamento',
      'itens',
      'subtotal',
      'entrega',
      'desconto',
      // signed: negative = discount for the payment method (total = subtotal + entrega - desconto + ajuste)
      'ajuste de pagamento',
      'total',
      'cupom',
    ];
    const lines = rows.map((o) => [
      o.number,
      o.placed,
      o.state,
      o.name,
      o.phone,
      o.mode,
      o.zone,
      o.method,
      o.pstatus,
      o.items,
      csvMoney(o.subtotal),
      csvMoney(o.fee),
      csvMoney(o.discount),
      csvMoney(o.adjustment),
      csvMoney(o.total),
      o.coupon,
    ]);
    return csvResponse(c, `pedidos-${r.from}-a-${r.to}.csv`, head, lines);
  });
}
