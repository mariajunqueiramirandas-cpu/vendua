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

/** Kernel 1.17 — why Core refused the cash change (`INVALID_CHANGE`), with the least it takes
 *  when Core sent `details.minCents`. */
export function changeMessage(details?: Record<string, unknown> | null, currency = 'BRL'): string {
  const min = details?.minCents;
  return typeof min === 'number' && min > 0
    ? `O troco precisa ser para um valor igual ou maior que o total, ${formatCents(min, currency)}.`
    : 'O troco precisa ser para um valor igual ou maior que o total.';
}
