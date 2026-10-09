import type { Sql } from '../../../platform/db.ts';
import { tenantPlan, type PlanFeature } from '../../../modules/billing/plans.ts';
import { upcomingSpecialDays } from '../../../modules/store.ts';
import { storeOrigin } from '../../../platform/store-origin.ts';
import { loadAgent } from '../../../vendedor/settings.ts';
import { setupChecklist } from '../../../admin/routes-onboarding.ts';
import { demandOf, loadSettings, statusOf } from '../../../admin/routes-store.ts';

// What Duá always knows about the store (ADR 0034, amended 2026-10-09): read at the start of every
// turn, in a few cheap queries, so he never answers as if he didn't know the store he works for.
// Only names, counts and switches: no amount or clock time, which the `grounded` guard lets out
// only as ledger figures. Those come from the tools and `load_context`.

export interface Brief {
  storeName: string;
  timezone: string;
  url: string | null;
  segment: string | null;
  city: string | null;
  tagline: string | null;
  plan: { name: string; features: PlanFeature[] };
  billingHold: boolean;
  delivery: { on: boolean; byDistance: boolean; zones: number };
  pickup: boolean;
  preordersWhileClosed: boolean;
  payments: string[];
  mercadoPago: string | null;
  pixKey: boolean;
  whatsapp: boolean;
  vendedor: 'off' | 'paused' | 'rehearsal' | 'on' | 'disconnected' | null;
  catalog: {
    categories: string[];
    products: number;
    hidden: number;
    soldOut: number;
    lowStock: number;
    withOptions: number;
  };
  coupons: number;
  loyalty: boolean;
  announcement: boolean;
  team: { owner: number; manager: number; attendant: number };
  printers: number;
  tables: number;
  setupMissing: string[];
  specialDays: { date: string; label: string | null; closed: boolean }[];
  site: string | null;
  /** turn-scoped: rendered in the volatile lines, not the cached tier */
  live: {
    status: string;
    demandHigh: boolean;
    waiting: number;
    inProgress: number;
    scheduled: number;
    pixToCheck: number;
    ordersEver: number;
  };
}

const STORE_DOMAIN = () => process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';

