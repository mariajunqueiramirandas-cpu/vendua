import type { MerchantNotify } from '../../admin/context.ts';
import { emitAdminTx } from '../../admin/live.ts';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { recordStaffEventTx, type StaffEventMap } from '../staff-events.ts';
import { notifyStaff, type StaffNotice } from '../staff.ts';
import {
  ProviderError,
  type PaymentProvider,
  type SubscriptionRequest,
} from '../payments/provider.ts';
import {
  billingLog,
  DAY_MS,
  hookUrl,
  issuePix,
  payerEmailFor,
  pixIsLive,
  supersedePix,
  upsertInvoice,
  viaProvider,
  type BillingMethod,
  type DropPix,
  type InvoiceRow,
} from './invoices.ts';
import {
  cancelledMessage,
  cancelScheduledMessage,
  chargeFailedMessage,
  dayMonth,
  queueOwners,
} from './notices.ts';
import { formatBRL, planRow, tenantPlan, type PlanRow } from './plans.ts';

// The plan's state machine (docs/roadmap.md, Phase 3). One subscriptions row per store:
//   pending ─(first invoice paid / first card charge)→ active ─(period ended unpaid)→ past_due
//   active|past_due ─(cancel)→ cancel_at_period_end ─(period end, jobs.ts)→ cancelled
// Money is only ever the plan's price_cents (or what the provider says it charged).

/** provision_store()'s pause: a self-serve store opens when its plan is paid */
export const OPENING_MESSAGE = 'A loja abre em breve.';
/** the pause a cancelled plan leaves behind */
export const CLOSED_MESSAGE = 'A loja está fechada no momento.';
/** the pix renewal goes out this long before the period ends */
export const RENEW_AHEAD_MS = 5 * DAY_MS;
/** below this, a mid-period upgrade isn't charged apart: it waits for the period end instead */
export const UPGRADE_MIN_CENTS = 100;

/**
 * What an upgrade costs for the rest of the paid period: the price difference × time left /
 * period length, in integer cents rounded half-up.
 */
export function proratedCents(diffCents: number, start: Date, end: Date, now: Date): number {
  if (diffCents <= 0) return 0;
  const period = Math.max(1, end.getTime() - start.getTime());
  const left = Math.min(period, Math.max(0, end.getTime() - now.getTime()));
  const p = BigInt(period);
  return Number((2n * BigInt(diffCents) * BigInt(left) + p) / (2n * p));
}

export interface SubRow {
  tenant_id: string;
  plan_id: string;
  pending_plan_id: string | null;
  pending_plan_at: Date | null;
  charge_cents: number | null;
  method: BillingMethod;
  status: 'pending' | 'trialing' | 'active' | 'past_due' | 'cancelled';
  provider: string;
  provider_subscription_id: string | null;
  checkout_url: string | null;
  payer_email: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  /** an upgrade waiting for its pro-rata invoice (plan_id stays the paid plan until then) */
  upgrade_plan_id: string | null;
  upgrade_invoice_id: string | null;
  /** set by a trial (ADR 0025) and kept after it: the owner's phone has had its trial */
  trial_ends_at: Date | null;
  trial_reminded: string[];
  created_at: Date;
  status_changed_at: Date;
}

export interface BillingCtx {
  sql: Sql;
  provider: PaymentProvider;
  notify: MerchantNotify;
  /** `https://<admin host>` — webhook and return URLs; null in jobs without VENDUA_ADMIN_HOST */
  origin: string | null;
  /** side effects that must not run inside the tx (staff messages) */
  later: (fn: () => Promise<unknown>) => void;
}

/** Tests swap this to see staff notices; production goes through notifyStaff. */
export const billingStaff = {
  notify: (sql: Sql, notice: StaffNotice): Promise<unknown> => notifyStaff(sql, null, notice),
};

