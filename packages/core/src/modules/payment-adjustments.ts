import type { StoreSettingsRow } from './store.ts';

// Per-payment-method discount/surcharge (model gap 7). Core is the only place it is computed:
// the cart view and the quote preview it, placeOrderTx recomputes it from the locked settings.

export const PAYMENT_METHODS = [
  'pix',
  'card_online',
  'card_on_delivery',
  'cash',
  'meal_voucher',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** what a store without the setting accepts (pre-0052 rows); meal_voucher is opt-in */
export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ['pix', 'card_on_delivery', 'cash'];

export const MAX_PERCENT_BPS = 5000;
export const MAX_FIXED_CENTS = 1_000_000;

/** signed: negative = discount */
export interface PaymentAdjustment {
  percentBps?: number;
  fixedCents?: number;
}
export type PaymentAdjustments = Partial<Record<PaymentMethod, PaymentAdjustment>>;

export const isPaymentMethod = (m: unknown): m is PaymentMethod =>
  typeof m === 'string' && (PAYMENT_METHODS as readonly string[]).includes(m);

const within = (v: unknown, max: number): v is number =>
  Number.isSafeInteger(v) && Math.abs(v as number) <= max;

/** Stored rows are validated on write; reading stays defensive so a bad row is ignored, not a 500. */
export function readPaymentAdjustments(raw: unknown): PaymentAdjustments {
  const out: PaymentAdjustments = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [method, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPaymentMethod(method) || !v || typeof v !== 'object') continue;
    const { percentBps, fixedCents } = v as Record<string, unknown>;
    const adj: PaymentAdjustment = {};
    if (within(percentBps, MAX_PERCENT_BPS) && percentBps !== 0) adj.percentBps = percentBps;
    if (within(fixedCents, MAX_FIXED_CENTS) && fixedCents !== 0) adj.fixedCents = fixedCents;
    if (adj.percentBps !== undefined || adj.fixedCents !== undefined) out[method] = adj;
  }
  return out;
}

export function offeredMethods(
  settings: Pick<StoreSettingsRow, 'payment_methods'> | null | undefined,
): string[] {
  return settings?.payment_methods ?? DEFAULT_PAYMENT_METHODS;
}

/** The rule for `method`, only while the store accepts it. */
export function adjustmentFor(
  settings: Pick<StoreSettingsRow, 'payment_methods' | 'payment_adjustments'> | null | undefined,
  method: string | null | undefined,
): PaymentAdjustment | null {
  if (!method || !isPaymentMethod(method) || !offeredMethods(settings).includes(method))
    return null;
  return readPaymentAdjustments(settings?.payment_adjustments)[method] ?? null;
}

/** round(n / d) with halves away from zero, integers only (d > 0) */
function divRoundHalfUp(n: number, d: number): number {
  const q = Math.floor((Math.abs(n) * 2 + d) / (2 * d));
  return n < 0 ? -q : q;
}

/**
 * Cents the payment method adds (or, negative, takes off). Base = items after the coupon's item
 * discount — never the delivery fee — and a discount never takes the base below zero.
 */
export function paymentAdjustmentCents(
  subtotalCents: number,
  itemDiscountCents: number,
  adj: PaymentAdjustment | null | undefined,
): number {
  if (!adj || subtotalCents <= 0) return 0;
  const base = Math.max(0, subtotalCents - Math.max(0, itemDiscountCents));
  const raw = divRoundHalfUp(base * (adj.percentBps ?? 0), 10_000) + (adj.fixedCents ?? 0);
  return Math.max(-base, raw) || 0; // no -0 in the books
}
