import type { Sql } from '../platform/db.ts';
import { loadCartView } from '../modules/cart.ts';
import { lineText } from './cards.ts';
import { describeGuard, type CompiledGuard } from './knowledge.ts';
import { customerCard, type CustomerCard } from './pack.ts';
import { aiAllowanceTx } from '../modules/billing/ai-allowance.ts';
import { DEFAULT_SETTINGS, introduction, loadAgent, type StoreAgentSettings } from './settings.ts';
import {
  loadStoreSettings,
  maskPhone,
  mustThread,
  storeStatus,
  threadFloor,
  type Thread,
} from './threads.ts';

// What the admin's Vendedor screens read (sales-agent-ux.md §3). Shapes here are the API's:
// apps/admin mirrors them in its client types. Names and phones are the store's own customers'
// and only reach its own staff; staff events and logs never carry them.

export type Presence =
  'off' | 'answering' | 'rehearsal' | 'covering' | 'disconnected' | 'budget' | 'trouble';

export interface WaitingRow {
  threadId: string;
  name: string;
  preview: string | null;
  reason: string | null;
  since: string;
}

export interface HomeView {
  agent: {
    enabled: boolean;
    name: string;
    disclose: boolean;
    intro: string;
    coverage: StoreAgentSettings['coverage'];
    slowAfterMin: number;
    enabledAt: string | null;
    firstSaleAt: string | null;
  };
  presence: Presence;
  /** what Duá can still take this period (ADR 0032): 0 left means shoppers go to the store */
  allowance: {
    period: 'month' | 'trial' | null;
    limit: number;
    used: number;
    remaining: number;
    resetsAt: string | null;
  };
  whatsapp: { state: string | null; linked: boolean };
  active: number;
  replyP50Sec: number | null;
  today: {
    closedCents: number;
    orders: number;
    averageCents: number | null;
    conversations: number;
    conversion: number | null;
    suggestionsOffered: number;
    suggestionsTaken: number;
    drafts: number;
  };
  waiting: WaitingRow[];
  whileAway: {
    orderId: string;
    number: number;
    totalCents: number;
    placedAt: string;
    scheduledFor: string | null;
  }[];
  demand: {
    unmet: { term: string; count: number }[];
    outOfZone: { term: string; count: number }[];
  };
  onboarding: { started: boolean; finished: boolean; part: string | null };
}

function dayStartSp(now: Date): Date {
  const local = new Date(now.getTime() - 3 * 3600_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3600_000,
  );
}

const displayName = (t: {
  profile_name: string | null;
  checkout: { name?: string } | null;
  phone: string | null;
}) => t.checkout?.name || t.profile_name?.split(/\s+/)[0] || maskPhone(t.phone) || 'Cliente';

