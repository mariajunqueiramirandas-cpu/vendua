import type { Sql } from '../../platform/db.ts';
import { controlTx } from '../control.ts';

// Live reads for cards and commands. A store spans control tables (billing, fleet) and its own
// tenant tables (orders, merchant users): one short control tx that also sets that store's
// tenant GUC — the same pattern as the CRM's mark-paid (control-billing.ts).

export interface StoreSnapshot {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  host: string | null;
  plan: string | null;
  subscription: string | null;
  paidAt: string | null;
  openInvoices: number;
  provisioning: string | null;
  liveAt: string | null;
  release: string | null;
  kernel: string | null;
  policy: string | null;
  probe: { status: string; failingSince: string | null; lastOkAt: string | null } | null;
  openIncidents: number;
  merchants: number;
  firstLogin: boolean;
  /** the store finished the admin's setup wizard (Bem-vindo) */
  setupAt: string | null;
  payments: string | null;
  customDomain: { host: string; status: string } | null;
  firstOrderAt: string | null;
  orders: {
    today: number;
    todayCents: number;
    week: number;
    weekCents: number;
    lastAt: string | null;
  };
}

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => Number(v ?? 0);

export async function storeSnapshot(sql: Sql, tenantId: string): Promise<StoreSnapshot | null> {
  return controlTx(sql, async (tx) => {
    await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
    const [t] = await tx<
      Row[]
    >`select id, name, slug, created_at from tenants where id = ${tenantId}`;
    if (!t) return null;
    const [domain, sub, inv, prov, ops, probe, incidents, users, setup, conn, custom, orders] =
      await Promise.all([
        tx<Row[]>`
          select host from domains where tenant_id = ${tenantId}
          order by is_primary desc, host limit 1
        `,
        tx<Row[]>`
          select s.status, p.name as plan from subscriptions s join plans p on p.id = s.plan_id
          where s.tenant_id = ${tenantId}
        `,
        tx<Row[]>`
          select min(paid_at) filter (where status = 'paid') as paid_at,
                 count(*) filter (where status = 'open')::int as open
          from invoices where tenant_id = ${tenantId}
        `,
        tx<Row[]>`select state, live_at from provisionings where tenant_id = ${tenantId}`,
        tx<Row[]>`
          select live_release_id, live_kernel_version, release_policy
          from storefront_ops where tenant_id = ${tenantId}
        `,
        tx<Row[]>`
          select status, failing_since, last_ok_at from fleet_probes where tenant_id = ${tenantId}
          order by (status = 'failing') desc limit 1
        `,
        tx<Row[]>`
          select count(*)::int as n from fleet_incidents
          where tenant_id = ${tenantId} and resolved_at is null
        `,
        tx<Row[]>`
          select count(*)::int as n, bool_or(last_seen_at is not null) as seen
          from merchant_users where tenant_id = ${tenantId} and status = 'active'
        `,
        tx<Row[]>`
          select onboarding ->> 'finishedAt' as at from store_settings where tenant_id = ${tenantId}
        `,
        tx<Row[]>`select status from payment_connections where tenant_id = ${tenantId}`,
        tx<Row[]>`
          select host, status from custom_domains where tenant_id = ${tenantId}
          order by created_at desc limit 1
        `,
        // "today" is the store's own day (store_settings.hours.timezone)
        tx<Row[]>`
          with z as (
            select date_trunc('day', now() at time zone tz) at time zone tz as day_start
            from (select coalesce(
              (select hours->>'timezone' from store_settings where tenant_id = ${tenantId}),
              'America/Sao_Paulo') as tz) t
          )
          select min(placed_at) as first_at, max(placed_at) as last_at,
                 count(*) filter (where placed_at >= z.day_start)::int as today,
                 coalesce(sum(total_cents) filter (where placed_at >= z.day_start
                   and state not in ('cancelled', 'refunded')), 0)::int as today_cents,
                 count(*) filter (where placed_at > now() - interval '7 days')::int as week,
                 coalesce(sum(total_cents) filter (where placed_at > now() - interval '7 days'
                   and state not in ('cancelled', 'refunded')), 0)::int as week_cents
          from orders cross join z where tenant_id = ${tenantId}
          group by z.day_start
        `,
      ]);
    const o = orders[0] ?? {};
    return {
      id: String(t.id),
      name: String(t.name),
      slug: String(t.slug),
      createdAt: iso(t.created_at)!,
      host: (domain[0]?.host as string | undefined) ?? null,
      plan: (sub[0]?.plan as string | undefined) ?? null,
      subscription: (sub[0]?.status as string | undefined) ?? null,
      paidAt: iso(inv[0]?.paid_at),
      openInvoices: num(inv[0]?.open),
      provisioning: (prov[0]?.state as string | undefined) ?? null,
      liveAt: iso(prov[0]?.live_at),
      release: (ops[0]?.live_release_id as string | undefined) ?? null,
      kernel: (ops[0]?.live_kernel_version as string | undefined) ?? null,
      policy: (ops[0]?.release_policy as string | undefined) ?? null,
      probe: probe[0]
        ? {
            status: String(probe[0].status),
            failingSince: iso(probe[0].failing_since),
            lastOkAt: iso(probe[0].last_ok_at),
          }
        : null,
      openIncidents: num(incidents[0]?.n),
      merchants: num(users[0]?.n),
      firstLogin: users[0]?.seen === true,
      setupAt: iso(setup[0]?.at),
      payments: (conn[0]?.status as string | undefined) ?? null,
      customDomain: custom[0]
        ? { host: String(custom[0].host), status: String(custom[0].status) }
        : null,
      firstOrderAt: iso(o.first_at),
      orders: {
        today: num(o.today),
        todayCents: num(o.today_cents),
        week: num(o.week),
        weekCents: num(o.week_cents),
        lastAt: iso(o.last_at),
      },
    };
  });
}

