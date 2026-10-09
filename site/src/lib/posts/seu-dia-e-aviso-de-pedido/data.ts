import { store } from '$lib/content';

// Example data for this post's widgets: Bolos da Nena's Tuesday, 29 Sep 2026, the same day as the
// site's screenshots (screens.facts.json: R$ 718,00 in 6 orders, #28 Mariana R$ 85,00 and #29 Luiz
// R$ 219,00, best seller ×5, busiest 18h, +151%, ticket R$ 120; the 7-day report shows R$ 1.928,00
// in 11 orders, best day 29 set). Everything is integer cents; the rules (busiest hour, the "vs."
// percentage, the report's periods and comparisons) are Core's, ported below.

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moneyRound = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
/** "R$ 1.234,56" */
export const brl = (cents: number) => money.format(cents / 100);
/** "R$ 120", the admin's moneyShort (apps/admin/src/lib/format.ts) */
export const brlShort = (cents: number) => moneyRound.format(Math.round(cents / 100));
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const TODAY = '2026-09-29';

/** the day's orders: the hour each came in, its total and how it leaves */
export const DAY_ORDERS = [
  { number: 24, at: '10h12', hour: 10, cents: 9_000 },
  { number: 25, at: '15h03', hour: 15, cents: 13_500 },
  { number: 26, at: '18h05', hour: 18, cents: 9_900 },
  { number: 27, at: '18h21', hour: 18, cents: 9_000 },
  { number: 28, at: '18h40', hour: 18, cents: 8_500 },
  { number: 29, at: '19h12', hour: 19, cents: 21_900 },
] as const;

/** the store's hours that day, for the hourly chart: 8h to 20h */
export const OPEN = 8;
export const CLOSE = 20;

export const HOURS = Array.from({ length: CLOSE - OPEN }, (_, i) => {
  const hour = OPEN + i;
  const mine = DAY_ORDERS.filter((o) => o.hour === hour);
  return { hour, orders: mine.length, cents: mine.reduce((s, o) => s + o.cents, 0) };
});

export const salesCents = DAY_ORDERS.reduce((s, o) => s + o.cents, 0);
export const orders = DAY_ORDERS.length;
/** Core: round(sales / orders); the Início shows it rounded to reais */
export const avgTicketCents = Math.round(salesCents / orders);
/** Core: the hour with the most orders today (routes-home.ts) */
export const busiest = [...HOURS].sort((a, b) => b.orders - a.orders)[0]!;
export const best = store.dayRecap.bestSeller;

/** the same weekday last week, up to the same hour */
export const lastWeek = { date: '2026-09-22', cents: 28_600, orders: 1 };
/** apps/admin Home.tsx: Math.round(((today − last week) / last week) × 100) */
export const vsLastWeek = Math.round(((salesCents - lastWeek.cents) / lastWeek.cents) * 100);

// ── the daily series behind the 7-day chart and the report ──────────────────────────────────

export type Day = { date: string; cents: number; orders: number };

const DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(parse(d) + n * DAY);
export const spanDays = (from: string, to: string) =>
  Math.round((parse(to) - parse(from)) / DAY) + 1;
const dayOf = (d: string) => Number(d.slice(8));
function monthStart(d: string, back = 0) {
  const t = new Date(parse(d));
  return iso(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back, 1));
}

/** the last fortnight as the 7-day report and the Início show it */
const FIXED: Record<string, [number, number]> = {
  '2026-09-16': [16_000, 1],
  '2026-09-17': [9_850, 1],
  '2026-09-18': [31_500, 2],
  '2026-09-19': [54_900, 3],
  '2026-09-20': [0, 0],
  '2026-09-21': [27_000, 1],
  '2026-09-22': [lastWeek.cents, lastWeek.orders],
  '2026-09-23': [6_500, 1],
  '2026-09-24': [12_000, 1],
  '2026-09-25': [0, 0],
  '2026-09-26': [45_500, 1],
  '2026-09-27': [0, 0],
  '2026-09-28': [57_000, 2],
  [TODAY]: [salesCents, orders],
};

/** a small seeded generator, so the earlier months are the same on every build */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TICKETS = [4_500, 6_000, 8_500, 9_000, 9_900, 12_000, 13_500, 16_000, 18_500, 21_900, 28_600];
/** orders on a usual day, by weekday (dom … sáb): closed on Sundays */
const USUAL = [0, 1, 1, 1, 1, 2, 2];

