import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ProviderError,
  type CardCheckout,
  type CardCheckoutRequest,
  type CardPaymentRequest,
  type OAuthTokens,
  type PaymentProvider,
  type PixRequest,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type ProviderSubscription,
  type ProviderSubscriptionPayment,
  type SubscriptionRequest,
  type WebhookEvent,
} from './provider.ts';

// An in-memory Mercado Pago for dev, CI and tests (VENDUA_PAYMENTS_DRIVER=fake). It keeps the
// same contract as the real adapter: payments start pending, a webhook is only a hint, the
// state lives here. Tests drive it with `approve` / `reject` / `settleSubscription` and then
// post `webhook()` to Core — the same path MP takes.

const FAKE_SECRET = 'fake-webhook-secret';

interface Stored extends ProviderPayment {
  token: string;
}

export class FakeProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  configured = true;
  platformConfigured = true;
  private seq = 0;
  readonly payments = new Map<string, Stored>();
  readonly checkouts = new Map<string, CardCheckoutRequest & { token: string }>();
  readonly subscriptions = new Map<string, ProviderSubscription & { req: SubscriptionRequest }>();
  readonly subscriptionPayments = new Map<string, ProviderSubscriptionPayment>();
  readonly refunds: (ProviderRefund & { paymentId: string })[] = [];
  /** tokens the fake refuses — simulates a revoked connection */
  readonly revoked = new Set<string>();
  /** tokens whose account is on hold */
  readonly restricted = new Set<string>();
  private byIdem = new Map<string, string>();
  private usedCardTokens = new Set<string>();
  /** where a fake 3DS challenge posts (dev-routes.ts); relative — the Kernel resolves it */
  challengeUrl = '/admin/v1/dev/mp/challenge';

  // provider ids are unique forever at MP; a per-boot prefix keeps a restarted dev Core from
  // reusing ids the database already holds
  private boot = Date.now().toString(36);
  private id(prefix: string) {
    return `${prefix}${this.boot}${1000 + ++this.seq}`;
  }

  private guard(token: string) {
    if (this.revoked.has(token)) throw new ProviderError('unauthorized', 'token revoked', 401);
    if (this.restricted.has(token)) throw new ProviderError('restricted', 'account on hold', 403);
  }

  connectUrl(state: string, redirectUri: string) {
    const u = new URL(redirectUri);
    u.searchParams.set('code', `fake-code-${state.slice(0, 8)}`);
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    if (!code.startsWith('fake-code')) throw new ProviderError('invalid', 'bad code', 400);
    return this.tokens();
  }

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    if (this.revoked.has(refreshToken)) throw new ProviderError('unauthorized', 'refresh revoked');
    return this.tokens();
  }

  tokens(userId = '424242'): OAuthTokens {
    const n = ++this.seq;
    return {
      accessToken: `fake-access-${n}`,
      refreshToken: `fake-refresh-${n}`,
      expiresAt: new Date(Date.now() + 180 * 86_400_000),
      providerUserId: userId,
      publicKey: `fake-pk-${n}`,
      scope: 'offline_access payments write',
      liveMode: false,
    };
  }

  private pay(token: string, req: PixRequest, kind: 'pix' | 'card'): Stored {
    const hit = this.byIdem.get(req.idempotencyKey);
    if (hit) return this.payments.get(hit)!;
    const id = this.id('P');
    const p: Stored = {
      token,
      id,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      kind,
      amountCents: req.amountCents,
      refundedCents: 0,
      providerFeeCents: null,
      applicationFeeCents: req.applicationFeeCents,
      netCents: null,
      externalReference: req.externalReference,
      collectorId: token === 'platform' ? 'platform' : '424242',
      approvedAt: null,
      pix:
        kind === 'pix'
          ? {
              copyPaste: `00020126FAKEPIX${id}5204000053039865406${(req.amountCents / 100).toFixed(2)}6304ABCD`,
              expiresAt: req.expiresAt.toISOString(),
            }
          : null,
    };
    this.payments.set(id, p);
    this.byIdem.set(req.idempotencyKey, id);
    return p;
  }

  async createPix(token: string, req: PixRequest) {
    this.guard(token);
    return strip(this.pay(token, req, 'pix'));
  }

  async createCardCheckout(token: string, req: CardCheckoutRequest): Promise<CardCheckout> {
    this.guard(token);
    const id = `pref-${this.id('C')}`;
    this.checkouts.set(id, { ...req, token });
    const u = new URL(req.backUrl);
    u.searchParams.set('fake_checkout', id);
    return { id, redirectUrl: u.toString() };
  }

  /**
   * The fake's card fields mint tokens that say how the card behaves:
   *   fake-card-approved | fake-card-pending (in review) | fake-card-challenge (3DS)
   *   fake-card-rejected-<status_detail>, e.g. fake-card-rejected-cc_rejected_insufficient_amount
   * each optionally with a `.<nonce>` suffix. Like MP, a token works once; the idempotency key
   * replays the first answer.
   */
  async createCardPayment(token: string, req: CardPaymentRequest) {
    this.guard(token);
    const hit = this.byIdem.get(req.idempotencyKey);
    if (hit) return strip(this.payments.get(hit)!);
    const m =
      /^fake-card-(approved|pending|challenge|rejected-([a-z0-9_]{1,60}))(\.[A-Za-z0-9]{1,40})?$/.exec(
        req.cardToken,
      );
    if (!m || this.usedCardTokens.has(req.cardToken))
      throw new ProviderError('invalid', 'invalid card token', 400);
    this.usedCardTokens.add(req.cardToken);
    const p = this.pay(
      token,
      {
        amountCents: req.amountCents,
        description: req.description,
        payerEmail: req.payer.email,
        externalReference: req.externalReference,
        idempotencyKey: req.idempotencyKey,
        notificationUrl: req.notificationUrl,
        applicationFeeCents: req.applicationFeeCents,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      'card',
    );
    p.attempt = req.attempt;
    const outcome = m[1]!;
    if (outcome === 'approved') this.settle(p.id, 'approved');
    else if (outcome.startsWith('rejected')) {
      this.settle(p.id, 'rejected');
      p.statusDetail = m[2]!;
    } else if (outcome === 'challenge') {
      p.statusDetail = 'pending_challenge';
      p.challenge = { url: this.challengeUrl, creq: p.id };
    } else p.statusDetail = 'pending_review_manual';
    return strip(p);
  }

  /** the shopper answers the 3DS challenge: the payment settles and the challenge is gone */
  completeChallenge(id: string, ok: boolean) {
    const p = this.payments.get(id);
    if (!p || p.statusDetail !== 'pending_challenge') throw new Error(`no challenge ${id}`);
    p.challenge = null;
    this.settle(id, ok ? 'approved' : 'rejected');
    if (!ok) p.statusDetail = 'cc_rejected_3ds_challenge';
    return strip(p);
  }

  /** the shopper "pays" a card checkout: a payment appears for its external reference */
  completeCheckout(checkoutId: string, status: ProviderPaymentStatus = 'approved') {
    const c = this.checkouts.get(checkoutId);
    if (!c) throw new Error(`no checkout ${checkoutId}`);
    const p = this.pay(
      c.token,
      {
        amountCents: c.amountCents,
        description: c.title,
        payerEmail: c.payerEmail ?? 'comprador@example.com',
        externalReference: c.externalReference,
        idempotencyKey: `checkout:${checkoutId}`,
        notificationUrl: c.notificationUrl,
        applicationFeeCents: c.applicationFeeCents,
        expiresAt: c.expiresAt,
      },
      'card',
    );
    this.settle(p.id, status);
    return strip(p);
  }

  async getPayment(token: string, id: string) {
    this.guard(token);
    const p = this.payments.get(id);
    // tokens rotate on refresh; any store token reads store payments, never the platform's
    if (!p || p.token === 'platform') throw new ProviderError('not_found', 'no such payment', 404);
    return strip(p);
  }

  async findPayment(token: string, externalReference: string) {
    this.guard(token);
    const hits = [...this.payments.values()].filter(
      (p) => p.externalReference === externalReference && p.token !== 'platform',
    );
    return hits.length ? strip(hits[hits.length - 1]!) : null;
  }

  /** move a payment the way MP would; tests then post webhook() */
  settle(id: string, status: ProviderPaymentStatus) {
    const p = this.payments.get(id);
    if (!p) throw new Error(`no payment ${id}`);
    p.status = status;
    p.statusDetail = status === 'approved' ? 'accredited' : status;
    if (status === 'approved') {
      p.approvedAt = new Date().toISOString();
      p.providerFeeCents = Math.round(p.amountCents * 0.0099);
      p.netCents = p.amountCents - p.providerFeeCents - p.applicationFeeCents;
    }
    return strip(p);
  }

  async refund(token: string, paymentId: string, amountCents: number | null, idem: string) {
    this.guard(token);
    const p = this.payments.get(paymentId);
    if (!p) throw new ProviderError('not_found', 'no such payment', 404);
    const prior = this.refunds.find((r) => r.id === `R-${idem}`);
    if (prior) return prior;
    const amount = amountCents ?? p.amountCents - p.refundedCents;
    if (amount <= 0 || amount > p.amountCents - p.refundedCents)
      throw new ProviderError('invalid', 'refund exceeds the payment', 400);
    p.refundedCents += amount;
    p.status = p.refundedCents >= p.amountCents ? 'refunded' : 'partially_refunded';
    const r = { id: `R-${idem}`, amountCents: amount, status: 'approved' as const, paymentId };
    this.refunds.push(r);
    return r;
  }

  /** a signed webhook exactly as Core receives it */
  webhook(
    kind: 'payment' | 'subscription_preapproval' | 'subscription_authorized_payment',
    id: string,
  ) {
    const requestId = crypto.randomUUID();
    const ts = String(Date.now());
    const v1 = createHmac('sha256', FAKE_SECRET)
      .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    return {
      headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      query: { 'data.id': id, type: kind },
      body: JSON.stringify({
        type: kind,
        action: `${kind}.updated`,
        data: { id },
        user_id: 424242,
      }),
    };
  }

  verifyWebhook(headers: Headers, rawBody: string, url: URL): WebhookEvent | null {
    const sig = headers.get('x-signature') ?? '';
    const requestId = headers.get('x-request-id') ?? '';
    const parts = Object.fromEntries(
      sig.split(',').map((kv) => kv.trim().split('=') as [string, string]),
    );
    let body: { type?: string; action?: string; data?: { id?: string }; user_id?: number } = {};
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return null;
    }
    const id = url.searchParams.get('data.id') ?? String(body.data?.id ?? '');
    if (!parts.ts || !parts.v1 || !id) return null;
    const want = createHmac('sha256', FAKE_SECRET)
      .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${parts.ts};`)
      .digest('hex');
    const a = Buffer.from(want);
    const b = Buffer.from(parts.v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const type = url.searchParams.get('type') ?? body.type ?? '';
    return {
      kind:
        type === 'payment'
          ? 'payment'
          : type === 'subscription_preapproval'
            ? 'subscription'
            : type === 'subscription_authorized_payment'
              ? 'subscription_payment'
              : 'unknown',
      resourceId: id,
      providerUserId: body.user_id ? String(body.user_id) : null,
      action: body.action ?? null,
    };
  }

  async platformPix(req: PixRequest) {
    return strip(this.pay('platform', req, 'pix'));
  }

  private cancel(id: string, platform: boolean) {
    const p = this.payments.get(id);
    if (!p || (p.token === 'platform') !== platform)
      throw new ProviderError('not_found', 'no such payment', 404);
    if (p.status !== 'pending')
      throw new ProviderError('invalid', 'only pending payments cancel', 400);
    p.status = 'cancelled';
    p.statusDetail = 'by_collector';
    return strip(p);
  }

  async cancelPayment(token: string, id: string) {
    this.guard(token);
    return this.cancel(id, false);
  }

  async platformCancelPayment(id: string) {
    return this.cancel(id, true);
  }

  async platformGetPayment(id: string) {
    const p = this.payments.get(id);
    if (!p || p.token !== 'platform') throw new ProviderError('not_found', 'no such payment', 404);
    return strip(p);
  }

  async createSubscription(req: SubscriptionRequest): Promise<ProviderSubscription> {
    const id = this.id('S');
    const u = new URL(req.backUrl);
    u.searchParams.set('fake_subscription', id);
    const s = {
      id,
      status: 'pending' as const,
      externalReference: req.externalReference,
      amountCents: req.amountCents,
      nextPaymentDate: null,
      redirectUrl: u.toString(),
      req,
    };
    this.subscriptions.set(id, s);
    return pub(s);
  }

  async getSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (!s) throw new ProviderError('not_found', 'no such subscription', 404);
    return pub(s);
  }

  async updateSubscription(
    id: string,
    patch: { amountCents?: number; status?: 'cancelled' | 'paused' | 'authorized' },
  ) {
    const s = this.subscriptions.get(id);
    if (!s) throw new ProviderError('not_found', 'no such subscription', 404);
    if (patch.amountCents !== undefined) s.amountCents = patch.amountCents;
    if (patch.status) s.status = patch.status;
    return pub(s);
  }

  /** the owner authorizes the card and MP charges the first month */
  settleSubscription(id: string, status: 'approved' | 'rejected' = 'approved') {
    const s = this.subscriptions.get(id);
    if (!s) throw new Error(`no subscription ${id}`);
    if (status === 'approved') s.status = 'authorized';
    s.nextPaymentDate = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const pay: ProviderSubscriptionPayment = {
      id: this.id('A'),
      subscriptionId: id,
      status,
      amountCents: s.amountCents,
      paymentId: null,
      date: new Date().toISOString(),
    };
    this.subscriptionPayments.set(pay.id, pay);
    return pay;
  }

  async getSubscriptionPayment(id: string) {
    const p = this.subscriptionPayments.get(id);
    if (!p) throw new ProviderError('not_found', 'no such authorized payment', 404);
    return p;
  }
}

function strip(p: Stored): ProviderPayment {
  const { token: _token, ...rest } = p;
  return {
    ...rest,
    pix: p.pix ? { ...p.pix } : null,
    challenge: p.challenge ? { ...p.challenge } : null,
  };
}

function pub(s: ProviderSubscription & { req?: SubscriptionRequest }): ProviderSubscription {
  const { req: _req, ...rest } = s;
  return rest;
}
