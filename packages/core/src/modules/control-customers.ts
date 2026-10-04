import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, uuidParam } from '../platform/http.ts';
import { isPublicHost, platformHost } from '../platform/store-origin.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { aiAllowanceTx } from './billing/ai-allowance.ts';
import { legacyPlan, planView, type PlanRow } from './billing/plans.ts';
import { controlTx } from './control.ts';

// /control/v1/customers (CRM "Visão" and "Lojas"): every store we serve, what it pays us, how it
// sells and how much of Duá it uses. One set-based read under controlTx; orders, admins and the
// billing hold come through definer functions that return aggregates only (store_order_days,
// store_fleet_facts), so staff never read a shopper's row.

const ZONE = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;
const LIST_CAP = 2000;

/** model costs are float sums: to the millionth of a dollar, so 0.1 + 0.2 reads 0.3 */
export const roundUsd = (n: number) => Math.round(n * 1e6) / 1e6;

export type CustomerRisk =
  | 'cancelled'
  | 'suspended'
  | 'past_due'
  | 'payment_pending'
  | 'probe_failing'
  | 'incident_open'
  | 'whatsapp_down'
  | 'ai_exhausted'
  | 'trial_ending'
  | 'no_orders_14d'
  | 'admin_idle_14d';

/** most severe first; `cancelled` stands alone */
const RISK_ORDER: readonly CustomerRisk[] = [
  'cancelled',
  'suspended',
  'past_due',
  'payment_pending',
  'probe_failing',
  'incident_open',
  'whatsapp_down',
  'ai_exhausted',
  'trial_ending',
  'no_orders_14d',
  'admin_idle_14d',
];

interface FleetRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  status: 'active' | 'suspended';
  plan: string;
  plan_row: PlanRow | null;
  hosts: string[] | null;
  sub_status: string | null;
  sub_method: string | null;
  sub_period_end: Date | null;
  sub_trial_end: Date | null;
  sub_price: number | null;
  billing_hold: boolean | null;
  admin_last_seen_at: Date | null;
  last_order_at: Date | null;
  orders_30d: number;
  gmv_30d: string;
  used_month: number;
  used_trial: number;
  pack_left: number;
  spend_30d: number;
  inv_id: string | null;
  inv_number: number | null;
  inv_amount: number | null;
  inv_kind: string | null;
  inv_due: Date | null;
  wa_state: string | null;
  wa_changed_at: Date | null;
  print_devices: number | null;
  print_seen_at: Date | null;
  probe: 'ok' | 'failing' | 'unknown' | null;
  incidents: number;
}

export interface FleetAi {
  included: boolean;
  period: 'month' | 'trial' | null;
  limit: number;
  used: number;
  packRemaining: number;
  remaining: number;
  spend30dUsd: number;
}

export interface CustomerRow {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  status: 'active' | 'suspended';
  url: string;
  plan: { id: string; name: string; priceCents: number };
  subscription: {
    status: string;
    method: string | null;
    currentPeriodEnd: Date | null;
    trialEndsAt: Date | null;
  } | null;
  mrrCents: number;
  openInvoice: {
    id: string;
    number: number;
    amountCents: number;
    kind: string;
    dueAt: Date | null;
  } | null;
  orders: { count30d: number; gmv30dCents: number; lastAt: Date | null };
  adminLastSeenAt: Date | null;
  ai: FleetAi;
  whatsapp: { state: string; stateChangedAt: Date } | null;
  printing: { devices: number; lastSeenAt: Date | null } | null;
  storefront: { probe: 'ok' | 'failing' | 'unknown'; openIncidents: number };
  risk: CustomerRisk[];
}

/** the first of the 30 São Paulo days that end today */
const from30 = (tx: Sql, now: Date) => tx`((${now}::timestamptz at time zone ${ZONE})::date - 29)`;

/**
 * Every store (or one), newest first, as the CRM lists it. The Vendedor's allowance follows
 * aiAllowanceTx and planHas('vendedor') exactly, computed for all stores in one statement.
 */