async function storeName(tx: Sql, tenantId: string) {
  return (
    (await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`)[0]?.name ??
    tenantId
  );
}

/** An invoice the team marks paid in the CRM (access code: no Mercado Pago). */
export async function recordManualInvoice(tx: Sql, inv: InvoiceRow, planName: string) {
  await recordStaffEventTx(
    tx,
    'billing.manual',
    {
      storeName: await storeName(tx, inv.tenant_id),
      invoiceId: inv.id,
      amountCents: inv.amount_cents,
      plan: planName,
    },
    { tenantId: inv.tenant_id, dedupeKey: `billing.manual:${inv.id}` },
  );
}

/** One event per `key` (an invoice, a period, a payment): a replay or a sweep adds nothing. */
export async function recordBillingProblem(
  tx: Sql,
  tenantId: string,
  problem: StaffEventMap['billing.problem']['problem'],
  detail: string,
  key: string,
) {
  await recordStaffEventTx(
    tx,
    'billing.problem',
    { storeName: await storeName(tx, tenantId), problem, detail },
    { tenantId, dedupeKey: `billing.problem:${tenantId}:${problem}:${key}` },
  );
}

/** `later` for request paths: after the handler returns (its tx commits right after). */
export const afterResponse = (fn: () => Promise<unknown>) => {
  setTimeout(() => void fn().catch((err) => billingLog.warn({ err }, 'billing effect failed')), 0);
};

/** Run `work`, then its queued effects — for webhooks, jobs and signup (we own the tx). */
export async function withEffects<T>(
  base: Omit<BillingCtx, 'later'>,
  work: (ctx: BillingCtx) => Promise<T>,
): Promise<T> {
  const effects: (() => Promise<unknown>)[] = [];
  const out = await work({ ...base, later: (fn) => void effects.push(fn) });
  for (const fn of effects)
    await fn().catch((err) => billingLog.warn({ err }, 'billing effect failed'));
  return out;
}

/**
 * Serializes billing per store. A row lock alone isn't enough: `for update` on a store with no
 * subscription row yet locks nothing, and two starts would each create an assinatura.
 */
export async function lockBilling(tx: Sql, tenantId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`billing:${tenantId}`}, 0))`;
}

export async function lockSub(tx: Sql, tenantId: string): Promise<SubRow | null> {
  await lockBilling(tx, tenantId);
  return (
    (await tx<SubRow[]>`select * from subscriptions where tenant_id = ${tenantId} for update`)[0] ??
    null
  );
}

async function planOrThrow(tx: Sql, id: string): Promise<PlanRow> {
  const p = await planRow(tx, id);
  if (!p) throw new Error(`plan ${id} missing`);
  return p;
}

async function setTenantPlan(tx: Sql, tenantId: string, planId: string) {
  await tx`update tenants set plan = ${planId} where id = ${tenantId} and plan is distinct from ${planId}`;
}

/** the next charge's plan: a waiting downgrade, else the current one */
export const chargePlanId = (sub: SubRow) => sub.pending_plan_id ?? sub.plan_id;

// ── starting ────────────────────────────────────────────────────────────────

export type PayNext =
  | { kind: 'card'; url: string }
  | { kind: 'pix'; invoiceId: string }
  /** the team confirms this invoice by hand (CRM → Lojas); no charge was sent to the provider */
  | { kind: 'manual'; invoiceId: string }
  /** a free trial: the store is open and nothing is charged until `endsAt` (ADR 0025) */
  | { kind: 'trial'; endsAt: string };

/** A store without a subscription (or a cancelled one) starts one: pending until paid. */
export async function startSubscription(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  o: {
    plan: PlanRow;
    method: BillingMethod;
    payerEmail: string | null;
    key: string;
    now: Date;
    manual?: boolean;
  },
): Promise<PayNext> {
  const existing = await lockSub(tx, tenantId);
  if (existing && existing.status !== 'cancelled')
    throw new HttpError(409, 'SUBSCRIPTION_EXISTS', 'this store already has a plan subscription');
  // a restart never carries the old preapproval, period or pending downgrade
  const sub = (
    await tx<SubRow[]>`
      insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email)
      values (${tenantId}, ${o.plan.id}, ${o.method}, 'pending', ${ctx.provider.name}, ${o.payerEmail})
      on conflict (tenant_id) do update set
        plan_id = excluded.plan_id, pending_plan_id = null, method = excluded.method,
        status = 'pending', provider = excluded.provider, provider_subscription_id = null,
        checkout_url = null, payer_email = excluded.payer_email, current_period_start = null,
        current_period_end = null, cancel_at_period_end = false, upgrade_plan_id = null,
        upgrade_invoice_id = null, updated_at = now(), status_changed_at = now()
      returning *
    `
  )[0]!;
  // a legacy store keeps its pilot plan until the first payment; a catalog store moves now
  if (await planRow(tx, (await currentTenantPlan(tx, tenantId)) ?? ''))
    await setTenantPlan(tx, tenantId, o.plan.id);
  const next = await beginPayment(ctx, tx, sub, o.key, o.now, { manual: o.manual });
  await emitAdminTx(tx, tenantId, 'billing');
  return next;
}

/**
 * A new store on a plan with a trial (ADR 0025): open at once, nothing charged until the trial
 * ends. The trial is the first period, so the first Pix invoice and a card's first charge fall
 * on its end like any renewal; the payment method starts as the monthly Pix (no card asked).
 */
export async function startTrial(
  tx: Sql,
  tenantId: string,
  o: { plan: PlanRow; payerEmail: string | null; provider: string; now: Date; phone: string },
): Promise<PayNext> {
  const endsAt = new Date(o.now.getTime() + o.plan.trial_days * DAY_MS);
  // trial_phone: the phone that took it keeps it taken, whatever its role in the store becomes
  await tx`
    insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                               current_period_start, current_period_end, trial_ends_at, trial_phone)
    values (${tenantId}, ${o.plan.id}, 'pix', 'trialing', ${o.provider}, ${o.payerEmail},
            ${o.now}, ${endsAt}, ${endsAt}, ${o.phone})
  `;
  await setTenantPlan(tx, tenantId, o.plan.id);
  await releaseHold(tx, tenantId);
  await emitAdminTx(tx, tenantId, 'billing');
  return { kind: 'trial', endsAt: endsAt.toISOString() };
}

async function currentTenantPlan(tx: Sql, tenantId: string) {
  return (await tx<{ plan: string }[]>`select plan from tenants where id = ${tenantId}`)[0]?.plan;
}

/** The first payment of a pending subscription: invoice #n + Pix, or the MP assinatura. Manual:
 *  the invoice only, with no Pix — the team marks it paid in the CRM. */
export async function beginPayment(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  key: string,
  now: Date,
  o: { manual?: boolean | undefined } = {},
): Promise<PayNext> {
  const plan = await planOrThrow(tx, sub.plan_id);
  const payerEmail = await payerEmailFor(tx, sub.tenant_id, sub.payer_email);
  if (!payerEmail)
    throw new HttpError(422, 'PAYER_EMAIL_REQUIRED', 'type the email the charge goes to', {
      field: 'payerEmail',
    });
  if (sub.method === 'pix' || o.manual) {
    const reuse = (
      await tx<InvoiceRow[]>`
        select * from invoices where tenant_id = ${sub.tenant_id} and status in ('open', 'failed')
          and kind = 'period'
        order by number desc limit 1
      `
    )[0];
    let inv = await upsertInvoice(tx, {
      tenantId: sub.tenant_id,
      provider: ctx.provider.name,
      drop: dropPix(ctx),
      start: reuse ? reuse.period_start : now,
      planId: plan.id,
      amountCents: plan.price_cents,
      method: 'pix',
      dueAt: now,
      reuse: reuse ?? null,
    });
    if (o.manual) {
      await recordManualInvoice(tx, inv, plan.name);
      return { kind: 'manual', invoiceId: inv.id };
    }
    if (!pixIsLive(inv, now))
      inv = await viaProvider(() =>
        issuePix(tx, ctx.provider, inv, {
          payerEmail,
          planName: plan.name,
          origin: ctx.origin,
          now,
          drop: dropPix(ctx),
        }),
      );
    return { kind: 'pix', invoiceId: inv.id };
  }
  if (sub.checkout_url && sub.provider_subscription_id)
    return { kind: 'card', url: sub.checkout_url };
  const url = await createPreapproval(ctx, tx, sub, plan, payerEmail, key);
  return { kind: 'card', url };
}

async function createPreapproval(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  plan: PlanRow,
  payerEmail: string,
  key: string,
): Promise<string> {
  if (!ctx.origin) throw new Error('card subscriptions need the admin origin');
  const now = Date.now();
  // switching to card mid-period (or during the trial): the first charge waits for its end
  const paidUntil =
    (sub.status === 'active' || sub.status === 'past_due' || sub.status === 'trialing') &&
    sub.current_period_end &&
    sub.current_period_end.getTime() > now
      ? sub.current_period_end
      : undefined;
  const req: SubscriptionRequest = {
    reason: plan.name,
    amountCents: plan.price_cents,
    payerEmail,
    externalReference: sub.tenant_id,
    backUrl: `${ctx.origin}/admin/?assinatura=retorno`,
    notificationUrl: hookUrl(ctx.origin),
    idempotencyKey: `preapproval:${sub.tenant_id}:${key}`.slice(0, 120),
    startDate: paidUntil ?? null,
  };
  const ps = await viaProvider(() => ctx.provider.createSubscription(req));
  const url = ps.redirectUrl ?? `${ctx.origin}/admin/conta`;
  const prior = (
    await tx<{ provider_subscription_id: string | null }[]>`
      select provider_subscription_id from subscriptions where tenant_id = ${sub.tenant_id}
    `
  )[0]?.provider_subscription_id;
  await tx`
    update subscriptions set provider_subscription_id = ${ps.id}, checkout_url = ${url},
      provider = ${ctx.provider.name}, charge_cents = ${plan.price_cents}, updated_at = now()
    where tenant_id = ${sub.tenant_id}
  `;
  // a superseded assinatura must never charge
  if (prior && prior !== ps.id) await viaProvider(() => stopPreapproval(ctx, prior, 'cancelled'));
  return url;
}

/** The MP assinatura charges `cents` from its next charge on; recorded so the jobs can re-sync. */
export async function setChargeAmount(ctx: BillingCtx, tx: Sql, sub: SubRow, cents: number) {
  if (sub.method !== 'card' || !sub.provider_subscription_id) return;
  await viaProvider(() =>
    ctx.provider.updateSubscription(sub.provider_subscription_id!, { amountCents: cents }),
  );
  await tx`update subscriptions set charge_cents = ${cents} where tenant_id = ${sub.tenant_id}`;
}

export const dropPix =
  (ctx: BillingCtx): DropPix =>
  (id) =>
    ctx.later(async () => {
      try {
        await ctx.provider.platformCancelPayment(id);
      } catch (err) {
        // already paid (it still settles its invoice), expired or gone — nothing to stop
        billingLog.info({ err, payment: id }, 'superseded Pix not cancelled');
      }
    });

/** Best effort: a preapproval we no longer use must stop charging. */
async function stopPreapproval(ctx: BillingCtx, id: string | null, status: 'cancelled' | 'paused') {
  if (!id) return;
  try {
    await ctx.provider.updateSubscription(id, { status });
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'not_found') return;
    throw err;
  }
}

// ── the pix renewal ─────────────────────────────────────────────────────────

/**
 * The next period's Pix invoice, once the period is within RENEW_AHEAD_MS of its end (or
 * past it). Null when it isn't time, the plan is ending, or the store pays by card.
 * `issue: false` leaves the Pix to the caller (the jobs issue it outside the lock).
 */
export async function ensureRenewal(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  now: Date,
  o: { issue?: boolean } = {},
): Promise<InvoiceRow | null> {
  if (sub.method !== 'pix' || sub.cancel_at_period_end || !sub.current_period_end) return null;
  // a trial is a free first period: its end is when the first paid month starts
  if (sub.status !== 'active' && sub.status !== 'past_due' && sub.status !== 'trialing')
    return null;
  if (sub.current_period_end.getTime() - now.getTime() > RENEW_AHEAD_MS) return null;
  const plan = await planOrThrow(tx, chargePlanId(sub));
  let inv = await upsertInvoice(tx, {
    tenantId: sub.tenant_id,
    provider: ctx.provider.name,
    drop: dropPix(ctx),
    start: sub.current_period_end,
    planId: plan.id,
    amountCents: plan.price_cents,
    method: 'pix',
    dueAt: sub.current_period_end,
  });
  if (o.issue !== false && inv.status === 'open' && !pixIsLive(inv, now)) {
    const payerEmail = await payerEmailFor(tx, sub.tenant_id, sub.payer_email);
    if (payerEmail)
      inv = await issuePix(tx, ctx.provider, inv, {
        payerEmail,
        planName: plan.name,
        origin: ctx.origin,
        now,
        drop: dropPix(ctx),
      });
  }
  return inv;
}

/** Re-issue the Pix of one open invoice (expired, or never issued). */
export async function reissuePix(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  invoiceId: string,
  now: Date,
) {
  const sub = await lockSub(tx, tenantId);
  const inv = (
    await tx<
      InvoiceRow[]
    >`select * from invoices where tenant_id = ${tenantId} and id = ${invoiceId}`
  )[0];
  if (!inv) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'invoice not found');
  if (
    inv.status !== 'open' ||
    inv.method !== 'pix' ||
    (inv.kind === 'upgrade' && (!sub || !upgradeLive(sub, inv, now)))
  )
    throw new HttpError(409, 'INVOICE_NOT_OPEN', 'only an open Pix invoice gets a new Pix');
  if (pixIsLive(inv, now)) return inv;
  const payerEmail = await payerEmailFor(tx, tenantId, sub?.payer_email);
  if (!payerEmail)
    throw new HttpError(422, 'PAYER_EMAIL_REQUIRED', 'type the email the charge goes to', {
      field: 'payerEmail',
    });
  // a pack's Pix keeps the pack's description, not the plan's month
  const label =
    inv.kind === 'ai_pack'
      ? `Duá ${(await aiPackRow(tx, inv.ai_pack_id!))?.name ?? inv.ai_pack_id}`
      : (await planOrThrow(tx, inv.plan_id)).name;
  const out = await viaProvider(() =>
    issuePix(tx, ctx.provider, inv, {
      payerEmail,
      planName: label,
      origin: ctx.origin,
      now,
      drop: dropPix(ctx),
    }),
  );
  await emitAdminTx(tx, tenantId, 'billing');
  return out;
}

