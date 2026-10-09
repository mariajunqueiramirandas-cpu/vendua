import { createHmac, timingSafeEqual } from 'node:crypto';
import { planHas } from './billing/plans.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { couponLabel, mintCouponTx, type CouponRow } from './coupons.ts';
import { phoneVariants } from '../store-whatsapp/text.ts';
import type { LoyaltyProgram, StoreSettingsRow } from './store.ts';

// "Sem senha, sem cadastro" (roadmap 2a/2c). Anyone can type any phone at checkout, so a
// phone alone proves nothing. A customer token binds (tenant, phone, anchor order): the
// order this device just placed, or the one whose number it named. Only a *delivered*
// anchor (the merchant handed the goods over) proves the phone: then the token reads the
// phone's order summaries, loyalty rewards and redeems its personal coupons. Until then it
// sees the anchor order alone. Never addresses or other customers' data.

const TOKEN_DAYS = 90;
const TOKEN_PREFIX = 'vcu2';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const normalizePhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  // store the national number; +55 prefixes and bare DDD+number collapse together
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
};

export function validPhone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const d = normalizePhone(v);
  return d.length >= 10 && d.length <= 11 ? d : null;
}

function sign(secret: string, msg: string) {
  return createHmac('sha256', secret).update(msg).digest('base64url');
}

const signed = (tenantId: string, phone: string, anchor: string, exp: number) =>
  `customer2|${tenantId}|${phone}|${anchor}|${exp}`;

export function mintCustomerToken(
  secret: string,
  tenantId: string,
  phone: string,
  anchorOrderId: string,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + TOKEN_DAYS * 86_400;
  const sig = sign(secret, signed(tenantId, phone, anchorOrderId, exp));
  return {
    token: `${TOKEN_PREFIX}.${phone}.${anchorOrderId}.${exp}.${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export interface CustomerClaim {
  phone: string;
  anchorOrderId: string;
}

/** Signature and expiry only — `resolveCustomer` decides what the claim is worth today. */
export function verifyCustomerToken(
  secret: string,
  tenantId: string,
  token: string,
  now = Date.now(),
): CustomerClaim | null {
  if (token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) return null;
  const [, phone, anchor, expRaw, sig] = parts as [string, string, string, string, string];
  const exp = Number(expRaw);
  if (!/^\d{10,11}$/.test(phone) || !UUID_RE.test(anchor)) return null;
  if (!Number.isInteger(exp) || exp * 1000 < now) return null;
  const expected = Buffer.from(sign(secret, signed(tenantId, phone, anchor, exp)));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got)
    ? { phone, anchorOrderId: anchor }
    : null;
}

export interface Customer extends CustomerClaim {
  /** the anchor order was delivered — the phone is the bearer's */
  proven: boolean;
}

/** A claim whose anchor is still this phone's live order; a cancelled/refunded anchor is void. */
export async function resolveCustomer(
  tx: Sql,
  tenantId: string,
  claim: CustomerClaim | null,
): Promise<Customer | null> {
  if (!claim) return null;
  const row = (
    await tx<{ state: string }[]>`
      select state from orders
      where tenant_id = ${tenantId} and id = ${claim.anchorOrderId}
        and customer_phone = ${claim.phone}
    `
  )[0];
  if (!row || row.state === 'cancelled' || row.state === 'refunded') return null;
  return { ...claim, proven: row.state === 'delivered' };
}

/** The customer the request proves, or 401 CUSTOMER_REQUIRED; a `phone` query must match it. */
export async function requireCustomer(
  tx: Sql,
  secret: string,
  tenantId: string,
  header: string | undefined,
  askedPhone?: string,
): Promise<Customer> {
  const customer = await resolveCustomer(
    tx,
    tenantId,
    header ? verifyCustomerToken(secret, tenantId, header) : null,
  );
  if (!customer)
    throw new HttpError(401, 'CUSTOMER_REQUIRED', 'verify this phone to see its orders');
  if (askedPhone !== undefined && validPhone(askedPhone) !== customer.phone)
    throw new HttpError(403, 'CUSTOMER_MISMATCH', 'token was issued for another phone');
  return customer;
}

/** The id of that phone's order with that number (the new token's anchor), if any. */
export async function verifyByOrder(
  tx: Sql,
  tenantId: string,
  phone: string,
  orderNumber: number,
): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    select id from orders
    where tenant_id = ${tenantId} and customer_phone = ${phone} and number = ${orderNumber}
      and state not in ('cancelled', 'refunded')
  `;
  return rows[0]?.id ?? null;
}

const SESSION_FAILURE_CAP = 5;

/** Wrong phone+number guesses per (tenant, phone) in 24h — order numbers are sequential. */
export async function sessionFailuresExceeded(
  tx: Sql,
  tenantId: string,
  phone: string,
): Promise<boolean> {
  // serialize guesses for one phone so parallel requests can't overrun the cap
  await tx`select pg_advisory_xact_lock(hashtextextended(${`custsession|${tenantId}|${phone}`}, 0))`;
  const n = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from customer_session_failures
      where tenant_id = ${tenantId} and phone = ${phone}
        and created_at > now() - interval '24 hours'
    `
  )[0]!.n;
  return n >= SESSION_FAILURE_CAP;
}

export async function recordSessionFailure(tx: Sql, tenantId: string, phone: string) {
  await tx`insert into customer_session_failures (tenant_id, phone) values (${tenantId}, ${phone})`;
  // bounded table: rows older than the window are dead weight
  if (Math.random() < 0.05)
    await tx`delete from customer_session_failures where created_at < now() - interval '2 days'`;
}

export interface OrderSummary {
  id: string;
  number: number;
  state: string;
  placedAt: string;
  scheduledFor: string | null;
  mode: 'pickup' | 'delivery';
  totalCents: number;
  items: { name: string; qty: number }[];
}

export async function ordersByPhone(
  tx: Sql,
  tenantId: string,
  phone: string,
  limit = 30,
  /** a pending (unproven) customer sees only its anchor order */
  onlyOrderId?: string,
): Promise<OrderSummary[]> {
  const rows = await tx<
    {
      id: string;
      number: number;
      state: string;
      placed_at: Date;
      scheduled_for: string | null;
      mode: string;
      total_cents: number;
      items: { name: string; qty: number }[] | null;
    }[]
  >`
    select o.id, o.number, o.state, o.placed_at, o.scheduled_for::text as scheduled_for,
           o.delivery ->> 'mode' as mode, o.total_cents,
           (select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.sort)
              from order_items i where i.order_id = o.id) as items
    from orders o
    where o.tenant_id = ${tenantId} and o.customer_phone = ${phone}
      and (${onlyOrderId ?? null}::uuid is null or o.id = ${onlyOrderId ?? null}::uuid)
    order by o.placed_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    state: r.state,
    placedAt: new Date(r.placed_at).toISOString(),
    scheduledFor: r.scheduled_for,
    // storefronts know two modes (Contract 2): a PDV's dine-in was handed over at the store
    mode: r.mode === 'delivery' ? 'delivery' : 'pickup',
    totalCents: r.total_cents,
    items: r.items ?? [],
  }));
}

