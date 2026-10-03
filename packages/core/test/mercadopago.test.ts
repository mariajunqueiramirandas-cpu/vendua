import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import {
  MercadoPagoProvider,
  mapPayment,
  mpDate,
  toCents,
  toReais,
} from '../src/modules/payments/mercadopago.ts';
import { ProviderError } from '../src/modules/payments/provider.ts';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function mp(
  reply: (s: Seen) => { status?: number; body?: unknown } | Promise<never>,
  o: { webhookSecret?: string; platformToken?: string | null } = {},
) {
  const seen: Seen[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const s: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(s);
    const r = await reply(s);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const p = new MercadoPagoProvider({
    clientId: 'cid',
    clientSecret: 'csecret',
    webhookSecret: o.webhookSecret ?? 'whsec',
    platformToken: o.platformToken === undefined ? 'platform-token' : o.platformToken,
    fetch: fetchStub,
  });
  return { p, seen };
}

const PAYMENT = {
  id: 1234567890,
  status: 'approved',
  status_detail: 'accredited',
  payment_type_id: 'bank_transfer',
  payment_method_id: 'pix',
  transaction_amount: 138.6,
  transaction_amount_refunded: 0,
  fee_details: [
    { type: 'mercadopago_fee', amount: 1.37, fee_payer: 'collector' },
    { type: 'application_fee', amount: 0.5, fee_payer: 'collector' },
  ],
  transaction_details: { net_received_amount: 136.73 },
  external_reference: '5a1b0c7e-1111-4222-8333-944455556666',
  collector_id: 424242,
  date_approved: '2026-09-30T12:00:00.000-03:00',
  date_of_expiration: '2026-09-30T12:30:00.000-03:00',
  point_of_interaction: { transaction_data: { qr_code: '00020126PIX' } },
};

const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(ProviderError);
  expect((err as ProviderError).code).toBe(code as never);
};