// ── changing ────────────────────────────────────────────────────────────────

/** unpaid invoices for the next charge: the first one (pending), or the renewal */
async function unpaidAhead(tx: Sql, sub: SubRow) {
  return tx<InvoiceRow[]>`
    select * from invoices where tenant_id = ${sub.tenant_id} and status in ('open', 'failed')
      and kind = 'period'
      ${sub.status === 'pending' || !sub.current_period_end ? tx`` : tx`and period_start >= ${sub.current_period_end}`}
    order by number
  `;
}

/** An already-issued next invoice follows a price change (its old Pix is dropped). */
async function repriceAhead(ctx: BillingCtx, tx: Sql, sub: SubRow, plan: PlanRow, now: Date) {
  for (const inv of await unpaidAhead(tx, sub)) {
    if (inv.plan_id === plan.id && inv.amount_cents === plan.price_cents) continue;
    const hadPix = !!inv.pix_copy_paste;
    let next = await upsertInvoice(tx, {
      tenantId: sub.tenant_id,
      provider: ctx.provider.name,
      drop: dropPix(ctx),
      start: inv.period_start,
      planId: plan.id,
      amountCents: plan.price_cents,
      method: inv.method,
      dueAt: inv.due_at,
      reuse: inv,
    });
    if (hadPix && next.method === 'pix') {
      const payerEmail = await payerEmailFor(tx, sub.tenant_id, sub.payer_email);
      if (payerEmail)
        next = await viaProvider(() =>
          issuePix(tx, ctx.provider, next, {
            payerEmail,
            planName: plan.name,
            origin: ctx.origin,
            now,
            drop: dropPix(ctx),
          }),
        );
    }
  }
}

// ── a mid-period upgrade ────────────────────────────────────────────────────

/** the pending upgrade's invoice is still payable: open, current, its period not over, and
 *  priced for the period the store is in (a renewal paid first moves the period on, and the
 *  difference was only ever computed for the old one) */
export function upgradeLive(sub: SubRow, inv: InvoiceRow, at: Date) {
  return (
    sub.upgrade_invoice_id === inv.id &&
    !!sub.upgrade_plan_id &&
    (sub.status === 'active' || sub.status === 'past_due') &&
    inv.status === 'open' &&
    inv.period_end.getTime() > at.getTime() &&
    inv.period_end.getTime() === sub.current_period_end?.getTime()
  );
}

async function upgradeInvoice(tx: Sql, sub: SubRow): Promise<InvoiceRow | null> {
  if (!sub.upgrade_invoice_id) return null;
  return (
    (
      await tx<InvoiceRow[]>`
        select * from invoices where tenant_id = ${sub.tenant_id} and id = ${sub.upgrade_invoice_id}
      `
    )[0] ?? null
  );
}

