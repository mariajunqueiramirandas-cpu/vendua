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
  type SubscriptionStatus,
  type WebhookEvent,
  type WebhookKind,
} from './provider.ts';

// Mercado Pago marketplace adapter (ADR 0009). Store orders run on the merchant's OAuth token;
// plan billing runs on Venduá's own token. MP speaks reais as decimals — conversion happens only
// here, and always through Math.round so a float never leaks a cent.

export interface MercadoPagoOptions {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  /** Venduá's own account (plan billing); null = billing off */
  platformToken: string | null;
  fetch?: typeof fetch;
}

const API = 'https://api.mercadopago.com';
const AUTH = 'https://auth.mercadopago.com.br/authorization';
const TIMEOUT_MS = 15_000;

export const toReais = (cents: number) => Math.round(cents) / 100;
export const toCents = (reais: unknown) =>
  typeof reais === 'number' && Number.isFinite(reais) ? Math.round(reais * 100) : 0;

/** MP wants an explicit offset; Brazil has had no DST since 2019, so -03:00 is exact. */
export function mpDate(d: Date) {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().replace('Z', '-03:00');
}

type Json = Record<string, unknown>;

interface MpPayment {
  id?: number | string;
  status?: string;
  status_detail?: string | null;
  payment_type_id?: string | null;
  payment_method_id?: string | null;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  fee_details?: { type?: string; amount?: number }[];
  transaction_details?: { net_received_amount?: number | null } | null;
  external_reference?: string | null;
  collector_id?: number | string | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: { transaction_data?: { qr_code?: string | null } | null } | null;
  three_ds_info?: { external_resource_url?: string | null; creq?: string | null } | null;
  metadata?: { vendua_attempt?: unknown } | null;
}

function paymentStatus(status: string | undefined, detail: string | null | undefined) {
  switch (status) {
    case 'approved':
      // MP keeps a partially refunded payment "approved"; the detail says so
      return (detail === 'partially_refunded' ? 'partially_refunded' : 'approved') as
        'approved' | 'partially_refunded';
    case 'authorized':
    case 'in_process':
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
      // an unpaid Pix past date_of_expiration is cancelled with detail "expired"
      return detail === 'expired' ? 'expired' : 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'charged_back':
      return 'charged_back';
    case 'in_mediation':
      return 'in_mediation';
    default:
      return 'pending';
  }
}

const SETTLED = new Set([
  'approved',
  'partially_refunded',
  'refunded',
  'charged_back',
  'in_mediation',
]);

export function mapPayment(p: MpPayment): ProviderPayment {
  const status: ProviderPaymentStatus = paymentStatus(p.status, p.status_detail);
  const amountCents = toCents(p.transaction_amount);
  const refundedCents = toCents(p.transaction_amount_refunded);
  const fees = Array.isArray(p.fee_details) ? p.fee_details : [];
  const appFee = fees
    .filter((f) => f.type === 'application_fee')
    .reduce((s, f) => s + toCents(f.amount), 0);
  const providerFee = fees
    .filter((f) => f.type !== 'application_fee')
    .reduce((s, f) => s + toCents(f.amount), 0);
  const settled = SETTLED.has(status);
  const net = p.transaction_details?.net_received_amount;
  const qr = p.point_of_interaction?.transaction_data?.qr_code;
  const card = ['credit_card', 'debit_card', 'prepaid_card'].includes(p.payment_type_id ?? '');
  // partially refunded is also flagged by amounts alone on some payment types
  const finalStatus =
    status === 'approved' && refundedCents > 0 && refundedCents < amountCents
      ? 'partially_refunded'
      : status;
  return {
    id: String(p.id ?? ''),
    status: finalStatus,
    statusDetail: p.status_detail ? String(p.status_detail).slice(0, 120) : null,
    kind: p.payment_method_id === 'pix' ? 'pix' : card ? 'card' : 'other',
    amountCents,
    refundedCents,
    providerFeeCents: fees.length ? providerFee : settled ? 0 : null,
    applicationFeeCents: appFee,
    netCents: typeof net === 'number' && (settled || net > 0) ? toCents(net) : null,
    externalReference: p.external_reference ?? null,
    collectorId:
      p.collector_id === null || p.collector_id === undefined ? null : String(p.collector_id),
    approvedAt: p.date_approved ?? null,
    pix: qr ? { copyPaste: qr, expiresAt: p.date_of_expiration ?? null } : null,
    challenge:
      p.status_detail === 'pending_challenge' &&
      p.three_ds_info?.external_resource_url &&
      p.three_ds_info.creq
        ? { url: p.three_ds_info.external_resource_url, creq: p.three_ds_info.creq }
        : null,
    attempt: Number.isInteger(Number(p.metadata?.vendua_attempt))
      ? Number(p.metadata!.vendua_attempt)
      : null,
  };
}