export async function customerRowsTx(
  tx: Sql,
  o: { storeDomain: string; now?: Date; tenantId?: string; uncapped?: boolean },
): Promise<CustomerRow[]> {
  const now = o.now ?? new Date();
  const only = o.tenantId ?? null;
  const rows = await tx<FleetRow[]>`
    with m as (
      select (date_trunc('month', ${now}::timestamptz at time zone ${ZONE}) at time zone ${ZONE})
        as start
    ),
    facts as (
      select * from store_fleet_facts() f where ${only}::uuid is null or f.tenant_id = ${only}
    ),
    od as (
      select d.tenant_id, sum(d.orders)::int as n, sum(d.revenue_cents)::bigint as gmv
      from store_order_days(${from30(tx, now)}) d
      where (${only}::uuid is null or d.tenant_id = ${only})
        and d.day <= (${now}::timestamptz at time zone ${ZONE})::date
      group by d.tenant_id
    ),
    conv as (
      select a.tenant_id,
        count(*) filter (where a.source = 'plan' and a.started_at >= m.start)::int as used_month,
        count(*) filter (where a.source = 'trial' and a.started_at >= s.created_at)::int
          as used_trial
      from ai_conversations a cross join m
        left join subscriptions s on s.tenant_id = a.tenant_id and s.status = 'trialing'
      where (${only}::uuid is null or a.tenant_id = ${only})
        and a.started_at >= least(m.start, coalesce(s.created_at, m.start))
      group by a.tenant_id
    ),
    packs as (
      select c.tenant_id, sum(c.remain)::int as remain from (
        select c.tenant_id, c.conversations - (
          select count(*) from ai_conversations a where a.credit_id = c.id) as remain
        from ai_credits c
        where c.expires_at > ${now} and (${only}::uuid is null or c.tenant_id = ${only})
      ) c where c.remain > 0
      group by c.tenant_id
    ),
    spend as (
      select e.tenant_id, sum((e.payload -> 'usage' ->> 'costUsd')::float8) as usd
      from agent_events e
      where e.type = 'model.responded' and e.at >= ${now}::timestamptz - interval '30 days'
        and (${only}::uuid is null or e.tenant_id = ${only})
      group by e.tenant_id
    ),
    inv as (
      -- the oldest plan invoice still to pay, as on /billing/stores
      select distinct on (i.tenant_id) i.tenant_id, i.id, i.number, i.amount_cents, i.kind, i.due_at
      from invoices i
      where i.status in ('open', 'failed') and i.kind <> 'ai_pack'
        and (${only}::uuid is null or i.tenant_id = ${only})
      order by i.tenant_id, i.period_start, i.number
    ),
    pr as (
      select d.tenant_id, count(*)::int as n, max(d.last_seen_at) as seen
      from print_devices d where ${only}::uuid is null or d.tenant_id = ${only}
      group by d.tenant_id
    ),
    probe as (
      -- the worst host stands for the store, as in fleet/view.ts
      select distinct on (p.tenant_id) p.tenant_id, p.status
      from fleet_probes p where ${only}::uuid is null or p.tenant_id = ${only}
      order by p.tenant_id, (p.status = 'failing') desc, (p.status = 'unknown') desc, p.host
    ),
    inc as (
      select i.tenant_id, count(*)::int as n from fleet_incidents i
      where i.resolved_at is null and i.tenant_id is not null
        and (${only}::uuid is null or i.tenant_id = ${only})
      group by i.tenant_id
    ),
    hosts as (
      select d.tenant_id, array_agg(d.host order by d.is_primary desc, length(d.host), d.host)
        as hosts
      from domains d where ${only}::uuid is null or d.tenant_id = ${only}
      group by d.tenant_id
    )
    select t.id, t.slug, t.name, t.created_at, t.status, t.plan,
      case when p.id is null then null else to_jsonb(p) end as plan_row,
      h.hosts,
      s.status as sub_status, s.method as sub_method, s.current_period_end as sub_period_end,
      s.trial_ends_at as sub_trial_end, sp.price_cents as sub_price,
      f.billing_hold, f.admin_last_seen_at, f.last_order_at,
      coalesce(od.n, 0) as orders_30d, coalesce(od.gmv, 0) as gmv_30d,
      coalesce(conv.used_month, 0) as used_month, coalesce(conv.used_trial, 0) as used_trial,
      coalesce(packs.remain, 0) as pack_left, coalesce(spend.usd, 0)::float8 as spend_30d,
      inv.id as inv_id, inv.number as inv_number, inv.amount_cents as inv_amount,
      inv.kind as inv_kind, inv.due_at as inv_due,
      wa.state as wa_state, wa.state_changed_at as wa_changed_at,
      pr.n as print_devices, pr.seen as print_seen_at,
      probe.status as probe, coalesce(inc.n, 0) as incidents
    from tenants t
      left join plans p on p.id = t.plan
      left join subscriptions s on s.tenant_id = t.id
      left join plans sp on sp.id = s.plan_id
      left join facts f on f.tenant_id = t.id
      left join od on od.tenant_id = t.id
      left join conv on conv.tenant_id = t.id
      left join packs on packs.tenant_id = t.id
      left join spend on spend.tenant_id = t.id
      left join inv on inv.tenant_id = t.id
      left join store_whatsapp wa on wa.tenant_id = t.id
      left join pr on pr.tenant_id = t.id
      left join probe on probe.tenant_id = t.id
      left join inc on inc.tenant_id = t.id
      left join hosts h on h.tenant_id = t.id
    where ${only}::uuid is null or t.id = ${only}
    order by t.created_at desc, t.id
    limit ${o.uncapped ? null : LIST_CAP}
  `;
  return rows.map((r) => customerJson(r, o.storeDomain, now));
}