/** Another plan change, a cancel or the period's end: the unpaid upgrade never applies. */
export async function cancelPendingUpgrade(ctx: BillingCtx, tx: Sql, sub: SubRow) {
  if (!sub.upgrade_plan_id && !sub.upgrade_invoice_id) return;
  const inv = await upgradeInvoice(tx, sub);
  if (inv && inv.status === 'open') {
    // its Pix ids stay on the row: a late payment still finds it (and goes to the team)
    await tx`update invoices set status = 'void' where id = ${inv.id}`;
    if (inv.provider_payment_id) dropPix(ctx)(inv.provider_payment_id);
  }
  await tx`
    update subscriptions set upgrade_plan_id = null, upgrade_invoice_id = null, updated_at = now()
    where tenant_id = ${sub.tenant_id}
  `;
}

async function upgradePix(ctx: BillingCtx, tx: Sql, sub: SubRow, inv: InvoiceRow, now: Date) {
  const payerEmail = await payerEmailFor(tx, sub.tenant_id, sub.payer_email);
  if (!payerEmail)
    throw new HttpError(422, 'PAYER_EMAIL_REQUIRED', 'type the email the charge goes to', {
      field: 'payerEmail',
    });
  const plan = await planOrThrow(tx, inv.plan_id);
  return viaProvider(() =>
    issuePix(tx, ctx.provider, inv, {
      payerEmail,
      planName: plan.name,
      origin: ctx.origin,
      now,
      drop: dropPix(ctx),
    }),
  );
}

/**
 * The difference for the rest of the paid period, as a one-off Pix invoice (card stores too:
 * the assinatura only charges whole months). The plan changes when it is paid.
 */
async function startUpgrade(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  current: PlanRow,
  target: PlanRow,
  amountCents: number,
  now: Date,
) {
  const inv = (
    await tx<InvoiceRow[]>`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                            method, status, provider, due_at, kind)
      values (${sub.tenant_id},
              (select coalesce(max(number), 0) + 1 from invoices where tenant_id = ${sub.tenant_id}),
              ${target.id}, ${amountCents}, ${now}, ${sub.current_period_end}, 'pix', 'open',
              ${ctx.provider.name}, ${now}, 'upgrade')
      returning *
    `
  )[0]!;
  await tx`
    update subscriptions set upgrade_plan_id = ${target.id}, upgrade_invoice_id = ${inv.id},
      pending_plan_id = null, pending_plan_at = null, updated_at = now()
    where tenant_id = ${sub.tenant_id}
  `;
  // a downgrade that was waiting is dropped: the next charge is the current plan again
  if (sub.pending_plan_id) {
    await setChargeAmount(ctx, tx, sub, current.price_cents);
    await repriceAhead(ctx, tx, { ...sub, pending_plan_id: null }, current, now);
  }
  await upgradePix(ctx, tx, sub, inv, now);
}

export interface AiPackRow {
  id: string;
  name: string;
  price_cents: number;
  conversations: number;
  public: boolean;
  sort: number;
}

export async function aiPackRow(tx: Sql, id: string): Promise<AiPackRow | null> {
  if (!/^[a-z0-9_]{2,30}$/.test(id)) return null;
  return (await tx<AiPackRow[]>`select * from ai_packs where id = ${id}`)[0] ?? null;
}

export async function publicAiPacks(tx: Sql) {
  const rows = await tx<
    AiPackRow[]
  >`select * from ai_packs where public order by sort, price_cents`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    conversations: r.conversations,
  }));
}

/**
 * More Vendedor conversations (ADR 0032): a one-off Pix invoice for the pack; the conversations
 * land when it is paid. Only on a paid plan that has the Vendedor — a trial has its own allowance.
 * One open pack invoice at a time: asking again returns it, with a fresh Pix if it lapsed.
 */
export async function buyAiPack(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  packId: unknown,
  now: Date,
): Promise<InvoiceRow> {
  const sub = await lockSub(tx, tenantId);
  const pack = typeof packId === 'string' ? await aiPackRow(tx, packId) : null;
  if (!pack || !pack.public)
    throw new HttpError(422, 'UNKNOWN_AI_PACK', 'pick one of the packs offered', {
      field: 'packId',
    });
  if (!(await tenantPlan(tx, tenantId)).features.vendedor)
    throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include the Vendedor", {
      feature: 'vendedor',
    });
  if (!sub || (sub.status !== 'active' && sub.status !== 'past_due'))
    throw new HttpError(409, 'AI_PACK_NEEDS_PAID_PLAN', 'packs are sold once the plan is paid');
  const open = (
    await tx<InvoiceRow[]>`
      select * from invoices where tenant_id = ${tenantId} and kind = 'ai_pack' and status = 'open'
      order by created_at desc limit 1
    `
  )[0];
  if (
    open &&
    open.ai_pack_id === pack.id &&
    open.amount_cents === pack.price_cents &&
    open.ai_conversations === pack.conversations
  )
    return pixIsLive(open, now) ? open : await packPix(ctx, tx, sub, open, pack, now);
  // another pack (or an old price) waiting: it gives way to this one
  if (open) await voidOpenPack(ctx, tx, open);
  const inv = (
    await tx<InvoiceRow[]>`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                            method, status, provider, due_at, kind, ai_pack_id, ai_conversations)
      values (${tenantId},
              (select coalesce(max(number), 0) + 1 from invoices where tenant_id = ${tenantId}),
              ${sub.plan_id}, ${pack.price_cents}, ${now}, ${now}, 'pix', 'open',
              ${ctx.provider.name}, ${now}, 'ai_pack', ${pack.id}, ${pack.conversations})
      returning *
    `
  )[0]!;
  return packPix(ctx, tx, sub, inv, pack, now);
}

async function packPix(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  inv: InvoiceRow,
  pack: AiPackRow,
  now: Date,
) {
  const payerEmail = await payerEmailFor(tx, sub.tenant_id, sub.payer_email);
  if (!payerEmail)
    throw new HttpError(422, 'PAYER_EMAIL_REQUIRED', 'type the email the charge goes to', {
      field: 'payerEmail',
    });
  return viaProvider(() =>
    issuePix(tx, ctx.provider, inv, {
      payerEmail,
      planName: `Duá ${pack.name}`,
      origin: ctx.origin,
      now,
      drop: dropPix(ctx),
    }),
  );
}

async function voidOpenPack(ctx: BillingCtx, tx: Sql, inv: InvoiceRow) {
  if (inv.provider_payment_id) dropPix(ctx)(inv.provider_payment_id);
  await tx`
    update invoices set status = 'void', ${supersedePix(tx)}
    where id = ${inv.id} and status = 'open'
  `;
}

/** A pack invoice was paid: what it promised when bought joins the store's, once per invoice. */
async function creditAiPack(tx: Sql, tenantId: string, inv: InvoiceRow) {
  await tx`
    insert into ai_credits (tenant_id, invoice_id, conversations)
    values (${tenantId}, ${inv.id}, ${inv.ai_conversations!})
    on conflict (invoice_id) do nothing
  `;
}