export interface OnboardingStepState {
  key:
    'created' | 'paid' | 'live' | 'first_login' | 'setup' | 'payments' | 'first_order' | 'domain';
  label: string;
  done: boolean;
}

/** The First-store gate per store (roadmap): what the onboarding card ticks off. */
export function onboardingSteps(s: StoreSnapshot): OnboardingStepState[] {
  const steps: OnboardingStepState[] = [
    { key: 'created', label: 'cadastro', done: true },
    { key: 'paid', label: 'plano pago', done: !!s.paidAt || s.subscription === 'active' },
    { key: 'live', label: 'loja no ar', done: s.provisioning === 'live' || !!s.liveAt },
    { key: 'first_login', label: 'primeiro acesso ao painel', done: s.firstLogin },
    { key: 'setup', label: 'loja montada', done: !!s.setupAt },
    { key: 'payments', label: 'Mercado Pago conectado', done: s.payments === 'connected' },
    { key: 'first_order', label: 'primeiro pedido', done: !!s.firstOrderAt },
  ];
  if (s.customDomain)
    steps.push({
      key: 'domain',
      label: `domínio ${s.customDomain.host}`,
      done: s.customDomain.status === 'dns_ok' || s.customDomain.status === 'active',
    });
  return steps;
}

export async function storeUrl(sql: Sql, tenantId: string): Promise<string | null> {
  const rows = await sql<{ host: string }[]>`
    select host from domains where tenant_id = ${tenantId} order by is_primary desc, host limit 1
  `;
  return rows[0] ? `https://${rows[0].host}` : null;
}

export interface StoreHit {
  id: string;
  name: string;
  slug: string;
}

/** Autocomplete for /loja: name or slug, newest first. */
export async function searchStores(sql: Sql, q: string, limit = 10): Promise<StoreHit[]> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql<StoreHit[]>`
    select id, name, slug from tenants
    where ${q ? sql`(name ilike ${like} or slug ilike ${like})` : sql`true`}
    order by created_at desc limit ${limit}
  `;
}

export interface LeadHit {
  id: string;
  name: string;
  business_name: string | null;
  state: string;
}

/** Autocomplete for /lead: name, business, phone digits or email. */
export async function searchLeads(sql: Sql, q: string, limit = 10): Promise<LeadHit[]> {
  return controlTx(sql, (tx) => {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');
    return tx<LeadHit[]>`
      select id, name, business_name, state from leads
      where archived_at is null and (
        ${q ? tx`name ilike ${like} or business_name ilike ${like} or email ilike ${like}` : tx`true`}
        ${digits.length >= 4 ? tx`or regexp_replace(coalesce(phone, '') || coalesce(whatsapp, ''), '\\D', '', 'g') like ${`%${digits}%`}` : tx``}
      )
      order by updated_at desc limit ${limit}
    `;
  });
}

export interface LeadSnapshot {
  id: string;
  name: string;
  business: string | null;
  state: string;
  owner: string | null;
  city: string | null;
  segment: string | null;
  agentMode: string;
  paused: boolean;
  unsubscribed: boolean;
  nextActionAt: string | null;
  tenantId: string | null;
  createdAt: string;
  costCents: number;
  openHumanTasks: number;
  nextMeeting: string | null;
  threads: { id: string; channel: string; agentEnabled: boolean }[];
  last: { direction: string; author: string; body: string; at: string; channel: string }[];
}

export async function leadSnapshot(sql: Sql, leadId: string): Promise<LeadSnapshot | null> {
  return controlTx(sql, async (tx) => {
    const [l] = await tx<Row[]>`select * from leads where id = ${leadId}`;
    if (!l) return null;
    const [cost, tasks, meeting, threads, last] = await Promise.all([
      tx<Row[]>`
        select coalesce(sum(cost_cents), 0)::int as c from agent_runs where lead_id = ${leadId}
      `,
      tx<Row[]>`
        select count(*)::int as n from lead_tasks
        where lead_id = ${leadId} and done_at is null and title like '[humano]%'
      `,
      tx<Row[]>`
        select min(starts_at) as at from meetings
        where lead_id = ${leadId} and status = 'scheduled' and starts_at > now()
      `,
      tx<Row[]>`
        select id, channel, agent_enabled from lead_threads where lead_id = ${leadId}
        order by last_message_at desc nulls last
      `,
      tx<Row[]>`
        select m.direction, m.author, m.body, m.created_at, t.channel
        from lead_messages m join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.status not in ('draft', 'rejected')
        order by m.created_at desc limit 3
      `,
    ]);
    return {
      id: String(l.id),
      name: String(l.name),
      business: (l.business_name as string | null) ?? null,
      state: String(l.state),
      owner: (l.owner as string | null) ?? null,
      city: (l.city as string | null) ?? null,
      segment: (l.segment as string | null) ?? null,
      agentMode: String(l.agent_mode),
      paused: !!l.agent_paused_at,
      unsubscribed: !!l.unsubscribed_at,
      nextActionAt: iso(l.next_action_at),
      tenantId: (l.tenant_id as string | null) ?? null,
      createdAt: iso(l.created_at)!,
      costCents: num(cost[0]?.c),
      openHumanTasks: num(tasks[0]?.n),
      nextMeeting: iso(meeting[0]?.at),
      threads: threads.map((t) => ({
        id: String(t.id),
        channel: String(t.channel),
        agentEnabled: t.agent_enabled === true,
      })),
      last: last.reverse().map((m) => ({
        direction: String(m.direction),
        author: String(m.author),
        body: String(m.body),
        at: iso(m.created_at)!,
        channel: String(m.channel),
      })),
    };
  });
}