export async function storeBrief(tx: Sql, tenantId: string, now: Date): Promise<Brief | null> {
  const [t] = await tx<{ name: string; slug: string }[]>`
    select name, slug from tenants where id = ${tenantId}`;
  if (!t) return null;
  const s = await loadSettings(tx, tenantId);
  const tz = s.hours?.timezone || 'America/Sao_Paulo';
  const [
    url,
    plan,
    agent,
    { checklist, orders: ordersEver },
    [catalog],
    categories,
    [counts],
    team,
    [mp],
  ] = await Promise.all([
    storeOrigin(tx, { id: tenantId, slug: t.slug }, STORE_DOMAIN()),
    tenantPlan(tx, tenantId),
    loadAgent(tx, tenantId),
    setupChecklist(tx, tenantId, s),
    tx<Brief['catalog'][]>`
      select count(*) filter (where p.status <> 'archived')::int as products,
             count(*) filter (where p.status = 'archived')::int as hidden,
             count(*) filter (where p.status = 'sold_out'
               or (p.status = 'active' and p.stock_quantity = 0))::int as "soldOut",
             count(*) filter (where p.status = 'active' and p.stock_quantity > 0
               and p.low_stock_threshold is not null
               and p.stock_quantity <= p.low_stock_threshold)::int as "lowStock",
             count(*) filter (where p.status <> 'archived' and exists (
               select 1 from modifier_groups g where g.product_id = p.id))::int as "withOptions"
      from products p where p.tenant_id = ${tenantId} and p.deleted_at is null`,
    tx<{ name: string }[]>`
      select name from categories where tenant_id = ${tenantId} order by sort, name limit 25`,
    tx<
      {
        zones: number;
        coupons: number;
        printers: number;
        tables: number;
        waiting: number;
        inProgress: number;
        scheduled: number;
        pixToCheck: number;
        site: string | null;
        wa: boolean;
      }[]
    >`
      select
        (select count(*) from delivery_zones where tenant_id = ${tenantId} and active)::int as zones,
        (select count(*) from coupons where tenant_id = ${tenantId} and active
           and source in ('merchant', 'staff') and phone is null
           and (ends_at is null or ends_at > now()))::int as coupons,
        (select count(*) from printers where tenant_id = ${tenantId})::int as printers,
        (select count(*) from pdv_tables where tenant_id = ${tenantId} and archived_at is null)::int as tables,
        (select count(*) from orders where tenant_id = ${tenantId} and state = 'placed'
           and (scheduled_for is null or scheduled_for <= (now() at time zone ${tz})::date))::int as waiting,
        (select count(*) from orders where tenant_id = ${tenantId}
           and state in ('confirmed', 'preparing', 'ready', 'out_for_delivery'))::int as "inProgress",
        (select count(*) from orders where tenant_id = ${tenantId}
           and scheduled_for > (now() at time zone ${tz})::date
           and state not in ('cancelled', 'refunded', 'delivered'))::int as scheduled,
        (select count(*) from orders where tenant_id = ${tenantId} and payment ->> 'method' = 'pix'
           and payment ->> 'status' = 'pending' and coalesce((payment ->> 'online')::boolean, false) = false
           and state not in ('cancelled', 'refunded') and placed_at > now() - interval '3 days')::int as "pixToCheck",
        (select status from site_requests where tenant_id = ${tenantId}
           order by created_at desc limit 1) as site,
        exists (select 1 from store_whatsapp where tenant_id = ${tenantId} and state = 'open') as wa
    `,
    tx<{ role: 'owner' | 'manager' | 'attendant'; n: number }[]>`
      select role, count(*)::int as n from merchant_users
      where tenant_id = ${tenantId} and status = 'active' group by role`,
    tx<{ status: string }[]>`
      select status from payment_connections where tenant_id = ${tenantId} and provider = 'mercadopago'`,
  ]);
  const st = statusOf(s);
  const roles = { owner: 0, manager: 0, attendant: 0 };
  for (const r of team) roles[r.role] = r.n;
  const vendedor: Brief['vendedor'] = !plan.features.vendedor
    ? null
    : !agent.enabled
      ? 'off'
      : agent.pausedUntil && agent.pausedUntil > now
        ? 'paused'
        : !counts!.wa
          ? 'disconnected'
          : agent.settings.coverage === 'rehearsal'
            ? 'rehearsal'
            : 'on';
  const settings = s as typeof s & { segment?: string | null; promo?: unknown; loyalty?: unknown };
  return {
    storeName: t.name,
    timezone: tz,
    url,
    segment: settings.segment ?? null,
    city: s.city || null,
    tagline: s.tagline || null,
    plan: {
      name: plan.name,
      features: (Object.keys(plan.features) as PlanFeature[]).filter((f) => plan.features[f]),
    },
    billingHold: !!s.billing_hold,
    delivery: {
      on: !!s.delivery_enabled,
      byDistance: !!s.distance_pricing,
      zones: counts!.zones,
    },
    pickup: !!s.pickup_enabled,
    preordersWhileClosed: s.preorders_while_closed ?? true,
    payments: s.payment_methods ?? ['pix'],
    mercadoPago: mp?.status ?? null,
    pixKey: !!s.pix_key,
    whatsapp: counts!.wa,
    vendedor,
    catalog: { ...catalog!, categories: categories.map((c) => c.name) },
    coupons: counts!.coupons,
    loyalty: !!settings.loyalty,
    announcement: !!settings.promo,
    team: roles,
    printers: counts!.printers,
    tables: counts!.tables,
    setupMissing: checklist.filter((c) => !c.done).map((c) => c.label),
    specialDays: upcomingSpecialDays(s.special_days, tz, now, 14)
      .slice(0, 6)
      .map((d) => ({ date: d.date, label: d.label ?? null, closed: d.closed })),
    site: counts!.site,
    live: {
      status: st.status,
      demandHigh: demandOf(s).level === 'high',
      waiting: counts!.waiting,
      inProgress: counts!.inProgress,
      scheduled: counts!.scheduled,
      pixToCheck: counts!.pixToCheck,
      ordersEver,
    },
  };
}

const METHOD: Record<string, string> = {
  pix: 'Pix',
  card: 'cartão online',
  cash: 'dinheiro',
  card_on_delivery: 'cartão na entrega',
  meal_voucher: 'vale-refeição',
};

const FEATURE: Record<PlanFeature, string> = {
  customDomain: 'domínio próprio',
  customSite: 'site sob medida',
  kds: 'tela da cozinha',
  printing: 'impressão automática',
  loyalty: 'cartão fidelidade',
  vendedor: 'Duá vendedor no WhatsApp',
  copilot: 'Copiloto',
  pdv: 'PDV (balcão, mesas e caixa)',
};

const VENDEDOR: Record<NonNullable<Brief['vendedor']>, string> = {
  off: 'desligado',
  paused: 'pausado',
  rehearsal: 'em ensaio (escreve mas não manda)',
  on: 'atendendo os clientes no WhatsApp da loja',
  disconnected: 'ligado, mas o WhatsApp da loja está desconectado',
};

