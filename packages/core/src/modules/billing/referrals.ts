import type { Sql } from '../../platform/db.ts';
import { withTenant } from '../../platform/db.ts';
import { audit } from '../../admin/audit.ts';
import { phoneVariants } from '../../store-whatsapp/text.ts';
import { controlTx } from '../control.ts';
import { billingLog, type InvoiceRow } from './invoices.ts';
import { dayMonth, queueOwners, type OwnerMessage } from './notices.ts';
import { formatBRL } from './plans.ts';
import {
  dropPix,
  lockSub,
  recordBillingProblem,
  withEffects,
  type BillingCtx,
} from './subscriptions.ts';

// Stores bring stores, partners bring stores (migration 0120). A store's link is its slug: the new
// store gets WELCOME_DAYS free on top of its trial, and once it pays its first month the store
// that referred it is owed a free month (a `billing_credits` row). A Pix plan takes the month by
// moving its next charge a month on; a card plan (Mercado Pago charges it on its own schedule)
// takes it as a full refund of its next charge. A partner's stores earn it a commission on every
// plan invoice they pay, for the partner's commission_months from the store's signup.

/** the referred store's first month, after its trial */
export const WELCOME_DAYS = 30;

const CODE = /^[A-Za-z0-9-]{3,40}$/;

/** A link's code as typed (`?indica=` or `?parceiro=`): a store's slug or a partner's code. */
export function referralCodeOr(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim();
  return CODE.test(c) ? c : null;
}

export interface ReferralPreview {
  kind: 'store' | 'partner';
  name: string;
  /** the referring store (never sent to a client) */
  tenantId: string | null;
}

export async function previewReferral(sql: Sql, code: string): Promise<ReferralPreview | null> {
  const r = (
    await sql<{ kind: 'store' | 'partner'; name: string; tenant_id: string | null }[]>`
      select kind, name, referrer_tenant_id as tenant_id from referral_lookup(${code})
    `
  )[0];
  return r ? { kind: r.kind, name: r.name, tenantId: r.tenant_id } : null;
}

/** A store's link brings a welcome month to this phone: not its own store's, once per WhatsApp. */
export async function welcomeFor(
  sql: Sql,
  r: ReferralPreview | null,
  phone: string | null,
  phoneKey: string | null,
): Promise<boolean> {
  if (r?.kind !== 'store') return false;
  if (!phone || !phoneKey) return true;
  if (await phoneHadWelcome(sql, phoneKey)) return false;
  const own = await sql<{ n: number }[]>`
    select count(*)::int as n from unnest(${phoneVariants(phone)}::text[]) p
      cross join lateral merchant_memberships_for_phone(p) m
    where m.tenant_id = ${r.tenantId} and m.role = 'owner'
  `;
  return own[0]!.n === 0;
}

/** Has this WhatsApp (its phoneLockKey) had a referral's welcome month already? */
export async function phoneHadWelcome(sql: Sql, phoneKey: string): Promise<boolean> {
  return (await sql<{ used: boolean }[]>`select phone_had_welcome(${phoneKey}) as used`)[0]!.used;
}

export type RecordResult = 'ok' | 'ok_no_welcome' | 'self' | 'invalid' | 'exists';

/** In the new store's own signup tx. `welcomeDays` is what the store would get; the result says
 *  whether it does (once per WhatsApp, and never from a partner's code). */
export async function recordReferralTx(
  tx: Sql,
  tenantId: string,
  code: string,
  phones: string[],
  phoneKey: string,
  welcomeDays: number,
): Promise<RecordResult> {
  return (
    await tx<{ r: RecordResult }[]>`
      select record_store_referral(${tenantId}, ${code}, ${phones}::text[], ${phoneKey},
                                   ${welcomeDays}) as r
    `
  )[0]!.r;
}

/** A plan invoice of this store was paid (its own tx): the partner's commission, and the
 *  referrer's free month on the first paid month. The month itself is applied by the referrer's
 *  own billing (the jobs, or its next card charge). */
