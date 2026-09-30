import type { Sql } from '../../platform/db.ts';
import type { PaymentProvider } from './provider.ts';

// STUB (CORE-PAY replaces): what the storefront may offer online right now.
export async function storePaymentsPublic(
  _tx: Sql,
  _tenantId: string,
  _provider: PaymentProvider,
  methods: string[],
): Promise<{ onlinePayments: { pix: boolean; card: boolean }; paymentMethods: string[] }> {
  return {
    onlinePayments: { pix: false, card: false },
    paymentMethods: methods.filter((m) => m !== 'card_online'),
  };
}
