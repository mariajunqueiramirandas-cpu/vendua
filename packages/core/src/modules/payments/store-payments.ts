import { emitAdminTx } from '../../admin/live.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError, UUID_RE } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { storeOrigin } from '../../platform/store-origin.ts';
import { ORDER_CHANNEL, loadOrderView, recordOrderStep, type OrderView } from '../orders.ts';
import type { PaymentAdjustment, PaymentAdjustments } from '../payment-adjustments.ts';
import { pixPayload, type PixKeyType } from '../pix.ts';
import { enqueueOrderMessageTx } from '../../store-whatsapp/messages.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import type { StoreSettingsRow } from '../store.ts';
import {
  isOnline,
  loadConnection,
  setConnectionStatus,
  tokenFor,
  type ConnectionRow,
  type StoreToken,
} from './connections.ts';
import {
  ProviderError,
  type PaymentProvider,
  type ProviderName,
  type ProviderPayment,
} from './provider.ts';

// Shopper → merchant payments on a store order (13-payments.md). The order's `payment` jsonb is
// what every UI reads; the `payments` rows (one per attempt) are the ledger; the provider is the
// truth — webhooks and syncs only ever apply what a fresh fetch returned.

const payLog = log.child({ mod: 'store-payments' });

export const PIX_TTL_MIN = 30;
export const CARD_TTL_MIN = 120;
/** an in-page card attempt whose create call never answered: another submit waits this long */
const CARD_SUBMIT_GRACE_MS = 2 * 60_000;
/** …and the job gives the attempt up after this, having looked it up at MP until then */
const CARD_FORM_TTL_MS = 30 * 60_000;
/** status_detail of an in-page card attempt before MP answers — tells it from a hosted checkout */
const CARD_FORM = 'card_form';
const MAX_ATTEMPTS = 20;

const SETTLED = ['approved', 'partially_refunded', 'refunded', 'charged_back', 'in_mediation'];
const OPEN = ['creating', 'pending'];
/** disputed or reversed money: the team hears about it (ADR 0023 `payment.problem`) */
const PROBLEMS = ['charged_back', 'in_mediation', 'refunded'];

export interface PaymentRow {
  id: string;
  order_id: string;
  provider: ProviderName;
  provider_payment_id: string | null;
  provider_checkout_id: string | null;
  kind: 'pix' | 'card';
  status: string;
  status_detail: string | null;
  amount_cents: number;
  refunded_cents: number;
  provider_fee_cents: number | null;
  net_cents: number | null;
  application_fee_cents: number;
  pix_copy_paste: string | null;
  pix_expires_at: Date | null;
  redirect_url: string | null;
  attempt: number;
  approved_at: Date | null;
  created_at: Date;
  /** set when a person must look at it (see migration 0055_core_pay) */
  review: string | null;
}

export type DeclineReason =
  | 'card_data'
  | 'insufficient_funds'
  | 'call_for_authorize'
  | 'card_disabled'
  | 'duplicated'
  | 'high_risk'
  | 'max_attempts'
  | 'installments'
  | 'challenge_failed'
  | 'other';

export type PayNext =
  | { kind: 'pix'; copyPaste: string; expiresAt: string | null }
  /** Kernels before 1.19: MP's hosted checkout */
  | { kind: 'redirect'; url: string }
  /** the Kernel mounts MP's card fields with this key; Core charges the order total */
  | {
      kind: 'card';
      provider: ProviderName;
      publicKey: string;
      amountCents: number;
      declined: DeclineReason | null;
    }
  | { kind: 'challenge'; url: string; creq: string }
  | { kind: 'declined'; reason: DeclineReason }
  | { kind: 'none' };

/** MP's status_detail of a refused card (collection-results) → what the shopper is told. */
export function declineReason(detail: string | null): DeclineReason {
  switch (detail) {
    case 'cc_rejected_bad_filled_card_number':
    case 'cc_rejected_bad_filled_date':
    case 'cc_rejected_bad_filled_other':
    case 'cc_rejected_bad_filled_security_code':
    case 'create_invalid':
      return 'card_data';
    case 'cc_rejected_insufficient_amount':
      return 'insufficient_funds';
    case 'cc_rejected_call_for_authorize':
      return 'call_for_authorize';
    case 'cc_rejected_card_disabled':
      return 'card_disabled';
    case 'cc_rejected_duplicated_payment':
      return 'duplicated';
    case 'cc_rejected_high_risk':
    case 'cc_rejected_blacklist':
      return 'high_risk';
    case 'cc_rejected_max_attempts':
      return 'max_attempts';
    case 'cc_rejected_invalid_installments':
      return 'installments';
    case 'cc_rejected_3ds_challenge':
      return 'challenge_failed';
    default:
      return 'other';
  }
}

export interface PayDeps {
  sql: Sql;
  provider: PaymentProvider;
  sessionSecret: string;
}

/** What the storefront may offer online right now (GET /storefront/v1/store). */
export async function storePaymentsPublic(
  tx: Sql,
  tenantId: string,
  provider: PaymentProvider,
  methods: string[],
  adjustments: PaymentAdjustments = {},
): Promise<{
  onlinePayments: { pix: boolean; card: boolean };
  paymentMethods: string[];
  /** offered methods with a discount/surcharge only — labels; Core computes the cents */
  paymentAdjustments: Record<string, PaymentAdjustment>;
}> {
  const online = isOnline(await loadConnection(tx, tenantId), provider);
  const paymentMethods = online ? methods : methods.filter((m) => m !== 'card_online');
  return {
    onlinePayments: {
      pix: online && methods.includes('pix'),
      card: online && methods.includes('card_online'),
    },
    paymentMethods,
    paymentAdjustments: Object.fromEntries(
      Object.entries(adjustments).filter(([m]) => paymentMethods.includes(m)),
    ),
  };
}

/** At checkout: may this order be charged online, and through which driver. */
export async function onlineOffer(
  tx: Sql,
  tenantId: string,
  provider?: PaymentProvider,
): Promise<{ online: boolean; provider: ProviderName | null }> {
  const conn = await loadConnection(tx, tenantId);
  const online = isOnline(conn, provider);
  return { online, provider: online ? (provider?.name ?? conn!.provider) : null };
}

const brl = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

/** Today's offline payment: the static Pix from the store's own key, or pay on delivery. */
export function offlinePayment(
  settings: Pick<
    StoreSettingsRow,
    'pix_key' | 'pix_key_type' | 'pix_beneficiary' | 'pix_city' | 'city'
  > | null,
  method: string,
  totalCents: number,
  number: number,
) {
  const profile =
    method === 'pix' && settings?.pix_key && settings.pix_key_type
      ? {
          key: settings.pix_key,
          keyType: settings.pix_key_type as PixKeyType,
          beneficiary: settings.pix_beneficiary ?? '',
          city: settings.pix_city ?? settings.city ?? '',
        }
      : null;
  return {
    // the contract's name for "no payment provider" (10-qa-pipeline C05) — kept so storefronts
    // and conformance read offline orders exactly as before Phase 3; `online` is what code branches on
    provider: 'sandbox',
    method,
    status: 'pending',
    online: false,
    instructions:
      method === 'pix'
        ? profile
          ? `Pague ${brl(totalCents)} no Pix copia e cola abaixo — o pedido #${number} aparece para a loja.`
          : 'Pagamento PIX combinado na entrega/retirada.'
        : method === 'meal_voucher'
          ? 'Pagamento com vale-refeição na entrega ou retirada.'
          : 'Pagamento na entrega ou retirada.',
    pix: profile
      ? {
          key: profile.key,
          keyType: profile.keyType,
          beneficiary: profile.beneficiary,
          copyPaste: pixPayload(profile, { amountCents: totalCents, txid: `PEDIDO${number}` }),
        }
      : null,
  };
}

