import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';

export interface PlanFeatures {
  customDomain: boolean;
  customSite: boolean;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number | null;
  feeBps: number;
  features: PlanFeatures;
}

export interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  fee_bps: number;
  features: Partial<PlanFeatures> | null;
  public: boolean;
  sort: number;
}

/** stores from before the catalog (tenants.plan 'spike', 'starter', …) */
export const LEGACY_PLAN_NAME = 'Plano piloto';

export function planView(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    feeBps: row.fee_bps,
    features: {
      customDomain: row.features?.customDomain === true,
      customSite: row.features?.customSite === true,
    },
  };
}

export function legacyPlan(id: string): Plan {
  return {
    id,
    name: LEGACY_PLAN_NAME,
    priceCents: null,
    feeBps: 0,
    features: { customDomain: false, customSite: false },
  };
}

export async function publicPlans(tx: Sql): Promise<Plan[]> {
  const rows = await tx<PlanRow[]>`select * from plans where public order by sort, price_cents`;
  return rows.map(planView);
}

export async function planRow(tx: Sql, id: string): Promise<PlanRow | null> {
  if (!/^[a-z0-9_]{2,30}$/.test(id)) return null;
  return (await tx<PlanRow[]>`select * from plans where id = ${id}`)[0] ?? null;
}

/** The plan a store is on (tenants.plan), legacy ids included. */
export async function tenantPlan(tx: Sql, tenantId: string): Promise<Plan> {
  const t = (await tx<{ plan: string }[]>`select plan from tenants where id = ${tenantId}`)[0];
  const id = t?.plan ?? 'spike';
  const row = await planRow(tx, id);
  return row ? planView(row) : legacyPlan(id);
}

/** A plan the store can pick itself (signup, "trocar de plano"): in the catalog and public. */
export async function publicPlanOr422(tx: Sql, id: unknown): Promise<PlanRow> {
  const row = typeof id === 'string' ? await planRow(tx, id) : null;
  if (!row || !row.public)
    throw new HttpError(422, 'UNKNOWN_PLAN', 'pick one of the plans offered', { field: 'planId' });
  return row;
}

/**
 * 403 PLAN_REQUIRED unless the store's plan includes the feature AND is paid for: tenants.plan
 * says PRO+ from signup (and a pending upgrade), before any money landed. A store the team put
 * on a plan without a subscription counts while it isn't held for payment.
 */
export async function requireFeature(tx: Sql, tenantId: string, feature: keyof PlanFeatures) {
  const plan = await tenantPlan(tx, tenantId);
  if (!plan.features[feature])
    throw new HttpError(403, 'PLAN_REQUIRED', 'this needs the Venduá PRO+ plan', { feature });
  const row = (
    await tx<{ status: string | null; hold: boolean | null }[]>`
      select (select status from subscriptions where tenant_id = ${tenantId}) as status,
             (select billing_hold from store_settings where tenant_id = ${tenantId}) as hold
    `
  )[0];
  const paid = row?.status ? row.status === 'active' || row.status === 'past_due' : !row?.hold;
  if (!paid)
    throw new HttpError(403, 'PLAN_REQUIRED', 'this needs the plan to be paid first', {
      feature,
      reason: 'unpaid',
    });
  return plan;
}

export function formatBRL(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