function customerJson(r: FleetRow, storeDomain: string, now: Date): CustomerRow {
  const plan = r.plan_row ? planView(r.plan_row) : legacyPlan(r.plan);
  // planStanding: a store without a subscription counts as paid while it isn't held
  const paid = r.sub_status
    ? r.sub_status === 'active' || r.sub_status === 'past_due'
    : !r.billing_hold;
  const trial = r.sub_status === 'trialing';
  const included = plan.features.vendedor && (paid || trial);
  const packRemaining = Math.max(0, r.pack_left);
  const limit = trial ? plan.aiTrialConversations : plan.aiConversations;
  const used = trial ? r.used_trial : r.used_month;
  const ai: FleetAi = included
    ? {
        included,
        period: trial ? 'trial' : 'month',
        limit,
        used,
        packRemaining,
        remaining: Math.max(0, limit - used) + (trial ? 0 : packRemaining),
        spend30dUsd: roundUsd(Number(r.spend_30d)),
      }
    : {
        included,
        period: null,
        limit: 0,
        used: 0,
        packRemaining,
        remaining: 0,
        spend30dUsd: roundUsd(Number(r.spend_30d)),
      };
  const host = r.hosts?.find(isPublicHost) ?? platformHost(r.slug, storeDomain);
  const row: CustomerRow = {
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdAt: r.created_at,
    status: r.status,
    url: `https://${host}`,
    plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents ?? 0 },
    subscription: r.sub_status
      ? {
          status: r.sub_status,
          method: r.sub_method,
          currentPeriodEnd: r.sub_period_end,
          trialEndsAt: r.sub_trial_end,
        }
      : null,
    mrrCents: r.sub_status === 'active' || r.sub_status === 'past_due' ? (r.sub_price ?? 0) : 0,
    openInvoice: r.inv_id
      ? {
          id: r.inv_id,
          number: r.inv_number!,
          amountCents: r.inv_amount!,
          kind: r.inv_kind!,
          dueAt: r.inv_due,
        }
      : null,
    orders: { count30d: r.orders_30d, gmv30dCents: Number(r.gmv_30d), lastAt: r.last_order_at },
    adminLastSeenAt: r.admin_last_seen_at,
    ai,
    whatsapp: r.wa_state ? { state: r.wa_state, stateChangedAt: r.wa_changed_at! } : null,
    printing: r.print_devices ? { devices: r.print_devices, lastSeenAt: r.print_seen_at } : null,
    storefront: { probe: r.probe ?? 'unknown', openIncidents: r.incidents },
    risk: [],
  };
  row.risk = riskOf(row, now);
  return row;
}