export function onlinePayment(
  provider: ProviderName,
  method: 'pix' | 'card_online',
  total: number,
) {
  return {
    provider,
    method,
    status: 'pending',
    online: true,
    instructions:
      method === 'pix'
        ? `Pague ${brl(total)} com Pix pelo código desta página — o pedido é confirmado quando o pagamento cai.`
        : `Pague ${brl(total)} com cartão nesta página — o pedido é confirmado quando o pagamento é aprovado.`,
    pix: null,
    redirectUrl: null,
  };
}

/** Venduá's cut from the tenant's plan (plans.fee_bps; 0 today). Legacy plans have no row → 0. */
async function applicationFee(tx: Sql, tenantId: string, totalCents: number) {
  const bps =
    (
      await tx<{ bps: number | null }[]>`
        select p.fee_bps as bps from tenants t left join plans p on p.id = t.plan where t.id = ${tenantId}
      `
    )[0]?.bps ?? 0;
  return Math.round((totalCents * bps) / 10_000);
}

function nextFor(row: PaymentRow | null, now = new Date()): PayNext {
  if (!row || !OPEN.includes(row.status)) return { kind: 'none' };
  if (row.kind === 'pix' && row.pix_copy_paste && pixLive(row, now))
    return {
      kind: 'pix',
      copyPaste: row.pix_copy_paste,
      expiresAt: row.pix_expires_at ? new Date(row.pix_expires_at).toISOString() : null,
    };
  if (row.kind === 'card' && !row.provider_payment_id && row.redirect_url && cardLive(row, now))
    return { kind: 'redirect', url: row.redirect_url };
  return { kind: 'none' };
}

const pixLive = (row: PaymentRow, now: Date) =>
  !row.pix_expires_at || new Date(row.pix_expires_at).getTime() > now.getTime();
const cardLive = (row: PaymentRow, now: Date) =>
  new Date(row.created_at).getTime() + CARD_TTL_MIN * 60_000 > now.getTime();

const formAttempt = (row: PaymentRow) =>
  row.kind === 'card' && !row.provider_payment_id && row.status_detail === CARD_FORM;
const age = (row: PaymentRow, now: Date) => now.getTime() - new Date(row.created_at).getTime();

/**
 * An open attempt nobody can pay any more: Pix past its expiry, a hosted checkout past its TTL,
 * an in-page card submit MP never answered.
 */
export function attemptExpired(row: PaymentRow, now = new Date()) {
  if (!OPEN.includes(row.status)) return false;
  if (row.kind === 'pix') return !pixLive(row, now);
  if (formAttempt(row)) return age(row, now) > CARD_FORM_TTL_MS;
  return !row.provider_payment_id && !cardLive(row, now);
}

/** Statuses only move forward: a stale fetch never walks a settled row back. */
const RANK: Record<string, number> = {
  creating: 0,
  pending: 0,
  rejected: 1,
  cancelled: 1,
  expired: 1,
  approved: 2,
  in_mediation: 2,
  partially_refunded: 3,
  refunded: 4,
  charged_back: 4,
};
export function forward(from: string, to: string): string {
  const a = RANK[from] ?? 0;
  const b = RANK[to] ?? 0;
  if (b !== a) return b > a ? to : from;
  // mediation opens and closes both ways; the other finals keep what they are
  return a === 0 || a === 2 ? to : from;
}

/** MercadoPagoProvider can also expire a hosted checkout; the interface doesn't require it. */
type Expirable = { expireCheckout?: (token: string, checkoutId: string) => Promise<unknown> };

/** Tell the store's connection what the provider said, in its own tx — the caller may roll back. */
export function markConnectionLater(
  d: PayDeps,
  tenantId: string,
  err: unknown,
  tok?: StoreToken | null,
) {
  if (!(err instanceof ProviderError)) return;
  const status =
    err.code === 'unauthorized' ? 'disconnected' : err.code === 'restricted' ? 'restricted' : null;
  if (!status) return;
  void withTenant(d.sql, tenantId, (tx) =>
    setConnectionStatus(tx, tenantId, status, err.code, tok?.since ?? null),
  ).catch((e) => payLog.warn({ err: e }, 'connection status update failed'));
}

/** A person has to look at this payment (Pagamentos lists it). */
export async function markReview(tx: Sql, tenantId: string, row: PaymentRow, reason: string) {
  if (row.review === reason) return;
  await tx`update payments set review = ${reason}, updated_at = now() where id = ${row.id}`;
  await emitAdminTx(tx, tenantId, 'order.changed', row.order_id);
  await emitAdminTx(tx, tenantId, 'store');
}

/**
 * Provider ids are unique across every store. A clash (MP replaying an id across our retries, a
 * dev fake restarted on the same database) is logged and treated as a conflict, never a 500:
 * the write runs in a savepoint so the surrounding tx stays usable.
 */
async function bindsProviderId<T>(tx: Sql, run: (sp: Sql) => Promise<T>): Promise<T | null> {
  try {
    return await (
      tx as unknown as { savepoint: (f: (sp: Sql) => Promise<T>) => Promise<T> }
    ).savepoint(run);
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
    payLog.error({ err }, 'provider payment id already bound to another payment');
    return null;
  }
}

interface OrderLock {
  id: string;
  number: number;
  state: string;
  total_cents: number;
  customer: { name?: string };
  payment: Record<string, unknown> & { online?: boolean; method?: string; status?: string };
}

type Plan =
  | { do: 'done'; next: PayNext }
  | { do: 'sync'; row: PaymentRow; tok: StoreToken }
  | {
      do: 'create';
      row: PaymentRow;
      tok: StoreToken;
      title: string;
      firstName: string | null;
      backUrl: string | null;
    };

const PAYABLE = ['pending', 'failed', 'expired'];

/**
 * POST /checkout/v1/orders/:id/pay — the shopper's page asks for the way to pay. Reuses the live
 * attempt, or opens a new one (none yet, expired, rejected). Mercado Pago is never called inside
 * a DB transaction: a short tx plans (and reserves a `creating` attempt row), the provider call
 * runs outside, a second short tx records it. MP's idempotency key is `${orderId}:${attempt}`,
 * and a `creating` row is retried with its own attempt number — a request that died after MP
 * answered gets the same payment back, never a second charge.
 */
export interface PayCtx {
  publicOrigin: string;
  storeDomain: string;
  payerEmail?: string;
  /** Kernel 1.19+: a card order gets the in-page form, never a hosted checkout */
  cardForm?: boolean;
  /** the key MP's card fields run under (MP_PUBLIC_KEY); unset → the store's own, from OAuth */
  publicKey?: string;
  /** the page saw the bank's 3DS frame say COMPLETE: a still-pending challenge is MP catching up */
  challengeDone?: boolean;
}

export async function preparePayment(
  d: PayDeps,
  tenant: { id: string; slug: string; name: string },
  orderId: string,
  cartId: string,
  ctx: PayCtx,
  now = new Date(),
): Promise<PayNext> {
  let synced = false;
  for (let i = 0; i < 4; i++) {
    const plan = await withTenant(d.sql, tenant.id, (tx) =>
      planPayment(tx, d, tenant, orderId, cartId, ctx, synced, now),
    );
    if (plan.do === 'done') return plan.next;
    if (plan.do === 'sync') {
      await syncAttempt(d, tenant.id, plan.tok, plan.row);
      synced = true;
      continue;
    }
    return createAttempt(d, tenant.id, plan, ctx, now);
  }
  throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is busy — try again', {
    reason: 'busy',
  });
}

