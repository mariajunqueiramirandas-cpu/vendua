import { HttpError } from '../platform/http.ts';

// Delivery vehicles (0159): an item may only travel by moto or by car (a big cake, a tower of
// boxes), and the store charges an extra on the delivery fee for each. The cart's vehicle is the
// biggest one its items need — a car carries what a moto does. The extra is the vehicle's own
// cost: free delivery (a zone's threshold, a free-delivery coupon) waives the trip, not the extra.

export type Vehicle = 'moto' | 'car';
/** smallest first */
export const VEHICLES: readonly Vehicle[] = ['moto', 'car'];

/** `store_settings.vehicle_fees`: the extra, in cents, a delivery that needs each vehicle pays */
export type VehicleFees = Partial<Record<Vehicle, number>>;

export const VEHICLE_FEE_MAX = 100_000;

export const isVehicle = (v: unknown): v is Vehicle => VEHICLES.includes(v as Vehicle);

/** the biggest vehicle any of these needs; null = none (the store's usual delivery) */
export function vehicleFor(needs: readonly (Vehicle | null | undefined)[]): Vehicle | null {
  let best = -1;
  for (const n of needs) if (n) best = Math.max(best, VEHICLES.indexOf(n));
  return best < 0 ? null : VEHICLES[best]!;
}

export function vehicleFeeCents(
  fees: VehicleFees | null | undefined,
  vehicle: Vehicle | null,
): number {
  if (!vehicle) return 0;
  const c = fees?.[vehicle];
  return Number.isSafeInteger(c) && c! > 0 ? c! : 0;
}

/** Admin input: `{ moto?, car? }`, each whole cents 0..VEHICLE_FEE_MAX or null (none). */
export function parseVehicleFees(v: unknown): VehicleFees {
  const bad = (msg: string): never => {
    throw new HttpError(422, 'BAD_REQUEST', msg, { field: 'vehicleFees' });
  };
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return bad('vehicleFees is an object');
  const out: VehicleFees = {};
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (!isVehicle(k)) bad(`vehicleFees: ${VEHICLES.join(' or ')}`);
    if (c === null) continue;
    if (!Number.isSafeInteger(c) || (c as number) < 0 || (c as number) > VEHICLE_FEE_MAX)
      bad(`vehicleFees.${k}: whole cents, 0 to ${VEHICLE_FEE_MAX}`);
    out[k as Vehicle] = c as number;
  }
  return out;
}
