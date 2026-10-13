import { randomInt } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { controlTx } from '../control.ts';
import { formatBRL, type PlanRow } from './plans.ts';

// Signup coupons (ADR 0042, migration 0118): staff make them in the CRM; a new owner types one on
// signup's last step. A coupon gives free days (a free first period, the trial's machinery) and/or
// a % or R$ discount on the first N paid months. The discount lives in SQL (period_charge_cents),
// because the billing jobs pick what to reprice in SQL; this module only asks it.

export type DiscountKind = 'percent' | 'amount';

export interface CouponRow {
  id: string;
  code: string;
  note: string | null;
  plan_ids: string[] | null;
  free_days: number;
  discount_kind: DiscountKind | null;
  discount_value: number;
  discount_months: number;
  max_uses: number | null;
  uses: number;
  expires_at: Date | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** the terms a store redeemed, kept as they were then */
export interface RedemptionRow {
  tenant_id: string;
  coupon_id: string;
  plan_id: string;
  code: string;
  free_days: number;
  discount_kind: DiscountKind | null;
  discount_value: number;
  discount_months: number;
  created_at: Date;
}

export interface CouponTerms {
  code: string;
  freeDays: number;
  /** percent: 1–99; amount: cents off each discounted month */
  discount: { kind: DiscountKind; value: number; months: number } | null;
}

export const COUPON_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** as typed, in any case and with stray spaces; '' when it can't be one */
export function normalizeCouponCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 80) return '';
  const code = raw.replace(/\s+/g, '').toUpperCase();
  return COUPON_RE.test(code) ? code : '';
}

/** not given (undefined / null / '') = null; anything else must look like a code */
export function couponCodeOr422(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const code = normalizeCouponCode(v);
  if (!code) throw refusal('invalid');
  return code;
}

// no 0/O, 1/I/L: the owner reads it off a flyer or a WhatsApp message
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** `PREFIX-XXXX-XXXX`, or `XXXX-XXXX` with no prefix: 31^8 ≈ 8.5e11, not guessable at 20/min */
export function generateCouponCode(prefix: string | null): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return [prefix, part(), part()].filter(Boolean).join('-');
}

export function couponTerms(r: {
  code: string;
  free_days: number;
  discount_kind: DiscountKind | null;
  discount_value: number;
  discount_months: number;
}): CouponTerms {
  return {
    code: r.code,
    freeDays: r.free_days,
    discount: r.discount_kind
      ? { kind: r.discount_kind, value: r.discount_value, months: r.discount_months }
      : null,
  };
}

/** "30 dias grátis e 50% de desconto nos 3 primeiros meses" — audit, emails, the team */
export function describeCoupon(t: CouponTerms): string {
  const parts: string[] = [];
  if (t.freeDays > 0) parts.push(`${t.freeDays} ${t.freeDays === 1 ? 'dia' : 'dias'} grátis`);
  if (t.discount) {
    const off =
      t.discount.kind === 'percent' ? `${t.discount.value}%` : formatBRL(t.discount.value);
    const when =
      t.discount.months === 1 ? 'no primeiro mês' : `nos ${t.discount.months} primeiros meses`;
    parts.push(`${off} de desconto ${when}`);
  }
  return parts.join(' e ');
}

export type CouponRefusal = 'invalid' | 'expired' | 'used_up' | 'plan' | 'phone';

const REFUSALS: Record<CouponRefusal, [422 | 409, string, string]> = {
  invalid: [422, 'COUPON_INVALID', 'this coupon does not exist or is off'],
  expired: [422, 'COUPON_EXPIRED', 'this coupon has expired'],
  used_up: [422, 'COUPON_USED_UP', 'this coupon was already used'],
  plan: [422, 'COUPON_PLAN', 'this coupon is not for this plan'],
  phone: [409, 'COUPON_ALREADY_USED', 'this phone already used this coupon'],
};