async function planPayment(
  tx: Sql,
  d: PayDeps,
  tenant: { id: string; slug: string; name: string },
  orderId: string,
  cartId: string,
  ctx: PayCtx,
  synced: boolean,
  now: Date,
): Promise<Plan> {
  const order = (
    await tx<OrderLock[]>`
      select id, number, state, total_cents, customer, payment from orders
      where tenant_id = ${tenant.id} and id = ${orderId} and cart_id = ${cartId} for update
    `
  )[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  if (!order.payment.online)
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is paid offline', {
      reason: 'offline',
    });
  if (order.state === 'cancelled' || order.state === 'refunded')
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is closed', { reason: 'closed' });
  if (!PAYABLE.includes(String(order.payment.status))) {
    // the card return: our own sync just found the money
    if (synced) return { do: 'done', next: { kind: 'none' } };
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is already paid', {
      reason: 'paid',
    });
  }
  const method = order.payment.method === 'card_online' ? 'card_online' : 'pix';
  const conn = await loadConnection(tx, tenant.id);
  const tok = isOnline(conn, d.provider, now)
    ? await tokenFor(tx, tenant.id, d.sessionSecret)
    : null;
  if (!tok) {
    if (method === 'pix')
      return { do: 'done', next: await degradeToOffline(tx, tenant.id, order.id) };
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason: 'not_connected',
    });
  }
  const latest =
    (
      await tx<PaymentRow[]>`
        select * from payments where tenant_id = ${tenant.id} and order_id = ${orderId} and review is null
        order by attempt desc limit 1 for update
      `
    )[0] ?? null;
  const create = async (row: PaymentRow): Promise<Plan> => ({
    do: 'create',
    row,
    tok,
    title: `Pedido #${order.number} — ${tenant.name}`.slice(0, 200),
    firstName: order.customer.name?.trim().split(/\s+/)[0]?.slice(0, 60) || null,
    backUrl:
      row.kind === 'card'
        ? `${await storeOrigin(tx, tenant, ctx.storeDomain)}/pedido/${orderId}?pagamento=retorno`
        : null,
  });
  if (method === 'card_online' && ctx.cardForm)
    return cardFormPlan(tx, d, tenant.id, order, conn!, tok, latest, ctx, synced, now);
  if (latest && OPEN.includes(latest.status)) {
    if (latest.status === 'creating' && !attemptExpired(latest, now))
      // an in-page submit is in flight; an older Kernel's page doesn't get a checkout beside it
      return formAttempt(latest) ? { do: 'done', next: { kind: 'none' } } : create(latest);
    if (latest.status === 'pending' && !synced) return { do: 'sync', row: latest, tok };
    if (!attemptExpired(latest, now)) return { do: 'done', next: nextFor(latest, now) };
    await tx`update payments set status = 'expired', updated_at = now() where id = ${latest.id}`;
    await syncOrderPayment(tx, tenant.id, orderId);
  } else if (latest && SETTLED.includes(latest.status)) {
    await syncOrderPayment(tx, tenant.id, orderId);
    return { do: 'done', next: { kind: 'none' } };
  }
  const attempt =
    ((
      await tx<{ n: number | null }[]>`
        select max(attempt) as n from payments where tenant_id = ${tenant.id} and order_id = ${orderId}
      `
    )[0]!.n ?? 0) + 1;
  if (attempt > MAX_ATTEMPTS) {
    // payments.attempt is capped; a Pix order that got this far is settled by hand instead
    if (method === 'pix')
      return { do: 'done', next: await degradeToOffline(tx, tenant.id, order.id) };
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'too many payment attempts', {
      reason: 'attempts',
    });
  }
  const kind = method === 'pix' ? 'pix' : 'card';
  const fee = await applicationFee(tx, tenant.id, order.total_cents);
  const row = (
    await tx<PaymentRow[]>`
      insert into payments (tenant_id, order_id, provider, kind, status, amount_cents,
        application_fee_cents, pix_expires_at, attempt)
      values (${tenant.id}, ${orderId}, ${d.provider.name}, ${kind}, 'creating', ${order.total_cents},
        ${fee}, ${kind === 'pix' ? new Date(now.getTime() + PIX_TTL_MIN * 60_000) : null}, ${attempt})
      returning *
    `
  )[0]!;
  return create(row);
}

/** The in-page card form (Kernel 1.19+): show it, or say a payment is already on its way. */
async function cardFormPlan(
  tx: Sql,
  d: PayDeps,
  tenantId: string,
  order: OrderLock,
  conn: ConnectionRow,
  tok: StoreToken,
  latest: PaymentRow | null,
  ctx: PayCtx,
  synced: boolean,
  now: Date,
): Promise<Plan> {
  const none: Plan = { do: 'done', next: { kind: 'none' } };
  if (latest?.kind === 'card' && OPEN.includes(latest.status)) {
    if (latest.provider_payment_id) {
      if (!synced) return { do: 'sync', row: latest, tok };
      // in review at MP: wait for it. An unanswered 3DS challenge can be replaced by a new card —
      // unless the shopper just answered it and MP hasn't settled it yet
      if (latest.status_detail !== 'pending_challenge' || ctx.challengeDone) return none;
    } else if (formAttempt(latest) && age(latest, now) < CARD_SUBMIT_GRACE_MS) return none;
  } else if (latest && SETTLED.includes(latest.status)) {
    await syncOrderPayment(tx, tenantId, order.id);
    return none;
  }
  const publicKey = ctx.publicKey || conn.public_key;
  if (!publicKey)
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason: 'no_public_key',
    });
  return {
    do: 'done',
    next: {
      kind: 'card',
      provider: d.provider.name,
      publicKey,
      amountCents: order.total_cents,
      declined:
        latest?.kind === 'card' && latest.status === 'rejected'
          ? declineReason(latest.status_detail)
          : null,
    },
  };
}

const notificationUrlFor = (ctx: PayCtx, tenantId: string) =>
  // MP only posts to public https endpoints; dev/test origins rely on sync + reconciliation
  ctx.publicOrigin.startsWith('https://')
    ? `${ctx.publicOrigin}/admin/v1/hooks/mercadopago?t=${tenantId}`
    : null;

async function createAttempt(
  d: PayDeps,
  tenantId: string,
  plan: Extract<Plan, { do: 'create' }>,
  ctx: PayCtx,
  now: Date,
): Promise<PayNext> {
  const { row, tok } = plan;
  const idempotencyKey = `${row.order_id}:${row.attempt}`;
  const notificationUrl = notificationUrlFor(ctx, tenantId);
  let patch: Partial<PaymentRow>;
  try {
    if (row.kind === 'pix') {
      const expiresAt = row.pix_expires_at
        ? new Date(row.pix_expires_at)
        : new Date(now.getTime() + PIX_TTL_MIN * 60_000);
      const p = await d.provider.createPix(tok.token, {
        amountCents: row.amount_cents,
        description: plan.title,
        payerEmail: ctx.payerEmail ?? `pagador@${ctx.storeDomain}`,
        ...(plan.firstName ? { payerName: plan.firstName } : {}),
        externalReference: row.order_id,
        idempotencyKey,
        notificationUrl,
        applicationFeeCents: row.application_fee_cents,
        expiresAt,
      });
      if (!p.pix?.copyPaste) throw new ProviderError('unavailable', 'pix without a qr code');
      patch = {
        provider_payment_id: p.id,
        status: forward('creating', p.status),
        status_detail: p.statusDetail,
        pix_copy_paste: p.pix.copyPaste.slice(0, 1000),
        pix_expires_at: p.pix.expiresAt ? new Date(p.pix.expiresAt) : expiresAt,
      };
    } else {
      const pref = await d.provider.createCardCheckout(tok.token, {
        title: plan.title,
        amountCents: row.amount_cents,
        externalReference: row.order_id,
        idempotencyKey,
        notificationUrl,
        backUrl: plan.backUrl!,
        applicationFeeCents: row.application_fee_cents,
        expiresAt: new Date(new Date(row.created_at).getTime() + CARD_TTL_MIN * 60_000),
      });
      patch = {
        provider_checkout_id: pref.id.slice(0, 120),
        status: 'pending',
        redirect_url: pref.redirectUrl.slice(0, 1000),
      };
    }
  } catch (err) {
    markConnectionLater(d, tenantId, err, tok);
    const code = err instanceof ProviderError ? err.code : 'unavailable';
    payLog.error({ err, orderId: row.order_id, attempt: row.attempt }, 'payment attempt failed');
    // unavailable: the `creating` row stays, and the next /pay retries this same attempt
    if (code === 'unavailable')
      throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
        reason: code,
      });
    const next = await withTenant(d.sql, tenantId, async (tx) => {
      await tx`
        update payments set status = 'cancelled', status_detail = ${`create_${code}`}, updated_at = now()
        where id = ${row.id} and status = 'creating'
      `;
      // Pix never fails the shopper: a store MP refuses falls back to its own key
      return row.kind === 'pix' ? degradeToOffline(tx, tenantId, row.order_id) : null;
    });
    if (next) return next;
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason: code,
    });
  }
  return nextFor(await recordAttempt(d, tenantId, row, patch), now);
}

