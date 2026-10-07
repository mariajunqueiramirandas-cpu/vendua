// The post's simulation: a made-up neighbourhood around Bolos da Nena (streets on a 1 km grid, a
// river with one bridge) and the real pricing rule, copied from Core's distance pricing
// (packages/core/src/modules/geo.ts: distanceFeeCents, priceByDistance, effectiveFee, DETOUR_FACTOR)
// and the admin's fields (apps/admin/src/features/store/Store.tsx, DistancePricing). Money is
// integer cents everywhere; only `brl` turns it into text.

export interface Knobs {
  baseFeeCents: number;
  feePerKmCents: number;
  /** 0 = no minimum (the admin's empty field) */
  minFeeCents: number;
  /** whole km, like the admin's stepper */
  maxKm: number;
  /** null = off (the admin's empty field) */
  freeOverCents: number | null;
}

/** An example setup for the Nena (not a recommendation); maxKm is Core's real default, 8 km. */
export const EXAMPLE: Knobs = {
  baseFeeCents: 400,
  feePerKmCents: 150,
  minFeeCents: 800,
  maxKm: 8,
  freeOverCents: 12_000,
};

/** geo.ts DETOUR_FACTOR: the straight line × 1.3 while no road route could be had */
export const DETOUR_FACTOR = 1.3;
/** geo.ts ESTIMATE_KMH: an estimated leg's drive time */
export const ESTIMATE_KMH = 25;
/** cart.ts: the store's prep time when it never set one */
export const PREP_MINUTES = 30;

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (cents: number) => money.format(cents / 100);
export const km1 = (km: number) =>
  km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Core shows and charges the distance rounded to 0.1 km ("3,0 km" never pays for a 4th). */
export const shownKm = (km: number) => Math.round(km * 10) / 10;
export const startedKm = (km: number) => Math.ceil(shownKm(km));

/** geo.ts distanceFeeCents: base + every started km, never below the minimum. */
export function feeCents(k: Knobs, km: number): number {
  return Math.max(k.minFeeCents, k.baseFeeCents + startedKm(km) * k.feePerKmCents);
}

export type Quote =
  | { ok: false; km: number }
  | {
      ok: true;
      km: number;
      started: number;
      /** base + started km × per km */
      raw: number;
      /** after the minimum, before the threshold */
      fee: number;
      /** what the customer pays for delivery */
      charged: number;
      byMinimum: boolean;
      byThreshold: boolean;
    };

/** geo.ts priceByDistance + effectiveFee: refused past the maximum, zeroed at the threshold
 *  (checked against the subtotal before any coupon). */
export function quote(k: Knobs, rawKm: number, subtotalCents: number): Quote {
  const km = shownKm(rawKm);
  if (km > k.maxKm) return { ok: false, km };
  const started = Math.ceil(km);
  const raw = k.baseFeeCents + started * k.feePerKmCents;
  const fee = Math.max(k.minFeeCents, raw);
  const byThreshold = k.freeOverCents != null && subtotalCents >= k.freeOverCents;
  return {
    ok: true,
    km,
    started,
    raw,
    fee,
    charged: byThreshold ? 0 : fee,
    byMinimum: raw < k.minFeeCents,
    byThreshold,
  };
}

// ── the made-up map, in km (x east, y south) ────────────────────────────────

export const MAP_W = 14;
export const MAP_H = 9;
export interface Pt {
  x: number;
  y: number;
}
export const STORE: Pt = { x: 5.2, y: 4.8 };
/** the only bridge crosses the river on this street */
export const BRIDGE_Y = 2.4;

/** the river's centre line at height y */
export const riverX = (y: number) => 8.6 + 0.35 * Math.sin(y * 0.8);
export const RIVER_HALF = 0.28;
const across = (p: Pt) => p.x > riverX(p.y);

export const straightKm = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The drive on the grid: along the store's street, then up the door's street; across the river,
 *  first to the bridge. Returns the turning points from the store to the door. */
export function route(door: Pt): Pt[] {
  if (!across(door))
    return [STORE, { x: door.x, y: STORE.y }, door].filter(
      (p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.y !== all[i - 1]!.y,
    );
  return [STORE, { x: STORE.x, y: BRIDGE_Y }, { x: door.x, y: BRIDGE_Y }, door];
}

export function roadKm(door: Pt): number {
  const pts = route(door);
  let d = 0;
  for (let i = 1; i < pts.length; i++)
    d += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y);
  return d;
}

export interface Door {
  id: string;
  name: string;
  where: string;
  at: Pt;
}

export const DOORS: Door[] = [
  { id: 'bia', name: 'Bia', where: 'a três quadras', at: { x: 6.4, y: 5.9 } },
  { id: 'caio', name: 'Caio', where: 'do outro lado do bairro', at: { x: 1.4, y: 7.6 } },
  { id: 'rita', name: 'Rita', where: 'do outro lado do rio', at: { x: 9.6, y: 5.4 } },
];

export interface Cart {
  id: string;
  label: string;
  cents: number;
}

/** Bolos da Nena's menu prices, as in the site's Duá demo (demos/vendedor/script.ts). */
export const CARTS: Cart[] = [
  { id: 'fatias', label: '2 fatias de cenoura com brigadeiro', cents: 1800 },
  { id: 'bolo', label: 'Bolo de cenoura com brigadeiro e uma fatia de chocolate', cents: 5450 },
  { id: 'festa', label: 'Bolos de cenoura, chocolate e fubá para a festa', cents: 13_100 },
];
