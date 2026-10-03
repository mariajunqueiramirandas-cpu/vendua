import type { CartView } from '../modules/cart.ts';
import { mintCouponTx } from '../modules/coupons.ts';
import type { Sql } from '../platform/db.ts';
import type { CompiledGuard } from './knowledge.ts';
import type { IncentiveReason, StoreAgentSettings } from './settings.ts';

// Incentives are the merchant's money (sales-agent.md §4.11): only a coupon the merchant picked,
// for a reason they allowed, above their minimum, under their monthly budget and at most once
// per phone per N days. Core mints a single-use coupon bound to the phone and applies it; the
// verifier blocks any discount Core didn't grant.

export type IncentiveRefusal =
  | 'NO_POLICY'
  | 'REASON_NOT_ALLOWED'
  | 'NO_PHONE'
  | 'BELOW_MINIMUM'
  | 'RECENTLY_GRANTED'
  | 'BUDGET_SPENT'
  | 'NO_COUPON';

export interface IncentiveGrant {
  ok: true;
  code: string;
  label: string;
  valueCents: number;
  couponId: string;
}

interface TemplateRow {
  id: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  label: string | null;
  min_subtotal_cents: number;
  max_discount_cents: number | null;
  active: boolean;
  ends_at: Date | null;
}

/** The most a coupon can take off this cart: what the budget counts. */
export function worstCaseCents(
  t: Pick<TemplateRow, 'kind' | 'value' | 'max_discount_cents'>,
  cart: CartView,
): number {
  if (t.kind === 'fixed') return Math.min(t.value, cart.totals.subtotalCents);
  if (t.kind === 'free_delivery') return cart.totals.deliveryFeeCents;
  const pct = Math.round((cart.totals.subtotalCents * t.value) / 100);
  return t.max_discount_cents ? Math.min(pct, t.max_discount_cents) : pct;
}

function monthStart(now: Date): Date {
  // the platform's month is São Paulo's (UTC−3)
  const local = new Date(now.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + 3 * 3600_000);
}

export async function budgetLeft(
  tx: Sql,
  tenantId: string,
  settings: StoreAgentSettings,
  now: Date,
) {
  const inc = settings.incentives;
  if (!inc) return 0;
  const [r] = await tx<{ spent: number }[]>`
    select coalesce(sum(value_cents), 0)::int as spent from agent_incentives
    where tenant_id = ${tenantId} and created_at >= ${monthStart(now)}`;
  return Math.max(0, inc.monthlyBudgetCents - (r?.spent ?? 0));
}

export async function grantIncentiveTx(
  tx: Sql,
  tenantId: string,
  o: {
    threadId: string;
    phone: string | null;
    reason: IncentiveReason;
    cart: CartView;
    settings: StoreAgentSettings;
    guards: readonly CompiledGuard[];
    now: Date;
  },
): Promise<IncentiveGrant | { ok: false; reason: IncentiveRefusal }> {
  const inc = o.settings.incentives;
  if (!inc || !o.settings.capabilities.coupons) return { ok: false, reason: 'NO_POLICY' };
  if (!inc.reasons.includes(o.reason)) return { ok: false, reason: 'REASON_NOT_ALLOWED' };
  if (!o.phone) return { ok: false, reason: 'NO_PHONE' };
  const floor = Math.max(
    inc.minOrderCents,
    ...o.guards.filter((g) => g.kind === 'coupon_min').map((g) => (g as { cents: number }).cents),
  );
  if (o.cart.totals.subtotalCents < floor) return { ok: false, reason: 'BELOW_MINIMUM' };
  // one grant at a time per store keeps the budget honest under concurrent conversations
  await tx`select pg_advisory_xact_lock(hashtext(${'vendedor.incentive|' + tenantId}))`;
  const [recent] = await tx<{ n: number }[]>`
    select count(*)::int as n from agent_incentives
    where tenant_id = ${tenantId} and phone = ${o.phone}
      and created_at > ${new Date(o.now.getTime() - inc.perCustomerDays * 86400_000)}`;
  if ((recent?.n ?? 0) > 0) return { ok: false, reason: 'RECENTLY_GRANTED' };
  const left = await budgetLeft(tx, tenantId, o.settings, o.now);
  const templates = await tx<TemplateRow[]>`
    select id, kind, value, label, min_subtotal_cents, max_discount_cents, active, ends_at from coupons
    where tenant_id = ${tenantId} and id = any(${inc.couponIds}::uuid[]) and active`;
  const usable = templates
    .filter(
      (t) =>
        (!t.ends_at || t.ends_at > o.now) && t.min_subtotal_cents <= o.cart.totals.subtotalCents,
    )
    .map((t) => ({ t, cost: worstCaseCents(t, o.cart) }))
    .filter((x) => x.cost > 0 && x.cost <= left)
    .sort((a, b) => b.cost - a.cost);
  if (!usable.length) return { ok: false, reason: templates.length ? 'BUDGET_SPENT' : 'NO_COUPON' };
  const { t, cost } = usable[0]!;
  const coupon = await mintCouponTx(
    tx,
    tenantId,
    {
      prefix: 'ANA',
      kind: t.kind,
      value: t.value,
      label: t.label ?? undefined,
      minSubtotalCents: t.min_subtotal_cents,
      // the budget was charged for today's cart: a bigger cart later can't take more off
      maxDiscountCents: cost,
      endsAt: new Date(o.now.getTime() + 48 * 3600_000),
      maxRedemptions: 1,
      perPhoneLimit: 1,
      phone: o.phone,
    },
    'agent',
  );
  await tx`
    insert into agent_incentives (tenant_id, thread_id, phone, reason, coupon_id, value_cents)
    values (${tenantId}, ${o.threadId}, ${o.phone}, ${o.reason}, ${coupon.id}, ${cost})`;
  return {
    ok: true,
    code: coupon.code,
    label: coupon.label ?? coupon.code,
    valueCents: cost,
    couponId: coupon.id,
  };
}
