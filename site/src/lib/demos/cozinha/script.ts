// The kitchen demo's orders and arithmetic, after apps/admin/src/features/kitchen/model.ts: a ticket's
// clock runs from "aceito" against its prep time, amber past 60%, red once late; prioridade first,
// then whatever is due soonest.

export type Mode = 'pickup' | 'delivery';
export type Stage = 'placed' | 'confirmed' | 'preparing' | 'ready';
export type Urgency = 'fresh' | 'warn' | 'late';

export interface Item {
  id: string;
  qty: number;
  name: string;
  done: boolean;
}

export interface Order {
  id: string;
  number: number;
  name: string;
  /** how she or he is referred to in a sentence: "a Mariana", "o Luiz" */
  who: string;
  mode: Mode;
  stage: Stage;
  /** prep time chosen on accept, minutes */
  prep: number;
  /** seconds on its clock at demo second `at` */
  clock: number;
  at: number;
  /** demo second it went ready */
  readyAt: number;
  rush: boolean;
  /** just landed: "novo" until the kitchen touches it */
  arriving: boolean;
  items: Item[];
}

const item = (id: string, qty: number, name: string, done = false): Item => ({
  id,
  qty,
  name,
  done,
});

const order = (
  o: Partial<Order> & Pick<Order, 'id' | 'number' | 'name' | 'who' | 'mode' | 'items'>,
) =>
  ({
    stage: 'preparing',
    prep: 30,
    clock: 0,
    at: 0,
    readyAt: 0,
    rush: false,
    arriving: false,
    ...o,
  }) as Order;

/** the board when the demo starts: two tickets cooking */
export function opening(): Order[] {
  return [
    order({
      id: 'o27',
      number: 27,
      name: 'Júlia',
      who: 'a Júlia',
      mode: 'pickup',
      clock: 12 * 60 + 40,
      items: [
        item('a', 2, 'Fatia de cenoura com brigadeiro'),
        item('b', 1, 'Bolo de milho cremoso'),
      ],
    }),
    order({
      id: 'o28',
      number: 28,
      name: 'Mariana',
      who: 'a Mariana',
      mode: 'delivery',
      clock: 19 * 60 + 10,
      items: [
        item('a', 1, 'Bolo de chocolate molhadinho'),
        item('b', 1, 'Fatia de fubá com goiabada'),
      ],
    }),
  ];
}

/** Luiz's order (R$ 219,00 with the delivery fee), arriving while the kitchen works */
export function luiz(at: number): Order {
  return order({
    id: 'o29',
    number: 29,
    name: 'Luiz',
    who: 'o Luiz',
    mode: 'delivery',
    stage: 'placed',
    clock: 0,
    at,
    items: [
      item('a', 1, 'Bolo de aniversário 2\u00a0kg'),
      item('b', 3, 'Fatia de cenoura com brigadeiro'),
      item('c', 2, 'Suco de laranja 400\u00a0ml'),
      item('d', 1, 'Café coado 300\u00a0ml'),
    ],
  });
}

/** without JavaScript: the board mid-service, some items made, one order on the counter */
export function midService(): Order[] {
  const [a, b] = opening() as [Order, Order];
  const c = luiz(0);
  return [
    { ...a, stage: 'ready', readyAt: -150, items: a.items.map((i) => ({ ...i, done: true })) },
    { ...b, clock: 24 * 60 + 30, items: b.items.map((i, k) => ({ ...i, done: k === 0 })) },
    {
      ...c,
      stage: 'preparing',
      clock: 6 * 60 + 5,
      items: c.items.map((i, k) => ({ ...i, done: k === 1 || k === 2 })),
    },
  ];
}

export function timing(o: Order, sec: number) {
  const elapsed = Math.max(0, o.clock + (sec - o.at));
  const target = o.prep * 60;
  const ratio = elapsed / target;
  const urgency: Urgency = ratio >= 1 ? 'late' : ratio >= 0.6 ? 'warn' : 'fresh';
  return { elapsed, ratio, left: target - elapsed, urgency };
}

export const WORD: Record<Urgency, string> = {
  fresh: 'no tempo',
  warn: 'atenção',
  late: 'atrasado',
};

/** "4:07" */
export function stopwatch(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** "12 min" */
export const minutes = (s: number) => `${Math.round(Math.abs(s) / 60)} min`;

export function byDue(sec: number) {
  return (a: Order, b: Order) => {
    if (a.rush !== b.rush) return a.rush ? -1 : 1;
    return timing(a, sec).left - timing(b, sec).left || a.number - b.number;
  };
}

export const count = (o: Order) => o.items.reduce((n, i) => n + i.qty, 0);