/**
 * The provider answered an attempt: record it on its `creating` row, in a short tx of its own.
 * Answers the row that now holds the payment (a webhook may have recorded it first).
 */
async function recordAttempt(
  d: PayDeps,
  tenantId: string,
  row: PaymentRow,
  patch: Partial<PaymentRow>,
): Promise<PaymentRow> {
  const out = await withTenant(d.sql, tenantId, async (tx) => {
    await tx`select id from orders where tenant_id = ${tenantId} and id = ${row.order_id} for update`;
    const cur = (
      await tx<PaymentRow[]>`select * from payments where id = ${row.id} for update`
    )[0]!;
    // a webhook may have recorded this very payment first (its own row): keep that one
    const other = patch.provider_payment_id
      ? (
          await tx<PaymentRow[]>`
            select * from payments where tenant_id = ${tenantId} and provider = ${row.provider}
              and provider_payment_id = ${patch.provider_payment_id} and id <> ${row.id}
          `
        )[0]
      : undefined;
    if (other) {
      await tx`update payments set status = 'cancelled', status_detail = 'superseded', updated_at = now() where id = ${row.id} and status = 'creating'`;
      await syncOrderPayment(tx, tenantId, row.order_id);
      return other.order_id === row.order_id ? other : ('conflict' as const);
    }
    if (cur.status === 'creating') {
      const bound = await bindsProviderId(
        tx,
        (sp) => sp`
          update payments set provider_payment_id = ${patch.provider_payment_id ?? null},
            provider_checkout_id = ${patch.provider_checkout_id ?? null}, status = ${patch.status ?? 'pending'},
            status_detail = ${patch.status_detail ?? null}, pix_copy_paste = ${patch.pix_copy_paste ?? null},
            pix_expires_at = ${patch.pix_expires_at ?? cur.pix_expires_at},
            redirect_url = ${patch.redirect_url ?? null}, updated_at = now()
          where id = ${row.id}
        `,
      );
      if (!bound) {
        // not ours to show: this attempt closes and the next /pay opens a fresh one
        await tx`update payments set status = 'cancelled', status_detail = 'provider_id_conflict', updated_at = now() where id = ${row.id}`;
        return 'conflict' as const;
      }
      if (SETTLED.includes(patch.status ?? ''))
        await flagIfPaidTwice(tx, tenantId, { ...cur, review: null });
    }
    await syncOrderPayment(tx, tenantId, row.order_id);
    return (await tx<PaymentRow[]>`select * from payments where id = ${row.id}`)[0]!;
  });
  if (out === 'conflict')
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable — try again', {
      reason: 'conflict',
    });
  return out;
}

export interface CardInput {
  token: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: { email: string; identification: { type: string; number: string } | null };
  deviceId: string | null;
}

const bad = (message: string) => new HttpError(422, 'INVALID_PAYMENT', message);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

/** POST /orders/:id/card's body: what MP's card fields hand the Kernel, bounded. Never an amount. */
export function parseCardInput(b: Record<string, unknown>): CardInput {
  const token = b.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(token))
    throw bad('token is required');
  const method = b.paymentMethodId;
  if (typeof method !== 'string' || !/^[a-z0-9_]{1,40}$/.test(method))
    throw bad('paymentMethodId is required');
  const issuer = typeof b.issuerId === 'number' ? String(b.issuerId) : b.issuerId;
  if (issuer != null && (typeof issuer !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(issuer)))
    throw bad('issuerId is invalid');
  const installments = b.installments;
  if (typeof installments !== 'number' || !Number.isInteger(installments))
    throw bad('installments must be an integer');
  if (installments < 1 || installments > 24) throw bad('installments must be 1-24');
  const payer = (b.payer ?? {}) as Record<string, unknown>;
  const email = typeof payer.email === 'string' ? payer.email.trim() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) throw bad('payer.email is invalid');
  let identification: CardInput['payer']['identification'] = null;
  if (payer.identification != null) {
    const id = payer.identification as Record<string, unknown>;
    const type = id.type;
    const number = typeof id.number === 'string' ? id.number.replace(/[^0-9A-Za-z]/g, '') : '';
    if (
      typeof type !== 'string' ||
      !/^[A-Za-z]{2,10}$/.test(type) ||
      !/^[0-9A-Za-z]{1,20}$/.test(number)
    )
      throw bad('payer.identification is invalid');
    identification = { type: type.toUpperCase(), number };
  }
  const device = b.deviceId;
  if (device != null && (typeof device !== 'string' || !/^[A-Za-z0-9_:.-]{1,200}$/.test(device)))
    throw bad('deviceId is invalid');
  return {
    token,
    paymentMethodId: method,
    issuerId: issuer ?? null,
    installments,
    payer: { email: email.toLowerCase(), identification },
    deviceId: device ?? null,
  };
}

type CardPlan =
  | { do: 'sync'; row: PaymentRow; tok: StoreToken }
  /** an unanswered 3DS challenge this card replaces: cancelled at MP before the new charge */
  | { do: 'abandon'; row: PaymentRow; tok: StoreToken }
  | {
      do: 'create';
      row: PaymentRow;
      tok: StoreToken;
      title: string;
      firstName: string | null;
      /** an older Kernel's hosted checkout the form replaces — expired at MP, best effort */
      supersededCheckout: string | null;
    };

/**
 * POST /checkout/v1/orders/:id/card — the shopper typed a card into MP's fields on the order page
 * (Kernel 1.19+). Same shape as preparePayment: a short tx reserves a `creating` attempt, MP is
 * called outside any tx with key `${orderId}:${attempt}`, a second tx records the answer. One
 * card at a time: while an attempt is in flight or in review, another submit gets
 * PAYMENT_IN_PROGRESS — a second token would be a second charge.
 */
