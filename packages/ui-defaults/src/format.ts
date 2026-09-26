export function money(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

export function dateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function time(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    ...(timeZone ? { timeZone } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

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

export const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
};
