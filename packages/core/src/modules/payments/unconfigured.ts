import { ProviderError, type PaymentProvider } from './provider.ts';

const off = () => Promise.reject(new ProviderError('unavailable', 'payments are not configured'));

export class UnconfiguredProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  readonly configured = false;
  readonly platformConfigured = false;
  connectUrl(): string {
    throw new ProviderError('unavailable', 'payments are not configured');
  }
  exchangeCode = off;
  refresh = off;
  createPix = off;
  createCardCheckout = off;
  createCardPayment = off;
  getPayment = off;
  findPayment = off;
  refund = off;
  cancelPayment = off;
  verifyWebhook() {
    return null;
  }
  platformPix = off;
  platformGetPayment = off;
  platformCancelPayment = off;
  createSubscription = off;
  getSubscription = off;
  updateSubscription = off;
  getSubscriptionPayment = off;
}