// ── loyalty ──────────────────────────────────────────────────────────────────

/** store_settings.loyalty as stored: `reward.label` is the merchant's own words, null when none */
export type StoredLoyalty = Omit<LoyaltyProgram, 'reward'> & {
  reward: Omit<LoyaltyProgram['reward'], 'label'> & { label: string | null };
};

/** Validates a program (a write, or the stored row) without inventing a reward label. */
export function readLoyalty(v: unknown): StoredLoyalty | null {
  const l = v as StoredLoyalty | null;
  if (!l || typeof l !== 'object') return null;
  if (!Number.isInteger(l.stampsRequired) || l.stampsRequired < 2 || l.stampsRequired > 50)
    return null;
  if (!l.reward || !['percent', 'fixed', 'free_delivery'].includes(l.reward.kind)) return null;
  return {
    stampsRequired: l.stampsRequired,
    minOrderCents: Math.max(0, Number(l.minOrderCents) || 0),
    reward: {
      kind: l.reward.kind,
      value: Math.max(0, Number(l.reward.value) || 0),
      label:
        typeof l.reward.label === 'string' ? l.reward.label.trim().slice(0, 120) || null : null,
    },
    rewardValidDays: Math.min(365, Math.max(1, Number(l.rewardValidDays) || 60)),
  };
}

/** The program as shoppers and staff read it: an unnamed reward is named like a coupon. */
export function parseLoyalty(v: unknown): LoyaltyProgram | null {
  const p = readLoyalty(v);
  return p && { ...p, reward: { ...p.reward, label: couponLabel(p.reward) } };
}

export interface LoyaltyCard {
  enabled: boolean;
  stampsRequired: number;
  /** stamps toward the next reward */
  stamps: number;
  minOrderCents: number;
  rewardLabel: string;
  /** minted, unused, unexpired rewards — each is a personal coupon code */
  rewards: { code: string; label: string; expiresAt: string | null }[];
}