export const FIRST = '2026-06-01';
export const SERIES: Day[] = (() => {
  const rand = seeded(29);
  const out: Day[] = [];
  for (let d = FIRST; d <= TODAY; d = addDays(d, 1)) {
    const fixed = FIXED[d];
    if (fixed) {
      out.push({ date: d, cents: fixed[0], orders: fixed[1] });
      continue;
    }
    const usual = USUAL[new Date(parse(d)).getUTCDay()]!;
    const n = usual ? Math.max(0, usual + (rand() < 0.45 ? 1 : 0) - (rand() < 0.25 ? 1 : 0)) : 0;
    let cents = 0;
    for (let i = 0; i < n; i++) cents += TICKETS[Math.floor(rand() * TICKETS.length)]!;
    out.push({ date: d, cents, orders: n });
  }
  return out;
})();

export const WEEK = SERIES.slice(-7);

// ── the report's periods (apps/admin/src/features/reports/range.ts, Core's routes-reports.ts) ──

export const PERIODS = [
  { value: 'hoje', label: 'hoje' },
  { value: 'ontem', label: 'ontem' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'mes', label: 'este mês' },
  { value: 'mes-passado', label: 'mês passado' },
  { value: 'custom', label: 'personalizado' },
] as const;
export type Period = (typeof PERIODS)[number]['value'];

export type Range = { from: string; to: string; prevFrom: string; prevTo: string };

/** Core's presetRange: the same number of days before, except months, which compare with the
 *  month before (to the same day, for this one); a custom range compares with as many days before */
export function rangeOf(p: Period, custom: { from: string; to: string }): Range {
  const today = TODAY;
  const back = (from: string, to: string): Range => {
    const n = spanDays(from, to);
    return { from, to, prevFrom: addDays(from, -n), prevTo: addDays(from, -1) };
  };
  switch (p) {
    case 'hoje':
      return back(today, today);
    case 'ontem':
      return back(addDays(today, -1), addDays(today, -1));
    case '7d':
      return back(addDays(today, -6), today);
    case '30d':
      return back(addDays(today, -29), today);
    case 'mes': {
      const prevEnd = addDays(monthStart(today), -1);
      const prevStart = monthStart(today, 1);
      return {
        from: monthStart(today),
        to: today,
        prevFrom: prevStart,
        prevTo: dayOf(today) < dayOf(prevEnd) ? addDays(prevStart, dayOf(today) - 1) : prevEnd,
      };
    }
    case 'mes-passado':
      return {
        from: monthStart(today, 1),
        to: addDays(monthStart(today), -1),
        prevFrom: monthStart(today, 2),
        prevTo: addDays(monthStart(today, 1), -1),
      };
    case 'custom':
      return back(custom.from, custom.to);
  }
}

export function totals(from: string, to: string) {
  const days = SERIES.filter((d) => d.date >= from && d.date <= to);
  const cents = days.reduce((s, d) => s + d.cents, 0);
  const n = days.reduce((s, d) => s + d.orders, 0);
  return { days, cents, orders: n, avg: n ? Math.round(cents / n) : 0 };
}

/** the report's "vs. período anterior": null when the period before sold nothing */
export const delta = (cur: number, prev: number) =>
  prev ? Math.round(((cur - prev) / prev) * 100) : null;

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "ter, 29 set" */
export function dateShort(d: string) {
  const t = new Date(parse(d));
  return `${WEEKDAY[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTH[t.getUTCMonth()]}`;
}
export const weekday = (d: string) => WEEKDAY[new Date(parse(d)).getUTCDay()]!;
/** "23 set – 29 set" or "29 set" */
export function span(from: string, to: string) {
  const f = (d: string) => `${dayOf(d)} ${MONTH[new Date(parse(d)).getUTCMonth()]}`;
  return from === to ? f(from) : `${f(from)} a ${f(to)}`;
}

/** the post's example funnel, for the same 7 days (11 orders) */
export const FUNNEL = [
  { label: 'Visitaram a loja', value: 240 },
  { label: 'Viram um produto', value: 150 },
  { label: 'Montaram sacola', value: 52 },
  { label: 'Foram pagar', value: 19 },
  { label: 'Pediram', value: 11 },
];
