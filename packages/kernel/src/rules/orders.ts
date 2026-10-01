import type { PaymentAdjustment } from '../api.ts';
import { formatCents, LOCALE } from './format.ts';

// Orders, payment methods and their labels, as the shopper reads them. Transitions are
// Core's (a pickup order never goes out for delivery); this only lays the path out.

export const ORDER_STATE_LABEL: Record<string, string> = {
  placed: 'Pedido recebido',
  confirmed: 'Pedido confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

export const TERMINAL_ORDER_STATES: ReadonlySet<string> = new Set([
  'delivered',
  'cancelled',
  'refunded',
]);

/** The happy path an order walks for its mode. */
export function orderPath(mode: 'delivery' | 'pickup'): string[] {
  return mode === 'delivery'
    ? ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']
    : ['placed', 'confirmed', 'preparing', 'ready', 'delivered'];
}

export interface OrderProgress {
  steps: { state: string; status: 'done' | 'current' | 'todo' }[];
  /** index of the order's state on the path; for a cancelled/refunded order the last step it
   *  reached (from its timeline), -1 when unknown */
  current: number;
  terminal: boolean;
  outcome: 'cancelled' | 'refunded' | null;
}

type ProgressInput = {
  state: string;
  /** an `Order` carries `delivery.mode`, an `OrderSummary` carries `mode` */
  mode?: 'delivery' | 'pickup';
  delivery?: { mode: 'delivery' | 'pickup' };
  timeline?: { to: string }[];
};

export function orderProgress(order: ProgressInput): OrderProgress {
  const path = orderPath(order.delivery?.mode ?? order.mode ?? 'delivery');
  const outcome = order.state === 'cancelled' || order.state === 'refunded' ? order.state : null;
  if (outcome) {
    const reached = Math.max(-1, ...(order.timeline ?? []).map((e) => path.indexOf(e.to)));
    return {
      steps: path.map((state, i) => ({ state, status: i <= reached ? 'done' : 'todo' })),
      current: reached,
      terminal: true,
      outcome,
    };
  }
  const current = path.indexOf(order.state);
  return {
    steps: path.map((state, i) => ({
      state,
      status: current < 0 || i > current ? 'todo' : i < current ? 'done' : 'current',
    })),
    current,
    terminal: TERMINAL_ORDER_STATES.has(order.state),
    outcome: null,
  };
}

/** A step's short name on the progress track (`Preparo`, `A caminho`, `Retirado`). */
export function orderStepLabel(state: string, mode: 'delivery' | 'pickup'): string {
  if (state === 'delivered') return mode === 'delivery' ? 'Entregue' : 'Retirado';
  return STEP_LABEL[state] ?? ORDER_STATE_LABEL[state] ?? state;
}

const STEP_LABEL: Record<string, string> = {
  placed: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Preparo',
  ready: 'Pronto',
  out_for_delivery: 'A caminho',
};

/** Payment methods in the shopper's words. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix: 'Pix',
  card_online: 'Cartão de crédito',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
  meal_voucher: 'Vale-refeição',
};
/** @deprecated alias of `PAYMENT_METHOD_LABEL` (the ui-defaults name) */
export const PAYMENT_LABEL = PAYMENT_METHOD_LABEL;

/** The order the checkout lists methods in. */
export const PAYMENT_METHOD_ORDER = [
  'pix',
  'card_online',
  'card_on_delivery',
  'meal_voucher',
  'cash',
] as const;

/** A second line under a method's name. */
export const PAYMENT_METHOD_DETAIL: Record<string, string> = {
  card_online: 'Pago pelo Mercado Pago',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'pago',
  pending: 'aguardando pagamento',
  failed: 'não aprovado',
  expired: 'expirado',
  refunded: 'devolvido',
  partially_refunded: 'devolvido em parte',
  in_mediation: 'em análise',
  charged_back: 'contestado',
};

/** A Pix key's type, as the shopper reads it beside the key. */
export const PIX_KEY_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'e-mail',
  phone: 'celular',
  random: 'chave aleatória',
};

/** A payment method's rule: discount (all parts ≤ 0), surcharge (all ≥ 0), mixed; null = none. */
export function adjustmentKind(
  a: PaymentAdjustment | null | undefined,
): 'discount' | 'surcharge' | 'mixed' | null {
  const pct = a?.percentBps ?? 0;
  const fixed = a?.fixedCents ?? 0;
  if (!pct && !fixed) return null;
  return pct <= 0 && fixed <= 0 ? 'discount' : pct >= 0 && fixed >= 0 ? 'surcharge' : 'mixed';
}

const pctText = (bps: number) =>
  `${(Math.abs(bps) / 100).toLocaleString(LOCALE, { maximumFractionDigits: 2 })}%`;

/** The rule as a tag: `−5%`, `+R$ 2,00`, `−5% +R$ 1,00`; null = none. The cents are Core's. */
export function adjustmentShort(
  a: PaymentAdjustment | null | undefined,
  currency = 'BRL',
): string | null {
  const pct = a?.percentBps ?? 0;
  const fixed = a?.fixedCents ?? 0;
  if (!pct && !fixed) return null;
  const sign = (n: number) => (n < 0 ? '−' : '+');
  return [
    pct ? `${sign(pct)}${pctText(pct)}` : '',
    fixed ? `${sign(fixed)}${formatCents(Math.abs(fixed), currency)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The rule in words: `5% de desconto`, `R$ 2,00 de acréscimo`, `5% + R$ 1,00 de desconto`,
 *  `5% de desconto e R$ 1,00 de acréscimo`; null = none. */
export function adjustmentText(
  a: PaymentAdjustment | null | undefined,
  currency = 'BRL',
): string | null {
  const pct = a?.percentBps ?? 0;
  const fixed = a?.fixedCents ?? 0;
  if (!pct && !fixed) return null;
  const word = (n: number) => (n < 0 ? 'desconto' : 'acréscimo');
  const money = (n: number) => formatCents(Math.abs(n), currency);
  if (pct && fixed && Math.sign(pct) !== Math.sign(fixed))
    return `${pctText(pct)} de ${word(pct)} e ${money(fixed)} de ${word(fixed)}`;
  const parts = [pct ? pctText(pct) : null, fixed ? money(fixed) : null].filter(Boolean);
  return `${parts.join(' + ')} de ${word(pct || fixed)}`;
}

type SummaryLine = {
  modifiers: { name: string; priceDeltaCents: number; qty?: number }[];
  combo?: { name: string; qty: number }[];
};

/** A line's options and kit picks: `2× Calda (+R$ 2,00), Granulado, 1× Pudim de leite`
 *  (an option's price is per unit; '' when there is nothing to say). */
export function lineSummary(item: SummaryLine, currency = 'BRL'): string {
  return [
    ...item.modifiers.map((m) => {
      const name = (m.qty ?? 1) > 1 ? `${m.qty}× ${m.name}` : m.name;
      return m.priceDeltaCents > 0
        ? `${name} (+${formatCents(m.priceDeltaCents, currency)})`
        : name;
    }),
    ...(item.combo ?? []).map((c) => `${c.qty}× ${c.name}`),
  ].join(', ');
}
