// The payment provider seam (13-payments.md#provider-interface). Mercado Pago is the only real
// adapter (mercadopago.ts); `fake.ts` stands in for dev, CI screenshots and tests. Two kinds of
// money move through it:
//   - store orders: on the merchant's own OAuth token (marketplace, ADR 0009) — `token` args
//   - the plan: on Venduá's own account (MP_PLATFORM_ACCESS_TOKEN) — the `platform*` methods
// Amounts are integer cents everywhere; adapters convert at the wire.

export type ProviderName = 'mercadopago' | 'fake';

export type ProviderPaymentStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'charged_back'
  | 'in_mediation';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  providerUserId: string;
  publicKey: string | null;
  scope: string | null;
  liveMode: boolean;
}

export interface ProviderPayment {
  id: string;
  status: ProviderPaymentStatus;
  statusDetail: string | null;
  kind: 'pix' | 'card' | 'other';
  amountCents: number;
  refundedCents: number;
  /** what the provider kept (MP fee_details, excluding our application fee) */
  providerFeeCents: number | null;
  applicationFeeCents: number;
  /** net_received_amount — what reaches the merchant */
  netCents: number | null;
  externalReference: string | null;
  /** the account that received the money — must be the store's connected account */
  collectorId: string | null;
  approvedAt: string | null;
  pix: { copyPaste: string; expiresAt: string | null } | null;
  /** a card payment waiting on the issuer's 3-D Secure challenge (MP `pending_challenge`) */
  challenge?: { url: string; creq: string } | null;
  /** the in-page card attempt this payment was made for (our metadata); null for anything else */
  attempt?: number | null;
}

/** One line of what a Pix pays for — the provider's anti-fraud scores on it. */
export interface PixItem {
  id: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
}

export interface PixRequest {
  amountCents: number;
  description: string;
  /** MP requires a payer email for Pix. One per person: an address shared by many payers reads
   *  to MP's anti-fraud as one payer paying everyone, and it refuses the money. */
  payerEmail: string;
  /** full name; the adapter splits it */
  payerName?: string;
  /** national digits (DDD + number) */
  payerPhone?: string;
  /** CPF (11 digits) or CNPJ (14, letters allowed), normalized */
  payerDocument?: string;
  items?: PixItem[];
  externalReference: string;
  /** stable per logical attempt — a retry returns the same payment */
  idempotencyKey: string;
  notificationUrl: string | null;
  applicationFeeCents: number;
  expiresAt: Date;
}

export interface CardCheckoutRequest {
  title: string;
  amountCents: number;
  externalReference: string;
  idempotencyKey: string;
  notificationUrl: string | null;
  /** where the shopper lands after paying (success, failure and pending all return here) */
  backUrl: string;
  applicationFeeCents: number;
  payerEmail?: string;
  expiresAt: Date;
}

/** A card the shopper typed into the provider's own fields on our page (MP Card Payment Brick). */
export interface CardPaymentRequest {
  amountCents: number;
  description: string;
  /** single-use token from the provider's card fields — the card itself never reaches Core */
  cardToken: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: {
    email: string;
    identification: { type: string; number: string } | null;
    firstName?: string;
  };
  externalReference: string;
  /** our attempt number — comes back on the payment, so it binds only to its own attempt */
  attempt: number;
  idempotencyKey: string;
  notificationUrl: string | null;
  applicationFeeCents: number;
  /** MP's device fingerprint from the SDK (anti-fraud), forwarded as X-meli-session-id */
  deviceId: string | null;
}

export interface CardCheckout {
  /** MP preference id */
  id: string;
  redirectUrl: string;
}

export interface ProviderRefund {
  id: string;
  amountCents: number;
  status: 'pending' | 'approved' | 'rejected';
}

export type WebhookKind = 'payment' | 'subscription' | 'subscription_payment' | 'unknown';

