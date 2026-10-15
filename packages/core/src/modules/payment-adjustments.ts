import { HttpError } from '../platform/http.ts';
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

export type HandoverMode = 'delivery' | 'pickup';
export const HANDOVER_MODES: readonly HandoverMode[] = ['delivery', 'pickup'];
export type MethodsOff = Partial<Record<HandoverMode, PaymentMethod[]>>;

/** Stored rows are validated on write; a stray entry is ignored on read. */
export function readMethodsOff(raw: unknown): MethodsOff {
  const out: MethodsOff = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const mode of HANDOVER_MODES) {
    const list = (raw as Record<string, unknown>)[mode];
    if (!Array.isArray(list)) continue;
    const methods = [...new Set(list.filter(isPaymentMethod))];
    if (methods.length) out[mode] = methods;
  }
  return out;
}

/**
 * What an order handed over this way may be paid with: the store's methods less those it turned
 * off for the mode (`cardOnline`: Mercado Pago takes cards right now). A mode is never left with
 * nothing — exclusions that would empty it fall back to the store's whole list.
 */
export function methodsForMode(
  settings: Pick<StoreSettingsRow, 'payment_methods' | 'payment_methods_off'> | null | undefined,
  mode: string | null | undefined,
  cardOnline: boolean,
): string[] {
  const usable = offeredMethods(settings).filter((m) => m !== 'card_online' || cardOnline);
  const off =
    mode === 'delivery' || mode === 'pickup'
      ? readMethodsOff(settings?.payment_methods_off)[mode]
      : undefined;
  const left = off ? usable.filter((m) => !(off as string[]).includes(m)) : usable;
  return left.length ? left : usable;
}

export interface EncomendaConflict {
  mode: HandoverMode;
  /** 'encomenda': none of the encomendas' methods; 'sinal': no Pix for the sinal */
  need: 'encomenda' | 'sinal';
  /** what that mode would need to take one of */
  methods: string[];
}

/**
 * A mode (one that is on) whose own exclusions leave an encomenda unpayable: the store takes one
 * of the encomendas' methods (or Pix, while it asks a sinal) but turned it off for that mode.
 * Every write that could cause it refuses it. Store-wide lists are the store's own call, as before.
 */
export function encomendaConflict(
  settings: Pick<
    StoreSettingsRow,
    | 'payment_methods'
    | 'payment_methods_off'
    | 'preorder_payment_methods'
    | 'deposit_bps'
    | 'pickup_enabled'
    | 'delivery_enabled'
  >,
): EncomendaConflict | null {
  const encomenda = settings.preorder_payment_methods ?? ['pix'];
  const store = methodsForMode(settings, null, true);
  const sinal = (settings.deposit_bps ?? 0) > 0 && store.includes('pix');
  for (const mode of HANDOVER_MODES) {
    if (!((mode === 'pickup' ? settings.pickup_enabled : settings.delivery_enabled) ?? true))
      continue;
    const takes = methodsForMode(settings, mode, true);
    const lost = (ms: string[]) =>
      ms.some((m) => store.includes(m)) && !ms.some((m) => takes.includes(m));
    if (lost(encomenda)) return { mode, need: 'encomenda', methods: encomenda };
    if (sinal && lost(['pix'])) return { mode, need: 'sinal', methods: ['pix'] };
  }
  return null;
}

/** 422 ENCOMENDA_PAYMENT_CONFLICT when `settings` (as they would be saved) leave one. */
export function assertNoEncomendaConflict(
  settings: Parameters<typeof encomendaConflict>[0],
  field: string,
): void {
  const c = encomendaConflict(settings);
  if (c)
    throw new HttpError(
      422,
      'ENCOMENDA_PAYMENT_CONFLICT',
      c.need === 'sinal'
        ? `${c.mode} must take pix while the store asks a sinal`
        : `${c.mode} must take one of the encomendas' payment methods`,
      { field, ...c },
    );
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
