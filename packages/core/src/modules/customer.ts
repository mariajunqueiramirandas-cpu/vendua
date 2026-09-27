import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { LoyaltyProgram, StoreSettingsRow } from './store.ts';

// "Sem senha, sem cadastro" (roadmap 2a/2c). A customer token binds (tenant, phone)
// and is minted two ways: to the device that just placed an order with that phone,
// or to anyone who can name one of that phone's order numbers. It unlocks the
// phone's order *summaries* and loyalty card — never addresses or other customers'
// data; a full order view still needs that order's own session token.

const TOKEN_DAYS = 90;

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

export function mintCustomerToken(
  secret: string,
  tenantId: string,
  phone: string,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + TOKEN_DAYS * 86_400;
  return {
    token: `vcu.${phone}.${exp}.${sign(secret, `customer|${tenantId}|${phone}|${exp}`)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyCustomerToken(
  secret: string,
  tenantId: string,
  token: string,
  now = Date.now(),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'vcu') return null;
  const [, phone, expRaw, sig] = parts as [string, string, string, string];
  const exp = Number(expRaw);
  if (!/^\d{10,11}$/.test(phone) || !Number.isInteger(exp) || exp * 1000 < now) return null;
  const expected = Buffer.from(sign(secret, `customer|${tenantId}|${phone}|${exp}`));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got) ? phone : null;
}

/** The phone the request proves, or 401 CUSTOMER_REQUIRED; a `phone` query must match it. */
export function requireCustomer(
  secret: string,
  tenantId: string,
  header: string | undefined,
  askedPhone?: string,
): string {
  const phone = header ? verifyCustomerToken(secret, tenantId, header) : null;
  if (!phone) throw new HttpError(401, 'CUSTOMER_REQUIRED', 'verify this phone to see its orders');
  if (askedPhone !== undefined && validPhone(askedPhone) !== phone)
    throw new HttpError(403, 'CUSTOMER_MISMATCH', 'token was issued for another phone');
  return phone;
}

export async function verifyByOrder(
  tx: Sql,
  tenantId: string,
  phone: string,
  orderNumber: number,
): Promise<boolean> {
  const rows = await tx`
    select 1 from orders
    where tenant_id = ${tenantId} and customer_phone = ${phone} and number = ${orderNumber}
  `;
  return rows.length > 0;
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
): Promise<OrderSummary[]> {
  const rows = await tx<
    {
      id: string;
      number: number;
      state: string;
      placed_at: Date;
      scheduled_for: string | null;
      mode: 'pickup' | 'delivery';
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
    order by o.placed_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    state: r.state,
    placedAt: new Date(r.placed_at).toISOString(),
    scheduledFor: r.scheduled_for,
    mode: r.mode,
    totalCents: r.total_cents,
    items: r.items ?? [],
  }));
}

// ── loyalty ──────────────────────────────────────────────────────────────────

export function parseLoyalty(v: unknown): LoyaltyProgram | null {
  const l = v as LoyaltyProgram | null;
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
      label: String(l.reward.label ?? '').slice(0, 120) || 'Recompensa',
    },
    rewardValidDays: Math.min(365, Math.max(1, Number(l.rewardValidDays) || 60)),
  };
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

async function stampCounts(tx: Sql, tenantId: string, phone: string, program: LoyaltyProgram) {
  const earned = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from orders
      where tenant_id = ${tenantId} and customer_phone = ${phone} and state = 'delivered'
        and subtotal_cents >= ${program.minOrderCents}
    `
  )[0]!.n;
  const minted = (
    await tx<{ n: number }[]>`
      select count(*)::int as n from coupons
      where tenant_id = ${tenantId} and source = 'loyalty' and phone = ${phone}
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
): Promise<LoyaltyCard> {
  const program = parseLoyalty(settings?.loyalty);
  if (!program)
    return {
      enabled: false,
      stampsRequired: 0,
      stamps: 0,
      minOrderCents: 0,
      rewardLabel: '',
      rewards: [],
    };
  const { earned, minted } = await stampCounts(tx, tenantId, phone, program);
  const rewards = await tx<{ code: string; label: string | null; ends_at: Date | null }[]>`
    select c.code, c.label, c.ends_at from coupons c
    where c.tenant_id = ${tenantId} and c.source = 'loyalty' and c.phone = ${phone} and c.active
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
      label: r.label ?? program.reward.label,
      expiresAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
    })),
  };
}

function rewardCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `FIEL-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
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
  const program = parseLoyalty(settings?.loyalty);
  if (!program) return [];
  // serialize per phone — two deliveries landing together must not double-mint
  await tx`select pg_advisory_xact_lock(hashtextextended(${`loyalty|${tenantId}|${phone}`}, 0))`;
  const { earned, minted } = await stampCounts(tx, tenantId, phone, program);
  const codes: string[] = [];
  for (let n = minted; (n + 1) * program.stampsRequired <= earned; n++) {
    const code = rewardCode();
    await tx`
      insert into coupons (tenant_id, code, kind, value, label, max_redemptions, per_phone_limit,
                           phone, source, ends_at)
      values (${tenantId}, ${code}, ${program.reward.kind}, ${program.reward.kind === 'percent' ? Math.min(100, Math.max(1, program.reward.value)) : program.reward.value},
              ${program.reward.label}, 1, 1, ${phone}, 'loyalty',
              now() + make_interval(days => ${program.rewardValidDays}))
    `;
    codes.push(code);
  }
  if (codes.length)
    await tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, 'loyalty.reward', ${tx.json({ phone, codes })})
    `;
  return codes;
}