export interface WebhookEvent {
  kind: WebhookKind;
  /** the provider id of the resource to fetch — the event itself is only a hint */
  resourceId: string;
  providerUserId: string | null;
  action: string | null;
}

export type SubscriptionStatus = 'pending' | 'authorized' | 'paused' | 'cancelled';

export interface SubscriptionRequest {
  reason: string;
  amountCents: number;
  payerEmail: string;
  /** our tenant id — comes back on every fetch */
  externalReference: string;
  backUrl: string;
  notificationUrl: string | null;
  idempotencyKey: string;
  /** first charge date (MP auto_recurring.start_date); absent = charge on authorization */
  startDate?: Date | null;
}

export interface ProviderSubscription {
  id: string;
  status: SubscriptionStatus;
  externalReference: string | null;
  amountCents: number;
  nextPaymentDate: string | null;
  redirectUrl: string | null;
}

export interface ProviderSubscriptionPayment {
  id: string;
  subscriptionId: string;
  status: 'approved' | 'rejected' | 'pending' | 'cancelled';
  amountCents: number;
  /** the underlying MP payment, when there is one */
  paymentId: string | null;
  date: string;
}

/** Thrown by adapters; `code` is what callers branch on. */
export class ProviderError extends Error {
  constructor(
    public code:
      | 'unauthorized' // token revoked/expired → connection disconnected
      | 'restricted' // the account can't receive (MP-side hold)
      | 'invalid' // we sent something the provider refused
      | 'not_found'
      | 'unavailable', // network, 5xx, timeout — retry later
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** false when the install has no provider credentials — the admin says so, checkout hides online methods */
  readonly configured: boolean;
  /** Venduá's own account is set up (plan billing) */
  readonly platformConfigured: boolean;

  // merchant connection (OAuth)
  connectUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;

  // store orders, on the merchant's token
  createPix(token: string, req: PixRequest): Promise<ProviderPayment>;
  /** Kernels before 1.19 only: MP's hosted checkout, reached by a redirect */
  createCardCheckout(token: string, req: CardCheckoutRequest): Promise<CardCheckout>;
  /** a card tokenized in our page — no redirect; may come back waiting on a 3DS challenge */
  createCardPayment(token: string, req: CardPaymentRequest): Promise<ProviderPayment>;
  getPayment(token: string, id: string): Promise<ProviderPayment>;
  /** the latest payment for an external reference (a card checkout before its webhook) */
  findPayment(token: string, externalReference: string): Promise<ProviderPayment | null>;
  /** every payment for an external reference, newest first (a superseded checkout's late one) */
  findPayments(token: string, externalReference: string): Promise<ProviderPayment[]>;
  refund(
    token: string,
    paymentId: string,
    amountCents: number | null,
    idempotencyKey: string,
  ): Promise<ProviderRefund>;
  /** cancel a still-pending payment (a Pix nobody paid yet); a paid one throws `invalid` */
  cancelPayment(token: string, id: string): Promise<ProviderPayment>;

  /** null = signature doesn't verify; never act on an unverified body */
  verifyWebhook(headers: Headers, rawBody: string, url: URL): WebhookEvent | null;

  // the plan, on Venduá's account
  /** whose account the platform token is; `live` false for a test token (CRM signup panel) */
  platformAccount(): Promise<{ id: string; name: string | null; live: boolean }>;
  platformPix(req: PixRequest): Promise<ProviderPayment>;
  platformGetPayment(id: string): Promise<ProviderPayment>;
  platformCancelPayment(id: string): Promise<ProviderPayment>;
  createSubscription(req: SubscriptionRequest): Promise<ProviderSubscription>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  updateSubscription(
    id: string,
    patch: { amountCents?: number; status?: 'cancelled' | 'paused' | 'authorized' },
  ): Promise<ProviderSubscription>;
  getSubscriptionPayment(id: string): Promise<ProviderSubscriptionPayment>;
}