export async function referralOnPaidTx(tx: Sql, inv: InvoiceRow): Promise<string | null> {
  if (inv.kind !== 'period' && inv.kind !== 'upgrade') return null;
  return (
    await tx<{ referrer: string | null }[]>`select referral_on_paid(${inv.id}) as referrer`
  )[0]!.referrer;
}

interface CreditRow {
  id: string;
  tenant_id: string;
  source_tenant_id: string | null;
  months: number;
}

const rewardMessage = (how: string): OwnerMessage => ({
  text: `Venduá: uma loja que você indicou assinou o Venduá. Obrigado! ${how}`,
  subject: 'Venduá: você ganhou um mês grátis',
});

/**
 * A card plan's charge just landed (its own tx, after the invoice is marked paid): a free month
 * owed is this charge, given back in full. The refund's key is the credit's, so a retry after a
 * rolled-back tx never refunds twice. A refund Mercado Pago refuses leaves the credit owed (the
 * next charge tries again) and tells the team.
 */
export async function applyCardCreditTx(
  ctx: BillingCtx,
  tx: Sql,
  tenantId: string,
  inv: InvoiceRow,
  paymentId: string | null,
) {
  if (inv.kind !== 'period' || !paymentId || inv.amount_cents <= 0) return;
  const credit = (
    await tx<CreditRow[]>`
      select id, tenant_id, source_tenant_id, months from billing_credits
      where tenant_id = ${tenantId} and status = 'pending'
      order by created_at limit 1 for update skip locked
    `
  )[0];
  if (!credit) return;
  try {
    const refund = await ctx.provider.platformRefund(paymentId, null, `credit:${credit.id}`);
    if (refund.status === 'rejected') throw new Error('refund rejected');
    await tx`
      update billing_credits set status = 'applied', applied_how = 'refund', invoice_id = ${inv.id},
        provider_refund_id = ${refund.id}, applied_at = now()
      where id = ${credit.id}
    `;
    await tx`update invoices set credited_cents = amount_cents where id = ${inv.id}`;
    await audit(
      tx,
      tenantId,
      { userId: null, name: 'Venduá' },
      {
        action: 'billing.credit',
        entity: 'account',
        entityId: inv.id,
        summary: `mês grátis por indicação: a cobrança de ${formatBRL(inv.amount_cents)} no cartão foi devolvida`,
        after: { creditId: credit.id, refundId: refund.id },
      },
    );
    queueOwners(
      ctx,
      tenantId,
      rewardMessage(
        `A cobrança de ${formatBRL(inv.amount_cents)} deste mês no cartão foi devolvida: este mês é por nossa conta.`,
      ),
      `billing:credit:${credit.id}`,
    );
  } catch (err) {
    billingLog.warn({ err, tenantId, credit: credit.id }, 'referral credit refund failed');
    await recordBillingProblem(
      tx,
      tenantId,
      'other',
      `O mês grátis por indicação não foi devolvido no cartão (cobrança ${inv.number}, ${formatBRL(inv.amount_cents)}): o Mercado Pago recusou o estorno. Ele fica para a próxima cobrança, ou devolva pelo Mercado Pago.`,
      `credit-refund:${credit.id}`,
    );
  }
}

/**
 * The jobs' step: free months owed to stores paying by Pix (trialing or active) move the next
 * charge a month on. A renewal invoice already issued for the old date is voided, its Pix
 * withdrawn; the renewal step issues the next one when its new date comes near. Card plans wait
 * for their next charge (applyCardCreditTx); a store not paying yet keeps its credit until it is.
 */
