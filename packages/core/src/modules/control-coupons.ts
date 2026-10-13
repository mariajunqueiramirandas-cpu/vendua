import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import {
  couponTerms,
  describeCoupon,
  generateCouponCode,
  normalizeCouponCode,
  type CouponRow,
  type DiscountKind,
} from './billing/coupons.ts';
import { claimControl, controlTx } from './control.ts';

// /control/v1/signup-coupons (CRM "Lojas → Planos"): the coupons a new owner can type on signup
// (ADR 0042). A coupon's terms are fixed once made — stores keep what they redeemed anyway — so
// staff only switch it off, rename its note, or change its expiry and max uses.

const MAX_BATCH = 200;
const YEAR_MS = 365 * 86_400_000;

type CouponListRow = CouponRow & {
  stores: { id: string; name: string; slug: string; at: string }[];
};

function couponOut(r: CouponRow & { stores?: CouponListRow['stores'] }) {
  const terms = couponTerms(r);
  return {
    id: r.id,
    code: r.code,
    note: r.note,
    planIds: r.plan_ids,
    freeDays: terms.freeDays,
    discount: terms.discount,
    label: describeCoupon(terms),
    maxUses: r.max_uses,
    uses: r.uses,
    expiresAt: r.expires_at,
    active: r.active,
    createdAt: r.created_at,
    /** the latest stores that signed up with it */
    stores: r.stores ?? [],
  };
}

const bad = (field: string, message: string) =>
  new HttpError(422, 'BAD_REQUEST', message, { field });

function intIn(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw bad(field, `${field} must be an integer ${min}–${max}`);
  return v;
}

/** null clears it; a date from now to five years out */
function expiryOr422(v: unknown): Date | null {
  if (v === null) return null;
  const at = typeof v === 'string' && v.length <= 40 ? new Date(v) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
    throw bad('expiresAt', 'expiresAt must be a future date or null');
  if (at.getTime() - Date.now() > 5 * YEAR_MS)
    throw bad('expiresAt', 'expiresAt must be within five years');
  return at;
}

function noteOr422(v: unknown): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.trim().length > 200)
    throw bad('note', 'note must have at most 200 characters');
  return v.trim() || null;
}

/** null = unlimited */
function maxUsesOr422(v: unknown): number | null {
  return v === null ? null : intIn(v, 'maxUses', 1, 100_000);
}

function discountOr422(v: unknown): { kind: DiscountKind; value: number; months: number } | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v))
    throw bad('discount', 'discount takes { kind, value, months } or null');
  const d = v as Record<string, unknown>;
  if (d.kind !== 'percent' && d.kind !== 'amount')
    throw bad('discount.kind', 'discount.kind must be percent or amount');
  // the floor in signup_coupon_price keeps any month at R$ 1,00 at least; 100% is free days
  const value =
    d.kind === 'percent'
      ? intIn(d.value, 'discount.value', 1, 99)
      : intIn(d.value, 'discount.value', 1, 10_000_000);
  return { kind: d.kind, value, months: intIn(d.months, 'discount.months', 1, 24) };
}