export async function payWithCard(
  d: PayDeps,
  tenant: { id: string; slug: string; name: string },
  orderId: string,
  cartId: string,
  input: CardInput,
  ctx: PayCtx,
  now = new Date(),
): Promise<PayNext> {
  const unavailable = (reason: string) =>
    new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason,
    });
  let synced = false;
  let abandoning = false;
  for (let i = 0; i < 4; i++) {
    const plan = await withTenant(d.sql, tenant.id, (tx) =>
      planCard(tx, d, tenant, orderId, cartId, synced, now),
    );
    if (plan.do === 'sync') {
      if (!(await syncAttempt(d, tenant.id, plan.tok, plan.row))) throw unavailable('sync');
      synced = true;
      continue;
    }
    if (plan.do === 'abandon') {
      // MP must confirm the old payment can't be paid any more, or a late answer is a second charge
      if (abandoning) throw unavailable('challenge');
      abandoning = true;
      try {
        const p = await d.provider.cancelPayment(plan.tok.token, plan.row.provider_payment_id!);
        await withTenant(d.sql, tenant.id, (tx) => applyProviderPayment(tx, tenant.id, p));
      } catch (err) {
        markConnectionLater(d, tenant.id, err, plan.tok);
        // `invalid`: it already moved at MP (paid or refused) — read what it became
        if (!(err instanceof ProviderError && err.code === 'invalid'))
          throw unavailable('challenge');
        if (!(await syncAttempt(d, tenant.id, plan.tok, plan.row))) throw unavailable('sync');
      }
      continue;
    }
    if (plan.supersededCheckout)
      await (d.provider as unknown as Expirable)
        .expireCheckout?.(plan.tok.token, plan.supersededCheckout)
        .catch((err) => payLog.warn({ err, orderId }, 'could not expire the hosted checkout'));
    return createCardAttempt(d, tenant.id, plan, input, ctx);
  }
  throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is busy — try again', {
    reason: 'busy',
  });
}

const inProgress = (reason: string) =>
  new HttpError(409, 'PAYMENT_IN_PROGRESS', 'a card payment for this order is on its way', {
    reason,
  });

async function planCard(
  tx: Sql,
  d: PayDeps,
  tenant: { id: string; name: string },
  orderId: string,
  cartId: string,
  synced: boolean,
  now: Date,
): Promise<CardPlan> {
  const order = (
    await tx<OrderLock[]>`
      select id, number, state, total_cents, customer, payment from orders
      where tenant_id = ${tenant.id} and id = ${orderId} and cart_id = ${cartId} for update
    `
  )[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  if (!order.payment.online)
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is paid offline', {
      reason: 'offline',
    });
  if (order.payment.method !== 'card_online') throw bad('this order is not paid by card');
  if (order.state === 'cancelled' || order.state === 'refunded')
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is closed', { reason: 'closed' });
  if (!PAYABLE.includes(String(order.payment.status)))
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is already paid', {
      reason: 'paid',
    });
  const conn = await loadConnection(tx, tenant.id);
  const tok = isOnline(conn, d.provider, now)
    ? await tokenFor(tx, tenant.id, d.sessionSecret)
    : null;
  if (!tok)
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason: 'not_connected',
    });
  const latest =
    (
      await tx<PaymentRow[]>`
        select * from payments where tenant_id = ${tenant.id} and order_id = ${orderId} and review is null
        order by attempt desc limit 1 for update
      `
    )[0] ?? null;
  const plan = (row: PaymentRow, supersededCheckout: string | null = null): CardPlan => ({
    do: 'create',
    row,
    tok,
    title: `Pedido #${order.number} — ${tenant.name}`.slice(0, 200),
    firstName: order.customer.name?.trim().split(/\s+/)[0]?.slice(0, 60) || null,
    supersededCheckout,
  });
  let superseded: string | null = null;
  if (latest && OPEN.includes(latest.status)) {
    if (latest.kind === 'card' && latest.provider_payment_id) {
      if (!synced) return { do: 'sync', row: latest, tok };
      if (latest.status_detail !== 'pending_challenge') throw inProgress('processing');
      return { do: 'abandon', row: latest, tok };
    }
    if (formAttempt(latest)) {
      if (age(latest, now) < CARD_SUBMIT_GRACE_MS) throw inProgress('submitting');
      // MP never answered that submit. Retry the same attempt: its idempotency key replays the
      // first payment if MP took it, so the new token is only charged if MP never saw the old one
      return plan(latest);
    }
    // an older Kernel's hosted checkout: the form replaces it (money that lands there still counts)
    superseded = latest.provider_checkout_id;
    await tx`update payments set status = 'cancelled', status_detail = 'superseded', updated_at = now() where id = ${latest.id}`;
  } else if (latest && SETTLED.includes(latest.status)) {
    await syncOrderPayment(tx, tenant.id, orderId);
    throw new HttpError(409, 'PAYMENT_NOT_REQUIRED', 'this order is already paid', {
      reason: 'paid',
    });
  }
  const attempt =
    ((
      await tx<{ n: number | null }[]>`
        select max(attempt) as n from payments where tenant_id = ${tenant.id} and order_id = ${orderId}
      `
    )[0]!.n ?? 0) + 1;
  if (attempt > MAX_ATTEMPTS)
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'too many payment attempts', {
      reason: 'attempts',
    });
  const fee = await applicationFee(tx, tenant.id, order.total_cents);
  const row = (
    await tx<PaymentRow[]>`
      insert into payments (tenant_id, order_id, provider, kind, status, status_detail, amount_cents,
        application_fee_cents, attempt)
      values (${tenant.id}, ${orderId}, ${d.provider.name}, 'card', 'creating', ${CARD_FORM},
        ${order.total_cents}, ${fee}, ${attempt})
      returning *
    `
  )[0]!;
  return plan(row, superseded);
}

async function createCardAttempt(
  d: PayDeps,
  tenantId: string,
  plan: Extract<CardPlan, { do: 'create' }>,
  input: CardInput,
  ctx: PayCtx,
): Promise<PayNext> {
  const { row, tok } = plan;
  let p: ProviderPayment;
  try {
    p = await d.provider.createCardPayment(tok.token, {
      amountCents: row.amount_cents,
      description: plan.title,
      cardToken: input.token,
      paymentMethodId: input.paymentMethodId,
      issuerId: input.issuerId,
      installments: input.installments,
      payer: { ...input.payer, ...(plan.firstName ? { firstName: plan.firstName } : {}) },
      externalReference: row.order_id,
      attempt: row.attempt,
      idempotencyKey: `${row.order_id}:${row.attempt}`,
      notificationUrl: notificationUrlFor(ctx, tenantId),
      applicationFeeCents: row.application_fee_cents,
      deviceId: input.deviceId,
    });
  } catch (err) {
    markConnectionLater(d, tenantId, err, tok);
    const code = err instanceof ProviderError ? err.code : 'unavailable';
    payLog.error({ err, orderId: row.order_id, attempt: row.attempt }, 'card payment failed');
    // unavailable: MP may have taken it — the `creating` row stays for the job to look up, and
    // the next submit waits out CARD_SUBMIT_GRACE_MS before it may charge another token
    if (code === 'unavailable')
      throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
        reason: code,
      });
    await withTenant(d.sql, tenantId, async (tx) => {
      await tx`
        update payments set status = 'cancelled', status_detail = ${`create_${code}`}, updated_at = now()
        where id = ${row.id} and status = 'creating'
      `;
      await syncOrderPayment(tx, tenantId, row.order_id);
    });
    // MP refuses a bad, expired or reused token with a 400: the shopper re-types the card
    if (code === 'invalid') return { kind: 'declined', reason: 'card_data' };
    throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'online payment is unavailable right now', {
      reason: code,
    });
  }
  const held = await recordAttempt(d, tenantId, row, {
    provider_payment_id: p.id,
    status: forward('creating', p.status),
    status_detail: p.statusDetail,
  });
  if (held.status === 'rejected' || held.status === 'cancelled')
    return { kind: 'declined', reason: declineReason(held.status_detail) };
  if (held.status === 'pending' && p.id === held.provider_payment_id && p.challenge)
    return { kind: 'challenge', url: p.challenge.url, creq: p.challenge.creq };
  return { kind: 'none' };
}