/** The upgrade invoice was paid: the plan moves now, and so do the charges ahead. */
async function applyUpgrade(ctx: BillingCtx, tx: Sql, sub: SubRow, inv: InvoiceRow, now: Date) {
  const current = await planOrThrow(tx, sub.plan_id);
  const target = await planOrThrow(tx, sub.upgrade_plan_id!);
  await tx`
    update subscriptions set plan_id = ${target.id}, pending_plan_id = null, pending_plan_at = null,
      upgrade_plan_id = null, upgrade_invoice_id = null, updated_at = now()
    where tenant_id = ${sub.tenant_id}
  `;
  await setTenantPlan(tx, sub.tenant_id, target.id);
  const after = (
    await tx<SubRow[]>`select * from subscriptions where tenant_id = ${sub.tenant_id}`
  )[0]!;
  try {
    // the money is in: a provider hiccup here is caught up by the jobs (syncPlanPrices)
    await setChargeAmount(ctx, tx, after, target.price_cents);
    await repriceAhead(ctx, tx, after, target, now);
  } catch (err) {
    if (!(err instanceof ProviderError || err instanceof HttpError)) throw err;
    billingLog.warn({ err, invoice: inv.id }, 'upgrade paid; next charge not repriced yet');
  }
  if (target.features?.customSite && !current.features?.customSite)
    await openSiteRequest(ctx, tx, sub.tenant_id);
}

export async function changeSubscription(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  o: {
    plan?: PlanRow | undefined;
    method?: BillingMethod | undefined;
    payerEmail?: string | undefined;
    key: string;
    now: Date;
  },
): Promise<{ before: SubRow; after: SubRow }> {
  let sub = await lockSub(tx, tenantId);
  if (!sub || sub.status === 'cancelled')
    throw new HttpError(409, 'NO_SUBSCRIPTION', 'start a plan subscription first');
  const before = sub;
  const reload = async () => (sub = (await lockSub(tx, tenantId))!);

  if (o.payerEmail !== undefined && o.payerEmail !== sub.payer_email) {
    await tx`update subscriptions set payer_email = ${o.payerEmail}, updated_at = now() where tenant_id = ${tenantId}`;
    await reload();
  }

  let upgradeWaits = false;
  if (o.plan && (sub.upgrade_plan_id || sub.upgrade_invoice_id)) {
    const inv = await upgradeInvoice(tx, sub);
    if (o.plan.id === sub.upgrade_plan_id && inv && upgradeLive(sub, inv, o.now)) {
      upgradeWaits = true;
      if (!pixIsLive(inv, o.now)) await upgradePix(ctx, tx, sub, inv, o.now);
    } else {
      await cancelPendingUpgrade(ctx, tx, sub);
      await reload();
    }
  }

  if (o.plan && !upgradeWaits && o.plan.id !== chargePlanId(sub)) {
    const target = o.plan;
    const current = await planOrThrow(tx, sub.plan_id);
    const card = sub.method === 'card' && sub.provider_subscription_id;
    const unpaid = sub.status === 'pending' || sub.status === 'trialing';
    const upgradeCents =
      !unpaid && sub.current_period_end && target.price_cents > current.price_cents
        ? proratedCents(
            target.price_cents - current.price_cents,
            sub.current_period_start ?? new Date(sub.current_period_end.getTime() - 30 * DAY_MS),
            sub.current_period_end,
            o.now,
          )
        : 0;
    if (target.id === sub.plan_id) {
      // back to the current plan: the waiting downgrade is dropped
      await tx`update subscriptions set pending_plan_id = null, updated_at = now() where tenant_id = ${tenantId}`;
      if (card) await setChargeAmount(ctx, tx, sub, current.price_cents);
      await repriceAhead(ctx, tx, await reload(), current, o.now);
    } else if (unpaid || !sub.current_period_end) {
      // nothing paid yet (a trial keeps running): the plan applies now and the first charge
      // is at its price
      await tx`
        update subscriptions set plan_id = ${target.id}, pending_plan_id = null, updated_at = now()
        where tenant_id = ${tenantId}
      `;
      if (sub.status !== 'pending' || (await planRow(tx, (await currentTenantPlan(tx, tenantId))!)))
        await setTenantPlan(tx, tenantId, target.id);
      if (card) await setChargeAmount(ctx, tx, sub, target.price_cents);
      await repriceAhead(ctx, tx, await reload(), target, o.now);
    } else if (upgradeCents >= UPGRADE_MIN_CENTS) {
      await startUpgrade(ctx, tx, sub, current, target, upgradeCents, o.now);
    } else {
      // a downgrade (or an upgrade too small to charge apart) waits for the period end; the
      // next charge already uses its price
      await tx`
        update subscriptions set pending_plan_id = ${target.id},
          pending_plan_at = ${sub.current_period_end}, updated_at = now()
        where tenant_id = ${tenantId}
      `;
      if (card) await setChargeAmount(ctx, tx, sub, target.price_cents);
      await repriceAhead(ctx, tx, await reload(), target, o.now);
    }
  }

  if (o.method && o.method !== sub.method) {
    const oldPreapproval = sub.method === 'card' ? sub.provider_subscription_id : null;
    await tx`
      update subscriptions set method = ${o.method}, provider_subscription_id = null,
        checkout_url = null, updated_at = now()
      where tenant_id = ${tenantId}
    `;
    await reload();
    if (o.method === 'pix') {
      await viaProvider(() => stopPreapproval(ctx, oldPreapproval, 'cancelled'));
      // unpaid card charges become the Pix invoice for the same period
      for (const inv of await unpaidAhead(tx, sub))
        await tx`
          update invoices set method = 'pix', status = 'open', provider_payment_id = null
          where id = ${inv.id}
        `;
      if (sub.status === 'pending') await beginPayment(ctx, tx, sub, o.key, o.now);
      else await viaProvider(() => ensureRenewal(ctx, tx, sub!, o.now));
    } else {
      // the card takes over: an unpaid Pix is withdrawn (one paid meanwhile still counts)
      for (const inv of await unpaidAhead(tx, sub)) {
        if (inv.method === 'pix' && inv.provider_payment_id) dropPix(ctx)(inv.provider_payment_id);
        await tx`
          update invoices set status = 'void', pix_copy_paste = null, pix_expires_at = null
          where id = ${inv.id}
        `;
      }
      const plan = await planOrThrow(tx, chargePlanId(sub));
      const payerEmail = await payerEmailFor(tx, tenantId, sub.payer_email);
      if (!payerEmail)
        throw new HttpError(422, 'PAYER_EMAIL_REQUIRED', 'type the email the charge goes to', {
          field: 'payerEmail',
        });
      await createPreapproval(ctx, tx, sub, plan, payerEmail, o.key);
    }
  }
  await emitAdminTx(tx, tenantId, 'billing');
  return { before, after: (await lockSub(tx, tenantId))! };
}

