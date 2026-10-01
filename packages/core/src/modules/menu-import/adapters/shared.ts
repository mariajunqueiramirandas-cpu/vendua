// What more than one adapter reads the same way: times, numbers, colours, payment names, Pix
// keys, sizes and the "a partir de" floor. Platform knowledge stays in each adapter.

import {
  toCents,
  type ImportOptionGroup,
  type ImportProduct,
  type ImportSchedule,
  type ImportWindow,
  type PaymentMethod,
  type PixKeyType,
} from '../doc.ts';
import { str } from './types.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d/;

/** "18:30", "18:30:00" → "18:30"; anything else null. */
export const hhmm = (v: unknown): string | null => {
  const m = HHMM.exec(str(v).trim());
  return m ? m[0] : null;
};

export const intOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

/** A number or a numeric string; null otherwise. */
export const numOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export const reais = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

/** "40", "30-50", "30 a 50 min", "20 - 60min." → minutes; anything else none. */
export function eta(v: unknown): { etaMin?: number; etaMax?: number } {
  const m = /^\s*(\d{1,4})(?:\s*(?:-|a|até)\s*(\d{1,4}))?\s*(?:min|minutos)?\.?\s*$/i.exec(str(v));
  if (!m) return {};
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  return lo <= hi && hi <= 1440 ? { etaMin: lo, etaMax: hi } : {};
}

