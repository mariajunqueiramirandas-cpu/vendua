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
  connected: 'conectou',
  back: 'voltou',
  lost: 'perdeu a conexão',
  logged_out: 'desvinculado no celular',
  banned: 'número recusado',
  disconnected: 'desconectado',
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
const join = (...parts: (string | null | undefined | false)[]) =>
  parts.filter(Boolean).join(' · ') || null;

/** One plain line under the event's label; null when the label says it all. */
export function eventText(e: StoreEvent): string | null {
  const d = e.data;
  const order = n(d.number) === null ? null : `pedido #${n(d.number)}`;
  switch (e.kind) {
    case 'order.placed':
      return join(order, money(d.totalCents), METHOD[s(d.method) ?? ''] ?? s(d.method));
    case 'order.updated':
      return join(order, ORDER_STEP[s(d.to) ?? ''] ?? s(d.to));
    case 'store.first_order':
      return join(order, money(d.totalCents));
    case 'payment.problem':
      return join(s(d.status), order, money(d.amountCents));
    case 'payments.connection':
      return join(d.connected ? 'conectado' : 'desconectado', s(d.detail));
    case 'whatsapp.store':
      return join(WA_STEP[s(d.step) ?? ''] ?? s(d.step), s(d.detail));
    case 'store.created':
      return join(SOURCE[s(d.source) ?? ''] ?? s(d.source), s(d.plan) && `plano ${s(d.plan)}`);
    case 'store.onboarding':
      return ONBOARDING[s(d.step) ?? ''] ?? s(d.step);
    case 'billing.paid':
      return join(money(d.amountCents), s(d.plan), d.first === true && 'primeira fatura');
    case 'billing.problem':
      return join(PROBLEM[s(d.problem) ?? ''] ?? s(d.problem), clip(s(d.detail)));
    case 'billing.manual':
      return join(money(d.amountCents), s(d.plan));
    case 'domain.ready':
    case 'store.live':
      return s(d.host);
    case 'deployment.failed':
      return clip(s(d.reason));
    case 'deployment.manual':
      return join(s(d.by), DEPLOY[s(d.action) ?? '']);
    case 'incident.opened':
      return clip(s(d.summary));
    case 'incident.updated':
      return join(INCIDENT[s(d.change) ?? ''], s(d.by));
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