export async function homeView(tx: Sql, tenantId: string, now = new Date()): Promise<HomeView> {
  const agent = await loadAgent(tx, tenantId);
  const [tenant] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
  const [wa] = await tx<{ state: string | null; wanted: boolean }[]>`
    select state, wanted from store_whatsapp where tenant_id = ${tenantId}`;
  const since = dayStartSp(now);
  const [today] = await tx<
    {
      closed: number;
      orders: number;
      site_avg: number | null;
      conversations: number;
      offered: number;
      taken: number;
      drafts: number;
    }[]
  >`
    select
      coalesce((select sum(total_cents) from orders where tenant_id = ${tenantId} and source = 'whatsapp_agent'
                and placed_at >= ${since} and state not in ('cancelled', 'refunded')), 0)::int as closed,
      (select count(*) from orders where tenant_id = ${tenantId} and source = 'whatsapp_agent'
         and placed_at >= ${since} and state not in ('cancelled', 'refunded'))::int as orders,
      null::int as site_avg,
      (select count(*) from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp'
         and last_in_at >= ${since})::int as conversations,
      (select count(*) from suggestion_events where tenant_id = ${tenantId} and created_at >= ${since})::int as offered,
      (select count(*) from suggestion_events where tenant_id = ${tenantId} and created_at >= ${since} and outcome = 'taken')::int as taken,
      (select count(*) from shopper_messages where tenant_id = ${tenantId} and status = 'draft' and created_at >= ${since})::int as drafts`;
  const waiting = await tx<
    {
      id: string;
      profile_name: string | null;
      checkout: { name?: string } | null;
      phone: string | null;
      owner_reason: string | null;
      waiting_since: Date;
      preview: string | null;
    }[]
  >`
    select t.id, t.profile_name, t.checkout, t.phone, t.owner_reason, t.waiting_since,
      (select coalesce(m.transcript, m.body) from shopper_messages m where m.thread_id = t.id and m.author = 'shopper'
        order by m.created_at desc limit 1) as preview
    from shopper_threads t
    where t.tenant_id = ${tenantId} and t.waiting_since is not null and t.owner <> 'muted' and t.channel <> 'test'
    order by t.waiting_since limit 20`;
  const away = await tx<
    {
      id: string;
      number: number;
      total_cents: number;
      placed_at: Date;
      scheduled_for: string | null;
    }[]
  >`
    select o.id, o.number, o.total_cents, o.placed_at, o.scheduled_for::text as scheduled_for
    from orders o
    where o.tenant_id = ${tenantId} and o.source = 'whatsapp_agent' and o.placed_at > now() - interval '18 hours'
      and o.state not in ('cancelled', 'refunded')
      and not exists (select 1 from shopper_messages m where m.thread_id = o.thread_id and m.author = 'merchant'
                      and m.created_at between o.placed_at - interval '30 minutes' and o.placed_at)
    order by o.placed_at desc limit 10`;
  const demand = await tx<{ kind: 'unmet' | 'out_of_zone'; term: string; n: number }[]>`
    select kind, term, count(*)::int as n from vendedor_demand
    where tenant_id = ${tenantId} and at > now() - interval '7 days'
    group by kind, term order by n desc limit 20`;
  const [active] = await tx<{ n: number }[]>`
    select count(*)::int as n from shopper_threads where tenant_id = ${tenantId} and channel = 'whatsapp'
      and last_in_at > now() - interval '30 minutes' and owner in ('open', 'agent')`;
  const p50 = await replyPercentiles(tx, tenantId, since);
  const linked = wa?.state === 'open';
  const presence: Presence = !agent.enabled
    ? 'off'
    : !linked
      ? 'disconnected'
      : agent.settings.coverage === 'rehearsal'
        ? 'rehearsal'
        : agent.settings.coverage === 'always'
          ? 'answering'
          : 'covering';
  const ai = await aiAllowanceTx(tx, tenantId, now);
  const ob = agent.onboarding as { started?: boolean; finished?: boolean; part?: string };
  return {
    agent: {
      enabled: agent.enabled,
      name: agent.settings.name,
      disclose: agent.settings.disclose,
      intro: introduction(agent.settings, tenant?.name ?? ''),
      coverage: agent.settings.coverage,
      slowAfterMin: agent.settings.slowAfterMin,
      enabledAt: agent.enabledAt?.toISOString() ?? null,
      firstSaleAt: agent.firstSaleAt?.toISOString() ?? null,
    },
    presence,
    allowance: {
      period: ai.period,
      limit: ai.limit,
      used: ai.used,
      remaining: ai.remaining,
      resetsAt: ai.resetsAt?.toISOString() ?? null,
    },
    whatsapp: { state: wa?.state ?? null, linked },
    active: active?.n ?? 0,
    replyP50Sec: p50.p50,
    today: {
      closedCents: today?.closed ?? 0,
      orders: today?.orders ?? 0,
      averageCents: today?.orders ? Math.round((today.closed ?? 0) / today.orders) : null,
      conversations: today?.conversations ?? 0,
      conversion: today?.conversations ? (today.orders ?? 0) / today.conversations : null,
      suggestionsOffered: today?.offered ?? 0,
      suggestionsTaken: today?.taken ?? 0,
      drafts: today?.drafts ?? 0,
    },
    waiting: waiting.map((w) => ({
      threadId: w.id,
      name: displayName(w),
      preview: w.preview?.slice(0, 160) ?? null,
      reason: w.owner_reason,
      since: w.waiting_since.toISOString(),
    })),
    whileAway: away.map((o) => ({
      orderId: o.id,
      number: o.number,
      totalCents: o.total_cents,
      placedAt: new Date(o.placed_at).toISOString(),
      scheduledFor: o.scheduled_for,
    })),
    demand: {
      unmet: demand.filter((d) => d.kind === 'unmet').map((d) => ({ term: d.term, count: d.n })),
      outOfZone: demand
        .filter((d) => d.kind === 'out_of_zone')
        .map((d) => ({ term: d.term, count: d.n })),
    },
    onboarding: { started: !!ob.started, finished: !!ob.finished, part: ob.part ?? null },
  };
}