export async function applyPixCredits(sql: Sql, base: Omit<BillingCtx, 'later'>, now: Date) {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ tenant_id: string }[]>`
      select distinct c.tenant_id from billing_credits c
      join subscriptions s on s.tenant_id = c.tenant_id
      where c.status = 'pending' and s.method = 'pix' and s.status in ('active', 'trialing')
        and s.current_period_end is not null and not s.cancel_at_period_end
      limit 100
    `,
  );
  for (const { tenant_id } of rows) {
    try {
      await withEffects(base, (ctx) =>
        withTenant(sql, tenant_id, async (tx) => {
          const sub = await lockSub(tx, tenant_id);
          if (
            !sub ||
            sub.method !== 'pix' ||
            (sub.status !== 'active' && sub.status !== 'trialing') ||
            !sub.current_period_end ||
            sub.cancel_at_period_end
          )
            return;
          const credits = await tx<CreditRow[]>`
            select id, tenant_id, source_tenant_id, months from billing_credits
            where tenant_id = ${tenant_id} and status = 'pending'
            order by created_at for update
          `;
          if (!credits.length) return;
          const months = credits.reduce((t, c) => t + c.months, 0);
          const from = sub.current_period_end;
          const until = (
            await tx<{ until: Date }[]>`
              select ${from}::timestamptz + make_interval(months => ${months}) as until
            `
          )[0]!.until;
          await tx`
            update subscriptions set current_period_end = ${until},
              trial_ends_at = case when status = 'trialing' then ${until}::timestamptz else trial_ends_at end,
              updated_at = now()
            where tenant_id = ${tenant_id}
          `;
          const voided = await tx<{ provider_payment_id: string | null }[]>`
            update invoices set status = 'void'
            where tenant_id = ${tenant_id} and kind = 'period' and status in ('open', 'failed')
              and period_start >= ${from}
            returning provider_payment_id
          `;
          for (const v of voided) if (v.provider_payment_id) dropPix(ctx)(v.provider_payment_id);
          await tx`
            update billing_credits set status = 'applied', applied_how = 'period', applied_at = ${now}
            where id = any (${credits.map((c) => c.id)}::uuid[])
          `;
          await audit(
            tx,
            tenant_id,
            { userId: null, name: 'Venduá' },
            {
              action: 'billing.credit',
              entity: 'account',
              entityId: tenant_id,
              summary: `${months === 1 ? 'mês grátis' : `${months} meses grátis`} por indicação: a próxima cobrança passou de ${dayMonth(from)} para ${dayMonth(until)}`,
              after: { credits: credits.map((c) => c.id), until: until.toISOString() },
            },
          );
          queueOwners(
            ctx,
            tenant_id,
            rewardMessage(
              `${months === 1 ? 'Ganhou um mês grátis' : `Ganhou ${months} meses grátis`}: a próxima cobrança do plano passou para ${dayMonth(until)}.`,
            ),
            `billing:credit:${credits[0]!.id}`,
          );
        }),
      );
    } catch (err) {
      billingLog.warn({ err, tenantId: tenant_id }, 'referral credit not applied');
    }
  }
}

export interface ReferralSummary {
  /** the code a link carries: the store's own slug */
  code: string;
  stores: { name: string; joinedAt: string; rewarded: boolean }[];
  /** free months earned and still waiting for the next charge */
  pendingMonths: number;
  appliedMonths: number;
  welcomeDays: number;
  /** this store's own welcome, when a referral brought it */
  referredBy: string | null;
}

export async function referralSummary(tx: Sql, tenantId: string): Promise<ReferralSummary> {
  const [slug, stores, credits, mine] = await Promise.all([
    tx<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`,
    tx<{ name: string; joined_at: Date; rewarded: boolean }[]>`
      select name, joined_at, rewarded from referrals_of(${tenantId})
    `,
    tx<{ status: string; months: number }[]>`
      select status, coalesce(sum(months), 0)::int as months from billing_credits
      where tenant_id = ${tenantId} and status in ('pending', 'applied') group by status
    `,
    tx<{ code: string; partner_id: string | null; referrer_tenant_id: string | null }[]>`
      select code, partner_id, referrer_tenant_id from store_referrals where tenant_id = ${tenantId}
    `,
  ]);
  const m = (s: string) => credits.find((c) => c.status === s)?.months ?? 0;
  const by = mine[0];
  return {
    code: slug[0]?.slug ?? '',
    stores: stores.map((s) => ({
      name: s.name,
      joinedAt: s.joined_at.toISOString(),
      rewarded: s.rewarded,
    })),
    pendingMonths: m('pending'),
    appliedMonths: m('applied'),
    welcomeDays: WELCOME_DAYS,
    referredBy: by ? ((await previewReferral(tx, by.code))?.name ?? null) : null,
  };
}