export function riskOf(r: CustomerRow, now: Date): CustomerRisk[] {
  const sub = r.subscription?.status;
  if (sub === 'cancelled') return ['cancelled'];
  const ago = (d: Date | null) => (d ? now.getTime() - d.getTime() : Infinity);
  const out = new Set<CustomerRisk>();
  if (r.status === 'suspended') out.add('suspended');
  if (sub === 'past_due') out.add('past_due');
  if (sub === 'pending') out.add('payment_pending');
  if (r.storefront.probe === 'failing') out.add('probe_failing');
  if (r.storefront.openIncidents > 0) out.add('incident_open');
  if (r.whatsapp && ['logged_out', 'banned', 'error'].includes(r.whatsapp.state))
    out.add('whatsapp_down');
  if (r.ai.included && r.ai.remaining === 0) out.add('ai_exhausted');
  const trialEnd = r.subscription?.trialEndsAt;
  if (sub === 'trialing' && trialEnd && trialEnd.getTime() - now.getTime() <= 7 * DAY_MS)
    out.add('trial_ending');
  // a store younger than 14 days hasn't had the time to go quiet
  const settled = ago(r.createdAt) > 14 * DAY_MS;
  if (settled && ago(r.orders.lastAt) > 14 * DAY_MS) out.add('no_orders_14d');
  if (settled && ago(r.adminLastSeenAt) > 14 * DAY_MS) out.add('admin_idle_14d');
  return RISK_ORDER.filter((k) => out.has(k));
}

const severity = (risk: CustomerRisk[]) => (risk.length ? RISK_ORDER.indexOf(risk[0]!) : 99);

async function overviewTx(tx: Sql, storeDomain: string, now: Date) {
  // the totals below sum these rows, so they can't stop at the list's cap
  const rows = await customerRowsTx(tx, { storeDomain, now, uncapped: true });
  const [daily, byModel, totals, byPlan] = await Promise.all([
    tx<{ day: string; orders: number; gmv: string }[]>`
      select to_char(g.day, 'YYYY-MM-DD') as day, coalesce(sum(d.orders), 0)::int as orders,
             coalesce(sum(d.revenue_cents), 0)::bigint as gmv
      from generate_series(${from30(tx, now)},
                           (${now}::timestamptz at time zone ${ZONE})::date, interval '1 day') g(day)
        left join store_order_days(${from30(tx, now)}) d on d.day = g.day::date
      group by g.day order by g.day
    `,
    tx<{ provider: string; model: string; calls: number; usd: number }[]>`
      select coalesce(e.payload ->> 'provider', '?') as provider,
             coalesce(e.payload ->> 'model', '?') as model, count(*)::int as calls,
             coalesce(sum((e.payload -> 'usage' ->> 'costUsd')::float8), 0)::float8 as usd
      from agent_events e
      where e.type = 'model.responded' and e.at >= ${now}::timestamptz - interval '30 days'
      group by 1, 2 order by usd desc, calls desc
    `,
    tx<
      {
        conversations: number;
        open_count: number;
        open_amount: string;
        cancelled_30d: number;
      }[]
    >`
      select
        (select count(*)::int from ai_conversations
          where started_at >= (date_trunc('month', ${now}::timestamptz at time zone ${ZONE})
                               at time zone ${ZONE})) as conversations,
        (select count(*)::int from invoices
          where status in ('open', 'failed') and kind <> 'ai_pack') as open_count,
        (select coalesce(sum(amount_cents), 0)::bigint from invoices
          where status in ('open', 'failed') and kind <> 'ai_pack') as open_amount,
        (select count(*)::int from subscriptions
          where status = 'cancelled'
            and status_changed_at >= ${now}::timestamptz - interval '30 days') as cancelled_30d
    `,
    // what each paying store's subscription charges: the plan it pays for, not one it awaits
    tx<{ plan_id: string; name: string; stores: number; mrr: string }[]>`
      select s.plan_id, p.name, count(*)::int as stores, sum(p.price_cents)::bigint as mrr
      from subscriptions s join plans p on p.id = s.plan_id
      where s.status in ('active', 'past_due')
      group by s.plan_id, p.name order by mrr desc, s.plan_id
    `,
  ]);
  const t = totals[0]!;
  const week = now.getTime() + 7 * DAY_MS;
  const sum = (f: (r: CustomerRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const subIs = (r: CustomerRow, s: string) => r.subscription?.status === s;
  return {
    asOf: now,
    revenue: {
      mrrCents: byPlan.reduce((n, b) => n + Number(b.mrr), 0),
      byPlan: byPlan.map((b) => ({
        planId: b.plan_id,
        name: b.name,
        stores: b.stores,
        mrrCents: Number(b.mrr),
      })),
      payingStores: rows.filter((r) => subIs(r, 'active') || subIs(r, 'past_due')).length,
      trialing: rows.filter((r) => subIs(r, 'trialing')).length,
      pastDue: rows.filter((r) => subIs(r, 'past_due')).length,
      openInvoices: { count: t.open_count, amountCents: Number(t.open_amount) },
      trialsEndingSoon: rows
        .filter(
          (r) =>
            subIs(r, 'trialing') &&
            r.subscription!.trialEndsAt &&
            r.subscription!.trialEndsAt.getTime() <= week,
        )
        .sort((a, b) => +a.subscription!.trialEndsAt! - +b.subscription!.trialEndsAt!)
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          plan: r.plan.name,
          trialEndsAt: r.subscription!.trialEndsAt!,
        })),
      newStores30d: rows.filter((r) => now.getTime() - r.createdAt.getTime() <= 30 * DAY_MS).length,
      cancelled30d: t.cancelled_30d,
    },
    activity: {
      orders30d: sum((r) => r.orders.count30d),
      gmv30dCents: sum((r) => r.orders.gmv30dCents),
      activeStores30d: rows.filter((r) => r.orders.count30d > 0).length,
      daily: daily.map((d) => ({ day: d.day, orders: d.orders, gmvCents: Number(d.gmv) })),
    },
    ai: {
      conversationsThisMonth: t.conversations,
      spend30dUsd: roundUsd(sum((r) => r.ai.spend30dUsd)),
      byModel: byModel.map((m) => ({ ...m, usd: roundUsd(Number(m.usd)) })),
      exhaustedStores: rows.filter((r) => r.risk.includes('ai_exhausted')).length,
      top: rows
        .filter((r) => r.ai.used > 0 || r.ai.spend30dUsd > 0)
        .sort((a, b) => b.ai.spend30dUsd - a.ai.spend30dUsd || b.ai.used - a.ai.used)
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          used: r.ai.used,
          limit: r.ai.limit,
          spend30dUsd: r.ai.spend30dUsd,
        })),
    },
    atRisk: rows
      .filter((r) => r.risk.length && r.risk[0] !== 'cancelled')
      .sort((a, b) => severity(a.risk) - severity(b.risk) || b.risk.length - a.risk.length)
      .slice(0, 20)
      .map((r) => ({ id: r.id, slug: r.slug, name: r.name, risk: r.risk })),
    totals: {
      stores: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      suspended: rows.filter((r) => r.status === 'suspended').length,
    },
  };
}

