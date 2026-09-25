import type { StoreProfile } from '@vendua/kernel';

export const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function brl(cents: number): string {
  return BRL.format(cents / 100);
}

export function hhmm(hhmmString: string): string {
  const [h = '', m = ''] = hhmmString.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

const DAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

export function daysLabel(days: number[]): string {
  if (days.length === 7) return 'todos os dias';
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (contiguous && sorted.length > 2) {
    return `${DAY_ABBR[sorted[0]!]} — ${DAY_ABBR[sorted[sorted.length - 1]!]}`;
  }
  return sorted.map((d) => DAY_ABBR[d] ?? '').join(' · ');
}

export function hoursLines(store: StoreProfile): string[] {
  return store.hours.windows.map(
    (w) => `${daysLabel(w.days)} · ${hhmm(w.open)} às ${hhmm(w.close)}`,
  );
}

function localYMD(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function resumeLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(d)
    .replace(':', 'h')
    .replace(/h00$/, 'h');
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const dayOf = dayFmt.format(d).replace('.', '').toLowerCase().slice(0, 3);
  const dd = (s: string) => new Date(`${s}T12:00:00Z`).getTime();
  const diff = Math.round((dd(localYMD(d, tz)) - dd(localYMD(new Date(), tz))) / 86400000);
  const day =
    diff <= 0
      ? 'hoje'
      : diff === 1
        ? 'amanhã'
        : (DAY_ABBR.find((d3) => dayOf.startsWith(d3.slice(0, 3))) ?? dayOf);
  return `${day} ${time}`;
}

export function localMinutesNow(tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

export function localDayNow(tz: string): number {
  const w = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date());
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w.slice(0, 3));
}

export function toMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

export const PAYMENT_LABELS: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'cartão no balcão',
  cash: 'dinheiro',
};

export const ORDER_STATE_LABELS: Record<string, string> = {
  placed: 'anotado',
  confirmed: 'confirmado',
  preparing: 'na fornada',
  ready: 'pronto no balcão',
  out_for_delivery: 'a caminho',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};
