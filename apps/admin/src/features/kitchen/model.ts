import type { KitchenItem, KitchenTicket } from '../../lib/api.ts';

// The kitchen's arithmetic, kept pure so the screen, the pickup display and /_ui agree.

export type Urgency = 'fresh' | 'warn' | 'late' | 'scheduled';
/** this screen's station: 'all' is the pass (everything), else a station id */
export type StationPick = 'all' | string;

/** amber from this share of the prep time on (spec §6.3 turns a card amber past its target) */
export const WARN_AT = 0.6;

export interface Timing {
  urgency: Urgency;
  /** ms on the clock */
  elapsed: number;
  /** elapsed / prep time */
  ratio: number;
  /** ms to the target; negative once late */
  left: number;
}

/**
 * The ticket's clock: from "aceito" against the prep time chosen then. An encomenda was accepted
 * days ago, so its clock only starts when the kitchen starts it.
 */
export function timing(t: KitchenTicket, now: number): Timing {
  const from = t.scheduledFor ? t.startedAt : (t.acceptedAt ?? t.placedAt);
  const target = Math.max(1, t.prepMinutes) * 60_000;
  if (!from) return { urgency: 'scheduled', elapsed: 0, ratio: 0, left: target };
  const elapsed = Math.max(0, now - Date.parse(from));
  const ratio = elapsed / target;
  return {
    urgency: ratio >= 1 ? 'late' : ratio >= WARN_AT ? 'warn' : 'fresh',
    elapsed,
    ratio,
    left: target - elapsed,
  };
}

/** "4:07", "1:02:30" */
export function stopwatch(ms: number) {
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const due = (t: KitchenTicket) => {
  const from = t.scheduledFor ? t.startedAt : (t.acceptedAt ?? t.placedAt);
  return from ? Date.parse(from) + t.prepMinutes * 60_000 : Number.POSITIVE_INFINITY;
};

/** The rail order: prioridade first, then whatever is due soonest; unstarted encomendas last. */
export function byDue(a: KitchenTicket, b: KitchenTicket) {
  if (a.rush !== b.rush) return a.rush ? -1 : 1;
  const d = due(a) - due(b);
  if (d) return d;
  return a.number - b.number;
}

/** Items with no station show on every screen: nothing falls between two stations. */
export const atStation = (i: KitchenItem, s: StationPick) =>
  s === 'all' || i.stationId === s || i.stationId === null;

export function itemsFor(t: KitchenTicket, s: StationPick) {
  const mine: KitchenItem[] = [];
  const others: KitchenItem[] = [];
  for (const i of t.items) (atStation(i, s) ? mine : others).push(i);
  return { mine, others };
}

export const progress = (items: KitchenItem[]) => ({
  done: items.filter((i) => i.doneAt).length,
  total: items.length,
});

/** "sem cebola", "tirar o picles": what the cook must leave out, shown apart from what's added */
export const isWithout = (name: string) => /^(sem|tirar|retirar|s\/|n[aã]o)\b/i.test(name.trim());

const ALLERGY =
  /(alerg\w*|al[eé]rgic\w*|gl[uú]ten|cel[ií]ac\w*|lactose|intoler\w*|amendoi\w*|castanhas?|nozes|camar[aã]o|frutos do mar|crust[aá]ce\w*)/gi;

export const mentionsAllergy = (text: string | null | undefined) => {
  if (!text) return false;
  ALLERGY.lastIndex = 0;
  return ALLERGY.test(text);
};

/** the note split around its allergy words, for highlighting */
export function allergySegments(text: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  ALLERGY.lastIndex = 0;
  for (const m of text.matchAll(ALLERGY)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

export const modifierLabel = (m: { name: string; qty: number }) =>
  m.qty > 1 ? `${m.qty}× ${m.name}` : m.name;

export interface AllDayRow {
  /** the dish, folded so "X-Burger" and "x-burger " count together */
  key: string;
  name: string;
  qty: number;
  /** how it's asked for: modifiers → how many */
  variants: { label: string; qty: number }[];
  /** tickets that still need it */
  tickets: string[];
}

const fold = (s: string) => s.trim().toLocaleLowerCase('pt-BR');

/**
 * "Tudo junto": what's still to make across the open tickets, dish by dish, so a cook can fire
 * twelve burgers at once. A combo counts by its parts (the kitchen makes the parts).
 */
export function allDay(tickets: KitchenTicket[], s: StationPick): AllDayRow[] {
  const rows = new Map<string, AllDayRow>();
  const add = (name: string, qty: number, variant: string, ticket: string) => {
    const key = fold(name);
    const row = rows.get(key) ?? { key, name: name.trim(), qty: 0, variants: [], tickets: [] };
    row.qty += qty;
    const v = row.variants.find((x) => x.label === variant);
    if (v) v.qty += qty;
    else row.variants.push({ label: variant, qty });
    if (!row.tickets.includes(ticket)) row.tickets.push(ticket);
    rows.set(key, row);
  };
  for (const t of tickets) {
    if (t.state !== 'confirmed' && t.state !== 'preparing') continue;
    for (const i of t.items) {
      if (i.doneAt || !atStation(i, s)) continue;
      const variant = i.modifiers.map(modifierLabel).sort().join(', ');
      if (i.combo.length) for (const c of i.combo) add(c.name, i.qty * c.qty, variant, t.id);
      else add(i.name, i.qty, variant, t.id);
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, variants: r.variants.sort((a, b) => b.qty - a.qty) }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR'));
}

export const itemMatches = (i: KitchenItem, key: string) =>
  fold(i.name) === key || i.combo.some((c) => fold(c.name) === key);

/** what the voice says when a ticket lands: "Pedido 128. 2 X-Burger, sem cebola. 1 batata." */
export function spoken(t: KitchenTicket, s: StationPick) {
  const parts = itemsFor(t, s).mine.map((i) => {
    const mods = i.modifiers.map((m) => m.name).join(', ');
    return `${i.qty} ${i.name}${mods ? `, ${mods}` : ''}`;
  });
  return `Pedido ${t.number}. ${parts.join('. ')}.`;
}

/** "12 min" / "1 h 05" */
export function minutes(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export type ActionKind = 'start' | 'mine' | 'ready';

/**
 * The ticket's one big button (and Enter on a bump bar). At a station, "minha parte pronta" marks
 * that station's share while other stations still owe items; otherwise it's "pronto".
 */
export function actionFor(
  t: KitchenTicket,
  s: StationPick,
): { kind: ActionKind; label: string; allDone: boolean } | null {
  if (t.state === 'confirmed') return { kind: 'start', label: 'começar', allDone: false };
  if (t.state !== 'preparing') return null;
  const { mine, others } = itemsFor(t, s);
  const allDone = t.items.every((i) => i.doneAt);
  if (mine.some((i) => !i.doneAt) && others.some((i) => !i.doneAt))
    return { kind: 'mine', label: 'minha parte pronta', allDone };
  return { kind: 'ready', label: 'pronto', allDone };
}
