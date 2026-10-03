import type { Sql } from '../platform/db.ts';
import { replyPercentiles } from './views.ts';

// Resultados (UX §3.8, sales-agent.md §6): what it closed and what it helped, apart, with the
// attribution window stated; the funnel; its ticket against the site's; what selling added;
// speed; handoffs; and up to three proposals for the week, each with its evidence.

export type Period = 'today' | '7d' | '30d';

/** A storefront order within this long of the Vendedor sending that phone a sacola link. */
export const ASSIST_WINDOW_HOURS = 24;

export interface ResultsView {
  period: Period;
  since: string;
  closed: { cents: number; orders: number; averageCents: number | null };
  assisted: { cents: number; orders: number; windowHours: number };
  siteAverageCents: number | null;
  funnel: { conversations: number; carts: number; summaries: number; orders: number };
  suggestions: { offered: number; taken: number; revenueCents: number };
  recovered: { orders: number; cents: number };
  replySec: { p50: number | null; p95: number | null };
  handoffs: { reason: string; count: number }[];
  proposals: {
    kind: 'answer' | 'retire_suggestion' | 'recovery_delay';
    text: string;
    evidence: string;
    ref: string | null;
  }[];
  enoughData: boolean;
}

export function sinceOf(period: Period, now: Date): Date {
  if (period === 'today') {
    const local = new Date(now.getTime() - 3 * 3600_000);
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3600_000,
    );
  }
  return new Date(now.getTime() - (period === '7d' ? 7 : 30) * 86400_000);
}