async function detailTx(tx: Sql, storeDomain: string, id: string, now: Date) {
  const store = (await customerRowsTx(tx, { storeDomain, now, tenantId: id }))[0];
  if (!store) return null;
  // merchant_users and store_settings are tenant-scoped: read them as the store from here
  await tx`select set_config('vendua.tenant_id', ${id}, true)`;
  const ai = await aiAllowanceTx(tx, id, now);
  const [daily, invoices, users, printers, wa, sf] = await Promise.all([
    tx<{ day: string; orders: number; gmv: string; usd: number; conversations: number }[]>`
      with g as (
        select g.day::date as day
        from generate_series(${from30(tx, now)},
                             (${now}::timestamptz at time zone ${ZONE})::date, interval '1 day') g(day)
      ),
      od as (select d.day, d.orders, d.revenue_cents from store_order_days(${from30(tx, now)}) d
             where d.tenant_id = ${id}),
      ev as (
        select (e.at at time zone ${ZONE})::date as day,
               sum((e.payload -> 'usage' ->> 'costUsd')::float8) as usd
        from agent_events e
        where e.tenant_id = ${id} and e.type = 'model.responded'
          and e.at >= (${from30(tx, now)})::timestamp at time zone ${ZONE}
        group by 1
      ),
      cv as (
        select (a.started_at at time zone ${ZONE})::date as day, count(*)::int as n
        from ai_conversations a
        where a.tenant_id = ${id}
          and a.started_at >= (${from30(tx, now)})::timestamp at time zone ${ZONE}
        group by 1
      )
      select to_char(g.day, 'YYYY-MM-DD') as day, coalesce(od.orders, 0)::int as orders,
             coalesce(od.revenue_cents, 0)::bigint as gmv, coalesce(ev.usd, 0)::float8 as usd,
             coalesce(cv.n, 0)::int as conversations
      from g left join od on od.day = g.day left join ev on ev.day = g.day
        left join cv on cv.day = g.day
      order by g.day
    `,
    tx<
      {
        id: string;
        number: number;
        kind: string;
        status: 'open' | 'paid' | 'failed' | 'void';
        amount_cents: number;
        created_at: Date;
        due_at: Date | null;
        paid_at: Date | null;
      }[]
    >`
      select id, number, kind, status, amount_cents, created_at, due_at, paid_at from invoices
      where tenant_id = ${id} order by created_at desc, number desc limit 12
    `,
    tx<{ id: string; name: string | null; role: string; last_seen_at: Date | null }[]>`
      select id, name, role, last_seen_at from merchant_users
      where tenant_id = ${id} and status = 'active'
      order by last_seen_at desc nulls last, created_at
    `,
    tx<{ id: string; name: string; last_seen_at: Date | null }[]>`
      select id, name, last_seen_at from print_devices where tenant_id = ${id}
      order by last_seen_at desc nulls last, created_at
    `,
    tx<{ state: string; connected_at: Date | null; state_changed_at: Date }[]>`
      select state, connected_at, state_changed_at from store_whatsapp where tenant_id = ${id}
    `,
    tx<{ last_probe_at: Date | null; kernel: string | null }[]>`
      select (select max(last_checked_at) from fleet_probes where tenant_id = ${id}) as last_probe_at,
             (select r.kernel_version from storefront_ops o join releases r on r.id = o.live_release_id
               where o.tenant_id = ${id}) as kernel
    `,
  ]);
  const w = wa[0];
  return {
    store,
    ai: {
      included: ai.included,
      period: ai.period,
      limit: ai.limit,
      used: ai.used,
      packRemaining: ai.packRemaining,
      packExpiresAt: ai.packExpiresAt,
      remaining: ai.remaining,
      resetsAt: ai.resetsAt,
    },
    daily: daily.map((d) => ({
      day: d.day,
      orders: d.orders,
      gmvCents: Number(d.gmv),
      aiUsd: roundUsd(Number(d.usd)),
      conversations: d.conversations,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      kind: i.kind,
      status: i.status,
      amountCents: i.amount_cents,
      createdAt: i.created_at,
      dueAt: i.due_at,
      paidAt: i.paid_at,
    })),
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role, lastSeenAt: u.last_seen_at })),
    printers: printers.map((p) => ({ id: p.id, name: p.name, lastSeenAt: p.last_seen_at })),
    whatsapp: w
      ? { state: w.state, connectedAt: w.connected_at, stateChangedAt: w.state_changed_at }
      : null,
    storefront: {
      probe: store.storefront.probe,
      lastProbeAt: sf[0]?.last_probe_at ?? null,
      openIncidents: store.storefront.openIncidents,
      kernel: sf[0]?.kernel ?? null,
    },
  };
}

export function mountControlCustomers(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  /** `<slug>.<storeDomain>` fallback for a store's address (default VENDUA_STORE_DOMAIN) */
  storeDomain?: string;
  /** the clock, for tests */
  now?: () => Date;
}) {
  const { app, sql, controlGate } = o;
  const storeDomain = o.storeDomain ?? process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';
  const clock = o.now ?? (() => new Date());

  app.get('/control/v1/customers', async (c) => {
    controlGate(c);
    const now = clock();
    const stores = await controlTx(sql, (tx) => customerRowsTx(tx, { storeDomain, now }));
    c.header('cache-control', 'no-store');
    return c.json({ asOf: now, stores });
  });

  app.get('/control/v1/customers/overview', async (c) => {
    controlGate(c);
    const out = await controlTx(sql, (tx) => overviewTx(tx, storeDomain, clock()));
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  app.get('/control/v1/customers/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id').toLowerCase();
    const out = await controlTx(sql, (tx) => detailTx(tx, storeDomain, id, clock()));
    if (!out) throw new HttpError(404, 'NOT_FOUND', 'store not found');
    c.header('cache-control', 'no-store');
    return c.json(out);
  });
}