export async function cancelSubscription(ctx: BillingCtx, tx: Sql, tenantId: string) {
  const sub = await lockSub(tx, tenantId);
  if (!sub || sub.status === 'cancelled')
    throw new HttpError(409, 'NO_SUBSCRIPTION', 'there is no plan subscription to cancel');
  if (sub.status === 'pending') {
    // nothing was paid: it ends now (a self-serve store stays behind its hold)
    await tx`
      update subscriptions set status = 'cancelled', cancel_at_period_end = false,
        checkout_url = null, updated_at = now(), status_changed_at = now()
      where tenant_id = ${tenantId}
    `;
    await tx`update invoices set status = 'void' where tenant_id = ${tenantId} and status in ('open', 'failed')`;
    if (sub.method === 'card')
      await viaProvider(() => stopPreapproval(ctx, sub.provider_subscription_id, 'cancelled'));
    await noticeCancelled(ctx, tx, sub, false);
  } else if (!sub.cancel_at_period_end) {
    await tx`
      update subscriptions set cancel_at_period_end = true, updated_at = now()
      where tenant_id = ${tenantId}
    `;
    for (const inv of await unpaidAhead(tx, sub))
      await tx`update invoices set status = 'void' where id = ${inv.id}`;
    await cancelPendingUpgrade(ctx, tx, sub);
    // paused, not cancelled: "voltar atrás" before the period ends re-authorizes the same card
    if (sub.method === 'card')
      await viaProvider(() => stopPreapproval(ctx, sub.provider_subscription_id, 'paused'));
    await noticeCancelScheduled(ctx, tx, sub);
  }
  await emitAdminTx(tx, tenantId, 'billing');
  return sub;
}

export async function resumeSubscription(ctx: BillingCtx, tx: Sql, tenantId: string, now: Date) {
  const sub = await lockSub(tx, tenantId);
  if (!sub || !sub.cancel_at_period_end || sub.status === 'cancelled')
    throw new HttpError(409, 'NOT_CANCELLING', 'the plan is not set to end');
  await tx`update subscriptions set cancel_at_period_end = false, updated_at = now() where tenant_id = ${tenantId}`;
  const next = { ...sub, cancel_at_period_end: false };
  if (sub.method === 'card' && sub.provider_subscription_id)
    await viaProvider(() =>
      ctx.provider.updateSubscription(sub.provider_subscription_id!, { status: 'authorized' }),
    );
  else await viaProvider(() => ensureRenewal(ctx, tx, next, now));
  await emitAdminTx(tx, tenantId, 'billing');
  return sub;
}

// ── money landed ────────────────────────────────────────────────────────────

/**
 * An invoice was paid (Pix approved, or the card charge for its period). Idempotent: a paid
 * invoice is never paid twice. The first payment activates the plan and opens the store.
 * `method` overrides the invoice's for the team's event ('manual': marked paid in the CRM).
 */
export async function markInvoicePaid(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  invoiceId: string,
  paidAt: Date,
  now: Date,
  o: { method?: string } = {},
): Promise<boolean> {
  const sub = await lockSub(tx, tenantId);
  const inv = (
    await tx<InvoiceRow[]>`
      update invoices set status = 'paid', paid_at = ${paidAt}
      where tenant_id = ${tenantId} and id = ${invoiceId} and status <> 'paid'
      returning *
    `
  )[0];
  if (!inv || !sub) return false;
  if (inv.kind === 'ai_pack') {
    await creditAiPack(tx, tenantId, inv);
  } else if (inv.kind === 'upgrade') {
    if (upgradeLive(sub, { ...inv, status: 'open' }, paidAt))
      await applyUpgrade(ctx, tx, sub, inv, now);
    else {
      const t = (
        await tx<
          { name: string; slug: string }[]
        >`select name, slug from tenants where id = ${tenantId}`
      )[0];
      const body = `A fatura ${inv.number} (diferença de plano, ${formatBRL(inv.amount_cents)}) da loja ${t?.name} (${t?.slug}) foi paga depois de cancelada ou vencida. O plano não mudou: devolva pelo Mercado Pago.`;
      ctx.later(() =>
        billingStaff.notify(ctx.sql, {
          subject: `Upgrade pago fora do prazo: ${t?.name ?? tenantId}`,
          body,
          idemKey: `invoice-upgrade-late:${inv.id}`,
        }),
      );
      await recordBillingProblem(tx, tenantId, 'pix_mismatch', body, `upgrade-late:${inv.id}`);
    }
  } else if (sub.status === 'pending' || sub.status === 'cancelled') {
    await activate(ctx, tx, sub, inv, paidAt);
  } else {
    const end = sub.current_period_end?.getTime() ?? 0;
    if (inv.period_end.getTime() > end) {
      await tx`
        update subscriptions set status = 'active', current_period_start = ${inv.period_start},
          current_period_end = ${inv.period_end}, updated_at = now(),
          status_changed_at = case when status = 'active' then status_changed_at else now() end
        where tenant_id = ${tenantId}
      `;
      // a trial's first payment is the plan's first: a plan with the site, chosen during it, gets its site now
      if (sub.status === 'trialing' && (await planRow(tx, sub.plan_id))?.features?.customSite)
        await openSiteRequest(ctx, tx, tenantId);
    }
    if (downgradeDue(sub, inv.period_start, now))
      await applyPendingPlan(ctx, tx, tenantId, sub.pending_plan_id!);
  }
  await recordPaid(tx, tenantId, inv, o.method ?? inv.method);
  await emitAdminTx(tx, tenantId, 'billing', inv.id);
  return true;
}

/** The team hears of every payment; the store's first one also moves its onboarding card. */
async function recordPaid(tx: Sql, tenantId: string, inv: InvoiceRow, method: string) {
  const first = (
    await tx<{ first: boolean }[]>`
      select not exists (
        select 1 from invoices where tenant_id = ${tenantId} and status = 'paid' and id <> ${inv.id}
      ) as first
    `
  )[0]!.first;
  await recordStaffEventTx(
    tx,
    'billing.paid',
    {
      storeName: await storeName(tx, tenantId),
      invoiceId: inv.id,
      amountCents: inv.amount_cents,
      first,
      method,
      plan:
        inv.kind === 'ai_pack'
          ? `${(await aiPackRow(tx, inv.ai_pack_id!))?.name ?? inv.ai_pack_id} (Duá)`
          : ((await planRow(tx, inv.plan_id))?.name ?? inv.plan_id),
    },
    { tenantId, dedupeKey: `billing.paid:${inv.id}` },
  );
  if (first)
    await recordStaffEventTx(
      tx,
      'store.onboarding',
      { step: 'paid' },
      { tenantId, dedupeKey: `onboarding:${tenantId}:paid` },
    );
}

async function activate(ctx: BillingCtx, tx: Sql, sub: SubRow, inv: InvoiceRow, paidAt: Date) {
  const tenantId = sub.tenant_id;
  // the paid month counts from the payment, not from when the invoice was issued
  await tx`
    update invoices set period_start = ${paidAt}, period_end = ${paidAt}::timestamptz + interval '1 month'
    where id = ${inv.id} and not exists (
      select 1 from invoices o where o.tenant_id = ${tenantId} and o.period_start = ${paidAt} and o.id <> ${inv.id}
    )
  `;
  await tx`
    update subscriptions set status = 'active', pending_plan_id = null, checkout_url = null,
      cancel_at_period_end = false, current_period_start = ${paidAt},
      current_period_end = ${paidAt}::timestamptz + interval '1 month',
      updated_at = now(), status_changed_at = now()
    where tenant_id = ${tenantId}
  `;
  await setTenantPlan(tx, tenantId, sub.plan_id);
  await releaseHold(tx, tenantId);
  const plan = await planRow(tx, sub.plan_id);
  if (plan?.features?.customSite) await openSiteRequest(ctx, tx, tenantId);
}