const SITE: Record<string, string> = {
  requested: 'pedido, esperando o briefing',
  in_progress: 'em construção',
  delivered: 'entregue',
  cancelled: 'cancelado',
};

const MP: Record<string, string> = {
  connected: 'conectado',
  expiring: 'conectado, mas a conexão está vencendo',
  restricted: 'com restrição do lado do Mercado Pago',
  disconnected: 'desconectado',
};

const yes = (b: boolean) => (b ? 'sim' : 'não');

/** The cached tenant block: who the store is and how it is set up. */
export function briefText(b: Brief): string {
  const c = b.catalog;
  const lines = [
    `FICHA DA LOJA (lida agora do sistema; para detalhes e valores, use as ferramentas ou load_context):`,
    `- Loja: ${b.storeName}${b.segment ? ` · segmento ${b.segment}` : ''}${b.city ? ` · ${b.city}` : ''}${b.url ? ` · ${b.url}` : ''}`,
    ...(b.tagline ? [`- Frase da loja: ${b.tagline}`] : []),
    `- Plano: ${b.plan.name}${b.plan.features.length ? ` (inclui ${b.plan.features.map((f) => FEATURE[f]).join(', ')})` : ''}${b.billingHold ? ' · a loja só abre quando o primeiro pagamento do plano for confirmado' : ''}`,
    `- Cardápio: ${c.products} produtos em ${b.catalog.categories.length} categorias${c.categories.length ? ` (${c.categories.join(', ')})` : ''}; ${c.soldOut} esgotados, ${c.lowStock} acabando, ${c.hidden} escondidos, ${c.withOptions} com opções.`,
    `- Entrega: ${b.delivery.on ? (b.delivery.byDistance ? 'sim, cobrada pela distância' : `sim, ${b.delivery.zones} áreas ativas`) : 'não'} · retirada: ${yes(b.pickup)} · encomendas com a loja fechada: ${yes(b.preordersWhileClosed)}`,
    `- Pagamentos aceitos: ${b.payments.map((m) => METHOD[m] ?? m).join(', ') || 'nenhum'} · chave Pix: ${b.pixKey ? 'cadastrada' : 'não cadastrada'} · Mercado Pago: ${b.mercadoPago ? (MP[b.mercadoPago] ?? b.mercadoPago) : 'não conectado'}`,
    `- WhatsApp da loja: ${b.whatsapp ? 'conectado' : 'não conectado'}${b.vendedor ? ` · Duá vendedor: ${VENDEDOR[b.vendedor]}` : ''}`,
    `- Marketing: ${b.coupons} cupons ativos · cartão fidelidade: ${yes(b.loyalty)} · aviso no topo da loja: ${yes(b.announcement)}`,
    `- Equipe: ${b.team.owner} dono(s), ${b.team.manager} gerente(s), ${b.team.attendant} atendente(s)${b.printers ? ` · ${b.printers} impressoras` : ''}${b.tables ? ` · ${b.tables} mesas no PDV` : ''}`,
  ];
  if (b.specialDays.length)
    lines.push(
      `- Dias especiais chegando: ${b.specialDays
        .map(
          (d) =>
            `${d.date}${d.label ? ` (${d.label})` : ''} ${d.closed ? 'fechada' : 'horário especial'}`,
        )
        .join('; ')}`,
    );
  if (b.site) lines.push(`- Site sob medida: ${SITE[b.site] ?? b.site}`);
  if (b.setupMissing.length) lines.push(`- Falta configurar: ${b.setupMissing.join('; ')}`);
  return lines.join('\n');
}

const STATUS: Record<string, string> = {
  open: 'aberta',
  closed: 'fechada (fora do horário)',
  paused: 'pausada',
};

/** Turn-scoped lines after AGORA: what's happening in the store as this turn starts. */
export function liveText(b: Brief): string {
  const l = b.live;
  const parts = [
    `LOJA AGORA: ${STATUS[l.status] ?? l.status}${l.demandHigh ? ', com aviso de muitos pedidos' : ''}`,
    `${l.waiting} pedidos esperando aceite`,
    `${l.inProgress} em andamento`,
  ];
  if (l.scheduled) parts.push(`${l.scheduled} encomendas para os próximos dias`);
  if (l.pixToCheck) parts.push(`${l.pixToCheck} Pix para conferir`);
  if (!l.ordersEver) parts.push('a loja ainda não recebeu nenhum pedido');
  return parts.join(' · ');
}
