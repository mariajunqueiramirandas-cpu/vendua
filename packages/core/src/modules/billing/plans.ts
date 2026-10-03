import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';

/** What a plan includes (ADR 0032). */
export interface PlanFeatures {
  customDomain: boolean;
  customSite: boolean;
  /** the kitchen display (ADR 0029) */
  kds: boolean;
  /** print agents and automatic order printing (ADR 0027) */
  printing: boolean;
  loyalty: boolean;
  /** the Vendedor, the store's AI seller on WhatsApp (ADR 0031) */
  vendedor: boolean;
}
export type PlanFeature = keyof PlanFeatures;
export const PLAN_FEATURES: readonly PlanFeature[] = [
  'customDomain',
  'customSite',
  'kds',
  'printing',
  'loyalty',
  'vendedor',
];
/** features a trial doesn't open: they wait for the first payment (ADR 0025) */
const PAID_ONLY: ReadonlySet<PlanFeature> = new Set(['customDomain', 'customSite']);

export interface Plan {
  id: string;
  name: string;
  priceCents: number | null;
  feeBps: number;
  features: PlanFeatures;
  /** a new store on this plan trials this many days before its first charge (0 = none) */
  trialDays: number;
  /** the plan signup and the site lead with */
  recommended: boolean;
  /** Vendedor conversations a paid month includes */
  aiConversations: number;
  /** Vendedor conversations the whole trial includes */
  aiTrialConversations: number;
}

export interface PlanRow {
  id: string;
  name: string;
  price_cents: number;
  fee_bps: number;
  features: Partial<PlanFeatures> | null;
  public: boolean;
  sort: number;
  trial_days: number;
  recommended: boolean;
  ai_conversations: number;
  ai_trial_conversations: number;
}

/** stores from before the catalog (tenants.plan 'spike', 'starter', …) */
export const LEGACY_PLAN_NAME = 'Plano piloto';
/** a pilot store's Vendedor conversations a month: the top plan's */
const LEGACY_AI_CONVERSATIONS = 1000;

export function planView(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    feeBps: row.fee_bps,
    features: Object.fromEntries(
      PLAN_FEATURES.map((f) => [f, row.features?.[f] === true]),
    ) as unknown as PlanFeatures,
    trialDays: row.trial_days ?? 0,
    recommended: row.recommended === true,
    aiConversations: row.ai_conversations ?? 0,
    aiTrialConversations: row.ai_trial_conversations ?? 0,
  };
}

/** Pilot stores the team set up by hand keep everything they run on, short of PRO features. */
export function legacyPlan(id: string): Plan {
  return {
    id,
    name: LEGACY_PLAN_NAME,
    priceCents: null,
    feeBps: 0,
    features: {
      customDomain: false,
      customSite: false,
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
    },
    trialDays: 0,
    recommended: false,
    aiConversations: LEGACY_AI_CONVERSATIONS,
    aiTrialConversations: 0,
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

/** Where the store's plan stands for its features: on it and paid for, or in its trial. */
async function planStanding(tx: Sql, tenantId: string) {
  const plan = await tenantPlan(tx, tenantId);
  const row = (
    await tx<{ status: string | null; hold: boolean | null }[]>`
      select (select status from subscriptions where tenant_id = ${tenantId}) as status,
             (select billing_hold from store_settings where tenant_id = ${tenantId}) as hold
    `
  )[0];
  // a store the team put on a plan without a subscription counts while it isn't held for payment
  const paid = row?.status ? row.status === 'active' || row.status === 'past_due' : !row?.hold;
  return { plan, paid, trialing: row?.status === 'trialing' };
}

function opens(s: Awaited<ReturnType<typeof planStanding>>, feature: PlanFeature) {
  if (!s.plan.features[feature]) return 'plan' as const;
  if (s.paid || (s.trialing && !PAID_ONLY.has(feature))) return null;
  return 'unpaid' as const;
}

/**
 * 403 PLAN_REQUIRED unless the store's plan includes the feature AND is paid for: tenants.plan
 * names the plan from signup (and a pending upgrade), before any money landed. A trial opens
 * everything its plan has except the domain and the site, which wait for the first payment.
 */
export async function requireFeature(tx: Sql, tenantId: string, feature: PlanFeature) {
  const s = await planStanding(tx, tenantId);
  const why = opens(s, feature);
  if (why === 'plan')
    throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include this", {
      feature,
    });
  if (why === 'unpaid')
    throw new HttpError(403, 'PLAN_REQUIRED', 'this needs the plan to be paid first', {
      feature,
      reason: 'unpaid',
    });
  return s.plan;
}

/** What the store can use right now, feature by feature: the session's answer for the admin. */
export async function planAccess(tx: Sql, tenantId: string) {
  const s = await planStanding(tx, tenantId);
  const open = Object.fromEntries(
    PLAN_FEATURES.map((f) => [f, opens(s, f) === null]),
  ) as unknown as PlanFeatures;
  return { id: s.plan.id, name: s.plan.name, features: open };
}

/** requireFeature's answer as a boolean, for paths that must quietly skip (checkout, jobs). */
export async function planHas(tx: Sql, tenantId: string, feature: PlanFeature) {
  return opens(await planStanding(tx, tenantId), feature) === null;
}

export function formatBRL(cents: number) {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