function tokens(j: Json): OAuthTokens {
  const access = typeof j.access_token === 'string' ? j.access_token : '';
  const user = j.user_id;
  if (!access || (typeof user !== 'number' && typeof user !== 'string'))
    throw new ProviderError('invalid', 'token response without access_token/user_id');
  const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 180 * 86_400;
  return {
    accessToken: access,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    providerUserId: String(user),
    publicKey: typeof j.public_key === 'string' ? j.public_key : null,
    scope: typeof j.scope === 'string' ? j.scope : null,
    liveMode: j.live_mode !== false,
  };
}

function subscriptionStatus(s: unknown): SubscriptionStatus {
  return s === 'authorized' || s === 'paused' || s === 'cancelled' ? s : 'pending';
}

function mapSubscription(j: Json): ProviderSubscription {
  const ar = (j.auto_recurring ?? {}) as Json;
  return {
    id: String(j.id ?? ''),
    status: subscriptionStatus(j.status),
    externalReference: typeof j.external_reference === 'string' ? j.external_reference : null,
    amountCents: toCents(ar.transaction_amount),
    nextPaymentDate: typeof j.next_payment_date === 'string' ? j.next_payment_date : null,
    redirectUrl: typeof j.init_point === 'string' ? j.init_point : null,
  };
}

