import { formatCents } from './format.ts';

// Default pt-BR copy per Core error code — what the Kernel's error surface shows, and what a
// store showing its own error text starts from. Coupon codes live in the same table.

export const ERROR_COPY: Record<string, { title: string; body?: string }> = {
  SOLD_OUT: { title: 'Esgotou agora há pouco', body: 'Esse item acabou. Escolha outro sabor.' },
  MODIFIER_SOLD_OUT: { title: 'Essa opção esgotou', body: 'Escolha outra opção para continuar.' },
  MODIFIER_REQUIRED: {
    title: 'Falta escolher uma opção',
    body: 'Complete as escolhas obrigatórias.',
  },
  MODIFIER_LIMIT: { title: 'Opções demais', body: 'Reduza as escolhas desse grupo.' },
  STORE_PAUSED: { title: 'A loja pausou os pedidos', body: 'Volte em instantes.' },
  STORE_CLOSED: { title: 'A loja está fechada agora' },
  OUT_OF_ZONE: { title: 'Fora da área de entrega', body: 'Retirada continua disponível.' },
  ORDER_MIN_NOT_MET: {
    title: 'Pedido abaixo do mínimo',
    body: 'Adicione mais itens para continuar.',
  },
  DELIVERY_UNAVAILABLE: { title: 'Entrega indisponível agora', body: 'Escolha retirada.' },
  PICKUP_UNAVAILABLE: { title: 'Retirada indisponível agora', body: 'Escolha entrega.' },
  EMPTY_CART: { title: 'Sua sacola está vazia' },
  CART_NOT_OPEN: { title: 'Essa sacola já virou pedido', body: 'Recarregue para começar outra.' },
  PRODUCT_NOT_FOUND: { title: 'Produto indisponível' },
  NETWORK_ERROR: { title: 'Sem conexão com a loja', body: 'Confira sua internet e tente de novo.' },
  RATE_LIMITED: { title: 'Muitas tentativas seguidas', body: 'Espere alguns segundos.' },
  // Kernel 1.2
  OUT_OF_STOCK: { title: 'Não temos tudo isso em estoque', body: 'Diminua a quantidade.' },
  PRICES_CHANGED: { title: 'Alguns preços mudaram', body: 'Confira a sacola e confirme de novo.' },
  COMBO_SLOT_COUNT: {
    title: 'Complete a montagem do kit',
    body: 'Confira quantos itens cada parte pede.',
  },
  COMBO_ITEM_LIMIT: { title: 'Repetiu demais um item do kit' },
  COMBO_ITEM_SOLD_OUT: { title: 'Um item do kit esgotou', body: 'Troque por outro sabor.' },
  INVALID_COMBO: { title: 'Esse kit mudou', body: 'Monte de novo.' },
  SCHEDULE_REQUIRED: { title: 'Escolha a data da encomenda' },
  INVALID_SCHEDULE: { title: 'Essa data não está disponível', body: 'Escolha outra data.' },
  // Kernel 1.7
  PAYMENT_UNAVAILABLE: {
    title: 'O pagamento online não respondeu',
    body: 'Tente de novo em instantes. Seu pedido está guardado.',
  },
  PAYMENT_NOT_REQUIRED: { title: 'Esse pedido não precisa de pagamento online' },
  PAYMENT_ONLINE: { title: 'Esse pagamento é confirmado pelo Mercado Pago' },
  PAYMENT_NOT_ALLOWED: { title: 'Encomendas aceitam outra forma de pagamento' },
  // Kernel 1.17 — the checkout shows `changeMessage` at the change field
  INVALID_CHANGE: { title: 'Confira o valor do troco' },
  // Kernel 1.19 — the in-page card
  PAYMENT_IN_PROGRESS: {
    title: 'Seu pagamento ainda está sendo processado',
    body: 'Espere a resposta do banco antes de tentar de novo.',
  },
  INVALID_PAYMENT: { title: 'Confira os dados do cartão' },
  // coupons — the one table (`couponMessage`, `COUPON_REASON` read it)
  COUPON_NOT_FOUND: { title: 'Cupom não encontrado' },
  INVALID_COUPON: { title: 'Cupom inválido' },
  COUPON_EXPIRED: { title: 'Esse cupom expirou' },
  COUPON_NOT_STARTED: { title: 'Esse cupom ainda não começou' },
  COUPON_EXHAUSTED: { title: 'Esse cupom esgotou' },
  COUPON_MIN_SUBTOTAL: { title: 'Falta pouco para usar o cupom', body: 'Adicione mais itens.' },
  COUPON_NOT_YOURS: { title: 'Esse cupom é de outro cliente' },
  COUPON_ALREADY_USED: { title: 'Você já usou esse cupom' },
  COUPON_FIRST_ORDER_ONLY: { title: 'Cupom válido só no primeiro pedido' },
  SHARE_NOT_FOUND: { title: 'Esse link de sacola expirou' },
  CUSTOMER_NOT_VERIFIED: {
    title: 'Não achamos esse pedido',
    body: 'Confira o número do pedido e o WhatsApp usado nele.',
  },
  CEP_NOT_FOUND: { title: 'CEP não encontrado', body: 'Preencha o endereço à mão.' },
  CEP_UNAVAILABLE: { title: 'Busca de CEP indisponível', body: 'Preencha o endereço à mão.' },
  // Kernel 1.18 — the storefront chat
  CHAT_UNAVAILABLE: {
    title: 'O chat da loja está desligado agora',
    body: 'Você ainda pode fazer o pedido pelo site.',
  },
  // Kernel 1.22 — ordering from a table's QR code
  TABLE_NOT_FOUND: {
    title: 'Esse QR code não vale mais',
    body: 'Peça à equipe o QR code atual da mesa.',
  },
  TABLE_ORDERS_OFF: {
    title: 'A loja não está recebendo pedidos pela mesa agora',
    body: 'Chame a equipe para pedir.',
  },
  TABLE_BUSY: { title: 'A mesa acabou de mudar', body: 'Tente de novo.' },
  TABLE_ORDERS_PENDING: {
    title: 'Esta mesa já tem pedidos esperando a equipe',
    body: 'Assim que a equipe aceitar os anteriores, você pode mandar outro.',
  },
  // Kernel 1.23
  CART_FULL: { title: 'Sua sacola está cheia', body: 'Finalize este pedido e faça outro.' },
  ORDER_TOO_LARGE: {
    title: 'Pedido grande demais para a loja',
    body: 'Fale com a loja para combinar.',
  },
  NOTIFY_LIMIT: {
    title: 'Não deu para anotar seu aviso agora',
    body: 'Tente de novo amanhã ou fale com a loja.',
  },
};

