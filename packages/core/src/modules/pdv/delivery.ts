import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { deliveryPricing, loadStoreSettings, loadZoneRows, storeCoords } from '../cart.ts';
import { addressParts, composeAddress, type CheckoutInput } from '../checkout.ts';
import { effectiveFee, normalizeCep, resolveDelivery, validCoords } from '../geo.ts';

// A phone order for delivery, taken at the counter (ADR 0035): the store's own zones price it,
// as at checkout; a manager may type the fee for an address no zone covers.

export const MAX_FEE_CENTS = 100_000;

export interface PdvDeliveryIn {
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string;
  reference: string | null;
  cep: string | null;
  lat: number | null;
  lng: number | null;
  /** typed by a manager: skips the zones */
  feeCents: number | null;
}

export interface PdvDeliveryQuote {
  feeCents: number;
  zoneName: string | null;
  etaMin: number | null;
  etaMax: number | null;
  distanceKm: number | null;
}

const bad = (message: string, field: string) =>
  new HttpError(422, 'INVALID_DELIVERY', message, { field });

const line = (v: unknown, field: string, max: number, required = false): string | null => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} is required`, field);
    return null;
  }
  if (typeof v !== 'string') throw bad(`${field} must be text`, field);
  const t = v.replace(/\s+/g, ' ').trim();
  if (required && t.length === 0) throw bad(`${field} is required`, field);
  if (t.length > max) throw bad(`${field} is too long (max ${max})`, field);
  return t || null;
};

export function parseDelivery(v: unknown): PdvDeliveryIn {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw bad('delivery must be an object', 'delivery');
  const o = v as Record<string, unknown>;
  const cep = line(o.cep, 'delivery.cep', 12);
  if (cep !== null && !normalizeCep(cep)) throw bad('cep must have 8 digits', 'delivery.cep');
  const hasPin = o.lat !== undefined && o.lat !== null;
  const pin = hasPin ? validCoords(o.lat as number, o.lng as number) : null;
  if (hasPin && !pin) throw bad('lat/lng are not a valid point', 'delivery.lat');
  let fee: number | null = null;
  if (o.feeCents !== undefined && o.feeCents !== null) {
    if (
      !Number.isInteger(o.feeCents) ||
      (o.feeCents as number) < 0 ||
      (o.feeCents as number) > MAX_FEE_CENTS
    )
      throw bad(`feeCents must be an integer 0–${MAX_FEE_CENTS}`, 'delivery.feeCents');
    fee = o.feeCents as number;
  }
  return {
    street: line(o.street, 'delivery.street', 120, true)!,
    number: line(o.number, 'delivery.number', 10),
    complement: line(o.complement, 'delivery.complement', 80),
    neighborhood: line(o.neighborhood, 'delivery.neighborhood', 80, true)!,
    reference: line(o.reference, 'delivery.reference', 120),
    cep: cep ? normalizeCep(cep) : null,
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
    feeCents: fee,
  };
}

/** checkout's address shape, for its one-line address and parts */
function asCheckout(d: PdvDeliveryIn): CheckoutInput['delivery'] {
  const out: CheckoutInput['delivery'] = {
    mode: 'delivery',
    street: d.street,
    neighborhood: d.neighborhood,
  };
  if (d.number) out.number = d.number;
  if (d.complement) out.complement = d.complement;
  if (d.reference) out.reference = d.reference;
  if (d.cep) out.cep = d.cep;
  return out;
}

export interface PricedDelivery {
  quote: PdvDeliveryQuote;
  distanceSource: 'route' | 'estimate' | null;
}

/** The fee for this address and order size; 422 OUT_OF_ZONE when no zone takes it. */
export async function priceDelivery(
  tx: Sql,
  tenantId: string,
  d: PdvDeliveryIn,
  subtotalCents: number,
): Promise<PricedDelivery> {
  if (d.feeCents !== null)
    return {
      quote: { feeCents: d.feeCents, zoneName: null, etaMin: null, etaMax: null, distanceKm: null },
      distanceSource: null,
    };
  const [settings, zones] = await Promise.all([
    loadStoreSettings(tx, tenantId),
    loadZoneRows(tx, tenantId),
  ]);
  const match = resolveDelivery(
    zones,
    { neighborhood: d.neighborhood, coords: validCoords(d.lat, d.lng) },
    storeCoords(settings),
    deliveryPricing(settings, null),
  );
  if (!match)
    throw new HttpError(422, 'OUT_OF_ZONE', 'the address is outside the delivery area', {
      field: 'delivery.neighborhood',
    });
  return {
    quote: {
      feeCents: effectiveFee(match, subtotalCents),
      zoneName: match.zone.name,
      etaMin: match.zone.eta_min_minutes ?? null,
      etaMax: match.zone.eta_max_minutes ?? null,
      distanceKm: match.distanceKm,
    },
    distanceSource: match.distanceSource ?? null,
  };
}

/** The order's delivery jsonb, the same shape checkout writes. */
export function deliveryJson(
  d: PdvDeliveryIn,
  priced: PricedDelivery,
  prepMinutes: number,
  now = new Date(),
) {
  const q = priced.quote;
  const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
  const c = asCheckout(d);
  return {
    mode: 'delivery' as const,
    neighborhood: d.neighborhood,
    address: composeAddress(c),
    addressParts: addressParts(c),
    ...(d.lat !== null ? { lat: d.lat, lng: d.lng } : {}),
    zoneName: q.zoneName,
    distanceKm: q.distanceKm,
    ...(priced.distanceSource ? { distanceSource: priced.distanceSource } : {}),
    feeCents: q.feeCents,
    etaMin: q.etaMin,
    etaMax: q.etaMax,
    promisedFrom: at(q.etaMin ?? prepMinutes),
    promisedTo: at(q.etaMax ?? q.etaMin ?? prepMinutes),
  };
}

/** A returning customer's name and last address, from the orders their phone placed. */
export async function customerByPhone(tx: Sql, tenantId: string, phone: string) {
  const [row] = await tx<
    {
      name: string | null;
      orders: number;
      delivery: {
        addressParts?: Record<string, string | null>;
        neighborhood?: string | null;
        lat?: number;
        lng?: number;
      } | null;
    }[]
  >`
    select
      (select o.customer ->> 'name' from orders o
        where o.tenant_id = ${tenantId} and o.customer_phone = ${phone}
          and coalesce(o.customer ->> 'name', '') not in ('', 'Balcão')
        order by o.placed_at desc limit 1) as name,
      (select count(*) from orders o
        where o.tenant_id = ${tenantId} and o.customer_phone = ${phone})::int as orders,
      (select o.delivery from orders o
        where o.tenant_id = ${tenantId} and o.customer_phone = ${phone}
          and o.delivery ->> 'mode' = 'delivery'
        order by o.placed_at desc limit 1) as delivery
  `;
  if (!row || row.orders === 0) return null;
  const p = row.delivery?.addressParts ?? null;
  return {
    name: row.name,
    phone,
    orders: row.orders,
    lastDelivery:
      p && p.street
        ? {
            street: p.street,
            number: p.number ?? null,
            complement: p.complement ?? null,
            neighborhood: p.neighborhood ?? row.delivery?.neighborhood ?? '',
            reference: p.reference ?? null,
            cep: p.cep ?? null,
            lat: typeof row.delivery?.lat === 'number' ? row.delivery.lat : null,
            lng: typeof row.delivery?.lng === 'number' ? (row.delivery.lng ?? null) : null,
          }
        : null,
  };
}