describe('mercado pago adapter', () => {
  test('cents ↔ reais never drift', () => {
    expect(toReais(13860)).toBe(138.6);
    expect(toReais(1)).toBe(0.01);
    expect(toCents(138.6)).toBe(13860);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(1.005 * 100 * 0 + 19.99)).toBe(1999);
    expect(toCents(undefined)).toBe(0);
    for (let c = 0; c < 5000; c += 7) expect(toCents(toReais(c))).toBe(c);
    expect(mpDate(new Date('2026-09-30T15:00:00.000Z'))).toBe('2026-09-30T12:00:00.000-03:00');
  });

  test('connect URL and code exchange', async () => {
    const { p, seen } = mp(() => ({
      body: {
        access_token: 'APP_USR-access',
        refresh_token: 'TG-refresh',
        expires_in: 15552000,
        user_id: 424242,
        public_key: 'APP_USR-pk',
        scope: 'offline_access payments read write',
        live_mode: true,
      },
    }));
    const u = new URL(
      p.connectUrl('st.ate', 'https://painel.x/admin/v1/payments/mercadopago/callback'),
    );
    expect(u.origin + u.pathname).toBe('https://auth.mercadopago.com.br/authorization');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'cid',
      response_type: 'code',
      platform_id: 'mp',
      state: 'st.ate',
      redirect_uri: 'https://painel.x/admin/v1/payments/mercadopago/callback',
    });
    const t = await p.exchangeCode('TG-code', 'https://painel.x/cb');
    expect(seen[0]!.url).toBe('https://api.mercadopago.com/oauth/token');
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.body).toEqual({
      client_id: 'cid',
      client_secret: 'csecret',
      grant_type: 'authorization_code',
      code: 'TG-code',
      redirect_uri: 'https://painel.x/cb',
    });
    expect(t.accessToken).toBe('APP_USR-access');
    expect(t.providerUserId).toBe('424242');
    expect(t.liveMode).toBe(true);
    expect(Math.abs(t.expiresAt.getTime() - (Date.now() + 15552000_000))).toBeLessThan(5000);

    await p.refresh('TG-refresh');
    expect(seen[1]!.body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'TG-refresh',
    });
  });

  test('a dead refresh token is unauthorized; a used code is invalid', async () => {
    const { p } = mp(() => ({ status: 400, body: { error: 'invalid_grant', message: 'bad' } }));
    await expectCode(p.refresh('x'), 'unauthorized');
    await expectCode(p.exchangeCode('x', 'https://a/b'), 'invalid');
  });

  test('Pix: request shape, idempotency, mapping', async () => {
    const { p, seen } = mp(() => ({ status: 201, body: { ...PAYMENT, status: 'pending' } }));
    const pay = await p.createPix('merchant-token', {
      amountCents: 13860,
      description: 'Pedido #12 — Doces',
      payerEmail: 'pagador@vendua.com.br',
      payerName: 'Joana',
      externalReference: PAYMENT.external_reference,
      idempotencyKey: 'order:1',
      notificationUrl: 'https://painel.x/admin/v1/hooks/mercadopago?t=abc',
      applicationFeeCents: 0,
      expiresAt: new Date('2026-09-30T15:30:00.000Z'),
    });
    const s = seen[0]!;
    expect(s.url).toBe('https://api.mercadopago.com/v1/payments');
    expect(s.headers.authorization).toBe('Bearer merchant-token');
    expect(s.headers['x-idempotency-key']).toBe('order:1');
    expect(s.body).toEqual({
      transaction_amount: 138.6,
      description: 'Pedido #12 — Doces',
      payment_method_id: 'pix',
      payer: { email: 'pagador@vendua.com.br', first_name: 'Joana' },
      external_reference: PAYMENT.external_reference,
      notification_url: 'https://painel.x/admin/v1/hooks/mercadopago?t=abc',
      date_of_expiration: '2026-09-30T12:30:00.000-03:00',
    });
    expect(s.body.application_fee).toBeUndefined();
    expect(pay.status).toBe('pending');
    expect(pay.pix).toEqual({ copyPaste: '00020126PIX', expiresAt: PAYMENT.date_of_expiration });

    await p.createPix('t', {
      amountCents: 1000,
      description: 'x',
      payerEmail: 'a@b.co',
      externalReference: 'r',
      idempotencyKey: 'k',
      notificationUrl: null,
      applicationFeeCents: 150,
      expiresAt: new Date(),
    });
    expect(seen[1]!.body.application_fee).toBe(1.5);
    expect(seen[1]!.body.notification_url).toBeUndefined();
  });

  test('payment mapping: fees, net, refunds, statuses', () => {
    const m = mapPayment(PAYMENT);
    expect(m).toMatchObject({
      id: '1234567890',
      status: 'approved',
      kind: 'pix',
      amountCents: 13860,
      refundedCents: 0,
      providerFeeCents: 137,
      applicationFeeCents: 50,
      netCents: 13673,
      collectorId: '424242',
      approvedAt: PAYMENT.date_approved,
    });
    expect(mapPayment({ ...PAYMENT, transaction_amount_refunded: 40 }).status).toBe(
      'partially_refunded',
    );
    expect(
      mapPayment({ ...PAYMENT, status: 'refunded', transaction_amount_refunded: 138.6 }),
    ).toMatchObject({
      status: 'refunded',
      refundedCents: 13860,
    });
    expect(mapPayment({ ...PAYMENT, status: 'cancelled', status_detail: 'expired' }).status).toBe(
      'expired',
    );
    expect(mapPayment({ ...PAYMENT, status: 'in_process' }).status).toBe('pending');
    expect(mapPayment({ ...PAYMENT, status: 'charged_back' }).status).toBe('charged_back');
    expect(
      mapPayment({ ...PAYMENT, payment_type_id: 'credit_card', payment_method_id: 'visa' }).kind,
    ).toBe('card');
    const pending = mapPayment({
      ...PAYMENT,
      status: 'pending',
      fee_details: [],
      transaction_details: { net_received_amount: 0 },
    });
    expect(pending.providerFeeCents).toBeNull();
    expect(pending.netCents).toBeNull();
  });

  test('card: Checkout Pro preference', async () => {
    const { p, seen } = mp(() => ({
      status: 201,
      body: {
        id: '123-abc',
        init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123-abc',
      },
    }));
    const out = await p.createCardCheckout('tok', {
      title: 'Pedido #12 — Doces',
      amountCents: 4590,
      externalReference: 'order-1',
      idempotencyKey: 'order-1:2',
      notificationUrl: 'https://painel.x/hook',
      backUrl: 'https://doces.vendua.com.br/pedido/order-1?pagamento=retorno',
      applicationFeeCents: 0,
      expiresAt: new Date('2026-09-30T17:00:00.000Z'),
    });
    expect(out).toEqual({
      id: '123-abc',
      redirectUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123-abc',
    });
    const s = seen[0]!;
    expect(s.url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(s.headers['x-idempotency-key']).toBe('order-1:2');
    const back = 'https://doces.vendua.com.br/pedido/order-1?pagamento=retorno';
    expect(s.body).toEqual({
      items: [{ title: 'Pedido #12 — Doces', quantity: 1, unit_price: 45.9, currency_id: 'BRL' }],
      external_reference: 'order-1',
      notification_url: 'https://painel.x/hook',
      back_urls: { success: back, failure: back, pending: back },
      auto_return: 'approved',
      expires: true,
      expiration_date_to: '2026-09-30T14:00:00.000-03:00',
      payment_methods: {
        excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }],
      },
    });
  });

  test('get, search, refund', async () => {
    const { p, seen } = mp((s) =>
      s.url.includes('/search')
        ? { body: { results: [PAYMENT] } }
        : s.url.endsWith('/refunds')
          ? { status: 201, body: { id: 99, amount: 10, status: 'approved' } }
          : { body: PAYMENT },
    );
    expect((await p.getPayment('tok', '1234567890')).id).toBe('1234567890');
    expect(seen[0]!.url).toBe('https://api.mercadopago.com/v1/payments/1234567890');
    expect((await p.findPayment('tok', 'ref-1'))!.id).toBe('1234567890');
    expect(seen[1]!.url).toBe(
      'https://api.mercadopago.com/v1/payments/search?external_reference=ref-1&sort=date_created&criteria=desc',
    );
    const r = await p.refund('tok', '1234567890', 1000, 'refund:x:1');
    expect(r).toEqual({ id: '99', amountCents: 1000, status: 'approved' });
    expect(seen[2]!.url).toBe('https://api.mercadopago.com/v1/payments/1234567890/refunds');
    expect(seen[2]!.body).toEqual({ amount: 10 });
    expect(seen[2]!.headers['x-idempotency-key']).toBe('refund:x:1');
    await p.refund('tok', '1', null, 'k');
    expect(seen[3]!.body).toEqual({});
    const none = mp(() => ({ body: { results: [] } }));
    expect(await none.p.findPayment('tok', 'nothing')).toBeNull();
  });

  test('cancel a pending payment; expire a hosted checkout', async () => {
    const { p, seen } = mp(() => ({
      body: { ...PAYMENT, status: 'cancelled', status_detail: 'by_collector' },
    }));
    const c = await p.cancelPayment('tok', '1234567890');
    expect(c.status).toBe('cancelled');
    expect(seen[0]!.method).toBe('PUT');
    expect(seen[0]!.url).toBe('https://api.mercadopago.com/v1/payments/1234567890');
    expect(seen[0]!.headers.authorization).toBe('Bearer tok');
    expect(seen[0]!.body).toEqual({ status: 'cancelled' });
    await p.platformCancelPayment('55');
    expect(seen[1]!.url).toBe('https://api.mercadopago.com/v1/payments/55');
    expect(seen[1]!.headers.authorization).toBe('Bearer platform-token');
    await p.expireCheckout('tok', 'pref-1');
    expect(seen[2]!.method).toBe('PUT');
    expect(seen[2]!.url).toBe('https://api.mercadopago.com/checkout/preferences/pref-1');
    expect(seen[2]!.body.expires).toBe(true);
    const paid = mp(() => ({ status: 400, body: { message: 'Payment already approved' } }));
    await expectCode(paid.p.cancelPayment('tok', '1'), 'invalid');
  });

  test('HTTP errors map to ProviderError codes', async () => {
    const cases: [number, unknown, string][] = [
      [401, { message: 'invalid_token' }, 'unauthorized'],
      [
        403,
        {
          message: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
          code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
        },
        'restricted',
      ],
      [403, { message: 'collector blocked' }, 'restricted'],
      [400, { message: 'bad payer' }, 'invalid'],
      [422, { message: 'nope' }, 'invalid'],
      [404, { message: 'not found' }, 'not_found'],
      [500, { message: 'boom' }, 'unavailable'],
      [503, undefined, 'unavailable'],
    ];
    for (const [status, body, code] of cases) {
      const { p } = mp(() => ({ status, body }));
      await expectCode(p.getPayment('tok', '1'), code);
    }
    const down = mp(() => Promise.reject(new TypeError('fetch failed')));
    await expectCode(down.p.getPayment('tok', '1'), 'unavailable');
    const insufficient = mp(() => ({
      status: 400,
      body: { message: 'bad_request', cause: [{ code: 2085, description: 'insufficient_amount' }] },
    }));
    const err = await insufficient.p.refund('tok', '1', 100, 'k').catch((e) => e);
    expect(err.code).toBe('invalid');
    expect(err.message).toContain('insufficient_amount');
  });

  test('timeouts abort at 15 s', async () => {
    let signal: AbortSignal | undefined;
    const p = new MercadoPagoProvider({
      clientId: 'c',
      clientSecret: 's',
      webhookSecret: 'w',
      platformToken: null,
      fetch: (async (_u: unknown, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        throw new DOMException('timed out', 'TimeoutError');
      }) as unknown as typeof fetch,
    });
    await expectCode(p.getPayment('tok', '1'), 'unavailable');
    expect(signal).toBeDefined();
  });

  test('plan billing on the platform token', async () => {
    const { p, seen } = mp((s) =>
      s.url.includes('/authorized_payments/')
        ? {
            body: {
              id: 7,
              preapproval_id: 'pre-1',
              status: 'processed',
              transaction_amount: 69.9,
              payment: { id: 555, status: 'approved' },
              debit_date: '2026-10-01T00:00:00.000-03:00',
            },
          }
        : {
            body: {
              id: 'pre-1',
              status: 'pending',
              external_reference: 'tenant-1',
              init_point: 'https://mp/subscribe',
              auto_recurring: { transaction_amount: 69.9 },
              next_payment_date: null,
            },
          },
    );
    const sub = await p.createSubscription({
      reason: 'Venduá Mirim',
      amountCents: 6990,
      payerEmail: 'dona@loja.com',
      externalReference: 'tenant-1',
      backUrl: 'https://painel.x/admin/?assinatura=retorno',
      notificationUrl: null,
      idempotencyKey: 'sub-1',
    });
    expect(sub).toEqual({
      id: 'pre-1',
      status: 'pending',
      externalReference: 'tenant-1',
      amountCents: 6990,
      nextPaymentDate: null,
      redirectUrl: 'https://mp/subscribe',
    });
    expect(seen[0]!.url).toBe('https://api.mercadopago.com/preapproval');
    expect(seen[0]!.headers.authorization).toBe('Bearer platform-token');
    expect(seen[0]!.body).toEqual({
      reason: 'Venduá Mirim',
      external_reference: 'tenant-1',
      payer_email: 'dona@loja.com',
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 69.9,
        currency_id: 'BRL',
      },
      back_url: 'https://painel.x/admin/?assinatura=retorno',
      status: 'pending',
    });
    await p.createSubscription({
      reason: 'Venduá Pangolin',
      amountCents: 44900,
      payerEmail: 'dona@loja.com',
      externalReference: 'tenant-1',
      backUrl: 'https://painel.x/admin/?assinatura=retorno',
      notificationUrl: null,
      idempotencyKey: 'sub-2',
      startDate: new Date('2026-10-30T12:00:00.000Z'),
    });
    expect(seen.at(-1)!.body.auto_recurring.start_date).toBe('2026-10-30T12:00:00.000Z');
    seen.pop();
    await p.updateSubscription('pre-1', { amountCents: 44900 });
    expect(seen[1]!.method).toBe('PUT');
    expect(seen[1]!.body).toEqual({
      auto_recurring: { transaction_amount: 449, currency_id: 'BRL' },
    });
    await p.getSubscription('pre-1');
    expect(seen[2]!.url).toBe('https://api.mercadopago.com/preapproval/pre-1');
    const ap = await p.getSubscriptionPayment('7');
    expect(ap).toMatchObject({
      id: '7',
      subscriptionId: 'pre-1',
      status: 'approved',
      amountCents: 6990,
      paymentId: '555',
    });
    await p.platformGetPayment('9');
    expect(seen.at(-1)!.headers.authorization).toBe('Bearer platform-token');

    const off = mp(() => ({ body: {} }), { platformToken: null });
    expect(off.p.platformConfigured).toBe(false);
    await expectCode(off.p.getSubscription('x'), 'unavailable');
  });

  test('webhook signature', () => {
    const { p } = mp(() => ({ body: {} }));
    const sign = (id: string, requestId: string, ts: string, secret = 'whsec') =>
      createHmac('sha256', secret)
        .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
        .digest('hex');
    const url = new URL(
      'https://painel.x/admin/v1/hooks/mercadopago?t=abc&data.id=123&type=payment',
    );
    const headers = (sig: string, rid = 'req-1') =>
      new Headers({ 'x-signature': sig, 'x-request-id': rid });
    const body = JSON.stringify({
      type: 'payment',
      action: 'payment.updated',
      data: { id: '123' },
      user_id: 424242,
    });
    const ok = p.verifyWebhook(headers(`ts=1700,v1=${sign('123', 'req-1', '1700')}`), body, url);
    expect(ok).toEqual({
      kind: 'payment',
      resourceId: '123',
      providerUserId: '424242',
      action: 'payment.updated',
    });
    // tampered id, wrong secret, missing parts
    expect(
      p.verifyWebhook(headers(`ts=1700,v1=${sign('124', 'req-1', '1700')}`), body, url),
    ).toBeNull();
    expect(
      p.verifyWebhook(headers(`ts=1700,v1=${sign('123', 'req-1', '1700', 'other')}`), body, url),
    ).toBeNull();
    expect(
      p.verifyWebhook(headers(`ts=1700,v1=${sign('123', 'req-2', '1700')}`), body, url),
    ).toBeNull();
    expect(p.verifyWebhook(headers('ts=1700'), body, url)).toBeNull();
    expect(p.verifyWebhook(new Headers(), body, url)).toBeNull();
    // alphanumeric ids are lowercased in the manifest; data.id falls back to the body
    const bodyOnly = new URL('https://painel.x/admin/v1/hooks/mercadopago?t=platform');
    const pre = JSON.stringify({ type: 'subscription_preapproval', data: { id: 'ABC123' } });
    const ev = p.verifyWebhook(headers(`ts=9,v1=${sign('ABC123', 'req-1', '9')}`), pre, bodyOnly);
    expect(ev).toMatchObject({ kind: 'subscription', resourceId: 'ABC123' });
    const topic = new URL('https://x/h?data.id=5&topic=authorized_payment');
    expect(p.verifyWebhook(headers(`ts=9,v1=${sign('5', 'req-1', '9')}`), '{}', topic)?.kind).toBe(
      'subscription_payment',
    );
    // no secret configured → nothing verifies
    const open = mp(() => ({ body: {} }), { webhookSecret: '' });
    expect(
      open.p.verifyWebhook(headers(`ts=1700,v1=${sign('123', 'req-1', '1700', '')}`), body, url),
    ).toBeNull();
  });
});