/** The plan is paid: billing_hold off and our own pause (opening or cancelled) lifted. */
export async function releaseHold(tx: Sql, tenantId: string) {
  await tx`
    update store_settings set
      billing_hold = false,
      status_override = case when status_override = 'paused'
        and pause_message in (${OPENING_MESSAGE}, ${CLOSED_MESSAGE}) then null else status_override end,
      resumes_at = case when status_override = 'paused'
        and pause_message in (${OPENING_MESSAGE}, ${CLOSED_MESSAGE}) then null else resumes_at end,
      pause_message = case when status_override = 'paused'
        and pause_message in (${OPENING_MESSAGE}, ${CLOSED_MESSAGE}) then null else pause_message end
    where tenant_id = ${tenantId}
  `;
  await emitAdminTx(tx, tenantId, 'store');
}

/** The plan ended: the store closes behind billing_hold until a plan is paid again. */
export async function applyHold(tx: Sql, tenantId: string) {
  await tx`
    update store_settings set billing_hold = true, status_override = 'paused',
      pause_message = ${CLOSED_MESSAGE}, resumes_at = null
    where tenant_id = ${tenantId}
  `;
  await emitAdminTx(tx, tenantId, 'store');
}

/** the downgrade's moment has come and the store's paid period reaches past it */
export function downgradeDue(sub: SubRow, periodStart: Date | null, now: Date) {
  return (
    !!sub.pending_plan_id &&
    !!sub.pending_plan_at &&
    !!periodStart &&
    sub.pending_plan_at.getTime() <= now.getTime() &&
    periodStart.getTime() >= sub.pending_plan_at.getTime()
  );
}

export async function applyPendingPlan(ctx: BillingCtx, tx: Sql, tenantId: string, planId: string) {
  const before = await currentTenantPlan(tx, tenantId);
  await tx`
    update subscriptions set plan_id = ${planId}, pending_plan_id = null, pending_plan_at = null,
      updated_at = now()
    where tenant_id = ${tenantId}
  `;
  await setTenantPlan(tx, tenantId, planId);
  // an upgrade too small to charge apart lands here, after a period at its price was paid
  const [from, to] = [await planRow(tx, before ?? ''), await planRow(tx, planId)];
  if (to?.features?.customSite && !from?.features?.customSite)
    await openSiteRequest(ctx, tx, tenantId);
}

/** Pangolim comes with a site made by our agent: one open request per store, and the team hears. */
export async function openSiteRequest(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  brief: string | null = null,
) {
  const row = (
    await tx<{ id: string }[]>`
      insert into site_requests (tenant_id, brief) values (${tenantId}, ${brief})
      on conflict (tenant_id) where status in ('requested', 'in_progress') do nothing
      returning id
    `
  )[0];
  if (!row) return null;
  const t = (
    await tx<
      { name: string; slug: string }[]
    >`select name, slug from tenants where id = ${tenantId}`
  )[0];
  ctx.later(() =>
    billingStaff.notify(ctx.sql, {
      subject: `Site sob medida: ${t?.name ?? tenantId}`,
      body: `A loja ${t?.name} (${t?.slug}) tem um plano com site sob medida e um pedido de site aberto.${brief ? `\n\n${brief}` : ''}`,
      idemKey: `site-request:${row.id}`,
    }),
  );
  await recordStaffEventTx(
    tx,
    'store.request',
    { storeName: t?.name ?? tenantId, title: 'site sob medida', detail: brief },
    { tenantId, dedupeKey: `store.request:site:${row.id}` },
  );
  await emitAdminTx(tx, tenantId, 'billing');
  return row.id;
}

/**
 * A card charge from the MP assinatura: the invoice for its period is created when missing,
 * then paid or failed. Replays (same authorized-payment id) change nothing.
 */
export async function recordCardCharge(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  charge: { id: string; status: 'approved' | 'rejected'; amountCents: number; date: Date },
  now: Date,
) {
  const sub = await lockSub(tx, tenantId);
  if (!sub) return;
  let inv = (
    await tx<InvoiceRow[]>`
      select * from invoices where tenant_id = ${tenantId} and provider = ${ctx.provider.name}
        and provider_payment_id = ${charge.id}
    `
  )[0];
  if (inv?.status === 'paid') return;
  // a replayed rejection: already recorded and told
  if (inv?.status === 'failed' && charge.status === 'rejected') return;
  if (!inv) {
    if (sub.status === 'pending' || sub.status === 'cancelled' || !sub.current_period_end) {
      const reuse = (
        await tx<InvoiceRow[]>`
          select * from invoices where tenant_id = ${tenantId} and status in ('open', 'failed')
            and kind = 'period'
          order by number desc limit 1
        `
      )[0];
      inv = await upsertInvoice(tx, {
        tenantId,
        provider: ctx.provider.name,
        drop: dropPix(ctx),
        start: reuse?.period_start ?? charge.date,
        planId: sub.plan_id,
        amountCents: charge.amountCents,
        method: 'card',
        dueAt: charge.date,
        reuse: reuse ?? null,
      });
    } else {
      let start = sub.current_period_end;
      const taken = (
        await tx<InvoiceRow[]>`
          select * from invoices where tenant_id = ${tenantId} and period_start = ${start}
        `
      )[0];
      if (taken?.status === 'paid') start = taken.period_end;
      inv = await upsertInvoice(tx, {
        tenantId,
        provider: ctx.provider.name,
        drop: dropPix(ctx),
        start,
        planId: chargePlanId(sub),
        amountCents: charge.amountCents,
        method: 'card',
        dueAt: start,
      });
    }
  }
  await tx`
    update invoices set ${supersedePix(tx)}, provider_payment_id = ${charge.id}, method = 'card',
      amount_cents = ${charge.amountCents}, pix_copy_paste = null, pix_expires_at = null,
      status = ${charge.status === 'approved' ? 'open' : 'failed'}
    where id = ${inv.id}
  `;
  if (charge.status === 'approved')
    await markInvoicePaid(ctx, tx, tenantId, inv.id, charge.date, now);
  else {
    await emitAdminTx(tx, tenantId, 'billing', inv.id);
    const plan = await planOrThrow(tx, inv.plan_id);
    queueOwners(
      ctx,
      tenantId,
      chargeFailedMessage(plan.name, charge.amountCents, ctx.origin),
      `billing:charge_failed:${charge.id}`,
    );
    // once per invoice: MP's retries of the same month stay one event
    await recordBillingProblem(
      tx,
      tenantId,
      'card_rejected',
      `A cobrança de ${formatBRL(charge.amountCents)} no cartão (plano ${plan.name}) não foi aprovada.`,
      inv.id,
    );
  }
}

