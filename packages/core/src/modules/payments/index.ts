import { FakeProvider } from './fake.ts';
import { MercadoPagoProvider } from './mercadopago.ts';
import type { PaymentProvider } from './provider.ts';
import { UnconfiguredProvider } from './unconfigured.ts';

export * from './provider.ts';
export { FakeProvider } from './fake.ts';
export { UnconfiguredProvider } from './unconfigured.ts';

/**
 * The install's provider:
 *   VENDUA_PAYMENTS_DRIVER=fake → in-memory (dev, CI screenshots)
 *   MP_CLIENT_ID + MP_CLIENT_SECRET → Mercado Pago (MP_PLATFORM_ACCESS_TOKEN adds plan billing)
 *   neither → unconfigured: stores keep their offline methods, the admin says online is off
 */
export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  if (env.VENDUA_PAYMENTS_DRIVER === 'fake' && env.NODE_ENV !== 'production')
    return new FakeProvider();
  if (env.MP_CLIENT_ID && env.MP_CLIENT_SECRET)
    return new MercadoPagoProvider({
      clientId: env.MP_CLIENT_ID,
      clientSecret: env.MP_CLIENT_SECRET,
      webhookSecret: env.MP_WEBHOOK_SECRET ?? '',
      platformToken: env.MP_PLATFORM_ACCESS_TOKEN ?? null,
    });
  return new UnconfiguredProvider();
}

/** MP_PUBLIC_KEY (the application's production public key) for the admin's MercadoPago.js: its
 *  device fingerprint goes with the plan's Pix. Null on any other driver. */
export function platformPublicKey(
  provider: Pick<PaymentProvider, 'name'>,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return provider.name === 'mercadopago' ? env.MP_PUBLIC_KEY?.trim() || null : null;
}
