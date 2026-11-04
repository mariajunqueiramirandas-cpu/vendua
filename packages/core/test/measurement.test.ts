import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import type { AdminApp, AdminDeps } from '../src/admin/context.ts';
import { measurementContext, reportPayment } from '../src/modules/billing/measurement.ts';
import { MercadoPagoProvider } from '../src/modules/payments/mercadopago.ts';
import { mountPaymentsPublic } from '../src/modules/payments/routes-public.ts';
import type { PixRequest, ProviderPayment } from '../src/modules/payments/provider.ts';

const anonymousId = `ra_${'a'.repeat(32)}`;
const originalKey = process.env.REVNU_EVENT_KEY;
let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  if (originalKey === undefined) delete process.env.REVNU_EVENT_KEY;
  else process.env.REVNU_EVENT_KEY = originalKey;
});
const payment = {
  id: '123',
  status: 'approved',
  amountCents: 6990,
  approvedAt: '2026-11-04T00:00:00Z',
  currency: 'BRL',
  payerEmail: 'payer@example.test',
  metadata: { revnu: { anonymousId, consentState: 'granted' } },
} as unknown as ProviderPayment;

function webhook(status = 'refunded') {
  const provider = new MercadoPagoProvider({
    clientId: '',
    clientSecret: '',
    webhookSecret: 'test-secret',
    platformToken: 'test-token',
    fetch: (async () =>
      Response.json({
        id: 123,
        status,
        transaction_amount: 69.9,
        currency_id: 'BRL',
        external_reference: '11111111-1111-4111-8111-111111111111',
        date_approved: '2026-11-04T00:00:00Z',
        payer: { email: 'payer@example.test' },
        metadata: payment.metadata,
      })) as unknown as typeof fetch,
  });
  const sql = Object.assign(
    (parts: TemplateStringsArray) =>
      Promise.resolve(
        parts.join('').includes('from invoices')
          ? [
              {
                tenant_id: '22222222-2222-4222-8222-222222222222',
                provider_payment_id: '123',
                pix_superseded: [],
              },
            ]
          : [],
      ),
    { begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql) },
  );
  const app = new Hono();
  app.onError((error, c) =>
    c.json({ error: error.message }, (error as { status?: number }).status === 401 ? 401 : 500),
  );
  mountPaymentsPublic(
    app as unknown as AdminApp,
    { sql, provider, notify: {}, sessionSecret: 'test' } as unknown as Omit<AdminDeps, 'admin'>,
  );
  const signature = createHmac('sha256', 'test-secret')
    .update('id:123;request-id:req;ts:123;')
    .digest('hex');
  return (valid = true) =>
    app.request('http://localhost/hooks/mercadopago?t=platform&data.id=123', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req',
        'x-signature': `ts=123,v1=${valid ? signature : '0'.repeat(64)}`,
      },
      body: JSON.stringify({ type: 'payment', data: { id: 123 } }),
    });
}

describe('Revnu measurement', () => {
  test('bounds context and never carries an identifier with denied or pending consent', () => {
    expect(measurementContext({ anonymousId, consentState: 'denied' })).toEqual({
      consentState: 'denied',
    });
    expect(measurementContext({ anonymousId, consentState: 'pending' })).toEqual({
      consentState: 'pending',
    });
    expect(
      measurementContext({ anonymousId: 'email@example.test', consentState: 'granted' }),
    ).toEqual({ consentState: 'granted' });
    expect(measurementContext('x'.repeat(513))).toBeUndefined();
    expect(measurementContext('{')).toBeUndefined();
  });

  test('sends approved payments in major units with a stable id, and preserves denials', async () => {
    process.env.REVNU_EVENT_KEY = 'test-only';
    const bodies: Record<string, unknown>[] = [];
    const send = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      bodies.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
      return Response.json({ counted: true });
    }) as unknown as typeof fetch;
    await reportPayment(payment, send);
    await reportPayment(payment, send);
    expect(bodies[0]).toEqual({
      event_id: 'mercadopago:payment:123',
      event_name: 'payment_succeeded',
      occurred_at: '2026-11-04T00:00:00.000Z',
      anonymous_id: anonymousId,
      consent_state: 'granted',
      amount: 69.9,
      currency: 'BRL',
      email: 'payer@example.test',
    });
    expect(bodies[1]?.event_id).toBe(bodies[0]?.event_id);
    await reportPayment({ ...payment, metadata: { revnu: { consentState: 'denied' } } }, send);
    expect(bodies[2]?.consent_state).toBe('denied');
    expect(bodies[2]).not.toHaveProperty('anonymous_id');
    const { metadata: _metadata, ...withoutMetadata } = payment;
    await reportPayment(withoutMetadata, send);
    expect(bodies[3]?.consent_state).toBe('pending');
  });

  test('pending payments and an unconfigured deployment send nothing', async () => {
    const send = (async () => {
      throw new Error('must not send');
    }) as unknown as typeof fetch;
    delete process.env.REVNU_EVENT_KEY;
    await reportPayment(payment, send);
    process.env.REVNU_EVENT_KEY = 'test-only';
    await reportPayment({ ...payment, status: 'pending' }, send);
  });

  test('existing webhook verifies its signature before reporting and retries a failed report', async () => {
    process.env.REVNU_EVENT_KEY = 'test-only';
    const bodies: unknown[] = [];
    let fail = false;
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: fail ? 503 : 200 });
    }) as unknown as typeof fetch);
    restore = () => spy.mockRestore();
    const request = webhook();
    expect((await request(false)).status).toBe(401);
    expect(bodies.length).toBe(0);
    expect((await request()).status).toBe(200);
    expect(bodies[0]).toMatchObject({
      event_id: 'mercadopago:payment:123',
      event_name: 'payment_succeeded',
      amount: 69.9,
      anonymous_id: anonymousId,
    });
    fail = true;
    expect((await request()).status).toBe(500);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  test('Pix metadata round-trips alongside existing metadata and references', async () => {
    let sent: Record<string, unknown> = {};
    const provider = new MercadoPagoProvider({
      clientId: '',
      clientSecret: '',
      webhookSecret: 'secret',
      platformToken: 'token',
      fetch: (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({
          id: 123,
          status: 'pending',
          metadata: sent.metadata,
          external_reference: sent.external_reference,
        });
      }) as unknown as typeof fetch,
    });
    const req: PixRequest = {
      amountCents: 6990,
      description: 'Mirim',
      payerEmail: 'payer@example.test',
      externalReference: 'existing-invoice',
      idempotencyKey: 'existing-key',
      notificationUrl: null,
      applicationFeeCents: 0,
      expiresAt: new Date('2026-11-04T02:00:00Z'),
      metadata: { existing: 'keep', revnu: { anonymousId, consentState: 'granted' } },
    };
    const result = await provider.platformPix(req);
    expect(sent.metadata).toEqual(req.metadata);
    expect(sent.external_reference).toBe('existing-invoice');
    expect(result.metadata).toEqual(req.metadata);
  });
});