/** From a shopper's message to the next reply in that thread, in seconds. */
export async function replyPercentiles(
  tx: Sql,
  tenantId: string,
  since: Date,
): Promise<{ p50: number | null; p95: number | null }> {
  const [r] = await tx<{ p50: number | null; p95: number | null }[]>`
    with pairs as (
      select extract(epoch from (
        select min(o.created_at) from shopper_messages o
        where o.thread_id = i.thread_id and o.author in ('agent', 'core') and o.status <> 'draft' and o.created_at > i.created_at
      ) - i.created_at) as secs
      from shopper_messages i join shopper_threads t on t.id = i.thread_id
      where i.tenant_id = ${tenantId} and i.author = 'shopper' and i.created_at >= ${since} and t.channel = 'whatsapp'
      limit 2000
    )
    select percentile_cont(0.5) within group (order by secs) as p50,
           percentile_cont(0.95) within group (order by secs) as p95
    from pairs where secs is not null and secs < 3600`;
  return {
    p50: r?.p50 != null ? Math.round(r.p50) : null,
    p95: r?.p95 != null ? Math.round(r.p95) : null,
  };
}

// ── conversations ────────────────────────────────────────────────────────────

/** `ask` "para decidir", `personal` "pessoais" (ADR 0033); `others` is class other. */
export type ThreadFilter = 'all' | 'waiting' | 'orders' | 'agent' | 'others' | 'ask' | 'personal';
export const THREAD_FILTERS = [
  'all',
  'waiting',
  'orders',
  'agent',
  'others',
  'ask',
  'personal',
] as const satisfies readonly ThreadFilter[];

export interface ThreadRow {
  id: string;
  name: string;
  phone: string | null;
  owner: Thread['owner'];
  floor: string;
  reason: string | null;
  waitingSince: string | null;
  stage: Thread['stage'];
  class: Thread['class'];
  /** why it has that class: a code (ADR 0033), never text about the person */
  classReason: Thread['classReason'];
  classSource: Thread['classSource'];
  preview: string | null;
  previewAuthor: string | null;
  lastAt: string;
  orderNumber: number | null;
  unread: boolean;
}

export async function threadList(
  tx: Sql,
  tenantId: string,
  o: { filter: ThreadFilter; q: string; before: string | null; limit: number },
  now = new Date(),
): Promise<{ threads: ThreadRow[]; next: string | null; counts: { ask: number } }> {
  const agent = await loadAgent(tx, tenantId);
  const status = storeStatus(await loadStoreSettings(tx, tenantId), now);
  const q = o.q.trim();
  const rows = await tx<
    (Record<string, unknown> & {
      id: string;
      profile_name: string | null;
      checkout: { name?: string } | null;
      phone: string | null;
      owner: Thread['owner'];
      owner_reason: string | null;
      waiting_since: Date | null;
      stage: Thread['stage'];
      class: Thread['class'];
      class_reason: Thread['classReason'];
      class_source: Thread['classSource'];
      updated_at: Date;
      human_until: Date | null;
      pending_since: Date | null;
      channel: Thread['channel'];
      order_number: number | null;
      preview: string | null;
      preview_author: string | null;
    })[]
  >`
    select t.*, o.number as order_number, last.body as preview, last.author as preview_author
    from shopper_threads t
    left join orders o on o.id = t.order_id
    left join lateral (
      select coalesce(m.transcript, m.body) as body, m.author from shopper_messages m
      where m.thread_id = t.id order by m.created_at desc limit 1) last on true
    where t.tenant_id = ${tenantId} and t.channel in ('whatsapp', 'web')
      and (${o.before}::timestamptz is null or t.updated_at < ${o.before}::timestamptz)
      and ${
        o.filter === 'waiting'
          ? tx`t.waiting_since is not null and t.owner <> 'muted'`
          : o.filter === 'orders'
            ? tx`t.order_id is not null`
            : o.filter === 'agent'
              ? tx`t.owner in ('open', 'agent') and t.class in ('shopper', 'unknown')`
              : o.filter === 'others'
                ? tx`t.class = 'other'`
                : o.filter === 'ask'
                  ? tx`t.class = 'ask'`
                  : o.filter === 'personal'
                    ? tx`t.class = 'personal'`
                    : tx`t.class not in ('other', 'personal')`
      }
      and (${q} = '' or t.profile_name ilike ${'%' + q + '%'} or t.checkout ->> 'name' ilike ${'%' + q + '%'}
           or t.phone like ${'%' + q.replace(/\D/g, '') + '%'} and ${q.replace(/\D/g, '').length >= 4})
    order by t.updated_at desc limit ${o.limit + 1}`;
  const page = rows.slice(0, o.limit);
  return {
    threads: page.map((r) => {
      const t = {
        owner: r.owner,
        humanUntil: r.human_until,
        pendingSince: r.pending_since,
        class: r.class,
        channel: r.channel,
      };
      return {
        id: r.id,
        name: displayName(r),
        phone: maskPhone(r.phone),
        owner: r.owner,
        floor: threadFloor(t as Thread, agent, status, now).floor,
        reason: r.owner_reason,
        waitingSince: r.waiting_since?.toISOString() ?? null,
        stage: r.stage,
        class: r.class,
        classReason: r.class_reason ?? null,
        classSource: r.class_source ?? null,
        preview: r.preview?.slice(0, 120) ?? null,
        previewAuthor: r.preview_author,
        lastAt: r.updated_at.toISOString(),
        orderNumber: r.order_number,
        unread: r.preview_author === 'shopper',
      };
    }),
    next: rows.length > o.limit ? page[page.length - 1]!.updated_at.toISOString() : null,
    counts: { ask: await askCount(tx, tenantId) },
  };
}