/** "#c0392b", "#c03" → "#c0392b"; anything else null. */
export const colour = (v: unknown): string | null => {
  const s = str(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return null;
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A payment method by the merchant's own label ("Cartão de Crédito - Maquininha"). */
export function methodOf(name: string): PaymentMethod | null {
  const n = fold(name);
  if (/\bpix\b/.test(n)) return 'pix';
  if (/dinheiro|especie/.test(n)) return 'cash';
  if (/vale|ticket|sodexo|alelo|pluxee|\bvr\b|refeicao|alimentacao|\bben\b|flash|caju/.test(n))
    return 'meal_voucher';
  if (/cartao|credito|debito|maquin|\belo\b|visa|master/.test(n)) return 'card_on_delivery';
  return null;
}

export function pixType(type: string, key: string): PixKeyType | null {
  const t = fold(type);
  const digits = key.replace(/\D/g, '');
  if (/mail/.test(t) || key.includes('@')) return 'email';
  if (/aleat|random|evp/.test(t) || /^[0-9a-f-]{36}$/i.test(key.trim())) return 'random';
  if (/telefone|celular|phone/.test(t)) return 'phone';
  if (/cpf|cnpj/.test(t) || /^[\d.\-/ ]+$/.test(key.trim())) {
    if (digits.length === 11) return 'cpf';
    if (digits.length === 14) return 'cnpj';
  }
  return null;
}

/** Day ranges with one shared open/close become one window each (hours by weekday). */
export function windowsOf(ranges: { day: number; open: string; close: string }[]): ImportWindow[] {
  const byRange = new Map<string, Set<number>>();
  for (const { day, open, close } of ranges) {
    if (day < 0 || day > 6 || open === close) continue;
    const k = `${open}-${close}`;
    byRange.set(k, (byRange.get(k) ?? new Set()).add(day));
  }
  return [...byRange.entries()]
    .map(([k, days]) => {
      const [open, close] = k.split('-') as [string, string];
      return { days: [...days].sort((a, b) => a - b), open, close };
    })
    .sort((a, b) => a.days[0]! - b.days[0]! || a.open.localeCompare(b.open));
}

/** Per-day windows → a product schedule; none when it's every day, all day. */
export function scheduleOf(
  perDay: Map<number, [string, string][]>,
): ImportSchedule | undefined | 'never' {
  const allDay = (w: [string, string][]) =>
    w.some(([a, b]) => a === '00:00' && (b === '23:59' || b === '24:00'));
  if (![...perDay.values()].some((w) => w.length)) return 'never';
  if ([0, 1, 2, 3, 4, 5, 6].every((d) => allDay(perDay.get(d) ?? []))) return undefined;
  const byRange = new Map<string, number[]>();
  for (const [day, ws] of perDay)
    for (const [from, to] of ws) {
      const k = allDay([[from, to]]) ? '' : `${from}-${to}`;
      byRange.set(k, [...(byRange.get(k) ?? []), day]);
    }
  const windows: ImportSchedule['windows'] = [];
  for (const [k, days] of byRange) {
    const d = [...new Set(days)].sort((a, b) => a - b);
    if (!k) {
      windows.push({ days: d });
      continue;
    }
    const [from, to] = k.split('-') as [string, string];
    if (from < to) windows.push({ days: d, from, to });
    else {
      // past midnight: the rest of the listed days, then the next mornings
      windows.push({ days: d, from, to: '23:59' });
      if (to > '00:00') windows.push({ days: d.map((x) => (x + 1) % 7), from: '00:00', to });
    }
  }
  return { windows, outside: 'unavailable' };
}

/** A window past midnight becomes the rest of its day and the next morning. */
function splitMidnight(m: Map<number, [string, string][]>): Map<number, [string, string][]> {
  const out = new Map<number, [string, string][]>();
  const add = (d: number, w: [string, string]) => out.set(d, [...(out.get(d) ?? []), w]);
  for (const [d, ws] of m)
    for (const [from, to] of ws) {
      if (from < to) add(d, [from, to]);
      else {
        add(d, [from, '23:59']);
        if (to > '00:00') add((d + 1) % 7, ['00:00', to]);
      }
    }
  return out;
}

/** Intersects two per-day window lists (a category's hours and its item's). */
export function intersectDays(
  a0: Map<number, [string, string][]> | null,
  b0: Map<number, [string, string][]> | null,
): Map<number, [string, string][]> | null {
  if (!a0) return b0;
  if (!b0) return a0;
  const a = splitMidnight(a0);
  const b = splitMidnight(b0);
  const out = new Map<number, [string, string][]>();
  for (let d = 0; d < 7; d++) {
    const ws: [string, string][] = [];
    for (const [a0, a1] of a.get(d) ?? [])
      for (const [b0, b1] of b.get(d) ?? []) {
        const from = a0 > b0 ? a0 : b0;
        const to = a1 < b1 ? a1 : b1;
        if (from < to) ws.push([from, to]);
      }
    out.set(d, ws);
  }
  return out;
}

/**
 * Sizes as a required "Tamanho" group (§5): base = the cheapest size, each option the
 * difference. Exact: a size is always picked, so the price is base + its delta.
 */
export function sizeGroup(
  sizes: { name: string; cents: number; soldOut?: boolean }[],
  name = 'Tamanho',
): { baseCents: number; group: ImportOptionGroup } | null {
  if (sizes.length < 2) return null;
  const baseCents = Math.min(...sizes.map((s) => s.cents));
  return {
    baseCents,
    group: {
      name,
      min: 1,
      max: 1,
      options: sizes.map((s) => ({
        name: s.name,
        priceDeltaCents: s.cents - baseCents,
        ...(s.soldOut ? { soldOut: true } : {}),
      })),
    },
  };
}

/**
 * "A partir de": a product whose base is 0 and whose price lives in one required list where a
 * pick always costs at least the cheapest option (single choice, dearest or average) — move
 * that floor into the base, so the menu shows the real starting price. Prices don't change.
 */
export function liftFloor(p: ImportProduct): void {
  if (p.priceCents !== 0) return;
  const req = p.optionGroups.find(
    (g) =>
      g.min >= 1 &&
      (g.max === 1 || g.pricingRule === 'most_expensive' || g.pricingRule === 'average') &&
      g.options.length > 0 &&
      g.options.every((o) => o.priceDeltaCents > 0),
  );
  if (!req) return;
  const floor = Math.min(...req.options.map((o) => o.priceDeltaCents));
  p.priceCents = floor;
  for (const o of req.options) o.priceDeltaCents -= floor;
}

/** A positive amount in cents, or null (0, missing and junk all mean "none"). */
export const positiveCents = (v: unknown): number | null => {
  const c = toCents(v ?? 0);
  return c !== null && c > 0 ? c : null;
};

/**
 * An average of the units picked lands on whole cents here and there alike only when it can't
 * fall on a half cent: at most two units, every price of the same parity. Past that, the
 * platforms round floats their own way.
 */
export function averageExact(g: ImportOptionGroup): boolean {
  if (g.max > 2) return false;
  const parity = new Set(g.options.map((o) => Math.abs(o.priceDeltaCents) % 2));
  return parity.size <= 1;
}

/** Runs `fn` over `items`, at most `n` at a time, keeping the order. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  // one failure (a block, the deadline) ends the read: nobody takes another item
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        stopped = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
