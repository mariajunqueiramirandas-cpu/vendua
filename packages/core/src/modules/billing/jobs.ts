import type { MerchantNotify } from '../../admin/context.ts';
import type { Sql } from '../../platform/db.ts';
import type { PaymentProvider } from '../payments/provider.ts';

// STUB (CORE-BILL replaces): invoices and renewals, reminders, holds, DNS checks.
export function startBillingJobs(
  _sql: Sql,
  _o: { provider: PaymentProvider; notify: MerchantNotify; adminOrigin: string | null },
): () => void {
  return () => {};
}