async function askCount(tx: Sql, tenantId: string): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from shopper_threads
    where tenant_id = ${tenantId} and class = 'ask' and channel = 'whatsapp' and owner <> 'muted'`;
  return r?.n ?? 0;
}

export interface MessageView {
  id: string;
  author: 'shopper' | 'agent' | 'merchant' | 'core';
  kind: string;
  body: string | null;
  transcript: string | null;
  status: string;
  at: string;
  card: string | null;
  data: unknown;
  hasMedia: boolean;
  seconds: number | null;
  verdict: string | null;
  turnId: string | null;
  suggestion: boolean;
}

export interface SacolaView {
  count: number;
  totalCents: number;
  lines: { text: string; totalCents: number }[];
  step: 'montar' | 'endereco' | 'pagamento' | 'confirmar' | 'feito';
}

export interface ThreadDetail {
  thread: ThreadRow & {
    humanUntil: string | null;
    profileName: string | null;
    test: boolean;
    channel: Thread['channel'];
  };
  messages: MessageView[];
  sacola: SacolaView | null;
  customer: (CustomerCard & { phone: string | null; firstSeen: string | null }) | null;
  order: {
    id: string;
    number: number;
    state: string;
    totalCents: number;
    paymentStatus: string;
  } | null;
  humanSilenceMin: number;
}

export async function threadDetail(
  tx: Sql,
  tenantId: string,
  id: string,
  now = new Date(),
): Promise<ThreadDetail> {
  const t = await mustThread(tx, tenantId, id);
  const agent = await loadAgent(tx, tenantId);
  const status = storeStatus(await loadStoreSettings(tx, tenantId), now);
  const msgs = await tx<
    {
      id: string;
      author: MessageView['author'];
      kind: string;
      body: string | null;
      transcript: string | null;
      status: string;
      created_at: Date;
      meta: Record<string, unknown>;
      has_media: boolean;
      seconds: number | null;
    }[]
  >`
    select m.id, m.author, m.kind, m.body, m.transcript, m.status, m.created_at, m.meta,
      exists (select 1 from shopper_media x where x.message_id = m.id) as has_media,
      (select x.seconds from shopper_media x where x.message_id = m.id limit 1) as seconds
    from shopper_messages m where m.tenant_id = ${tenantId} and m.thread_id = ${id}
      -- a personal contact's chat is the owner's alone; what remains is erased rows
      and ${t.class !== 'personal'}
    order by m.created_at desc limit 200`;
  const suggested = new Set(
    (
      await tx<{ turn: string | null }[]>`
        select distinct e.turn_id::text as turn from agent_events e join agent_actors a on a.id = e.actor_id
        where a.tenant_id = ${tenantId} and a.subject_id = ${id} and e.type = 'tool.returned'
          and e.payload ->> 'name' = 'offer_suggestion' and e.payload ->> 'ok' = 'true'`
    ).map((r) => r.turn),
  );
  let sacola: SacolaView | null = null;
  if (t.cartId) {
    const cart = await loadCartView(tx, tenantId, t.cartId, now).catch(() => null);
    if (cart && cart.status === 'open' && cart.items.length) {
      const step: SacolaView['step'] =
        t.stage === 'confirming'
          ? 'confirmar'
          : !cart.delivery
            ? 'endereco'
            : !t.checkout.payment
              ? 'pagamento'
              : 'confirmar';
      sacola = {
        count: cart.totals.itemCount,
        totalCents: cart.totals.totalCents,
        lines: cart.items.map((i) => ({ text: lineText(i), totalCents: i.lineTotalCents })),
        step: cart.delivery ? step : 'montar',
      };
    }
  }
  let order: ThreadDetail['order'] = null;
  if (t.orderId) {
    const [o] = await tx<
      {
        id: string;
        number: number;
        state: string;
        total_cents: number;
        payment: { status?: string };
      }[]
    >`
      select id, number, state, total_cents, payment from orders where id = ${t.orderId}`;
    if (o)
      order = {
        id: o.id,
        number: o.number,
        state: o.state,
        totalCents: o.total_cents,
        paymentStatus: o.payment?.status ?? 'pending',
      };
    if (o && !sacola) sacola = { count: 0, totalCents: o.total_cents, lines: [], step: 'feito' };
  }
  const card = t.channel === 'whatsapp' ? await customerCard(tx, tenantId, t.phone) : null;
  const [first] = await tx<{ at: Date | null }[]>`
    select min(placed_at) as at from orders where tenant_id = ${tenantId} and customer_phone = ${t.phone ?? '-'}`;
  const f = threadFloor(t, agent, status, now);
  return {
    thread: {
      id: t.id,
      name: t.checkout.name || t.profileName?.split(/\s+/)[0] || maskPhone(t.phone) || 'Cliente',
      phone: maskPhone(t.phone),
      owner: t.owner,
      floor: f.floor,
      reason: t.ownerReason,
      waitingSince: t.waitingSince?.toISOString() ?? null,
      stage: t.stage,
      class: t.class,
      classReason: t.classReason,
      classSource: t.classSource,
      preview: null,
      previewAuthor: null,
      lastAt: t.updatedAt.toISOString(),
      orderNumber: order?.number ?? null,
      unread: false,
      humanUntil: t.humanUntil?.toISOString() ?? null,
      profileName: t.profileName,
      test: t.channel === 'test',
      channel: t.channel,
    },
    messages: msgs.reverse().map((m) => ({
      id: m.id,
      author: m.author,
      kind: m.kind,
      body: m.body,
      transcript: m.transcript,
      status: m.status,
      at: m.created_at.toISOString(),
      card: typeof m.meta.card === 'string' ? m.meta.card : null,
      data: m.meta.card === 'summary' || m.meta.card === 'order' ? (m.meta.data ?? null) : null,
      hasMedia: m.has_media,
      seconds: m.seconds,
      verdict: typeof m.meta.verdict === 'string' ? m.meta.verdict : null,
      turnId: typeof m.meta.turnId === 'string' ? m.meta.turnId : null,
      suggestion:
        typeof m.meta.turnId === 'string' && suggested.has(m.meta.turnId) && m.author === 'agent',
    })),
    sacola,
    customer: card
      ? {
          ...card,
          phone: maskPhone(t.phone),
          firstSeen: first?.at ? new Date(first.at).toISOString() : null,
        }
      : null,
    order,
    humanSilenceMin: agent.settings.humanSilenceMin,
  };
}

// ── "por quê" ────────────────────────────────────────────────────────────────

export interface WhyView {
  asked: string | null;
  steps: { kind: 'lookup' | 'figure' | 'rule' | 'action' | 'blocked'; text: string }[];
}

const TOOL_WORDS: Record<string, string> = {
  search_catalog: 'procurou no cardápio',
  get_product: 'abriu o produto',
  store_info: 'consultou horário e formas de pagamento',
  quote_delivery: 'calculou a entrega',
  knowledge: 'leu as respostas da loja',
  ask_store: 'perguntou para a loja',
  view_cart: 'conferiu a sacola',
  cart_edit: 'anotou na sacola',
  reorder: 'refez um pedido anterior',
  set_fulfillment: 'anotou entrega ou retirada',
  set_payment: 'anotou o pagamento',
  set_customer: 'anotou nome e observações',
  apply_coupon: 'aplicou um cupom',
  send_summary: 'gerou o resumo calculado pela loja',
  place_order: 'fez o pedido',
  send_pix: 'mandou o Pix',
  my_orders: 'viu os pedidos anteriores',
  order_status: 'consultou o pedido',
  send_link: 'mandou o link da sacola',
  send_card: 'mostrou um produto',
  handoff: 'passou para você',
  remember: 'anotou uma preferência',
  forget_fact: 'esqueceu uma informação',
  stop_replying: 'parou de responder a pedido do cliente',
  join_waitlist: 'pôs na lista de espera',
  suggest: 'buscou sugestões calculadas pela loja',
  offer_suggestion: 'registrou uma sugestão',
  offer_incentive: 'pediu um cupom do seu orçamento',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The turn behind a message, read in plain words from its events (UX §3.3). */
export async function whyView(
  tx: Sql,
  tenantId: string,
  threadId: string,
  messageId: string,
): Promise<WhyView> {
  const [m] = await tx<{ meta: { turnId?: string } }[]>`
    select meta from shopper_messages where tenant_id = ${tenantId} and thread_id = ${threadId} and id = ${messageId}`;
  const raw = m?.meta?.turnId;
  // a turn id that isn't a uuid (old or hand-written rows) reads as no turn, never a 500
  const turnId = typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
  if (!turnId)
    return {
      asked: null,
      steps: [{ kind: 'rule', text: 'Mensagem escrita pela loja ou pelo sistema.' }],
    };
  const events = await tx<{ type: string; payload: Record<string, unknown> }[]>`
    select e.type, e.payload from agent_events e join agent_actors a on a.id = e.actor_id
    where e.tenant_id = ${tenantId} and a.subject_id = ${threadId} and e.turn_id = ${turnId}
    order by e.seq limit 300`;
  const steps: WhyView['steps'] = [];
  let asked: string | null = null;
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'turn.started') {
      const batch =
        (p.batch as { kind: string; payload: { text?: string; transcript?: string } }[]) ?? [];
      const last = batch.filter((b) => b.kind === 'message.inbound').at(-1);
      asked = last?.payload?.transcript ?? last?.payload?.text ?? null;
    }
    if (e.type === 'tool.returned' && typeof p.name === 'string' && p.name !== 'reply')
      steps.push({
        kind: p.ok === false ? 'blocked' : p.name === 'handoff' ? 'action' : 'lookup',
        text: `${TOOL_WORDS[p.name] ?? p.name}${p.ok === false ? ' (a loja recusou e ela corrigiu)' : ''}`,
      });
    if (e.type === 'ledger.recorded')
      for (const f of (p.figures as { id: string; text: string; kind: string }[]) ?? [])
        if (f.kind === 'money' || f.kind === 'duration' || f.kind === 'time')
          steps.push({ kind: 'figure', text: `${f.text}, calculado pela loja` });
    if (e.type === 'guard.blocked')
      steps.push({
        kind: 'blocked',
        text: `uma resposta foi barrada antes de sair (${String(p.guard)}) e ela reescreveu`,
      });
  }
  const seen = new Set<string>();
  return { asked, steps: steps.filter((s) => !seen.has(s.text) && seen.add(s.text)).slice(0, 30) };
}

// ── teaching, Ensaio, Cliente oculto ─────────────────────────────────────────

export interface KnowledgeItem {
  id: string;
  kind: 'answer' | 'rule' | 'question';
  status: string;
  source: string;
  question: string | null;
  answer: string | null;
  guaranteed: boolean;
  guarantee: string | null;
  askedCount: number;
  usedCount: number;
  at: string;
}

export async function knowledgeView(
  tx: Sql,
  tenantId: string,
): Promise<{
  questions: KnowledgeItem[];
  learned: KnowledgeItem[];
  answers: KnowledgeItem[];
  rules: KnowledgeItem[];
}> {
  const rows = await tx<
    {
      id: string;
      kind: KnowledgeItem['kind'];
      status: string;
      source: string;
      question: string | null;
      answer: string | null;
      guard: CompiledGuard | null;
      asked_count: number;
      used_count: number;
      updated_at: Date;
    }[]
  >`select id, kind, status, source, question, answer, guard, asked_count, used_count, updated_at
    from store_knowledge where tenant_id = ${tenantId} and status <> 'dismissed'
    order by status, asked_count desc, updated_at desc limit 400`;
  const item = (r: (typeof rows)[number]): KnowledgeItem => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    source: r.source,
    question: r.question,
    answer: r.answer,
    guaranteed: !!r.guard,
    guarantee: r.guard ? describeGuard(r.guard) : null,
    askedCount: r.asked_count,
    usedCount: r.used_count,
    at: r.updated_at.toISOString(),
  });
  return {
    questions: rows.filter((r) => r.kind === 'question' && r.status === 'open').map(item),
    learned: rows.filter((r) => r.status === 'proposed').map(item),
    answers: rows.filter((r) => r.kind === 'answer' && r.status === 'live').map(item),
    rules: rows.filter((r) => r.kind === 'rule' && r.status === 'live').map(item),
  };
}

export interface EnsaioView {
  drafts: number;
  compared: number;
  agreed: number;
  disagreements: {
    threadId: string;
    draftId: string;
    shopper: string | null;
    draft: string;
    merchant: string | null;
    at: string;
  }[];
}

/** Each draft against what the store actually sent next (UX §3.6). */
export async function ensaioView(tx: Sql, tenantId: string): Promise<EnsaioView> {
  const rows = await tx<
    {
      id: string;
      thread_id: string;
      body: string;
      created_at: Date;
      verdict: string | null;
      merchant: string | null;
      shopper: string | null;
    }[]
  >`
    select d.id, d.thread_id, d.body, d.created_at, d.meta ->> 'verdict' as verdict,
      (select m.body from shopper_messages m where m.thread_id = d.thread_id and m.author = 'merchant'
         and m.created_at > d.created_at - interval '10 minutes' order by abs(extract(epoch from m.created_at - d.created_at)) limit 1) as merchant,
      (select coalesce(s.transcript, s.body) from shopper_messages s where s.thread_id = d.thread_id
         and s.author = 'shopper' and s.created_at < d.created_at order by s.created_at desc limit 1) as shopper
    from shopper_messages d
    where d.tenant_id = ${tenantId} and d.status = 'draft' and d.author = 'agent' and d.created_at > now() - interval '14 days'
    order by d.created_at desc limit 300`;
  const compared = rows.filter((r) => r.verdict || r.merchant);
  const agreed = compared.filter(
    (r) => r.verdict === 'same' || (!r.verdict && r.merchant && similar(r.body, r.merchant)),
  );
  return {
    drafts: rows.length,
    compared: compared.length,
    agreed: agreed.length,
    disagreements: compared
      .filter((r) => !agreed.includes(r) && r.verdict !== 'dismissed')
      .slice(0, 30)
      .map((r) => ({
        threadId: r.thread_id,
        draftId: r.id,
        shopper: r.shopper,
        draft: r.body,
        merchant: r.merchant,
        at: r.created_at.toISOString(),
      })),
  };
}

/** "Iguais ou quase": the same figures and most of the same words. */
export function similar(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .split(/[^a-z0-9,]+/)
        .filter((w) => w.length > 2),
    );
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  const nums = (s: string) => (s.match(/\d+[,.]?\d*/g) ?? []).sort().join('|');
  return nums(a) === nums(b) && n / Math.min(wa.size, wb.size) >= 0.5;
}

export async function clienteOcultoView(tx: Sql, tenantId: string) {
  const runs = await tx<
    {
      id: string;
      trigger: string;
      status: string;
      passed: number | null;
      total: number | null;
      results: unknown;
      error: string | null;
      created_at: Date;
      finished_at: Date | null;
    }[]
  >`select id, trigger, status, passed, total, results, error, created_at, finished_at from vendedor_runs
    where tenant_id = ${tenantId} order by created_at desc limit 10`;
  return {
    latest: runs[0]
      ? {
          id: runs[0].id,
          trigger: runs[0].trigger,
          status: runs[0].status,
          passed: runs[0].passed,
          total: runs[0].total,
          results: runs[0].results,
          error: runs[0].error,
          at: runs[0].created_at.toISOString(),
          finishedAt: runs[0].finished_at?.toISOString() ?? null,
        }
      : null,
    history: runs.map((r) => ({
      id: r.id,
      passed: r.passed,
      total: r.total,
      status: r.status,
      at: r.created_at.toISOString(),
    })),
  };
}

export const SETTINGS_DEFAULTS = DEFAULT_SETTINGS;
