import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { ProviderError, type PaymentProvider, type ProviderPayment } from '../payments/provider.ts';

export const billingLog = log.child({ mod: 'billing' });

export const DAY_MS = 86_400_000;
/** a plan Pix stays payable for 3 days; an expired one is issued again (new attempt) */
export const PIX_TTL_MS = 3 * DAY_MS;

export type BillingMethod = 'card' | 'pix';

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  number: number;
  plan_id: string;
  amount_cents: number;
  period_start: Date;
  period_end: Date;
  method: BillingMethod;
  status: 'open' | 'paid' | 'failed' | 'void';
  provider: string;
  provider_payment_id: string | null;
  pix_copy_paste: string | null;
  pix_expires_at: Date | null;
  due_at: Date;
  paid_at: Date | null;
  reminded: string[];
  pix_attempt: number;
  pix_superseded: string[];
  /** 'upgrade': the one-off difference for the rest of a paid period (0062);
   *  'ai_pack': extra Vendedor conversations bought one-off (0083) */
  kind: 'period' | 'upgrade' | 'ai_pack';
  ai_pack_id: string | null;
  /** the pack's conversations as bought */
  ai_conversations: number | null;
  short_payments: string[];
  created_at: Date;
}

/** Provider failures in a request path: the page offers to try again. */
export async function viaProvider<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ProviderError) {
      billingLog.warn({ code: err.code, err: err.message }, 'billing provider call failed');
      throw new HttpError(
        503,
        'BILLING_UNAVAILABLE',
        'the payment provider did not answer — try again',
        {
          provider: err.code,
        },
      );
    }
    throw err;
  }
}

export const hookUrl = (origin: string | null) =>
  origin ? `${origin}/admin/v1/hooks/mercadopago?t=platform` : null;

/**
 * The invoice for the period starting at `start`: an unpaid one is reused (plan, amount and
 * method follow the subscription; a stale Pix is dropped), a missing one gets the next number.
 * (tenant_id, period_start) is unique, so a period is charged at most once. The caller holds
 * the subscription row lock — that serializes numbering per store.
 */
export async function upsertInvoice(
  tx: Sql,
  o: {
    tenantId: string;
    provider: string;
    start: Date;
    planId: string;
    amountCents: number;
    method: BillingMethod;
    dueAt: Date;
    reuse?: InvoiceRow | null;
    /** a Pix this replaces — cancel it at the provider (after commit) */
    drop?: DropPix;
  },
): Promise<InvoiceRow> {
  const existing =
    o.reuse ??
    (
      await tx<InvoiceRow[]>`
        select * from invoices where tenant_id = ${o.tenantId} and period_start = ${o.start}
      `
    )[0];
  if (existing?.status === 'paid') return existing;
  if (existing) {
    const same =
      existing.status === 'open' &&
      existing.amount_cents === o.amountCents &&
      existing.method === o.method;
    if (!same && existing.method === 'pix' && existing.provider_payment_id)
      o.drop?.(existing.provider_payment_id);
    return (
      await tx<InvoiceRow[]>`
        update invoices set
          plan_id = ${o.planId}, amount_cents = ${o.amountCents}, method = ${o.method},
          provider = ${o.provider}, status = 'open',
          period_start = ${o.start}, period_end = ${o.start}::timestamptz + interval '1 month',
          due_at = ${o.dueAt},
          ${same ? tx`pix_superseded = pix_superseded` : supersedePix(tx)},
          provider_payment_id = ${same ? tx`provider_payment_id` : null},
          pix_copy_paste = ${same ? tx`pix_copy_paste` : null},
          pix_expires_at = ${same ? tx`pix_expires_at` : null}
        where id = ${existing.id}
        returning *
      `
    )[0]!;
  }
  return (
    await tx<InvoiceRow[]>`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                            method, status, provider, due_at)
      values (${o.tenantId},
              (select coalesce(max(number), 0) + 1 from invoices where tenant_id = ${o.tenantId}),
              ${o.planId}, ${o.amountCents}, ${o.start}, ${o.start}::timestamptz + interval '1 month',
              ${o.method}, 'open', ${o.provider}, ${o.dueAt})
      returning *
    `
  )[0]!;
}

/**
 * `set` fragment: the current Pix id joins pix_superseded before it's replaced — the old QR
 * stays payable until it expires, and its payment must still find this invoice.
 */
/** best effort, after commit: a superseded Pix is cancelled at the provider (it stays matchable) */
export type DropPix = (providerPaymentId: string) => void;