/**
 * Refetch an open attempt from the provider (outside any tx) and apply it. Down → keep ours, and
 * answer false: the caller must not act as if MP had nothing.
 */
async function syncAttempt(d: PayDeps, tenantId: string, tok: StoreToken, row: PaymentRow) {
  let p: ProviderPayment | null;
  try {
    p = row.provider_payment_id
      ? await d.provider.getPayment(tok.token, row.provider_payment_id)
      : await d.provider.findPayment(tok.token, row.order_id);
  } catch (err) {
    if (!(err instanceof ProviderError && err.code === 'not_found')) {
      markConnectionLater(d, tenantId, err, tok);
      payLog.warn({ err, paymentId: row.id }, 'payment sync failed');
    }
    return false;
  }
  if (p) await withTenant(d.sql, tenantId, (tx) => applyProviderPayment(tx, tenantId, p));
  return true;
}

/** The connection is gone: a Pix order becomes today's static Pix (or pay on delivery). */
async function degradeToOffline(tx: Sql, tenantId: string, orderId: string): Promise<PayNext> {
  const order = (
    await tx<{ number: number; total_cents: number }[]>`
      select number, total_cents from orders where tenant_id = ${tenantId} and id = ${orderId} for update
    `
  )[0]!;
  const settings = (
    await tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenantId}`
  )[0];
  const payment = offlinePayment(settings ?? null, 'pix', order.total_cents, order.number);
  await tx`
    update orders set payment = ${tx.json(payment as never)}, rev = rev + 1, updated_at = now()
    where tenant_id = ${tenantId} and id = ${orderId}
  `;
  await tx`select pg_notify(${ORDER_CHANNEL}, ${orderId})`;
  await emitAdminTx(tx, tenantId, 'order.changed', orderId);
  return payment.pix
    ? { kind: 'pix', copyPaste: payment.pix.copyPaste, expiresAt: null }
    : { kind: 'none' };
}

/**
 * Cancelling an order: its unpaid attempts stop being payable at MP (best effort — a payment
 * that still lands on a cancelled order is refunded automatically) and here.
 */
export async function cancelOpenAttempts(d: PayDeps, tenantId: string, orderId: string) {
  const { rows, tok } = await withTenant(d.sql, tenantId, async (tx) => ({
    rows: await tx<PaymentRow[]>`
      select * from payments where tenant_id = ${tenantId} and order_id = ${orderId}
        and status in ('creating', 'pending') and review is null
    `,
    tok: await tokenFor(tx, tenantId, d.sessionSecret, { read: true }),
  }));
  if (!rows.length) return;
  const ext = d.provider as unknown as Expirable;
  if (tok && tok.provider === d.provider.name)
    for (const r of rows) {
      try {
        if (r.provider_payment_id) await d.provider.cancelPayment(tok.token, r.provider_payment_id);
        else if (r.provider_checkout_id)
          await ext.expireCheckout?.(tok.token, r.provider_checkout_id);
      } catch (err) {
        payLog.warn({ err, paymentId: r.id }, 'could not cancel the attempt at the provider');
      }
    }
  await withTenant(d.sql, tenantId, async (tx) => {
    await tx`
      update payments set status = 'cancelled', status_detail = 'order_cancelled', updated_at = now()
      where id = any(${rows.map((r) => r.id)}) and status in ('creating', 'pending')
    `;
  });
}

/**
 * Derives orders.payment from the attempt rows and writes it when it moved: `rev` bumps (the live
 * order version), the shopper's page and the admin wake. No change → no write, so replays are free.
 */
export async function syncOrderPayment(
  tx: Sql,
  tenantId: string,
  orderId: string,
): Promise<{ changed: boolean; status: string | null }> {
  const cur = (
    await tx<{ number: number; payment: Record<string, unknown> }[]>`
      select number, payment from orders where tenant_id = ${tenantId} and id = ${orderId}
    `
  )[0];
  if (!cur) return { changed: false, status: null };
  // an amount that doesn't match the order never counts as this order's payment
  const rows = await tx<PaymentRow[]>`
    select * from payments where tenant_id = ${tenantId} and order_id = ${orderId}
      and review is distinct from 'amount_mismatch'
    order by attempt
  `;
  if (!rows.length) return { changed: false, status: String(cur.payment.status ?? '') };
  const settled = rows.filter((r) => SETTLED.includes(r.status));
  // an order that fell back to offline keeps the store's own Pix until money actually lands
  if (cur.payment.online !== true && !settled.length)
    return { changed: false, status: String(cur.payment.status ?? '') };
  const latest = rows[rows.length - 1]!;
  const refunded = rows.reduce((s, r) => s + r.refunded_cents, 0);
  let status: string;
  if (settled.some((r) => r.status === 'charged_back')) status = 'charged_back';
  else if (settled.some((r) => r.status === 'in_mediation')) status = 'in_mediation';
  else if (settled.length) {
    const captured = settled.reduce((s, r) => s + r.amount_cents, 0);
    status = refunded >= captured ? 'refunded' : refunded > 0 ? 'partially_refunded' : 'paid';
  } else if (OPEN.includes(latest.status)) status = 'pending';
  else if (latest.status === 'expired') status = 'expired';
  else status = 'failed';
  const approved = settled
    .map((r) => r.approved_at)
    .filter((a): a is Date => !!a)
    .map((a) => new Date(a).getTime());
  const lastPix = [...rows].reverse().find((r) => r.kind === 'pix' && r.pix_copy_paste);
  const patch: Record<string, unknown> = {
    status,
    paidAt: approved.length ? new Date(Math.min(...approved)).toISOString() : null,
    refundedCents: refunded,
    pix:
      lastPix && !settled.length && latest.kind === 'pix'
        ? {
            copyPaste: lastPix.pix_copy_paste,
            expiresAt: lastPix.pix_expires_at
              ? new Date(lastPix.pix_expires_at).toISOString()
              : null,
          }
        : null,
    redirectUrl:
      latest.kind === 'card' && OPEN.includes(latest.status) && !latest.provider_payment_id
        ? latest.redirect_url
        : null,
  };
  // money that landed makes the order online again, even one that fell back to offline meanwhile
  if (settled.length) Object.assign(patch, { online: true, provider: settled[0]!.provider });
  const same = Object.entries(patch).every(
    ([k, v]) => JSON.stringify(cur.payment[k] ?? null) === JSON.stringify(v),
  );
  if (same) return { changed: false, status };
  await tx`
    update orders set payment = payment || ${tx.json(patch as never)}, rev = rev + 1, updated_at = now()
    where tenant_id = ${tenantId} and id = ${orderId}
  `;
  await tx`select pg_notify(${ORDER_CHANNEL}, ${orderId})`;
  await emitAdminTx(tx, tenantId, 'order.changed', orderId);
  // the "Pix recebido" push: once, when money first lands on this order
  if (patch.paidAt && !cur.payment.paidAt) {
    await emitAdminTx(tx, tenantId, 'payment.received', orderId);
    await recordOrderStep(
      tx,
      tenantId,
      { id: orderId, number: cur.number },
      'paid',
      settled[0]!.provider,
    );
    await enqueueOrderMessageTx(tx, tenantId, orderId, 'paid');
  }
  return { changed: true, status };
}

/**
 * Pending refunds against what the provider says was refunded in total: covered ones are
 * approved (oldest first). With `release`, a reservation of another request that never reached
 * MP and isn't covered is rejected, so it stops holding the refundable amount; a refund MP took
 * but never confirmed is released after a day.
 */
export async function reconcileRefunds(
  tx: Sql,
  paymentId: string,
  providerRefunded: number,
  release?: { exceptKey: string },
) {
  const refunds = await tx<
    {
      id: string;
      amount_cents: number;
      status: string;
      provider_refund_id: string | null;
      request_key: string | null;
      created_at: Date;
    }[]
  >`
    select id, amount_cents, status, provider_refund_id, request_key, created_at
    from payment_refunds where payment_id = ${paymentId} order by created_at, id for update
  `;
  let room =
    providerRefunded -
    refunds.filter((r) => r.status === 'approved').reduce((s, r) => s + r.amount_cents, 0);
  const now = Date.now();
  for (const r of refunds) {
    if (r.status !== 'pending') continue;
    if (r.amount_cents <= room) {
      room -= r.amount_cents;
      await tx`update payment_refunds set status = 'approved', updated_at = now() where id = ${r.id}`;
    } else if (
      (!r.provider_refund_id &&
        release &&
        r.request_key !== release.exceptKey &&
        now - new Date(r.created_at).getTime() > 5 * 60_000) ||
      (r.provider_refund_id && now - new Date(r.created_at).getTime() > 86_400_000)
    ) {
      await tx`update payment_refunds set status = 'rejected', updated_at = now() where id = ${r.id}`;
    }
  }
}

/**
 * Money landed on an order that was already paid (a 3DS card finished after its replacement, a
 * hosted checkout paid while the form replaced it, a Pix paid twice): the merchant refunds one
 * from the order, the team hears of it. Call when `row` has just become settled.
 */
async function flagIfPaidTwice(tx: Sql, tenantId: string, row: PaymentRow) {
  const paidBefore = await tx`
    select 1 from payments where tenant_id = ${tenantId} and order_id = ${row.order_id} and id <> ${row.id}
      and status = any(${SETTLED}) and review is distinct from 'amount_mismatch' limit 1
  `;
  if (!paidBefore.length) return;
  await markReview(tx, tenantId, row, 'paid_twice');
  const info = (
    await tx<{ name: string; number: number }[]>`
      select t.name, o.number from tenants t join orders o on o.tenant_id = t.id
      where t.id = ${tenantId} and o.id = ${row.order_id}
    `
  )[0];
  await recordStaffEventTx(
    tx,
    'payment.problem',
    {
      orderId: row.order_id,
      number: info?.number ?? null,
      storeName: info?.name ?? '',
      status: 'paid_twice',
      amountCents: row.amount_cents,
    },
    { tenantId, dedupeKey: `payment:${row.id}:paid_twice` },
  );
}

export type ApplyResult =
  | { applied: true; orderId: string; changed: boolean; paymentRowId: string; closed: boolean }
  | { applied: false; reason: 'collector' | 'reference' | 'amount' | 'attempts' | 'conflict' };

/**
 * One provider payment, freshly fetched, onto its attempt row and order. Only payments into the
 * store's own account for one of its orders, for the order's exact amount, count. Idempotent:
 * replays find nothing new; statuses only move forward; refunds only grow.
 */
export async function applyProviderPayment(
  tx: Sql,
  tenantId: string,
  p: ProviderPayment,
  opts: { release?: { exceptKey: string } } = {},
): Promise<ApplyResult> {
  const conn = await loadConnection(tx, tenantId);
  if (!conn || !p.collectorId || p.collectorId !== conn.provider_user_id) {
    payLog.warn({ tenantId, paymentId: p.id }, 'payment for another account ignored');
    return { applied: false, reason: 'collector' };
  }
  const orderId = p.externalReference ?? '';
  if (!UUID_RE.test(orderId)) return { applied: false, reason: 'reference' };
  const order = (
    await tx<{ id: string; number: number; total_cents: number; state: string }[]>`
      select id, number, total_cents, state from orders where tenant_id = ${tenantId} and id = ${orderId} for update
    `
  )[0];
  if (!order) return { applied: false, reason: 'reference' };
  const kind = p.kind === 'pix' ? 'pix' : 'card';
  const maxAttempt = async () =>
    (
      await tx<{ n: number | null }[]>`
        select max(attempt) as n from payments where tenant_id = ${tenantId} and order_id = ${orderId}
      `
    )[0]!.n ?? 0;
  let row = (
    await tx<PaymentRow[]>`
      select * from payments where tenant_id = ${tenantId} and provider = ${conn.provider}
        and provider_payment_id = ${p.id} for update
    `
  )[0];

  if (p.amountCents !== order.total_cents) {
    // checked before anything attaches: it never pins an attempt, and money that landed is kept
    // on record for a person, not dropped
    payLog.error(
      { tenantId, orderId, paymentId: p.id, amount: p.amountCents, want: order.total_cents },
      'payment amount does not match the order',
    );
    if (!row && SETTLED.includes(p.status) && p.amountCents > 0) {
      const n = await maxAttempt();
      if (n < MAX_ATTEMPTS)
        row =
          (
            await bindsProviderId(
              tx,
              (sp) => sp<PaymentRow[]>`
                insert into payments (tenant_id, order_id, provider, provider_payment_id, kind, status,
                  amount_cents, approved_at, attempt, review)
                values (${tenantId}, ${orderId}, ${conn.provider}, ${p.id}, ${kind}, ${p.status},
                  ${p.amountCents}, ${p.approvedAt ? new Date(p.approvedAt) : null}, ${n + 1}, 'amount_mismatch')
                returning *
              `,
            )
          )?.[0] ?? undefined;
    } else if (row) {
      const status = forward(row.status, p.status === 'pending' ? 'cancelled' : p.status);
      await tx`update payments set status = ${status}, review = 'amount_mismatch', updated_at = now() where id = ${row.id}`;
    }
    if (row) {
      await syncOrderPayment(tx, tenantId, orderId);
      await emitAdminTx(tx, tenantId, 'store');
    }
    return { applied: false, reason: 'amount' };
  }

  if (!row) {
    // An in-page card payment names its attempt. Anything else (a Pix, a hosted checkout) takes
    // the latest open attempt that isn't an in-page card submit — or the hosted checkout the form
    // superseded, which MP can still settle — never a card submit whose own answer is pending.
    row = (
      p.attempt != null
        ? await tx<PaymentRow[]>`
            select * from payments where tenant_id = ${tenantId} and order_id = ${orderId}
              and attempt = ${p.attempt} and kind = 'card' and provider_payment_id is null
              and review is null and status in ('creating', 'pending')
            for update
          `
        : await tx<PaymentRow[]>`
            select * from payments where tenant_id = ${tenantId} and order_id = ${orderId}
              and kind = ${kind} and provider_payment_id is null and review is null
              and status_detail is distinct from ${CARD_FORM}
              and (status in ('creating', 'pending') or (status = 'cancelled' and status_detail = 'superseded'))
            order by attempt desc limit 1 for update
          `
    )[0];
    if (row) {
      const id = row.id;
      if (
        !(await bindsProviderId(
          tx,
          (sp) => sp`update payments set provider_payment_id = ${p.id} where id = ${id}`,
        ))
      )
        return { applied: false, reason: 'conflict' };
      row = { ...row, provider_payment_id: p.id };
    }
  }
  if (!row) {
    const n = await maxAttempt();
    if (n >= MAX_ATTEMPTS || p.amountCents <= 0) return { applied: false, reason: 'attempts' };
    const inserted = await bindsProviderId(
      tx,
      (sp) => sp<PaymentRow[]>`
        insert into payments (tenant_id, order_id, provider, provider_payment_id, kind, status, amount_cents, attempt)
        values (${tenantId}, ${orderId}, ${conn.provider}, ${p.id}, ${kind}, 'pending', ${p.amountCents}, ${n + 1})
        returning *
      `,
    );
    if (!inserted?.[0]) return { applied: false, reason: 'conflict' };
    row = inserted[0];
  }
  const status = forward(row.status, p.status);
  const refunded = Math.min(row.amount_cents, Math.max(row.refunded_cents, p.refundedCents));
  const next = {
    status,
    status_detail: p.statusDetail?.slice(0, 120) ?? null,
    refunded_cents: refunded,
    provider_fee_cents: p.providerFeeCents ?? row.provider_fee_cents,
    net_cents: p.netCents ?? row.net_cents,
    application_fee_cents: p.applicationFeeCents || row.application_fee_cents,
    approved_at: p.approvedAt ? new Date(p.approvedAt) : row.approved_at,
    pix_copy_paste: p.pix?.copyPaste?.slice(0, 1000) ?? row.pix_copy_paste,
    pix_expires_at: p.pix?.expiresAt ? new Date(p.pix.expiresAt) : row.pix_expires_at,
    // a fresh fetch settles what we could not verify before
    review: row.review === 'unverified' ? null : row.review,
  };
  const t = (d: Date | null) => (d ? new Date(d).getTime() : null);
  const moved =
    next.status !== row.status ||
    next.status_detail !== row.status_detail ||
    next.refunded_cents !== row.refunded_cents ||
    next.provider_fee_cents !== row.provider_fee_cents ||
    next.net_cents !== row.net_cents ||
    next.application_fee_cents !== row.application_fee_cents ||
    t(next.approved_at) !== t(row.approved_at) ||
    next.pix_copy_paste !== row.pix_copy_paste ||
    t(next.pix_expires_at) !== t(row.pix_expires_at) ||
    next.review !== row.review;
  if (moved)
    await tx`
      update payments set status = ${next.status}, status_detail = ${next.status_detail},
        refunded_cents = ${next.refunded_cents}, provider_fee_cents = ${next.provider_fee_cents},
        net_cents = ${next.net_cents}, application_fee_cents = ${next.application_fee_cents},
        approved_at = ${next.approved_at}, pix_copy_paste = ${next.pix_copy_paste},
        pix_expires_at = ${next.pix_expires_at}, review = ${next.review}, updated_at = now()
      where id = ${row.id}
    `;
  await reconcileRefunds(tx, row.id, p.refundedCents, opts.release);
  if (SETTLED.includes(next.status) && !SETTLED.includes(row.status) && next.review === null)
    await flagIfPaidTwice(tx, tenantId, { ...row, review: null });
  if (next.status !== row.status && PROBLEMS.includes(next.status)) {
    // a refund the store asked for through us is not a problem; one made at the provider is
    const asked =
      next.status === 'refunded' &&
      (
        await tx<{ n: number }[]>`
          select coalesce(sum(amount_cents), 0)::int as n from payment_refunds
          where payment_id = ${row.id} and status <> 'rejected'
        `
      )[0]!.n >= next.refunded_cents;
    if (!asked) {
      const store = (
        await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`
      )[0];
      await recordStaffEventTx(
        tx,
        'payment.problem',
        {
          orderId,
          number: order.number,
          storeName: store?.name ?? '',
          status: next.status,
          amountCents: row.amount_cents,
        },
        { tenantId, dedupeKey: `payment:${row.id}:${next.status}` },
      );
    }
  }
  const synced = await syncOrderPayment(tx, tenantId, orderId);
  return {
    applied: true,
    orderId,
    changed: moved || synced.changed,
    paymentRowId: row.id,
    closed: order.state === 'cancelled' || order.state === 'refunded',
  };
}

