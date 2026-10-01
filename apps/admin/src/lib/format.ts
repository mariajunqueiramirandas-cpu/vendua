import { formatCents, phoneDisplay } from '@vendua/kernel/rules';

// pt-BR formatting (design spec §9): R$ 1.234,56 · "há 3 min" · "hoje às 14h30" · (31) 99876-5432

const brlShort = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

/** "R$ 1.234,56" — the storefront's own formatter (its no-break space keeps "R$" on the
 *  number's line, as `phone` does with the DDD). */
export const money = (cents: number) => formatCents(cents, 'BRL');
/** R$ 1.234 — for axis ticks and compact tiles */
export const moneyShort = (cents: number) => brlShort.format(Math.round(cents / 100));
export const moneyCompact = (cents: number) => {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (v >= 10_000) return `R$ ${Math.round(v / 1000)} mil`;
  return moneyShort(cents);
};
export const num = (n: number) => n.toLocaleString('pt-BR');

/** "(22) 98179-5040" — the Kernel's phoneDisplay; '' for none. */
export const phone = (p: string | null | undefined) => (p ? phoneDisplay(p) : '');

const time = (d: Date, tz?: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(d)
    .replace(':', 'h');

const dayKey = (d: Date, tz?: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

/** "sáb, 27 set" */
export function dateShort(iso: string | Date, tz?: string) {
  const d = typeof iso === 'string' ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso) : iso;
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  })
    .format(d)
    .replace(/\./g, '')
    .replace(/ de /g, ' ');
}

/** "hoje às 14h30" · "ontem às 9h" · "sáb, 27 set às 8h" */
export function when(iso: string, tz?: string) {
  const d = new Date(iso);
  const now = new Date();
  const k = dayKey(d, tz);
  const t = time(d, tz).replace(/h00$/, 'h');
  if (k === dayKey(now, tz)) return `hoje às ${t}`;
  if (k === dayKey(new Date(now.getTime() - 86_400_000), tz)) return `ontem às ${t}`;
  return `${dateShort(d, tz)} às ${t}`;
}

/** "agora" · "há 3 min" · "há 2 h" · "há 3 dias" */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

export const minutesSince = (iso: string, now = Date.now()) =>
  Math.floor((now - new Date(iso).getTime()) / 60_000);

export function clock(iso: string, tz?: string) {
  return time(new Date(iso), tz).replace(/h00$/, 'h');
}

/** "9h" / "18h30" from "09:00" / "18:30" */
export const hhmm = (t: string) => {
  const [h, m] = t.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};

export const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** local YYYY-MM-DD in a timezone */
export function isoDate(d: Date, tz?: string) {
  return dayKey(d, tz);
}

export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

export function greeting(tz?: string) {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(
      new Date(),
    ),
  );
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
