// Example data for the Resultados board, invented for Bolos da Nena: Venduá has no real numbers
// to show here. The shape and the rules are Core's (packages/core/src/vendedor/results.ts):
// closed and assisted apart, assisted = a site order within 24 h of Duá sending a sacola link, a
// funnel that never grows from one step to the next, "poucas conversas" under 20. Every total
// below is computed from the day series, so the numbers on the board always add up.

export type Period = 'today' | '7d' | '30d';

/** [orders, cents] per day, oldest first; the last one is today, up to 18h */
const CLOSED: [number, number][] = [
  [2, 21250],
  [3, 33300],
  [4, 40850],
  [4, 45300],
  [6, 64450],
  [5, 47600],
  [3, 28250],
  [3, 30150],
  [4, 40100],
  [3, 29300],
  [5, 53950],
  [7, 67100],
  [6, 51800],
  [2, 18650],
  [3, 32700],
  [4, 39700],
  [3, 32550],
  [4, 37000],
  [6, 63450],
  [5, 45900],
  [3, 24850],
  [2, 23500],
  [4, 42350],
  [4, 39550],
  [4, 42500],
  [7, 72400],
  [5, 46950],
  [2, 20700],
  [2, 19050],
  [3, 31250],
];
const ASSISTED: [number, number][] = [
  [1, 8650],
  [0, 0],
  [0, 0],
  [1, 10600],
  [0, 0],
  [0, 0],
  [0, 0],
  [1, 7700],
  [1, 8100],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [2, 15100],
  [1, 7200],
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
  [1, 10300],
  [0, 0],
  [0, 0],
  [2, 18500],
  [1, 10750],
  [0, 0],
  [0, 0],
  [1, 7450],
  [1, 9400],
];
/** today by hour (9h to 18h): Duá's three orders and the one site order after his link */
const TODAY: { hour: number; closed: number; assisted: number }[] = [
  { hour: 9, closed: 0, assisted: 0 },
  { hour: 10, closed: 5600, assisted: 0 },
  { hour: 11, closed: 0, assisted: 0 },
  { hour: 12, closed: 0, assisted: 9400 },
  { hour: 13, closed: 0, assisted: 0 },
  { hour: 14, closed: 0, assisted: 0 },
  { hour: 15, closed: 10750, assisted: 0 },
  { hour: 16, closed: 0, assisted: 0 },
  { hour: 17, closed: 14900, assisted: 0 },
  { hour: 18, closed: 0, assisted: 0 },
];

// today is the last day; the six before it, by weekday
const WEEK = ['qui', 'sex', 'sáb', 'dom', 'seg', 'ter', 'hoje'];

export interface Bar {
  label: string;
  /** read out by screen readers in place of the short label */
  long: string;
  closed: number;
  assisted: number;
}

export interface Board {
  bars: Bar[];
  /** which bars get a visible axis label */
  tick: (i: number) => boolean;
  closed: { cents: number; orders: number };
  assisted: { cents: number; orders: number };
  siteAverageCents: number;
  funnel: { conversations: number; carts: number; summaries: number; orders: number };
  suggestions: { offered: number; taken: number; revenueCents: number };
  recovered: { orders: number; cents: number };
  replySec: { p50: number; p95: number };
  handoffs: { reason: string; count: number }[];
}

const sum = (rows: [number, number][]) =>
  rows.reduce((a, r) => ({ orders: a.orders + r[0], cents: a.cents + r[1] }), {
    orders: 0,
    cents: 0,
  });

function days(n: number): Bar[] {
  const from = CLOSED.length - n;
  return CLOSED.slice(from).map((c, i) => {
    const ago = n - 1 - i;
    return {
      label: n === 7 ? WEEK[i]! : ago === 0 ? 'hoje' : `há ${ago} d`,
      long: ago === 0 ? 'hoje' : ago === 1 ? 'ontem' : `há ${ago} dias`,
      closed: c[1],
      assisted: ASSISTED[from + i]![1],
    };
  });
}

const PER: Record<Period, Omit<Board, 'bars' | 'tick' | 'closed' | 'assisted'>> = {
  today: {
    // the day's other three orders came through the site: R$ 718,00 in six orders, all told
    siteAverageCents: Math.round((71800 - 31250) / 3),
    funnel: { conversations: 9, carts: 6, summaries: 4, orders: 3 },
    suggestions: { offered: 3, taken: 2, revenueCents: 900 + 950 },
    recovered: { orders: 1, cents: 5600 },
    replySec: { p50: 8, p95: 31 },
    handoffs: [{ reason: 'pediu uma pessoa', count: 1 }],
  },
  '7d': {
    siteAverageCents: 10430,
    funnel: { conversations: 71, carts: 47, summaries: 34, orders: 26 },
    suggestions: { offered: 24, taken: 9, revenueCents: 5 * 900 + 4 * 950 },
    recovered: { orders: 4, cents: 5600 + 9800 + 12450 + 10400 },
    replySec: { p50: 9, p95: 34 },
    handoffs: [
      { reason: 'pediu uma pessoa', count: 3 },
      { reason: 'pedido grande', count: 2 },
      { reason: 'alergia', count: 1 },
    ],
  },
  '30d': {
    siteAverageCents: 10280,
    funnel: { conversations: 298, carts: 205, summaries: 151, orders: 114 },
    suggestions: { offered: 101, taken: 37, revenueCents: 20 * 900 + 17 * 950 },
    recovered: { orders: 13, cents: 129700 },
    replySec: { p50: 9, p95: 41 },
    handoffs: [
      { reason: 'pediu uma pessoa', count: 11 },
      { reason: 'pedido grande', count: 6 },
      { reason: 'alergia', count: 4 },
      { reason: 'reclamação', count: 2 },
      { reason: 'pagamento', count: 1 },
    ],
  },
};

export function board(p: Period): Board {
  if (p === 'today')
    return {
      bars: TODAY.map((h) => ({
        label: `${h.hour}h`,
        long: `das ${h.hour}h às ${h.hour + 1}h`,
        closed: h.closed,
        assisted: h.assisted,
      })),
      tick: (i) => i % 3 === 0,
      closed: sum(CLOSED.slice(-1)),
      assisted: sum(ASSISTED.slice(-1)),
      ...PER.today,
    };
  const n = p === '7d' ? 7 : 30;
  return {
    bars: days(n),
    tick: n === 7 ? () => true : (i) => (n - 1 - i) % 7 === 0,
    closed: sum(CLOSED.slice(-n)),
    assisted: sum(ASSISTED.slice(-n)),
    ...PER[p],
  };
}

/** Core's own threshold: under 20 conversations the board says the numbers are still few */
export const ENOUGH = 20;

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];