/**
 * The shared path for "the provider says payment X moved" (verified webhook, dev settle, job):
 * fetch it with the store's token outside any tx, then apply. A store without a usable token
 * can't verify it: the attempt is flagged for review instead of silently dropped. Throws only on
 * `unavailable`, so a webhook answers 5xx and MP retries.
 */
export async function processStorePayment(
  d: PayDeps,
  tenantId: string,
  providerPaymentId: string,
): Promise<ApplyResult | { applied: false; reason: 'not_connected' | 'not_found' }> {
  const tok = await withTenant(d.sql, tenantId, (tx) =>
    tokenFor(tx, tenantId, d.sessionSecret, { read: true }),
  );
  const unverified = () =>
    withTenant(d.sql, tenantId, async (tx) => {
      const row = (
        await tx<PaymentRow[]>`
          select * from payments where tenant_id = ${tenantId} and provider_payment_id = ${providerPaymentId}
        `
      )[0];
      // any attempt we didn't see settle — open, or cancelled here while still payable at MP
      if (row && !SETTLED.includes(row.status)) await markReview(tx, tenantId, row, 'unverified');
      else if (!row)
        payLog.error(
          { tenantId, providerPaymentId },
          'unverifiable payment event for an unknown payment',
        );
      return { applied: false as const, reason: 'not_connected' as const };
    });
  if (!tok || tok.provider !== d.provider.name) return unverified();
  let p: ProviderPayment;
  try {
    p = await d.provider.getPayment(tok.token, providerPaymentId);
  } catch (err) {
    if (err instanceof ProviderError && err.code !== 'unavailable') {
      markConnectionLater(d, tenantId, err, tok);
      if (err.code === 'not_found') return { applied: false, reason: 'not_found' };
      return unverified();
    }
    throw err;
  }
  return withTenant(d.sql, tenantId, (tx) => applyProviderPayment(tx, tenantId, p));
}

