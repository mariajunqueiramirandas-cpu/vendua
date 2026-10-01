import type { DeliveryZone, StoreProfile } from '../api.ts';
import { formatCents } from './format.ts';

// What delivery costs and takes, summed up from Core's zones before an address is known.
// The fee for an address is always Core's quote; this is only the "a partir de" line.

/** The least a zone charges: Core charges `fee + ceil(km) × perKm`, and a real address is
 *  never 0 km away, so a per-km zone costs at least one km. */
export function zoneFeeFloor(
  z: Pick<DeliveryZone, 'feeCents'> & Partial<Pick<DeliveryZone, 'kind' | 'feePerKmCents'>>,
): number {
  const perKm = z.kind === 'radius' && (z.feePerKmCents ?? 0) > 0 ? z.feePerKmCents! : 0;
  return z.feeCents + perKm;
}

export interface DeliverySummary {
  delivery: null | {
    etaMin: number;
    etaMax: number;
    fee: { form: 'free' | 'flat' | 'from' | 'some-free'; cents: number };
    /** every paid zone turns free above this subtotal (the highest of them); null = not all */
    freeOverCents: number | null;
    /** the lowest minimum order across zones (Core: the store's or the zone's, the higher) */
    minOrderCents: number;
    minOrderVaries: boolean;
  };
  pickup: null | { prepMinutes: number };
}

type SummaryStore = Pick<
  StoreProfile,
  'deliveryEnabled' | 'pickupEnabled' | 'minOrderCents' | 'prepTimeMinutes'
>;

export function deliverySummary(
  store: SummaryStore,
  zones: readonly DeliveryZone[],
): DeliverySummary {
  const pickup = store.pickupEnabled ? { prepMinutes: store.prepTimeMinutes } : null;
  // no zone, no address Core would deliver to
  if (!store.deliveryEnabled || zones.length === 0) return { delivery: null, pickup };
  const floors = zones.map(zoneFeeFloor);
  const lowest = Math.min(...floors);
  const perKm = zones.some((z) => z.kind === 'radius' && (z.feePerKmCents ?? 0) > 0);
  const fee: { form: 'free' | 'flat' | 'from' | 'some-free'; cents: number } = floors.every(
    (f) => f === 0,
  )
    ? { form: 'free', cents: 0 }
    : !perKm && new Set(floors).size === 1
      ? { form: 'flat', cents: lowest }
      : lowest === 0
        ? { form: 'some-free', cents: 0 }
        : { form: 'from', cents: lowest };
  const paid = zones.filter((z) => zoneFeeFloor(z) > 0);
  const freeOverCents =
    paid.length > 0 && paid.every((z) => z.freeDeliveryOverCents != null)
      ? Math.max(...paid.map((z) => z.freeDeliveryOverCents!))
      : null;
  const mins = zones.map((z) => Math.max(store.minOrderCents, z.minOrderCents));
  return {
    delivery: {
      etaMin: Math.min(...zones.map((z) => z.etaMin)),
      etaMax: Math.max(...zones.map((z) => z.etaMax)),
      fee,
      freeOverCents,
      minOrderCents: Math.min(...mins),
      minOrderVaries: new Set(mins).size > 1,
    },
    pickup,
  };
}

export interface DeliveryWords {
  /** `entrega grátis` / `entrega R$ 5,00` / `entrega a partir de R$ 5,00` /
   *  `entrega grátis em algumas regiões` */
  fee: string;
  /** `30–50 min` */
  eta: string;
  /** `pedido mínimo R$ 20,00` / `pedido mínimo a partir de R$ 20,00`; null = none */
  minOrder: string | null;
  /** `grátis acima de R$ 80,00`; null = none */
  freeOver: string | null;
}

/** Default pt-BR words for a summary's delivery; null when the store doesn't deliver. */
export function deliveryWords(summary: DeliverySummary, currency = 'BRL'): DeliveryWords | null {
  const d = summary.delivery;
  if (!d) return null;
  const money = (c: number) => formatCents(c, currency);
  const fee =
    d.fee.form === 'free'
      ? 'entrega grátis'
      : d.fee.form === 'flat'
        ? `entrega ${money(d.fee.cents)}`
        : d.fee.form === 'some-free'
          ? 'entrega grátis em algumas regiões'
          : `entrega a partir de ${money(d.fee.cents)}`;
  return {
    fee,
    eta: d.etaMin === d.etaMax ? `${d.etaMin} min` : `${d.etaMin}–${d.etaMax} min`,
    minOrder:
      d.minOrderCents > 0
        ? `pedido mínimo ${d.minOrderVaries ? 'a partir de ' : ''}${money(d.minOrderCents)}`
        : null,
    freeOver: d.freeOverCents != null ? `grátis acima de ${money(d.freeOverCents)}` : null,
  };
}
