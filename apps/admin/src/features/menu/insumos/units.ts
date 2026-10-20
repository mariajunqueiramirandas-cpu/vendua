import type { InsumoUnit, OrderMode } from '../../../lib/api.ts';
import { money } from '../../../lib/format.ts';

// Core keeps insumo quantities in thousandths of g, ml or un ("milli") and costs per 1000 units
// (a kg, a litre, a thousand un). These only turn them into words and back from what's typed.

/** what a quantity can be typed in */
export type InputUnit = 'g' | 'kg' | 'ml' | 'L' | 'un';

export const INPUT_UNITS: Record<InsumoUnit, InputUnit[]> = {
  g: ['kg', 'g'],
  ml: ['L', 'ml'],
  un: ['un'],
};
const FACTOR: Record<InputUnit, number> = { g: 1000, kg: 1e6, ml: 1000, L: 1e6, un: 1000 };

export const UNIT_LABEL: Record<InsumoUnit, string> = {
  g: 'Peso',
  ml: 'Volume',
  un: 'Unidade',
};

export const MODE_LABEL: Record<OrderMode, string> = {
  delivery: 'Delivery',
  pickup: 'Retirada',
  dine_in: 'Mesa',
};

const dec = (n: number, max = 3) => n.toLocaleString('pt-BR', { maximumFractionDigits: max });

/** 1_500_000 g-milli → "1,5 kg"; 150_000 → "150 g"; 2000 un-milli → "2 un" */
export function qty(milli: number, unit: InsumoUnit): string {
  const sign = milli < 0 ? '−' : '';
  const base = Math.abs(milli) / 1000;
  if (unit === 'un') return `${sign}${dec(base)} un`;
  const big = unit === 'g' ? 'kg' : 'L';
  return base >= 1000 ? `${sign}${dec(base / 1000)} ${big}` : `${sign}${dec(base)} ${unit}`;
}

/** the unit a quantity reads best in, for an input that starts from it */
export function inputUnitOf(milli: number | null, unit: InsumoUnit): InputUnit {
  if (unit === 'un') return 'un';
  return milli != null && Math.abs(milli) < 1_000_000 ? unit : unit === 'g' ? 'kg' : 'L';
}

/** "1,5" in kg → 1_500_000; null = not a number we take */
export function parseQty(s: string, u: InputUnit): number | null {
  // "1,5" or "1.5"; with a comma, dots are thousands ("1.250,5")
  const raw = s.trim();
  const t = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (!/^\d{1,9}(\.\d{0,3})?$/.test(t)) return null;
  const v = Math.round(Number(t) * FACTOR[u]);
  return v > 0 ? v : null;
}

/** milli → what goes in an input typed in `u` */
export const qtyInput = (milli: number | null, u: InputUnit) =>
  milli == null
    ? ''
    : (milli / FACTOR[u]).toLocaleString('pt-BR', { maximumFractionDigits: 3, useGrouping: false });

/** an insumo's cost in its own words: "R$ 45,90/kg", "R$ 0,35/un" */
export function costLabel(cpk: number | null, unit: InsumoUnit): string | null {
  if (cpk == null) return null;
  if (unit === 'g') return `${money(cpk)}/kg`;
  if (unit === 'ml') return `${money(cpk)}/L`;
  const cents = cpk / 1000;
  if (Number.isInteger(cents)) return `${money(cents)}/un`;
  return `${(cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 4,
  })}/un`;
}

/** the amount a typed cost is for, by default: 1 kg, 1 L, 1 un */
export const defaultCostUnit = (unit: InsumoUnit): InputUnit =>
  unit === 'g' ? 'kg' : unit === 'ml' ? 'L' : 'un';

/** a preview of what `milli` of it costs, in cents (Core recomputes on save) */
export const lineCost = (milli: number, cpk: number | null) =>
  cpk == null ? 0 : Math.round((milli * cpk) / 1e6);

/** "2 caixas de 24 un" */
export function packsLabel(
  packs: number,
  packName: string | null,
  packMilli: number,
  unit: InsumoUnit,
) {
  const name = packName ?? 'pacote';
  return `${packs} ${packs === 1 ? name : plural(name)} de ${qty(packMilli, unit)}`;
}

/** pt-BR plural for a pack's name: caixa → caixas, fardo → fardos, saco → sacos */
function plural(w: string) {
  if (/[aeiou]$/i.test(w)) return `${w}s`;
  if (/ão$/i.test(w)) return w.replace(/ão$/i, 'ões');
  if (/[rz]$/i.test(w)) return `${w}es`;
  if (/l$/i.test(w)) return w.replace(/l$/i, 'is');
  return `${w}s`;
}