/** GET /orders/:id `payments` (admin). */
export async function orderPayments(tx: Sql, tenantId: string, orderId: string) {
  return tx<
    {
      id: string;
      kind: string;
      status: string;
      amountCents: number;
      refundedCents: number;
      refundableCents: number;
      providerFeeCents: number | null;
      netCents: number | null;
      approvedAt: string | null;
      createdAt: string;
      review: string | null;
      refunds: { amountCents: number; status: string; reason: string | null; createdAt: string }[];
    }[]
  >`
    select p.id, p.kind, p.status, p.amount_cents as "amountCents", p.refunded_cents as "refundedCents",
           case when p.status in ('approved', 'partially_refunded') and p.provider_payment_id is not null
                  and p.review is distinct from 'amount_mismatch'
             then greatest(0, p.amount_cents - greatest(p.refunded_cents,
               coalesce((select sum(r.amount_cents) from payment_refunds r
                         where r.payment_id = p.id and r.status <> 'rejected'), 0)))
             else 0 end::int as "refundableCents",
           p.provider_fee_cents as "providerFeeCents", p.net_cents as "netCents",
           p.approved_at as "approvedAt", p.created_at as "createdAt", p.review,
           coalesce((select json_agg(json_build_object('amountCents', r.amount_cents, 'status', r.status,
                              'reason', r.reason, 'createdAt', r.created_at) order by r.created_at)
                     from payment_refunds r where r.payment_id = p.id), '[]'::json) as refunds
    from payments p where p.tenant_id = ${tenantId} and p.order_id = ${orderId}
    order by p.attempt desc
  `;
}

/** Pagamentos: money a person has to look at. */
export async function paymentReviews(tx: Sql, tenantId: string) {
  return tx<
    {
      paymentId: string;
      orderId: string;
      orderNumber: number;
      reason: string;
      status: string;
      amountCents: number;
      at: string;
    }[]
  >`
    select p.id as "paymentId", p.order_id as "orderId", o.number as "orderNumber", p.review as reason,
           p.status, p.amount_cents as "amountCents", p.updated_at as at
    from payments p join orders o on o.id = p.order_id
    where p.tenant_id = ${tenantId} and p.review is not null
    order by p.updated_at desc limit 50
  `;
}
