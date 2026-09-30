import { useSyncExternalStore } from 'react';
import { ApiError, type Notice } from './api.ts';

// Typed error codes map to default surfaces when the storefront doesn't handle
// them (02 — hooks). A primitive with no onError lands here; so does anything a
// storefront hands to useErrorSurface().show().

const COPY: Record<string, { title: string; body?: string }> = {
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
  return COPY[code] ?? FALLBACK;
}

export function errorCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string')
    return (err as { code: string }).code;
  return 'INTERNAL';
}

let transient: Notice[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
/** codes whose server truth changed — surfaces/store refetch so the overlay appears */
export const STATUS_CODES = new Set(['STORE_PAUSED', 'STORE_CLOSED', 'TENANT_SUSPENDED']);
let onStatusChange: (() => void) | null = null;
export function setStatusRefresher(fn: (() => void) | null) {
  onStatusChange = fn;
}

export function showError(err: unknown) {
  const code = errorCode(err);
  const copy = errorCopy(code);
  const id = `error:${code}`;
  transient = [
    ...transient.filter((n) => n.id !== id),
    {
      id,
      kind: 'error',
      severity: 'warning',
      title: copy.title,
      ...(copy.body ? { body: copy.body } : {}),
      dismissible: true,
      priority: 90,
      payload: { code },
    },
  ].slice(-3);
  notify();
  setTimeout(() => dismissError(id), 8000);
  if (STATUS_CODES.has(code)) onStatusChange?.();
}

/** An informational toast on the same transient stack (e.g. "sacola recuperada"). */
export function showInfo(id: string, title: string, body?: string) {
  const key = `info:${id}`;
  transient = [
    ...transient.filter((n) => n.id !== key),
    {
      id: key,
      kind: 'info',
      severity: 'info',
      title,
      ...(body ? { body } : {}),
      dismissible: true,
      priority: 80,
    },
  ].slice(-3);
  notify();
  setTimeout(() => dismissError(key), 8000);
}

export function dismissError(id: string) {
  const next = transient.filter((n) => n.id !== id);
  if (next.length !== transient.length) {
    transient = next;
    notify();
  }
}

export function useTransientNotices(): Notice[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => transient,
    () => transient,
  );
}

/** Storefront-facing: route any caught error to the default surface. */
export function useErrorSurface(): { show: (err: unknown) => void } {
  return { show: showError };
}