function webhookKind(type: string): WebhookKind {
  switch (type) {
    case 'payment':
      return 'payment';
    case 'subscription_preapproval':
    case 'preapproval':
      return 'subscription';
    case 'subscription_authorized_payment':
    case 'authorized_payment':
      return 'subscription_payment';
    default:
      return 'unknown';
  }
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = 'mercadopago' as const;
  readonly configured: boolean;
  readonly platformConfigured: boolean;
  private readonly fetch: typeof fetch;

  constructor(private readonly o: MercadoPagoOptions) {
    this.configured = !!(o.clientId && o.clientSecret);
    this.platformConfigured = !!o.platformToken;
    this.fetch = o.fetch ?? fetch;
  }

  private async call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    token: string | null,
    body?: unknown,
    idempotencyKey?: string,
    extra?: Record<string, string>,
  ): Promise<Json> {
    const headers: Record<string, string> = { accept: 'application/json', ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    let res: Response;
    try {
      res = await this.fetch(`${API}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProviderError('unavailable', `mercado pago unreachable: ${(err as Error).name}`);
    }
    const raw = await res.text().catch(() => '');
    let json: Json = {};
    try {
      json = raw ? (JSON.parse(raw) as Json) : {};
    } catch {
      if (res.ok) throw new ProviderError('unavailable', 'mercado pago sent a non-JSON answer');
    }
    if (res.ok) return json;
    // MP puts the specific reason (e.g. not enough balance to refund) in cause[]
    const causes = Array.isArray(json.cause)
      ? (json.cause as { code?: unknown; description?: unknown }[])
          .map((c) => `${c.code ?? ''} ${c.description ?? ''}`.trim())
          .join('; ')
      : '';
    const msg = [String(json.message ?? json.error ?? res.statusText ?? 'error'), causes]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 300);
    const code = String(json.error ?? json.code ?? '');
    if (res.status === 401) throw new ProviderError('unauthorized', msg, 401);
    if (res.status === 403)
      throw new ProviderError(
        /polic|block|restrict/i.test(`${code} ${msg}`) ? 'restricted' : 'invalid',
        msg,
        403,
      );
    if (res.status === 404) throw new ProviderError('not_found', msg, 404);
    if (res.status === 429 || res.status >= 500)
      throw new ProviderError('unavailable', msg, res.status);
    if (res.status === 400 && path === '/oauth/token' && code === 'invalid_grant')
      throw new ProviderError('unauthorized', msg, 400);
    throw new ProviderError('invalid', msg, res.status);
  }

  private platform(): string {
    if (!this.o.platformToken)
      throw new ProviderError('unavailable', 'plan billing is not configured');
    return this.o.platformToken;
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  connectUrl(state: string, redirectUri: string) {
    const u = new URL(AUTH);
    u.searchParams.set('client_id', this.o.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('platform_id', 'mp');
    u.searchParams.set('state', state);
    u.searchParams.set('redirect_uri', redirectUri);
    return u.toString();
  }

  async exchangeCode(code: string, redirectUri: string) {
    const j = await this.call('POST', '/oauth/token', null, {
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).catch((err) => {
      // a used/expired code is our request's fault, not a revoked account
      if (err instanceof ProviderError && err.code === 'unauthorized' && err.status === 400)
        throw new ProviderError('invalid', err.message, 400);
      throw err;
    });
    return tokens(j);
  }

  async refresh(refreshToken: string) {
    return tokens(
      await this.call('POST', '/oauth/token', null, {
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    );
  }

  // ── store orders ─────────────────────────────────────────────────────────

  private pixBody(req: PixRequest) {
    return {
      transaction_amount: toReais(req.amountCents),
      description: req.description.slice(0, 200),
      payment_method_id: 'pix',
      payer: {
        email: req.payerEmail,
        ...(req.payerName ? { first_name: req.payerName.slice(0, 60) } : {}),
      },
      external_reference: req.externalReference,
      ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
      ...(req.applicationFeeCents > 0 ? { application_fee: toReais(req.applicationFeeCents) } : {}),
      date_of_expiration: mpDate(req.expiresAt),
    };
  }

  async createPix(token: string, req: PixRequest) {
    return mapPayment(
      (await this.call(
        'POST',
        '/v1/payments',
        token,
        this.pixBody(req),
        req.idempotencyKey,
      )) as MpPayment,
    );
  }

  async createCardPayment(token: string, req: CardPaymentRequest) {
    const body = {
      transaction_amount: toReais(req.amountCents),
      token: req.cardToken,
      description: req.description.slice(0, 200),
      installments: req.installments,
      payment_method_id: req.paymentMethodId,
      ...(req.issuerId ? { issuer_id: Number(req.issuerId) || req.issuerId } : {}),
      payer: {
        email: req.payer.email,
        ...(req.payer.identification ? { identification: req.payer.identification } : {}),
        ...(req.payer.firstName ? { first_name: req.payer.firstName.slice(0, 60) } : {}),
      },
      external_reference: req.externalReference,
      metadata: { vendua_attempt: req.attempt },
      ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
      ...(req.applicationFeeCents > 0 ? { application_fee: toReais(req.applicationFeeCents) } : {}),
      // 3DS 2.0 needs capture and a non-binary payment; the challenge renders in our page
      capture: true,
      binary_mode: false,
      three_d_secure_mode: 'optional',
    };
    return mapPayment(
      (await this.call(
        'POST',
        '/v1/payments',
        token,
        body,
        req.idempotencyKey,
        req.deviceId ? { 'x-meli-session-id': req.deviceId } : undefined,
      )) as MpPayment,
    );
  }

  async createCardCheckout(token: string, req: CardCheckoutRequest): Promise<CardCheckout> {
    const j = await this.call(
      'POST',
      '/checkout/preferences',
      token,
      {
        items: [
          {
            title: req.title.slice(0, 250),
            quantity: 1,
            unit_price: toReais(req.amountCents),
            currency_id: 'BRL',
          },
        ],
        external_reference: req.externalReference,
        ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
        back_urls: { success: req.backUrl, failure: req.backUrl, pending: req.backUrl },
        auto_return: 'approved',
        ...(req.applicationFeeCents > 0
          ? { marketplace_fee: toReais(req.applicationFeeCents) }
          : {}),
        ...(req.payerEmail ? { payer: { email: req.payerEmail } } : {}),
        expires: true,
        expiration_date_to: mpDate(req.expiresAt),
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }],
        },
      },
      req.idempotencyKey,
    );
    const id = typeof j.id === 'string' ? j.id : '';
    const url = typeof j.init_point === 'string' ? j.init_point : '';
    if (!id || !url) throw new ProviderError('unavailable', 'preference without id/init_point');
    return { id, redirectUrl: url };
  }

  async getPayment(token: string, id: string) {
    return mapPayment(
      (await this.call('GET', `/v1/payments/${encodeURIComponent(id)}`, token)) as MpPayment,
    );
  }

  /** An unpaid Pix stops being payable; MP refuses (invalid) once it's paid. */
  async cancelPayment(token: string, id: string) {
    return mapPayment(
      (await this.call('PUT', `/v1/payments/${encodeURIComponent(id)}`, token, {
        status: 'cancelled',
      })) as MpPayment,
    );
  }

  /** A hosted checkout of a cancelled order stops taking cards (MP-only; the fake has none). */
  async expireCheckout(token: string, checkoutId: string) {
    await this.call('PUT', `/checkout/preferences/${encodeURIComponent(checkoutId)}`, token, {
      expires: true,
      expiration_date_to: mpDate(new Date()),
    });
  }

  async findPayment(token: string, externalReference: string) {
    return (await this.findPayments(token, externalReference))[0] ?? null;
  }

  async findPayments(token: string, externalReference: string) {
    const q = new URLSearchParams({
      external_reference: externalReference,
      sort: 'date_created',
      criteria: 'desc',
      limit: '30',
    });
    const j = await this.call('GET', `/v1/payments/search?${q}`, token);
    return Array.isArray(j.results) ? (j.results as MpPayment[]).map(mapPayment) : [];
  }

  async refund(
    token: string,
    paymentId: string,
    amountCents: number | null,
    idempotencyKey: string,
  ): Promise<ProviderRefund> {
    const j = await this.call(
      'POST',
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      token,
      amountCents === null ? {} : { amount: toReais(amountCents) },
      idempotencyKey,
    );
    const s = String(j.status ?? '');
    return {
      id: String(j.id ?? ''),
      amountCents: toCents(j.amount),
      status:
        s === 'approved'
          ? 'approved'
          : s === 'rejected' || s === 'cancelled'
            ? 'rejected'
            : 'pending',
    };
  }

  // ── webhooks ─────────────────────────────────────────────────────────────

  verifyWebhook(headers: Headers, rawBody: string, url: URL): WebhookEvent | null {
    const secret = this.o.webhookSecret;
    if (!secret) return null;
    const parts: Record<string, string> = {};
    for (const kv of (headers.get('x-signature') ?? '').split(',')) {
      const i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
    const requestId = headers.get('x-request-id') ?? '';
    let body: {
      type?: unknown;
      topic?: unknown;
      action?: unknown;
      data?: { id?: unknown };
      user_id?: unknown;
    } = {};
    try {
      const parsed = JSON.parse(rawBody || '{}');
      if (parsed && typeof parsed === 'object') body = parsed;
    } catch {
      return null;
    }
    const bodyId = body.data?.id;
    const id = (
      url.searchParams.get('data.id') ??
      (typeof bodyId === 'string' || typeof bodyId === 'number' ? String(bodyId) : '')
    ).trim();
    const ts = parts.ts ?? '';
    const v1 = parts.v1 ?? '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !ts || !/^[0-9a-f]{64}$/i.test(v1)) return null;
    // the replay window is not checked: an event only makes us re-fetch the resource, and MP
    // re-signs its retries with the original ts
    const manifest = `id:${id.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
    const want = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'));
    const got = Buffer.from(v1.toLowerCase());
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    const type =
      url.searchParams.get('type') ??
      url.searchParams.get('topic') ??
      (typeof body.type === 'string'
        ? body.type
        : typeof body.topic === 'string'
          ? body.topic
          : '');
    const user = body.user_id;
    return {
      kind: webhookKind(type),
      resourceId: id,
      providerUserId: typeof user === 'number' || typeof user === 'string' ? String(user) : null,
      action: typeof body.action === 'string' ? body.action.slice(0, 80) : null,
    };
  }

  // ── the plan, on Venduá's account ───────────────────────────────────────

  async platformPix(req: PixRequest) {
    return this.createPix(this.platform(), req);
  }

  async platformGetPayment(id: string) {
    return this.getPayment(this.platform(), id);
  }

  async platformCancelPayment(id: string) {
    return this.cancelPayment(this.platform(), id);
  }

  async createSubscription(req: SubscriptionRequest) {
    return mapSubscription(
      await this.call(
        'POST',
        '/preapproval',
        this.platform(),
        {
          reason: req.reason.slice(0, 200),
          external_reference: req.externalReference,
          payer_email: req.payerEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: toReais(req.amountCents),
            currency_id: 'BRL',
            ...(req.startDate ? { start_date: req.startDate.toISOString() } : {}),
          },
          back_url: req.backUrl,
          ...(req.notificationUrl ? { notification_url: req.notificationUrl } : {}),
          status: 'pending',
        },
        req.idempotencyKey,
      ),
    );
  }

  async getSubscription(id: string) {
    return mapSubscription(
      await this.call('GET', `/preapproval/${encodeURIComponent(id)}`, this.platform()),
    );
  }

  async updateSubscription(
    id: string,
    patch: { amountCents?: number; status?: 'cancelled' | 'paused' | 'authorized' },
  ) {
    return mapSubscription(
      await this.call('PUT', `/preapproval/${encodeURIComponent(id)}`, this.platform(), {
        ...(patch.amountCents !== undefined
          ? {
              auto_recurring: {
                transaction_amount: toReais(patch.amountCents),
                currency_id: 'BRL',
              },
            }
          : {}),
        ...(patch.status ? { status: patch.status } : {}),
      }),
    );
  }

  async getSubscriptionPayment(id: string): Promise<ProviderSubscriptionPayment> {
    const j = await this.call(
      'GET',
      `/authorized_payments/${encodeURIComponent(id)}`,
      this.platform(),
    );
    const pay = (j.payment ?? null) as { id?: unknown; status?: unknown } | null;
    const ps = pay?.status;
    const status =
      ps === 'approved'
        ? 'approved'
        : ps === 'rejected' || j.status === 'recycling'
          ? 'rejected'
          : j.status === 'cancelled'
            ? 'cancelled'
            : 'pending';
    const payId = pay?.id;
    return {
      id: String(j.id ?? id),
      subscriptionId: String(j.preapproval_id ?? ''),
      status,
      amountCents: toCents(j.transaction_amount),
      paymentId: typeof payId === 'number' || typeof payId === 'string' ? String(payId) : null,
      date: String(j.debit_date ?? j.date_created ?? new Date().toISOString()),
    };
  }
}