const FALLBACK = { title: 'Não foi possível concluir', body: 'Tente novamente em instantes.' };

export function errorCopy(code: string): { title: string; body?: string } {
  return ERROR_COPY[code] ?? FALLBACK;
}

const COUPON_CODES = [
  'COUPON_NOT_FOUND',
  'INVALID_COUPON',
  'COUPON_EXPIRED',
  'COUPON_NOT_STARTED',
  'COUPON_EXHAUSTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_NOT_YOURS',
  'COUPON_ALREADY_USED',
  'COUPON_FIRST_ORDER_ONLY',
];

/** Coupon code → its message (the ui-defaults name; reads `ERROR_COPY`). */
export const COUPON_REASON: Record<string, string> = Object.fromEntries(
  COUPON_CODES.map((c) => [c, ERROR_COPY[c]!.title]),
);

/** The error is about the coupon itself (the coupon field shows it, not a toast). */
export function isCouponError(code: string): boolean {
  return COUPON_CODES.includes(code);
}

/** Why a coupon doesn't apply, or why applying it failed. `COUPON_MIN_SUBTOTAL` says how much
 *  is missing when Core sent `details.remainingCents`. */
export function couponMessage(
  code: string,
  details?: Record<string, unknown> | null,
  currency = 'BRL',
): string {
  const remaining = details?.remainingCents;
  if (code === 'COUPON_MIN_SUBTOTAL' && typeof remaining === 'number' && remaining > 0)
    return `Faltam ${formatCents(remaining, currency)} para usar este cupom.`;
  return ERROR_COPY[code]?.title ?? 'Este cupom não vale agora.';
}

/** Kernel 1.17 — why Core refused the cash change (`INVALID_CHANGE`): the least it takes
 *  (`details.minCents`, the total) or, Kernel 1.18, the most (`details.maxCents`, Core's cap)
 *  when the amount the shopper typed (`changeForCents`) is above it. Core sends both bounds and
 *  not the amount, so without `changeForCents` both are named. */
export function changeMessage(
  details?: Record<string, unknown> | null,
  currency = 'BRL',
  changeForCents?: number | null,
): string {
  const bound = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  const min = bound(details?.minCents);
  const max = bound(details?.maxCents);
  const atLeast = min
    ? `O troco precisa ser para um valor igual ou maior que o total, ${formatCents(min, currency)}.`
    : 'O troco precisa ser para um valor igual ou maior que o total.';
  if (!max) return atLeast;
  const upTo = `O troco pode ser para até ${formatCents(max, currency)}.`;
  if (typeof changeForCents === 'number') return changeForCents > max ? upTo : atLeast;
  return min
    ? `O troco precisa ser para um valor entre o total, ${formatCents(min, currency)}, e ${formatCents(max, currency)}.`
    : upTo;
}