async function stampCounts(
  tx: Sql,
  tenantId: string,
  phone: string,
  program: Pick<StoredLoyalty, 'minOrderCents'>,
) {
  const earned = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from orders
      where tenant_id = ${tenantId} and customer_phone = any(${phoneVariants(phone)})
        and state = 'delivered' and subtotal_cents >= ${program.minOrderCents}
    `
  )[0]!.n;
  const minted = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from coupons
      where tenant_id = ${tenantId} and source = 'loyalty' and phone = any(${phoneVariants(phone)})
    `
  )[0]!.n;
  return { earned, minted };
}

export async function loyaltyCard(
  tx: Sql,
  tenantId: string,
  phone: string,
  settings: Pick<StoreSettingsRow, 'loyalty'> | null,
  now = new Date(),
  /** reward codes are bearer coupons — only for a proven customer (or the merchant) */
  opts: { withRewards?: boolean } = {},
): Promise<LoyaltyCard> {
  const program = parseLoyalty(settings?.loyalty);
  if (!program || !(await planHas(tx, tenantId, 'loyalty')))
    return {
      enabled: false,
      stampsRequired: 0,
      stamps: 0,
      minOrderCents: 0,
      rewardLabel: '',
      rewards: [],
    };
  const { earned, minted } = await stampCounts(tx, tenantId, phone, program);
  const rewards =
    opts.withRewards === false
      ? []
      : await tx<
          {
            code: string;
            kind: CouponRow['kind'];
            value: number;
            label: string | null;
            ends_at: Date | null;
          }[]
        >`
    select c.code, c.kind, c.value, c.label, c.ends_at from coupons c
    where c.tenant_id = ${tenantId} and c.source = 'loyalty' and c.phone = any(${phoneVariants(phone)})
      and c.active
      and (c.ends_at is null or c.ends_at > ${now})
      and not exists (
        select 1 from coupon_redemptions r join orders o on o.id = r.order_id
        where r.coupon_id = c.id and o.state <> 'cancelled'
      )
    order by c.created_at
  `;
  return {
    enabled: true,
    stampsRequired: program.stampsRequired,
    stamps: Math.max(0, earned - minted * program.stampsRequired),
    minOrderCents: program.minOrderCents,
    rewardLabel: program.reward.label,
    rewards: rewards.map((r) => ({
      code: r.code,
      label: couponLabel(r),
      expiresAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    })),
  };
}

/** Called when an order reaches `delivered`: mints every reward the phone has now earned. */
export async function mintLoyaltyRewards(
  tx: Sql,
  tenantId: string,
  phone: string | null,
): Promise<string[]> {
  if (!phone) return [];
  const settings = (
    await tx<
      { loyalty: unknown }[]
    >`select loyalty from store_settings where tenant_id = ${tenantId}`
  )[0];
  // a reward the merchant didn't name stays unnamed: couponLabel names it from the coupon itself
  const program = readLoyalty(settings?.loyalty);
  // a plan without loyalty keeps the program for later but stamps and mints nothing now
  if (!program || !(await planHas(tx, tenantId, 'loyalty'))) return [];
  // serialize per phone — two deliveries landing together must not double-mint
  // one lock for both 9th-digit spellings: they count the same stamps
  const key = phoneVariants(phone).sort()[0]!;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`loyalty|${tenantId}|${key}`}, 0))`;
  const { earned, minted } = await stampCounts(tx, tenantId, phone, program);
  const codes: string[] = [];
  for (let n = minted; (n + 1) * program.stampsRequired <= earned; n++) {
    const { code } = await mintCouponTx(
      tx,
      tenantId,
      {
        prefix: 'FIEL',
        kind: program.reward.kind,
        // within the coupon's bounds whatever was stored: a mint that throws here would stop the
        // order from ever reaching delivered
        value:
          program.reward.kind === 'percent'
            ? Math.min(100, Math.max(1, Math.round(program.reward.value)))
            : Math.min(10_000_000, Math.max(0, Math.round(program.reward.value))),
        label: program.reward.label,
        maxRedemptions: 1,
        perPhoneLimit: 1,
        phone,
        validDays: program.rewardValidDays,
      },
      'loyalty',
    );
    codes.push(code);
  }
  if (codes.length)
    await tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, 'loyalty.reward', ${tx.json({ phone, codes })})
    `;
  return codes;
}