function refusal(why: CouponRefusal, planIds?: string[] | null) {
  const [status, code, message] = REFUSALS[why];
  return new HttpError(status, code, message, {
    field: 'coupon',
    ...(why === 'plan' && planIds ? { planIds } : {}),
  });
}

/**
 * Signup's look before the store exists: what the coupon gives and, on `plan`, the discounted
 * price. Takes no use: redeemCouponTx decides, under the coupon's lock. Read under
 * vendua.control (the catalog is the CRM's), one fixed query.
 */
export async function previewCoupon(
  sql: Sql,
  code: string,
  plan: PlanRow | null,
): Promise<CouponTerms & { planIds: string[] | null; discountedCents: number | null }> {
  const row = await controlTx(
    sql,
    async (tx) =>
      (
        await tx<(CouponRow & { discounted: number | null })[]>`
          select c.*,
            ${plan ? tx`signup_coupon_price(${plan.price_cents}, c.discount_kind, c.discount_value)` : null}::int
              as discounted
          from signup_coupons c where c.code = ${code}
        `
      )[0],
  );
  if (!row || !row.active) throw refusal('invalid');
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) throw refusal('expired');
  if (plan && row.plan_ids && !row.plan_ids.includes(plan.id)) throw refusal('plan', row.plan_ids);
  if (row.max_uses !== null && row.uses >= row.max_uses) throw refusal('used_up');
  return {
    ...couponTerms(row),
    planIds: row.plan_ids,
    discountedCents: row.discount_kind ? row.discounted : null,
  };
}

/** Signup's only use of a coupon: in the new store's own transaction, under the phone's lock. */
export async function redeemCouponTx(
  tx: Sql,
  tenantId: string,
  code: string,
  phoneKey: string,
  planId: string,
): Promise<RedemptionRow> {
  const out = (
    await tx<{ r: string }[]>`
      select redeem_signup_coupon(${code}, ${tenantId}, ${phoneKey}, ${planId}) as r
    `
  )[0]!.r;
  if (out !== 'ok') throw refusal(out as CouponRefusal);
  return (await storeCoupon(tx, tenantId))!;
}

/** the coupon this store signed up with (its own row, under its RLS) */
export async function storeCoupon(tx: Sql, tenantId: string): Promise<RedemptionRow | null> {
  return (
    (
      await tx<RedemptionRow[]>`
        select * from signup_coupon_redemptions where tenant_id = ${tenantId}
      `
    )[0] ?? null
  );
}

/**
 * What the period starting at `start` charges on `plan`: its price, less the store's signup
 * coupon while discounted months are left. `null` asks for a card's next charge.
 */
export async function periodPrice(
  tx: Sql,
  tenantId: string,
  plan: Pick<PlanRow, 'price_cents'>,
  start: Date | null,
): Promise<{ amountCents: number; discountCents: number }> {
  const at = start ? start.toISOString() : 'infinity';
  const cents = (
    await tx<{ c: number }[]>`
      select period_charge_cents(${tenantId}, ${plan.price_cents}, ${at}::text::timestamptz) as c
    `
  )[0]!.c;
  return { amountCents: cents, discountCents: plan.price_cents - cents };
}

/** Conta's line: the coupon and its discounted months not yet paid. (Charging counts an issued
 *  one too, in period_charge_cents, so two open invoices never both take the last month.) */
export async function couponView(tx: Sql, tenantId: string) {
  const r = await storeCoupon(tx, tenantId);
  if (!r) return null;
  const used = r.discount_kind
    ? (
        await tx<{ n: number }[]>`
          select count(*)::int as n from invoices
          where tenant_id = ${tenantId} and kind = 'period' and discount_cents > 0
            and status = 'paid'
        `
      )[0]!.n
    : 0;
  const terms = couponTerms(r);
  return {
    ...terms,
    label: describeCoupon(terms),
    discountMonthsLeft: r.discount_kind ? Math.max(0, r.discount_months - used) : 0,
  };
}
