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
  card_online: 'Cartão de crédito',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
  meal_voucher: 'Vale-refeição',
};

/** "sáb., 26 set." for a store-local YYYY-MM-DD (no timezone shift). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12)));
}

export const COUPON_REASON: Record<string, string> = {
  COUPON_NOT_FOUND: 'Cupom não encontrado.',
  COUPON_EXPIRED: 'Este cupom expirou.',
  COUPON_NOT_STARTED: 'Este cupom ainda não começou.',
  COUPON_EXHAUSTED: 'Este cupom esgotou.',
  COUPON_MIN_SUBTOTAL: 'Adicione mais itens para usar este cupom.',
  COUPON_NOT_YOURS: 'Este cupom é de outro cliente.',
  COUPON_ALREADY_USED: 'Você já usou este cupom.',
  COUPON_FIRST_ORDER_ONLY: 'Cupom válido só no primeiro pedido.',
};

/** Core's resized copies of an uploaded image (`/v1/media/…?w=`, smallest variant ≥ w). */
export const MEDIA_WIDTHS = [320, 480, 640, 960, 1280];

/** A srcset for a Core media path; undefined for any other src (external, data:, CDN). */
export function mediaSrcSet(src: string, widths: readonly number[] = MEDIA_WIDTHS) {
  if (!src.startsWith('/v1/media/')) return undefined;
  const sep = src.includes('?') ? '&' : '?';
  return widths.map((w) => `${src}${sep}w=${w} ${w}w`).join(', ');
}

/** "29:41" (or "1:02:05") until `to`; "0:00" once it passed. */
export function countdown(to: number, now: number): string {
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
