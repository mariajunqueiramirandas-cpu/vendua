import { UnconfiguredProvider } from './unconfigured.ts';

// STUB (CORE-PAY replaces): the Mercado Pago adapter.
export interface MercadoPagoOptions {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  /** Venduá's own account (plan billing); null = billing off */
  platformToken: string | null;
  fetch?: typeof fetch;
}

export class MercadoPagoProvider extends UnconfiguredProvider {
  constructor(_o: MercadoPagoOptions) {
    super();
  }
}
