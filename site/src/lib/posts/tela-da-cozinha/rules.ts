// The kitchen screen's real rules, after apps/admin/src/features/kitchen/model.ts (clock, order,
// stations, the big button, "sem" and allergy words), data.ts (UNDO_MS), Pickup.tsx (SPOTLIGHT_MS)
// and ui/OrderCard.tsx (the prep chips). The widgets compute with these, not with made-up numbers.

export type Urgency = 'fresh' | 'warn' | 'late';

/** amber from this share of the prep time on */
export const WARN_AT = 0.6;
/** "pronto" waits this long with "desfazer" before the customer is told */
export const UNDO_MS = 4500;
/** a newly ready number takes the pickup display for this long */
export const SPOTLIGHT_MS = 7000;
/** the store's usual prep time when nobody changed it */
export const PREP_DEFAULT = 30;
/** the chips on "aceitar": 15, 30, 45 and the store's usual, sorted */
export const PREP_CHIPS = [...new Set([15, 30, 45, PREP_DEFAULT])]
  .sort((a, b) => a - b)
  .slice(0, 4);

export const WORD: Record<Urgency, string> = {
  fresh: 'no tempo',
  warn: 'atenção',
  late: 'atrasado',
};

/** minutes on the clock against the prep minutes */
export function urgency(elapsed: number, prep: number): Urgency {
  const ratio = elapsed / Math.max(1, prep);
  return ratio >= 1 ? 'late' : ratio >= WARN_AT ? 'warn' : 'fresh';
}

export interface RailOrder {
  number: number;
  /** minute it was accepted */
  acceptedAt: number;
  prep: number;
  rush: boolean;
}

/** prioridade first, then whatever is due soonest, then the lower number */
export function byDue(a: RailOrder, b: RailOrder) {
  if (a.rush !== b.rush) return a.rush ? -1 : 1;
  const d = a.acceptedAt + a.prep - (b.acceptedAt + b.prep);
  if (d) return d;
  return a.number - b.number;
}

/** "18h06" from minutes after 18h00 */
export const clock = (m: number) => {
  const h = 18 + Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, '0')}`;
};

/** stations: an item with no station shows on every screen; "all" is the pass */
export const atStation = (stationId: string | null, s: string) =>
  s === 'all' || stationId === s || stationId === null;

export interface StationItem {
  id: string;
  qty: number;
  name: string;
  stationId: string | null;
  done: boolean;
}

/** the ticket's one big button at this station (model.ts actionFor, order already "preparando") */
export function actionFor(items: StationItem[], s: string) {
  const mine = items.filter((i) => atStation(i.stationId, s));
  const others = items.filter((i) => !atStation(i.stationId, s));
  const mineOpen = mine.some((i) => !i.done);
  const othersOpen = others.some((i) => !i.done);
  if (mineOpen && othersOpen) return 'minha parte pronta';
  if (othersOpen) return 'sua parte está pronta';
  return 'pronto';
}

/** "sem cebola", "tirar o picles": what the cook must leave out */
export const isWithout = (name: string) => /^(sem|tirar|retirar|s\/|n[aã]o)\b/i.test(name.trim());

const ALLERGY =
  /(alerg\w*|al[eé]rgic\w*|gl[uú]ten|cel[ií]ac\w*|lactose|intoler\w*|amendoi\w*|castanhas?|nozes|camar[aã]o|frutos do mar|crust[aá]ce\w*)/gi;

/** the note split around its allergy words, for highlighting */
export function allergySegments(text: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(ALLERGY)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MiniItem {
  qty: number;
  name: string;
  mods: string[];
  done: boolean;
}
export interface Mini {
  number: number;
  name: string;
  state: 'confirmed' | 'preparing';
  rush: boolean;
  note: string;
  items: MiniItem[];
}
