import { offeredMethods } from './payment-adjustments.ts';
import type { StoreSettingsRow } from './store.ts';

// Festa calculada F2 (0128): an order with a sinal is two charges, the sinal (fixed when the
// order is placed, `orders.deposit_cents`) and the rest (always total − sinal). What has been
// paid, and how, is `orders.payment.sinal`; `payment.status` reads 'paid' only once both are.

export type Charge = 'deposit' | 'balance';
/** online = Mercado Pago confirmed it; manual = a manager saw the Pix land; pdv = the caixa */
export type SinalVia = 'online' | 'manual' | 'pdv';

export interface OrderSinal {
  depositCents: number;
  balanceCents: number;
  depositPaidAt: string | null;
  depositVia: SinalVia | null;
  balancePaidAt: string | null;
  balanceVia: SinalVia | null;
  /** the store's own cancellation words when the order was placed, shown as the store's */
  policy: string | null;
}

export interface SinalRule {
  bps: number;
  /** encomendas from this total ask for a sinal too; null = parties only */
  minCents: number | null;
  policy: string | null;
}

export const DEPOSIT_POLICY_MAX = 600;

export function sinalRule(
  s: Pick<
    StoreSettingsRow,
    'deposit_bps' | 'deposit_min_cents' | 'deposit_policy' | 'payment_methods'
  > | null,
): SinalRule | null {
  const bps = s?.deposit_bps ?? 0;
  // a sinal is a Pix: a store that stopped taking Pix asks for none
  if (!bps || !offeredMethods(s).includes('pix')) return null;
  return { bps, minCents: s?.deposit_min_cents ?? null, policy: s?.deposit_policy ?? null };
}

/** A party always; another encomenda from the store's amount on. Never a plan's or a table's. */
export function sinalApplies(
  rule: SinalRule | null,
  o: { party: boolean; totalCents: number },
): rule is SinalRule {
  if (!rule || o.totalCents < 2) return false;
  return o.party || (rule.minCents !== null && o.totalCents >= rule.minCents);
}

/** The sinal of a total: half a cent up, and both parts at least one cent. */
export function depositCents(totalCents: number, bps: number): number {
  const d = Math.floor((totalCents * bps + 5_000) / 10_000);
  return Math.min(Math.max(d, 1), totalCents - 1);
}

export function newSinal(totalCents: number, rule: SinalRule): OrderSinal {
  const deposit = depositCents(totalCents, rule.bps);
  return {
    depositCents: deposit,
    balanceCents: totalCents - deposit,
    depositPaidAt: null,
    depositVia: null,
    balancePaidAt: null,
    balanceVia: null,
    policy: rule.policy,
  };
}

export function sinalOf(payment: unknown): OrderSinal | null {
  const s = (payment as { sinal?: OrderSinal | null } | null)?.sinal;
  return s && Number.isInteger(s.depositCents) && Number.isInteger(s.balanceCents) ? s : null;
}

/** What is still to pay: the sinal first, then the rest; null once both are paid. */
export function dueCharge(s: OrderSinal): { charge: Charge; cents: number } | null {
  if (!s.depositPaidAt) return { charge: 'deposit', cents: s.depositCents };
  if (!s.balancePaidAt) return { charge: 'balance', cents: s.balanceCents };
  return null;
}

export const sinalPaid = (s: OrderSinal) => !!s.depositPaidAt && !!s.balancePaidAt;
