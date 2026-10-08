import type { StoreEvent } from '@/lib/api.ts';
import { fmtMoney } from '@/lib/format.ts';

const ORDER_STEP: Record<string, string> = {
  paid: 'pago',
  confirmed: 'confirmado',
  preparing: 'em preparo',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'reembolsado',
};
const WA_STEP: Record<string, string> = {
  connected: 'WhatsApp conectado',
  back: 'WhatsApp voltou',
  lost: 'WhatsApp caiu',
  logged_out: 'WhatsApp desvinculado no celular',
  banned: 'número de WhatsApp recusado',
  disconnected: 'WhatsApp desconectado',
};
const ONBOARDING: Record<string, string> = {
  paid: 'plano pago',
  live: 'loja no ar',
  first_login: 'primeiro acesso ao painel',
  setup: 'loja montada',
  payments: 'Mercado Pago conectado',
  first_order: 'primeiro pedido',
  domain: 'domínio próprio pronto',
};
const SOURCE: Record<string, string> = {
  signup: 'cadastro pelo site',
  access_code: 'código de acesso',
  invite: 'convite da equipe',
};
const PROBLEM: Record<string, string> = {
  card_rejected: 'cartão recusado',
  past_due: 'assinatura vencida',
  cancelled: 'assinatura cancelada',
  trial_ended: 'teste acabou sem pagamento',
  pix_mismatch: 'Pix com valor diferente',
  other: 'problema na assinatura',
};
const DEPLOY: Record<string, string> = {
  promote: 'promoveu',
  rollback: 'fez rollback',
  pin: 'fixou a versão',
  unpin: 'soltou a versão',
};
const INCIDENT: Record<string, string> = {
  escalated: 'ficou crítico',
  acked: 'reconhecido',
  resolved: 'resolvido',
};
const MONITOR: Record<string, string> = {
  blocks: 'respostas barradas a cada 100',
  handoffs: '% das conversas passadas para a loja',
  optouts: 'pedidos para parar',
};
const METHOD: Record<string, string> = { pix: 'pix', card: 'cartão', cash: 'dinheiro' };

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const money = (v: unknown) => (n(v) === null ? null : fmtMoney(n(v)));
const clip = (v: string | null, max = 140) => (v && v.length > max ? `${v.slice(0, max - 1)}…` : v);
/** 'YYYY-MM-DD' (or an ISO instant) as a local day with its year — renewals run a year out */
const day = (v: string | null) => {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};
const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ') || null;

/**
 * The row's title. Core's label names a kind of event for the alert settings ("conectou, caiu
 * ou foi desvinculado"); on one store's timeline the row says which it was.
 */
export function eventTitle(e: StoreEvent): string {
  const d = e.data;
  switch (e.kind) {
    case 'whatsapp.store':
      return WA_STEP[s(d.step) ?? ''] ?? e.label;
    case 'order.updated': {
      const to = ORDER_STEP[s(d.to) ?? ''];
      return to ? `pedido ${to}` : e.label;
    }
    case 'payments.connection':
      return d.connected ? 'Mercado Pago conectado' : 'Mercado Pago desconectado';
    case 'billing.problem':
      return PROBLEM[s(d.problem) ?? ''] ?? e.label;
    case 'store.first_order':
      return 'primeiro pedido';
    case 'vendedor.monitor':
      return 'o Duá saiu do normal';
    case 'incident.updated': {
      const c = INCIDENT[s(d.change) ?? ''];
      return c ? `incidente ${c}` : e.label;
    }
    default:
      return e.label;
  }
}

/** One plain line under the title; null when the title says it all. */
export function eventText(e: StoreEvent): string | null {
  const d = e.data;
  const order = n(d.number) === null ? null : `pedido #${n(d.number)}`;
  switch (e.kind) {
    case 'order.placed':
      return join(order, money(d.totalCents), METHOD[s(d.method) ?? ''] ?? s(d.method));
    case 'order.updated':
      return join(order, ORDER_STEP[s(d.to) ?? ''] ? null : s(d.to));
    case 'store.first_order':
      return join(order, money(d.totalCents));
    case 'payment.problem':
      return join(s(d.status), order, money(d.amountCents));
    case 'payments.connection':
      return s(d.detail);
    case 'whatsapp.store':
      return join(WA_STEP[s(d.step) ?? ''] ? null : s(d.step), s(d.detail));
    case 'store.created':
      return join(SOURCE[s(d.source) ?? ''] ?? s(d.source), s(d.plan) && `plano ${s(d.plan)}`);
    case 'store.onboarding':
      return ONBOARDING[s(d.step) ?? ''] ?? s(d.step);
    case 'billing.paid':
      return join(money(d.amountCents), s(d.plan), d.first === true && 'primeira fatura');
    case 'billing.problem':
      return join(PROBLEM[s(d.problem) ?? ''] ? null : s(d.problem), clip(s(d.detail)));
    case 'billing.manual':
      return join(money(d.amountCents), s(d.plan));
    case 'domain.ready':
    case 'domain.live':
    case 'domain.tls_stuck':
    case 'domain.repairing':
    case 'domain.lapsed':
    case 'domain.ordered':
    case 'domain.registered':
    case 'domain.renewal_failed':
    case 'store.live':
      return s(d.host);
    case 'domain.order_failed':
      return join(s(d.host), d.reason === 'conflict' && 'conflito de provedor');
    case 'domain.renewed':
      return join(s(d.host), day(s(d.until)) && `até ${day(s(d.until))}`);
    case 'deployment.failed':
      return clip(s(d.reason));
    case 'deployment.manual':
      return join(s(d.by), DEPLOY[s(d.action) ?? '']);
    case 'incident.opened':
      return clip(s(d.summary));
    case 'incident.updated':
      return s(d.by);
    case 'merchant.help':
      return join(s(d.who), s(d.topic) !== 'geral' && s(d.topic), clip(s(d.message)));
    case 'store.request':
      return s(d.title);
    case 'agent.turn_failed':
      return clip(s(d.error));
    case 'vendedor.monitor':
      return n(d.today) === null
        ? null
        : `${n(d.today)} ${MONITOR[s(d.metric) ?? ''] ?? ''} hoje (de costume ${n(d.baseline)})`;
    default:
      return null;
  }
}
