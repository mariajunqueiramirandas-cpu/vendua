import { store } from '$lib/content';

// Order #29 as Core holds it (the same order as the "pedido" screenshot): its items, its zone's
// delivery estimate, and the clock it walks on. Times are minutes after midnight on a fixed,
// fictional day: the demo never reads the real clock.

export type State =
  'placed' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered';

/** the Kernel's path for a delivery order (packages/kernel/src/rules/orders.ts orderPath) */
export const PATH: State[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
];

export const order = {
  ...store.newOrder,
  items: [
    { qty: 1, name: 'Bolo de laranja com calda' },
    { qty: 2, name: 'Bolo de milho cremoso' },
    { qty: 2, name: 'Bolo de chocolate molhadinho' },
  ],
  neighborhood: 'Centro',
  address: 'Rua das Acácias, 120 — Centro',
  payment: 'Cartão na entrega',
};

/** the admin's prep chips (apps/admin/src/ui/OrderCard.tsx: 15, 30, 45 and the store's default, 30) */
export const PREPS = [15, 30, 45] as const;
export type Prep = (typeof PREPS)[number];
export const PREP_DEFAULT: Prep = 30;

/** the Centro zone's estimate, which Core adds to the prep time when the store accepts */
const ETA = { min: 20, max: 30 };
const PLACED = 12 * 60 + 4;
const ACCEPTED = PLACED + 1;

/** when the order reached each state, for a given prep time */
export function times(prep: number): Record<State, number> {
  const ready = ACCEPTED + prep - 1;
  return {
    placed: PLACED,
    confirmed: ACCEPTED,
    preparing: ACCEPTED + 1,
    ready,
    out_for_delivery: ready + 2,
    delivered: ready + 24,
  };
}

/** the window the customer is promised (packages/core/src/admin/routes-orders.ts: on accept,
 *  prep + the zone's estimate; at checkout, the zone's estimate alone) */
export function promise(state: State, prep: number) {
  const from = state === 'placed' ? PLACED : ACCEPTED + prep;
  return { from: from + ETA.min, to: from + ETA.max };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** storefront: "12:04" */
export const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** admin: "12h04" */
export const hh = (m: number) => `${pad(Math.floor(m / 60))}h${pad(m % 60)}`;
/** the storefront timeline's date (formatDateTime, pt-BR) on the lock screen's day */
export const stamp = (m: number) => `ter., 29 de set., ${hm(m)}`;

/** admin: the order card's age ("agora", "12 min", "1 h 4 min") */
export function age(m: number) {
  const a = m - PLACED;
  return a < 1 ? 'agora' : a < 60 ? `${a} min` : `${Math.floor(a / 60)} h ${a % 60} min`;
}

/** apps/admin/src/ui/StateChip.tsx STATE_META labels */
export const CHIP: Record<State, string> = {
  placed: 'Novo',
  confirmed: 'Aceito',
  preparing: 'Preparando',
  ready: 'Pronto',
  out_for_delivery: 'Saiu',
  delivered: 'Entregue',
};

/** the button that moves the order on (StateChip.tsx ACTION + nextStep) */
export const NEXT: Partial<Record<State, string>> = {
  placed: 'aceitar',
  confirmed: 'começar preparo',
  preparing: 'marcar pronto',
  ready: 'saiu para entrega',
  out_for_delivery: 'entregue',
};

/** the toast after each move (apps/admin/src/features/orders/actions.ts DONE_TOAST) */
export const TOAST: Partial<Record<State, string>> = {
  confirmed: `Pedido #${order.number} aceito`,
  preparing: `#${order.number} em preparo`,
  ready: `#${order.number} pronto`,
  out_for_delivery: `#${order.number} saiu para entrega`,
  delivered: `#${order.number} entregue ✓`,
};

/** the board's lanes on a phone (apps/admin/src/features/orders/Orders.tsx LANES, short labels) */
export const LANES = [
  { id: 'novos', label: 'Novos', states: ['placed'] },
  { id: 'preparo', label: 'Preparo', states: ['confirmed', 'preparing'] },
  { id: 'prontos', label: 'Prontos', states: ['ready', 'out_for_delivery'] },
  { id: 'concluidos', label: 'Concluídos', states: ['delivered'] },
] as const satisfies readonly { id: string; label: string; states: readonly State[] }[];

/** the shopper's words (packages/kernel/src/rules/orders.ts ORDER_STATE_LABEL) */
export const LABEL: Record<State, string> = {
  placed: 'Pedido recebido',
  confirmed: 'Pedido confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
};