export async function resultsView(
  tx: Sql,
  tenantId: string,
  period: Period,
  now = new Date(),
): Promise<ResultsView> {
  const since = sinceOf(period, now);
  const [r] = await tx<
    {
      closed_cents: number;
      closed_n: number;
      site_avg: number | null;
      conversations: number;
      carts: number;
      summaries: number;
      offered: number;
      taken: number;
      sugg_cents: number;
      assisted_cents: number;
      assisted_n: number;
      recovered_n: number;
      recovered_cents: number;
    }[]
  >`
    select
      coalesce(sum(o.total_cents) filter (where o.source = 'whatsapp_agent'), 0)::int as closed_cents,
      count(*) filter (where o.source = 'whatsapp_agent')::int as closed_n,
      avg(o.total_cents) filter (where o.source = 'storefront')::int as site_avg,
      (select count(*) from shopper_threads t where t.tenant_id = ${tenantId} and t.channel = 'whatsapp'
         and t.class <> 'other' and t.last_in_at >= ${since})::int as conversations,
      (select count(*) from shopper_threads t where t.tenant_id = ${tenantId} and t.channel = 'whatsapp'
         and t.last_in_at >= ${since} and (t.cart_id is not null or t.order_id is not null))::int as carts,
      (select count(distinct m.thread_id) from shopper_messages m join shopper_threads t on t.id = m.thread_id
         where m.tenant_id = ${tenantId} and t.channel = 'whatsapp' and m.meta ->> 'card' = 'summary'
           and m.status <> 'draft' and m.created_at >= ${since})::int as summaries,
      (select count(*) from suggestion_events s where s.tenant_id = ${tenantId} and s.created_at >= ${since})::int as offered,
      (select count(*) from suggestion_events s where s.tenant_id = ${tenantId} and s.created_at >= ${since} and s.outcome = 'taken')::int as taken,
      (select coalesce(sum(s.price_cents), 0) from suggestion_events s where s.tenant_id = ${tenantId}
         and s.created_at >= ${since} and s.outcome = 'taken')::int as sugg_cents,
      coalesce(sum(o.total_cents) filter (where o.source = 'storefront' and exists (
        select 1 from cart_shares cs join shopper_threads t on t.id = cs.thread_id
        where cs.tenant_id = o.tenant_id and t.phone = o.customer_phone
          and cs.created_at between o.placed_at - make_interval(hours => ${ASSIST_WINDOW_HOURS}) and o.placed_at)), 0)::int as assisted_cents,
      count(*) filter (where o.source = 'storefront' and exists (
        select 1 from cart_shares cs join shopper_threads t on t.id = cs.thread_id
        where cs.tenant_id = o.tenant_id and t.phone = o.customer_phone
          and cs.created_at between o.placed_at - make_interval(hours => ${ASSIST_WINDOW_HOURS}) and o.placed_at))::int as assisted_n,
      count(*) filter (where o.source = 'whatsapp_agent' and exists (
        select 1 from shopper_threads t where t.id = o.thread_id and t.recovery_at is not null
          and t.recovery_at < o.placed_at and t.recovery_at > o.placed_at - interval '24 hours'))::int as recovered_n,
      coalesce(sum(o.total_cents) filter (where o.source = 'whatsapp_agent' and exists (
        select 1 from shopper_threads t where t.id = o.thread_id and t.recovery_at is not null
          and t.recovery_at < o.placed_at and t.recovery_at > o.placed_at - interval '24 hours')), 0)::int as recovered_cents
    from orders o
    where o.tenant_id = ${tenantId} and o.placed_at >= ${since} and o.state not in ('cancelled', 'refunded')`;
  const handoffs = await tx<{ reason: string; n: number }[]>`
    select coalesce(owner_reason, 'outro') as reason, count(*)::int as n from shopper_threads
    where tenant_id = ${tenantId} and channel = 'whatsapp' and waiting_since >= ${since}
    group by 1 order by n desc limit 8`;
  const speed = await replyPercentiles(tx, tenantId, since);

  const proposals: ResultsView['proposals'] = [];
  const asked = await tx<{ id: string; question: string; asked_count: number }[]>`
    select id, question, asked_count from store_knowledge
    where tenant_id = ${tenantId} and kind = 'question' and status = 'open' and asked_count >= 2
    order by asked_count desc limit 1`;
  if (asked[0])
    proposals.push({
      kind: 'answer',
      text: `ensinar a resposta: "${asked[0].question.slice(0, 80)}"`,
      evidence: `perguntaram ${asked[0].asked_count}×`,
      ref: asked[0].id,
    });
  const dead = await tx<{ product_id: string; name: string; n: number }[]>`
    select s.product_id, p.name, count(*)::int as n from suggestion_events s join products p on p.id = s.product_id
    where s.tenant_id = ${tenantId} and s.created_at > now() - interval '30 days'
    group by s.product_id, p.name having count(*) >= 10 and count(*) filter (where s.outcome = 'taken') = 0
    order by n desc limit 1`;
  if (dead[0])
    proposals.push({
      kind: 'retire_suggestion',
      text: `parar de sugerir ${dead[0].name}`,
      evidence: `oferecido ${dead[0].n}× nos últimos 30 dias, ninguém aceitou`,
      ref: dead[0].product_id,
    });
  const [rec] = await tx<{ nudged: number; came_back: number }[]>`
    select count(*)::int as nudged,
      count(*) filter (where exists (select 1 from orders o where o.thread_id = t.id and o.placed_at > t.recovery_at))::int as came_back
    from shopper_threads t where t.tenant_id = ${tenantId} and t.recovery_at > now() - interval '30 days'`;
  if (rec && rec.nudged >= 10 && rec.came_back / rec.nudged < 0.1)
    proposals.push({
      kind: 'recovery_delay',
      text: 'lembrar a sacola parada mais cedo',
      evidence: `${rec.came_back} de ${rec.nudged} voltaram depois do lembrete`,
      ref: null,
    });

  return {
    period,
    since: since.toISOString(),
    closed: {
      cents: r?.closed_cents ?? 0,
      orders: r?.closed_n ?? 0,
      averageCents: r?.closed_n ? Math.round(r.closed_cents / r.closed_n) : null,
    },
    assisted: {
      cents: r?.assisted_cents ?? 0,
      orders: r?.assisted_n ?? 0,
      windowHours: ASSIST_WINDOW_HOURS,
    },
    siteAverageCents: r?.site_avg ?? null,
    funnel: {
      conversations: r?.conversations ?? 0,
      carts: r?.carts ?? 0,
      summaries: r?.summaries ?? 0,
      orders: r?.closed_n ?? 0,
    },
    suggestions: {
      offered: r?.offered ?? 0,
      taken: r?.taken ?? 0,
      revenueCents: r?.sugg_cents ?? 0,
    },
    recovered: { orders: r?.recovered_n ?? 0, cents: r?.recovered_cents ?? 0 },
    replySec: speed,
    handoffs: handoffs.map((h) => ({ reason: h.reason, count: h.n })),
    proposals: proposals.slice(0, 3),
    enoughData: (r?.conversations ?? 0) >= 20,
  };
}
