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
  /** Duá Copilot, Duá working for the store's people inside the admin (ADR 0034) */
  copilot: boolean;
  /** the PDV: counter sales, mesas and the caixa (ADR 0035) */
  pdv: boolean;
}
export type PlanFeature = keyof PlanFeatures;
export const PLAN_FEATURES: readonly PlanFeature[] = [
  'customDomain',
  'customSite',
  'kds',
  'printing',
  'loyalty',
  'vendedor',
  'copilot',
  'pdv',
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
  /** a store can pick it now; one that isn't is shown, closed (Pangolim waits on own domains) */
  available: boolean;
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
  available: boolean;
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
    available: row.available !== false,
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
      copilot: false,
      pdv: true,
    },
    trialDays: 0,
    recommended: false,
    aiConversations: LEGACY_AI_CONVERSATIONS,
    aiTrialConversations: 0,
    available: false,
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
  return (await storePlan(tx, tenantId, false)).plan;
}

/** tenantPlan in one statement; `standing` adds the subscription's status and the billing hold. */
async function storePlan(tx: Sql, tenantId: string, standing: boolean) {
  const r = (
    await tx<{ id: string; row: PlanRow | null; status: string | null; hold: boolean | null }[]>`
      select coalesce(t.plan, 'spike') as id, to_jsonb(p) as row,
        ${standing ? tx`(select status from subscriptions where tenant_id = ${tenantId})` : tx`null::text`} as status,
        ${standing ? tx`(select billing_hold from store_settings where tenant_id = ${tenantId})` : tx`null::boolean`} as hold
      from (values (1)) one (x)
        left join tenants t on t.id = ${tenantId}
        left join plans p on p.id = coalesce(t.plan, 'spike')
    `
  )[0];
  const id = r?.id ?? 'spike';
  // planRow's guard: an id outside the catalog's shape is a legacy one
  const plan = r?.row && /^[a-z0-9_]{2,30}$/.test(id) ? planView(r.row) : legacyPlan(id);
  return { plan, status: r?.status ?? null, hold: r?.hold ?? null };
}

/**
 * A plan the store can pick itself (signup, "trocar de plano"): in the catalog, public and open.
 * `held` are the plans the store already has or was promised (heldPlans): those stay pickable
 * when they close, so it can still pay for them. `null` leaves the open check to the caller.
 */
export async function publicPlanOr422(
  tx: Sql,
  id: unknown,
  held: readonly string[] | null = [],
): Promise<PlanRow> {
  // staff closing this plan in the CRM takes this lock exclusively: inside the caller's
  // transaction the plan can't close between this read and the subscription it starts
  if (typeof id === 'string' && id.length <= 64)
    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${`plan-available:${id}`}, 0))`;
  const row = typeof id === 'string' ? await planRow(tx, id) : null;
  if (!row || !row.public)
    throw new HttpError(422, 'UNKNOWN_PLAN', 'pick one of the plans offered', { field: 'planId' });
  if (held) openOr409(row, held);
  return row;
}

export function openOr409(row: PlanRow, held: readonly string[] = []) {
  if (row.available === false && !held.includes(row.id))
    throw new HttpError(409, 'PLAN_UNAVAILABLE', 'this plan is not open to new subscriptions yet', {
      field: 'planId',
    });
}

/** The store's plan, and the ones its subscription runs on, waits for or is paying an upgrade to. */
export async function heldPlans(tx: Sql, tenantId: string): Promise<string[]> {
  const r = (
    await tx<{ plans: (string | null)[] }[]>`
      select array[t.plan, s.plan_id, s.pending_plan_id, s.upgrade_plan_id] as plans
      from tenants t left join subscriptions s on s.tenant_id = t.id
      where t.id = ${tenantId}
    `
  )[0];
  return (r?.plans ?? []).filter((p): p is string => !!p);
}

/** Where the store's plan stands for its features: on it and paid for, or in its trial. */
async function planStanding(tx: Sql, tenantId: string) {
  const { plan, status, hold } = await storePlan(tx, tenantId, true);
  // a store the team put on a plan without a subscription counts while it isn't held for payment
  const paid = status ? status === 'active' || status === 'past_due' : !hold;
  return { plan, paid, trialing: status === 'trialing' };
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
