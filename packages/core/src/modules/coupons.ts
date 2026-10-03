import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Coupons: Core computes every discount (money invariant). A coupon applied to a
// cart is re-evaluated on every read — one that stops applying (subtotal dropped,
// expired) reports why and discounts nothing, and checkout re-checks it with the
// customer's phone (per-phone limits, first order, personal rewards).

export type CouponSource = 'staff' | 'merchant' | 'loyalty' | 'agent';

export interface CouponRow {
  id: string;
  code: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  label: string | null;
  min_subtotal_cents: number;
  max_discount_cents: number | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  max_redemptions: number | null;
  per_phone_limit: number | null;
  first_order_only: boolean;
  phone: string | null;
  source: CouponSource;
  active: boolean;
}

export interface CouponUsage {
  total: number;
  /** only when the phone is known (checkout) */
  byPhone?: number;
  /** delivered-or-not orders this phone already placed at the store */
  priorOrders?: number;
}

export interface CouponOutcome {
  ok: boolean;
  code: string;
  discountCents: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');
export const COUPON_CODE_RE = /^[A-Z0-9_-]{3,32}$/;

export function couponLabel(c: Pick<CouponRow, 'kind' | 'value' | 'label'>): string {
  if (c.label) return c.label;
  if (c.kind === 'percent') return `${c.value}% off`;
  if (c.kind === 'free_delivery') return 'Entrega grátis';
  return `R$ ${(c.value / 100).toFixed(2).replace('.', ',')} off`;
}

export function evaluateCoupon(
  c: CouponRow,
  ctx: {
    subtotalCents: number;
    deliveryFeeCents: number;
    phone?: string | null;
    /** checkout only: the phone a *proven* customer token vouches for (null = none). A
     *  personal coupon is a bearer secret for its phone — the typed phone can't claim it. */
    provenPhone?: string | null;
    usage: CouponUsage;
    now: Date;
  },
): CouponOutcome {
  const fail = (reason: string, details?: Record<string, unknown>): CouponOutcome => ({
    ok: false,
    code: c.code,
    discountCents: 0,
    reason,
    ...(details ? { details } : {}),
  });
  if (!c.active) return fail('COUPON_NOT_FOUND');
  const t = ctx.now.getTime();
  if (c.starts_at && new Date(c.starts_at).getTime() > t)
    return fail('COUPON_NOT_STARTED', { startsAt: new Date(c.starts_at).toISOString() });
  if (c.ends_at && new Date(c.ends_at).getTime() <= t) return fail('COUPON_EXPIRED');
  if (c.max_redemptions != null && ctx.usage.total >= c.max_redemptions)
    return fail('COUPON_EXHAUSTED');
  if (ctx.subtotalCents < c.min_subtotal_cents)
    return fail('COUPON_MIN_SUBTOTAL', {
      minSubtotalCents: c.min_subtotal_cents,
      remainingCents: c.min_subtotal_cents - ctx.subtotalCents,
    });
  if (c.phone && ctx.provenPhone !== undefined && c.phone !== ctx.provenPhone)
    return fail('COUPON_NOT_YOURS');
  if (ctx.phone != null) {
    if (c.phone && c.phone !== ctx.phone) return fail('COUPON_NOT_YOURS');
    if (c.per_phone_limit != null && (ctx.usage.byPhone ?? 0) >= c.per_phone_limit)
      return fail('COUPON_ALREADY_USED');
    if (c.first_order_only && (ctx.usage.priorOrders ?? 0) > 0)
      return fail('COUPON_FIRST_ORDER_ONLY');
  }
  let discount = 0;
  if (c.kind === 'percent') discount = Math.floor((ctx.subtotalCents * c.value) / 100);
  else if (c.kind === 'fixed') discount = c.value;
  else discount = ctx.deliveryFeeCents;
  if (c.max_discount_cents != null) discount = Math.min(discount, c.max_discount_cents);
  // never below zero: fixed/percent come off the items, free delivery off the fee
  discount = Math.min(
    discount,
    c.kind === 'free_delivery' ? ctx.deliveryFeeCents : ctx.subtotalCents,
  );
  return { ok: true, code: c.code, discountCents: Math.max(0, discount) };
}

export async function loadCoupon(
  tx: Sql,
  tenantId: string,
  code: string,
): Promise<CouponRow | null> {
  const rows = await tx<CouponRow[]>`
    select id, code, kind, value, label, min_subtotal_cents, max_discount_cents, starts_at, ends_at,
           max_redemptions, per_phone_limit, first_order_only, phone, source, active
    from coupons where tenant_id = ${tenantId} and code = ${code}
  `;
  return rows[0] ?? null;
}

export async function couponUsage(
  tx: Sql,
  tenantId: string,
  couponId: string,
  phone?: string | null,
): Promise<CouponUsage> {
  const total = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from coupon_redemptions r join orders o on o.id = r.order_id
      where r.tenant_id = ${tenantId} and r.coupon_id = ${couponId} and o.state not in ('cancelled')
    `
  )[0]!.n;
  if (!phone) return { total };
  const byPhone = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from coupon_redemptions r join orders o on o.id = r.order_id
      where r.tenant_id = ${tenantId} and r.coupon_id = ${couponId} and r.phone = ${phone}
        and o.state not in ('cancelled')
    `
  )[0]!.n;
  const priorOrders = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from orders
      where tenant_id = ${tenantId} and customer_phone = ${phone} and state not in ('cancelled')
    `
  )[0]!.n;
  return { total, byPhone, priorOrders };
}

export function parseCode(v: unknown): string {
  if (typeof v !== 'string' || v.length > 64)
    throw new HttpError(422, 'INVALID_COUPON', 'code must be a short string', { field: 'code' });
  const code = normalizeCode(v);
  if (!COUPON_CODE_RE.test(code))
    throw new HttpError(422, 'INVALID_COUPON', 'code has invalid characters', { field: 'code' });
  return code;
}

export interface MintCouponInput {
  /** generated (prefix + 6 unambiguous characters) when absent */
  code?: string | undefined;
  prefix?: string | undefined;
  kind: CouponRow['kind'];
  value: number;
  label?: string | null | undefined;
  minSubtotalCents?: number | undefined;
  maxDiscountCents?: number | null | undefined;
  startsAt?: Date | string | null | undefined;
  endsAt?: Date | string | null | undefined;
  /** ends this many days after the tx's now(); ignored when endsAt is set */
  validDays?: number | undefined;
  maxRedemptions?: number | null | undefined;
  perPhoneLimit?: number | null | undefined;
  firstOrderOnly?: boolean | undefined;
  phone?: string | null | undefined;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCouponCode(prefix?: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const tail = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return prefix ? `${prefix}-${tail}` : tail;
}

/** The one insert into coupons. A taken code → 409 COUPON_EXISTS; a generated one retries. */
export async function mintCouponTx(
  tx: Sql,
  tenantId: string,
  input: MintCouponInput,
  source: CouponSource,
): Promise<CouponRow> {
  const prefix = input.prefix === undefined ? undefined : normalizeCode(input.prefix);
  if (prefix !== undefined && !/^[A-Z0-9]{1,12}$/.test(prefix))
    throw new HttpError(422, 'BAD_REQUEST', 'prefix must be 1–12 letters or numbers', {
      field: 'prefix',
    });
  const given = input.code === undefined ? undefined : normalizeCode(input.code);
  if (given !== undefined && !COUPON_CODE_RE.test(given))
    throw new HttpError(422, 'BAD_REQUEST', 'use 3–32 letters, numbers, _ or -', { field: 'code' });
  const value = input.value;
  const [lo, hi] = input.kind === 'percent' ? [1, 100] : [0, 10_000_000];
  if (!Number.isInteger(value) || value < lo || value > hi)
    throw new HttpError(422, 'BAD_REQUEST', `value must be an integer between ${lo} and ${hi}`, {
      field: 'value',
    });
  const endsAt =
    input.endsAt != null
      ? tx`${input.endsAt}::timestamptz`
      : input.validDays != null
        ? tx`now() + make_interval(days => ${input.validDays})`
        : tx`null`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = given ?? generateCouponCode(prefix);
    // on conflict, not a caught 23505: a failed insert would abort the caller's tx
    const row = (
      await tx<CouponRow[]>`
        insert into coupons (tenant_id, code, kind, value, label, min_subtotal_cents, max_discount_cents,
                             starts_at, ends_at, max_redemptions, per_phone_limit, first_order_only,
                             phone, source)
        values (${tenantId}, ${code}, ${input.kind}, ${value}, ${input.label ?? null},
                ${input.minSubtotalCents ?? 0}, ${input.maxDiscountCents ?? null},
                ${input.startsAt ?? null}, ${endsAt}, ${input.maxRedemptions ?? null},
                ${input.perPhoneLimit ?? null}, ${input.firstOrderOnly === true},
                ${input.phone ?? null}, ${source})
        on conflict (tenant_id, code) do nothing
        returning id, code, kind, value, label, min_subtotal_cents, max_discount_cents, starts_at,
                  ends_at, max_redemptions, per_phone_limit, first_order_only, phone, source, active
      `
    )[0];
    if (row) return row;
    if (given !== undefined)
      throw new HttpError(409, 'COUPON_EXISTS', `${given} already exists`, { field: 'code' });
  }
  throw new HttpError(409, 'COUPON_EXISTS', 'could not find a free code — try again');
}
