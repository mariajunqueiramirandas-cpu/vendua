import type { OrderPayment } from '../../lib/api.ts';

export const refundable = (p: OrderPayment) =>
  p.status === 'approved' || p.status === 'partially_refunded' ? p.refundableCents : 0;

export function paymentTotals(payments: readonly OrderPayment[] = []) {
  const sum = (field: 'providerFeeCents' | 'netCents') =>
    payments.some((p) => p[field] === null)
      ? null
      : payments.reduce((total, p) => total + (p[field] ?? 0), 0);
  return {
    amount: payments.reduce((total, p) => total + p.amountCents, 0),
    refunded: payments.reduce((total, p) => total + p.refundedCents, 0),
    refundable: payments.reduce((total, p) => total + refundable(p), 0),
    fee: sum('providerFeeCents'),
    net: sum('netCents'),
  };
}

export function refundAmount(cents: number, totalRefundableCents: number) {
  return cents === totalRefundableCents ? null : cents;
}
