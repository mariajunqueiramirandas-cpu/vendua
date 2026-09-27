// pt-BR formatting (design spec §9): R$ 1.234,56 · "há 3 min" · "hoje às 14h30" · (31) 99876-5432

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlShort = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const money = (cents: number) => brl.format(cents / 100).replace(/ /g, ' ');
/** R$ 1.234 — for axis ticks and compact tiles */
export const moneyShort = (cents: number) =>
  brlShort.format(Math.round(cents / 100)).replace(/ /g, ' ');
export const moneyCompact = (cents: number) => {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (v >= 10_000) return `R$ ${Math.round(v / 1000)} mil`;
  return moneyShort(cents);
};
export const num = (n: number) => n.toLocaleString('pt-BR');

export function phone(p: string | null | undefined): string {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

/** What gets stored: digits with the country code, so wa.me links work. */
export function waDigits(v: string): string | null {
  const d = v.replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

export function whatsappLink(p: string, text?: string) {
  const d = p.replace(/\D/g, '');
  const full = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

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
