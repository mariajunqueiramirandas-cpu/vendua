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
