import type { MerchantNotify } from '../../admin/context.ts';
import type { Sql } from '../../platform/db.ts';
import type { PaymentProvider } from './provider.ts';

// STUB (CORE-PAY replaces): token refresh + connection health, pending-payment reconciliation.
export function startPaymentJobs(
  _sql: Sql,
  _o: {
    provider: PaymentProvider;
    sessionSecret: string;
    notify: MerchantNotify;
    adminOrigin: string | null;
  },
): () => void {
  return () => {};
}