/** MP says what the assinatura itself is now (authorized, cancelled…). */
export async function syncPreapproval(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  providerId: string,
  status: 'pending' | 'authorized' | 'paused' | 'cancelled',
) {
  await lockBilling(tx, tenantId);
  const sub = (
    await tx<SubRow[]>`
      select * from subscriptions where tenant_id = ${tenantId}
        and provider_subscription_id = ${providerId} for update
    `
  )[0];
  if (!sub) return;
  if (status === 'authorized') {
    // the card is set: nothing left to open
    if (sub.checkout_url)
      await tx`update subscriptions set checkout_url = null, updated_at = now() where tenant_id = ${tenantId}`;
  } else if (status === 'cancelled') {
    if (sub.status === 'pending') {
      await tx`
        update subscriptions set status = 'cancelled', checkout_url = null, updated_at = now(),
          status_changed_at = now()
        where tenant_id = ${tenantId}
      `;
      await tx`update invoices set status = 'void' where tenant_id = ${tenantId} and status in ('open', 'failed')`;
      await noticeCancelled(ctx, tx, sub, false, 'mercadopago');
    } else if (sub.status !== 'cancelled' && !sub.cancel_at_period_end) {
      // cancelled on MP's side: the paid period is still the store's, then it ends (jobs.ts)
      await tx`update subscriptions set cancel_at_period_end = true, updated_at = now() where tenant_id = ${tenantId}`;
      await noticeCancelScheduled(ctx, tx, sub, 'mercadopago');
    }
  } else return;
  await emitAdminTx(tx, tenantId, 'billing');
}

export { stopPreapproval };

type CancelledBy = 'owner' | 'mercadopago';

const cancelledBy = (by: CancelledBy, planName: string) =>
  by === 'owner'
    ? `O lojista cancelou o plano ${planName}`
    : `A assinatura do plano ${planName} foi cancelada no Mercado Pago`;

// The team's event is keyed by the period (or, before any payment, the subscription's start),
// so a replayed webhook or a re-run sweep never repeats it.
export async function noticeCancelScheduled(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  by: CancelledBy = 'owner',
) {
  const plan = await planOrThrow(tx, sub.plan_id);
  queueOwners(
    ctx,
    sub.tenant_id,
    cancelScheduledMessage(plan.name, sub.current_period_end, ctx.origin),
    `billing:cancel_scheduled:${sub.tenant_id}:${Date.now()}`,
  );
  const until = sub.current_period_end
    ? `; vale até ${dayMonth(sub.current_period_end)}, depois a loja fecha`
    : '';
  await recordBillingProblem(
    tx,
    sub.tenant_id,
    'cancelled',
    `${cancelledBy(by, plan.name)}${until}.`,
    `scheduled:${(sub.current_period_end ?? sub.status_changed_at).toISOString()}`,
  );
}

export async function noticeCancelled(
  ctx: BillingCtx,
  tx: Sql,
  sub: SubRow,
  closed: boolean,
  by: CancelledBy = 'owner',
) {
  const plan = await planOrThrow(tx, sub.plan_id);
  queueOwners(
    ctx,
    sub.tenant_id,
    cancelledMessage(plan.name, closed, ctx.origin),
    `billing:cancelled:${sub.tenant_id}:${Date.now()}`,
  );
  await recordBillingProblem(
    tx,
    sub.tenant_id,
    'cancelled',
    closed
      ? `O plano ${plan.name} terminou e a loja está fechada.`
      : `${cancelledBy(by, plan.name)} antes do primeiro pagamento.`,
    closed
      ? `ended:${(sub.current_period_end ?? sub.status_changed_at).toISOString()}`
      : `pending:${sub.status_changed_at.toISOString()}`,
  );
}

/**
 * A Pix landed on Venduá's account for this invoice — the current Pix or any superseded one
 * (external_reference is the invoice id; the payment was read back with our own token). It
 * settles the invoice when it covers the amount; a short one (a QR from before a price rise)
 * leaves it open. Short, over and second payments go to the team (refund or difference by hand).
 */
export async function settlePixPayment(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  invoiceId: string,
  pay: { id: string; amountCents: number; approvedAt: Date },
  now: Date,
) {
  await lockBilling(tx, tenantId);
  const inv = (
    await tx<InvoiceRow[]>`
      select * from invoices where tenant_id = ${tenantId} and id = ${invoiceId} for update
    `
  )[0];
  if (!inv) return false;
  const t = (
    await tx<
      { name: string; slug: string }[]
    >`select name, slug from tenants where id = ${tenantId}`
  )[0];
  const flag = async (subject: string, body: string, key: string) => {
    ctx.later(() => billingStaff.notify(ctx.sql, { subject, body, idemKey: key }));
    await recordBillingProblem(tx, tenantId, 'pix_mismatch', body, key);
  };
  if (inv.status === 'paid') {
    if (inv.provider_payment_id !== pay.id)
      await flag(
        `Fatura paga duas vezes: ${t?.name ?? tenantId}`,
        `A fatura ${inv.number} da loja ${t?.name} (${t?.slug}) já estava paga e recebeu outro Pix (${pay.id}, ${formatBRL(pay.amountCents)}). Confira e devolva pelo Mercado Pago.`,
        `invoice-dup:${pay.id}`,
      );
    return false;
  }
  if (pay.amountCents < inv.amount_cents) {
    // a QR for an older, lower price: the invoice stays open at its amount
    if (!inv.short_payments.includes(pay.id))
      await tx`update invoices set short_payments = array_append(short_payments, ${pay.id}) where id = ${inv.id}`;
    await flag(
      `Pix com valor menor: ${t?.name ?? tenantId}`,
      `A fatura ${inv.number} da loja ${t?.name} (${t?.slug}) é de ${formatBRL(inv.amount_cents)} e recebeu ${formatBRL(pay.amountCents)} (Pix ${pay.id}, emitido antes de uma mudança de preço). A fatura continua em aberto: devolva esse Pix pelo Mercado Pago ou acerte a diferença.`,
      `invoice-amount:${pay.id}`,
    );
    await emitAdminTx(tx, tenantId, 'billing', inv.id);
    return false;
  }
  if (pay.amountCents > inv.amount_cents)
    await flag(
      `Pix com valor diferente: ${t?.name ?? tenantId}`,
      `A fatura ${inv.number} da loja ${t?.name} (${t?.slug}) era de ${formatBRL(inv.amount_cents)} e foi paga com ${formatBRL(pay.amountCents)} (Pix ${pay.id}). A fatura foi dada como paga; devolva a diferença pelo Mercado Pago.`,
      `invoice-amount:${pay.id}`,
    );
  // the attempt that wasn't used can't be paid a second time
  if (inv.provider_payment_id && inv.provider_payment_id !== pay.id)
    dropPix(ctx)(inv.provider_payment_id);
  await tx`
    update invoices set
      ${pay.id === inv.provider_payment_id ? tx`pix_superseded = pix_superseded` : supersedePix(tx)},
      provider_payment_id = ${pay.id}, amount_cents = ${pay.amountCents}
    where id = ${inv.id}
  `;
  return markInvoicePaid(ctx, tx, tenantId, inv.id, pay.approvedAt, now);
}