export const supersedePix = (tx: Sql) => tx`
  pix_superseded = case
    when method = 'pix' and provider_payment_id is not null
      and not (provider_payment_id = any(pix_superseded))
    then array_append(pix_superseded, provider_payment_id) else pix_superseded end
`;

export function pixIsLive(inv: InvoiceRow, now: Date) {
  return (
    !!inv.pix_copy_paste && !!inv.pix_expires_at && inv.pix_expires_at.getTime() > now.getTime()
  );
}

/** Issue (or re-issue) the Pix of an open invoice on Venduá's own account. */
export async function issuePix(
  tx: Sql,
  provider: PaymentProvider,
  inv: InvoiceRow,
  o: { payerEmail: string; planName: string; origin: string | null; now: Date; drop?: DropPix },
): Promise<InvoiceRow> {
  return storePix(
    tx,
    provider,
    inv,
    await requestPix(provider, inv, inv.pix_attempt + 1, o),
    o.drop,
  );
}

export interface PixCharge {
  payment: ProviderPayment;
  attempt: number;
  expiresAt: Date;
}

/** The provider half of issuePix: no row is touched. The attempt keys the request — asking
 *  again with the same attempt gets the same Pix back. */
export async function requestPix(
  provider: PaymentProvider,
  inv: InvoiceRow,
  attempt: number,
  o: { payerEmail: string; planName: string; origin: string | null; now: Date },
): Promise<PixCharge> {
  const expiresAt = new Date(o.now.getTime() + PIX_TTL_MS);
  const payment = await provider.platformPix({
    amountCents: inv.amount_cents,
    description: `${o.planName} — fatura ${inv.number}`,
    payerEmail: o.payerEmail,
    externalReference: inv.id,
    // a retried request (its tx rolled back) repeats the attempt number → the same Pix
    idempotencyKey: `invoice:${inv.id}:${attempt}`,
    notificationUrl: hookUrl(o.origin),
    applicationFeeCents: 0,
    expiresAt,
  });
  return { payment, attempt, expiresAt };
}

/** Records a Pix from requestPix on its invoice; the one it replaces joins pix_superseded. */
export async function storePix(
  tx: Sql,
  provider: PaymentProvider,
  inv: InvoiceRow,
  c: PixCharge,
  drop?: DropPix,
): Promise<InvoiceRow> {
  const p = c.payment;
  if (inv.method === 'pix' && inv.provider_payment_id && inv.provider_payment_id !== p.id)
    drop?.(inv.provider_payment_id);
  return (
    await tx<InvoiceRow[]>`
      update invoices set
        ${p.id === inv.provider_payment_id ? tx`pix_superseded = pix_superseded` : supersedePix(tx)},
        provider = ${provider.name}, provider_payment_id = ${p.id},
        pix_copy_paste = ${p.pix?.copyPaste ?? null},
        pix_expires_at = ${p.pix?.expiresAt ? new Date(p.pix.expiresAt) : c.expiresAt},
        pix_attempt = ${c.attempt}
      where id = ${inv.id}
      returning *
    `
  )[0]!;
}

/** Who the plan Pix/assinatura is billed to: the subscription's payer, else the owner, else the store. */
export async function payerEmailFor(
  tx: Sql,
  tenantId: string,
  payerEmail: string | null | undefined,
): Promise<string | null> {
  if (payerEmail) return payerEmail;
  const row = (
    await tx<{ email: string | null }[]>`
      select coalesce(
        (select email from merchant_users where tenant_id = ${tenantId} and role = 'owner'
           and status = 'active' and email is not null order by created_at limit 1),
        (select email from store_settings where tenant_id = ${tenantId})
      ) as email
    `
  )[0];
  return row?.email ?? null;
}

export function invoiceView(
  inv: InvoiceRow & { plan_name: string; ai_pack_name?: string | null; ai_credited?: boolean },
  now: Date,
) {
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    planName: inv.plan_name,
    aiPackName: inv.ai_pack_name ?? null,
    /** a paid pack whose conversations went in (false: paid without Duá, the team refunds it) */
    aiCredited: inv.kind === 'ai_pack' ? inv.ai_credited === true : null,
    amountCents: inv.amount_cents,
    periodStart: inv.period_start,
    periodEnd: inv.period_end,
    method: inv.method,
    status: inv.status,
    dueAt: inv.due_at,
    paidAt: inv.paid_at,
    pix:
      inv.status === 'open' && inv.method === 'pix' && inv.pix_copy_paste && pixIsLive(inv, now)
        ? { copyPaste: inv.pix_copy_paste, expiresAt: inv.pix_expires_at }
        : null,
  };
}