export function mountControlCoupons(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  idemKey: (c: Context) => string;
}) {
  const { app, sql, controlGate, idemKey } = o;

  app.get('/control/v1/signup-coupons', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) => tx<CouponListRow[]>`
        select c.*, coalesce((
          select json_agg(x order by x.at desc) from (
            select t.id, t.name, t.slug, r.created_at as at
            from signup_coupon_redemptions r join tenants t on t.id = r.tenant_id
            where r.coupon_id = c.id order by r.created_at desc limit 5
          ) x
        ), '[]'::json) as stores
        from signup_coupons c
        order by c.active desc, c.created_at desc
        limit 500
      `,
    );
    return c.json({ coupons: rows.map(couponOut) });
  });

  // One coupon with the code staff typed, or `quantity` coupons with generated codes (one-time
  // codes to hand out one by one), all on the same terms.
  app.post('/control/v1/signup-coupons', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const typed = body.code === undefined || body.code === '' ? null : body.code;
    const code = typed === null ? null : normalizeCouponCode(typed);
    if (typed !== null && !code)
      throw bad(
        'code',
        'code must have 3–40 letters, numbers or -, starting with a letter or number',
      );
    const quantity =
      body.quantity === undefined ? 1 : intIn(body.quantity, 'quantity', 1, MAX_BATCH);
    if (code && quantity > 1) throw bad('quantity', 'a typed code is one coupon');
    let prefix: string | null = null;
    if (body.prefix !== undefined && body.prefix !== null && body.prefix !== '') {
      prefix = typeof body.prefix === 'string' ? body.prefix.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{2,12}$/.test(prefix))
        throw bad('prefix', 'prefix must have 2–12 letters or numbers');
    }
    const note = body.note === undefined ? null : noteOr422(body.note);
    const freeDays = body.freeDays === undefined ? 0 : intIn(body.freeDays, 'freeDays', 0, 365);
    const discount = discountOr422(body.discount);
    if (!freeDays && !discount)
      throw bad('freeDays', 'a coupon gives free days, a discount, or both');
    const maxUses = body.maxUses === undefined ? 1 : maxUsesOr422(body.maxUses);
    const expiresAt = body.expiresAt === undefined ? null : expiryOr422(body.expiresAt);
    let planIds: string[] | null = null;
    if (body.planIds !== undefined && body.planIds !== null) {
      if (
        !Array.isArray(body.planIds) ||
        body.planIds.length < 1 ||
        body.planIds.length > 20 ||
        !body.planIds.every((p: unknown) => typeof p === 'string' && /^[a-z0-9_]{2,30}$/.test(p))
      )
        throw bad('planIds', 'planIds takes 1–20 plan ids, or null for every plan');
      planIds = [...new Set(body.planIds as string[])];
    }

    const res = await claimControl(sql, idemKey(c), async (tx) => {
      if (planIds) {
        const known = await tx<{ id: string }[]>`select id from plans where id in ${tx(planIds)}`;
        if (known.length !== planIds.length)
          throw bad('planIds', 'one of the plans does not exist');
      }
      const made: CouponRow[] = [];
      for (let i = 0; i < quantity; i++) {
        // a generated code that collides (1 in ~10^11) just draws again
        for (let attempt = 0; ; attempt++) {
          const row = (
            await tx<CouponRow[]>`
              insert into signup_coupons (code, note, plan_ids, free_days, discount_kind,
                                          discount_value, discount_months, max_uses, expires_at)
              values (${code ?? generateCouponCode(prefix)}, ${note}, ${planIds}, ${freeDays},
                      ${discount?.kind ?? null}, ${discount?.value ?? 0}, ${discount?.months ?? 0},
                      ${maxUses}, ${expiresAt})
              on conflict (code) do nothing
              returning *
            `
          )[0];
          if (row) {
            made.push(row);
            break;
          }
          if (code)
            throw new HttpError(409, 'COUPON_CODE_TAKEN', 'this code already exists', {
              field: 'code',
            });
          if (attempt >= 3) throw new Error('could not draw a free coupon code');
        }
      }
      return { status: 201, body: { coupons: made.map((r) => couponOut(r)) } };
    });
    return c.json(res.body, res.status as 201);
  });

  app.patch('/control/v1/signup-coupons/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw bad('active', 'active must be true or false');
    const note = body.note === undefined ? undefined : noteOr422(body.note);
    const maxUses = body.maxUses === undefined ? undefined : maxUsesOr422(body.maxUses);
    const expiresAt = body.expiresAt === undefined ? undefined : expiryOr422(body.expiresAt);
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const row = (
        await tx<CouponRow[]>`
          update signup_coupons set
            active = ${typeof body.active === 'boolean' ? body.active : tx`active`},
            note = ${note === undefined ? tx`note` : note},
            max_uses = ${maxUses === undefined ? tx`max_uses` : maxUses},
            expires_at = ${expiresAt === undefined ? tx`expires_at` : expiresAt},
            updated_at = now()
          where id = ${id}
          returning *
        `
      )[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'coupon not found');
      return { status: 200, body: { coupon: couponOut(row) } };
    });
    return c.json(res.body, res.status as 200);
  });
}
