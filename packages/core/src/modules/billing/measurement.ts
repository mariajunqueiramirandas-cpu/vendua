import type { ProviderPayment } from '../payments/provider.ts';

export interface MeasurementContext {
  anonymousId?: string;
  consentState: 'granted' | 'pending' | 'denied';
}

/** Only the opaque browser id and consent travel through payment metadata. */
export function measurementContext(raw: unknown): MeasurementContext | undefined {
  if (typeof raw === 'string') {
    if (raw.length > 512) return;
    try {
      raw = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const { anonymousId, consentState } = raw as Record<string, unknown>;
  if (consentState !== 'granted' && consentState !== 'pending' && consentState !== 'denied') return;
  return {
    consentState,
    ...(consentState === 'granted' &&
    typeof anonymousId === 'string' &&
    /^ra_[a-f0-9]{32}$/.test(anonymousId)
      ? { anonymousId }
      : {}),
  };
}

/** Called after billing commits, not through the best-effort effects queue: failure must
 * escape to the verified webhook so Mercado Pago retries the same payment id. */
export async function reportPayment(payment: ProviderPayment, send: typeof fetch = fetch) {
  const key = process.env.REVNU_EVENT_KEY;
  if (!key) return;
  const paidStates = ['approved', 'partially_refunded', 'refunded'];
  if (!paidStates.includes(payment.status) || !payment.approvedAt) return;
  const paidAt = new Date(payment.approvedAt);
  if (Number.isNaN(paidAt.getTime())) throw new Error('Payment has no valid approval date');
  const context = measurementContext(payment.metadata?.revnu);
  const response = await send('https://revnu.com/api/measurement/events', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: `mercadopago:payment:${payment.id}`,
      event_name: 'payment_succeeded',
      occurred_at: paidAt.toISOString(),
      ...(context?.anonymousId ? { anonymous_id: context.anonymousId } : {}),
      // No provider metadata (e.g. recurring card charges): do not infer permission.
      consent_state: context?.consentState ?? 'pending',
      amount: payment.amountCents / 100,
      currency: payment.currency ?? 'BRL',
      ...(payment.payerEmail ? { email: payment.payerEmail } : {}),
    }),
  });
  if (!response.ok) throw new Error('Payment measurement unavailable; retry webhook');
}

if (import.meta.main) {
  const key = process.env.REVNU_EVENT_KEY;
  if (!key) throw new Error('Set REVNU_EVENT_KEY in the server environment first');
  const response = await fetch('https://revnu.com/api/measurement/events', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: `vendua:test:${crypto.randomUUID()}`,
      event_name: 'payment_succeeded',
      occurred_at: new Date().toISOString(),
      consent_state: 'denied',
      amount: 1,
      currency: 'BRL',
      test: true,
    }),
  });
  if (!response.ok) throw new Error('Revnu test request failed');
  const result = (await response.json()) as { counted?: boolean };
  if (result.counted !== false) throw new Error('Revnu test did not confirm counted: false');
  console.log('Revnu test accepted, counted: false');
}
