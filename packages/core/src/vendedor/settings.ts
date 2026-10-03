import { HttpError } from '../platform/http.ts';
import type { Sql } from '../platform/db.ts';

// The merchant's controls (sales-agent.md §5). Defaults are the design's recommendations
// (§10 open decision 3), not owner decisions: change them here when the owner rules.

export type Coverage = 'rehearsal' | 'when_slow' | 'after_hours' | 'always';
export type Tone = 'relaxed' | 'balanced' | 'formal';
export type IncentiveReason = 'recovery' | 'first_order' | 'hesitation';

export interface StoreAgentSettings {
  name: string;
  disclose: boolean;
  tone: Tone;
  voice: string;
  coverage: Coverage;
  slowAfterMin: 1 | 2 | 5;
  capabilities: { closeOrder: boolean; sendPix: boolean; suggest: boolean; coupons: boolean };
  pinnedPairings: { whenCategoryId: string; suggestProductId: string }[];
  handoff: {
    complaint: boolean;
    allergy: boolean;
    aboveCents: number | null;
    newCashCustomer: boolean;
  };
  humanSilenceMin: number;
  unknownNumbers: 'shoppers_only' | 'all';
  recovery: { enabled: boolean; delayMin: number };
  incentives: null | {
    couponIds: string[];
    reasons: IncentiveReason[];
    minOrderCents: number;
    monthlyBudgetCents: number;
    perCustomerDays: number;
  };
  pixOnlyAfterCancels: number | null;
  voiceReplies: boolean;
}

export const DEFAULT_SETTINGS: StoreAgentSettings = {
  name: 'Ana',
  disclose: true,
  tone: 'balanced',
  voice: '',
  coverage: 'when_slow',
  slowAfterMin: 2,
  capabilities: { closeOrder: true, sendPix: true, suggest: true, coupons: false },
  pinnedPairings: [],
  handoff: { complaint: true, allergy: true, aboveCents: null, newCashCustomer: false },
  humanSilenceMin: 30,
  unknownNumbers: 'shoppers_only',
  recovery: { enabled: true, delayMin: 15 },
  incentives: null,
  pixOnlyAfterCancels: null,
  voiceReplies: false,
};

export interface StoreAgentRow {
  enabled: boolean;
  settings: StoreAgentSettings;
  onboarding: Record<string, unknown>;
  packVersion: number;
  enabledAt: Date | null;
  firstSaleAt: Date | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stored settings over the defaults, field by field: a row written by an older Core still reads. */
export function withDefaults(stored: unknown): StoreAgentSettings {
  const s = isObj(stored) ? stored : {};
  const d = DEFAULT_SETTINGS;
  const sub = <T extends object>(k: string, base: T): T =>
    isObj(s[k]) ? ({ ...base, ...(s[k] as object) } as T) : base;
  return {
    ...d,
    ...(s as Partial<StoreAgentSettings>),
    capabilities: sub('capabilities', d.capabilities),
    handoff: sub('handoff', d.handoff),
    recovery: sub('recovery', d.recovery),
    pinnedPairings: Array.isArray(s.pinnedPairings)
      ? (s.pinnedPairings as StoreAgentSettings['pinnedPairings'])
      : [],
    incentives: isObj(s.incentives) ? (s.incentives as StoreAgentSettings['incentives']) : null,
  };
}

export async function loadAgent(tx: Sql, tenantId: string): Promise<StoreAgentRow> {
  const [row] = await tx<
    {
      enabled: boolean;
      settings: unknown;
      onboarding: Record<string, unknown>;
      pack_version: string;
      enabled_at: Date | null;
      first_sale_at: Date | null;
    }[]
  >`select enabled, settings, onboarding, pack_version, enabled_at, first_sale_at
    from store_agent where tenant_id = ${tenantId}`;
  return {
    enabled: row?.enabled ?? false,
    settings: withDefaults(row?.settings),
    onboarding: row?.onboarding ?? {},
    packVersion: Number(row?.pack_version ?? 1),
    enabledAt: row?.enabled_at ?? null,
    firstSaleAt: row?.first_sale_at ?? null,
  };
}

// ── validation of a merchant's patch ─────────────────────────────────────────

type Role = 'owner' | 'manager' | 'attendant';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(field: string, message: string): never {
  throw new HttpError(422, 'BAD_REQUEST', message, { field });
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') bad(field, `${field} must be true or false`);
  return v;
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    bad(field, `${field} must be an integer between ${min} and ${max}`);
  return v;
}

function oneOf<T extends string | number>(v: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) bad(field, `${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}

function uuids(v: unknown, field: string, max: number): string[] {
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || !UUID.test(x)))
    bad(field, `${field} must be up to ${max} ids`);
  return [...new Set(v as string[])];
}

/** Which fields a role may change (sales-agent-ux.md §8). Owner: on/off, disclosure, money. */
const OWNER_ONLY = new Set(['enabled', 'disclose', 'incentives', 'capabilities.coupons']);

export interface SettingsPatch {
  enabled?: boolean;
  settings: StoreAgentSettings;
  /** Ids the caller must check belong to the store (categories, products, coupons). */
  refs: { categoryIds: string[]; productIds: string[]; couponIds: string[] };
  changed: string[];
}

/**
 * Applies a partial patch over the current settings. Unknown keys and out-of-range values are
 * 422; fields above the caller's role are 403. Ids are returned for the caller to check against
 * the store's own rows (an unknown one is 422 there).
 */
export function parseSettingsPatch(
  body: unknown,
  current: StoreAgentSettings,
  role: Role,
): SettingsPatch {
  if (!isObj(body)) bad('body', 'expected an object');
  const next: StoreAgentSettings = structuredClone(current);
  const changed: string[] = [];
  const refs = {
    categoryIds: [] as string[],
    productIds: [] as string[],
    couponIds: [] as string[],
  };
  let enabled: boolean | undefined;
  const mark = (k: string) => {
    if (OWNER_ONLY.has(k) && role !== 'owner')
      throw new HttpError(403, 'FORBIDDEN', 'only the owner can change this', {
        need: 'owner',
        field: k,
      });
    changed.push(k);
  };

  for (const [k, v] of Object.entries(body)) {
    switch (k) {
      case 'enabled':
        mark(k);
        enabled = bool(v, k);
        break;
      case 'name': {
        if (typeof v !== 'string' || !v.trim() || v.trim().length > 30)
          bad(k, 'name must be 1–30 characters');
        if (/[\n\r{}<>]/.test(v)) bad(k, 'name has characters that are not allowed');
        mark(k);
        next.name = v.trim();
        break;
      }
      case 'disclose':
        mark(k);
        next.disclose = bool(v, k);
        break;
      case 'tone':
        mark(k);
        next.tone = oneOf(v, k, ['relaxed', 'balanced', 'formal'] as const);
        break;
      case 'voice':
        if (typeof v !== 'string' || v.length > 1000) bad(k, 'voice must be up to 1000 characters');
        mark(k);
        next.voice = v.trim();
        break;
      case 'coverage':
        mark(k);
        next.coverage = oneOf(v, k, ['rehearsal', 'when_slow', 'after_hours', 'always'] as const);
        break;
      case 'slowAfterMin':
        mark(k);
        next.slowAfterMin = oneOf(v, k, [1, 2, 5] as const);
        break;
      case 'capabilities': {
        if (!isObj(v)) bad(k, 'capabilities must be an object');
        for (const [ck, cv] of Object.entries(v)) {
          if (!['closeOrder', 'sendPix', 'suggest', 'coupons'].includes(ck))
            bad(`capabilities.${ck}`, 'unknown capability');
          mark(`capabilities.${ck}`);
          next.capabilities[ck as keyof StoreAgentSettings['capabilities']] = bool(
            cv,
            `capabilities.${ck}`,
          );
        }
        break;
      }
      case 'pinnedPairings': {
        if (!Array.isArray(v) || v.length > 20) bad(k, 'up to 20 pairings');
        next.pinnedPairings = v.map((p, i) => {
          if (
            !isObj(p) ||
            typeof p.whenCategoryId !== 'string' ||
            typeof p.suggestProductId !== 'string'
          )
            bad(`${k}.${i}`, 'pairing needs whenCategoryId and suggestProductId');
          if (!UUID.test(p.whenCategoryId) || !UUID.test(p.suggestProductId))
            bad(`${k}.${i}`, 'pairing ids must be uuids');
          refs.categoryIds.push(p.whenCategoryId);
          refs.productIds.push(p.suggestProductId);
          return { whenCategoryId: p.whenCategoryId, suggestProductId: p.suggestProductId };
        });
        mark(k);
        break;
      }
      case 'handoff': {
        if (!isObj(v)) bad(k, 'handoff must be an object');
        for (const [hk, hv] of Object.entries(v)) {
          const f = `handoff.${hk}`;
          if (hk === 'aboveCents')
            next.handoff.aboveCents = hv === null ? null : int(hv, f, 100, 10_000_000);
          else if (['complaint', 'allergy', 'newCashCustomer'].includes(hk))
            (next.handoff as unknown as Record<string, boolean>)[hk] = bool(hv, f);
          else bad(f, 'unknown handoff rule');
          mark(f);
        }
        break;
      }
      case 'humanSilenceMin':
        mark(k);
        next.humanSilenceMin = int(v, k, 5, 240);
        break;
      case 'unknownNumbers':
        mark(k);
        next.unknownNumbers = oneOf(v, k, ['shoppers_only', 'all'] as const);
        break;
      case 'recovery': {
        if (!isObj(v)) bad(k, 'recovery must be an object');
        for (const [rk, rv] of Object.entries(v)) {
          if (rk === 'enabled') next.recovery.enabled = bool(rv, 'recovery.enabled');
          else if (rk === 'delayMin') next.recovery.delayMin = int(rv, 'recovery.delayMin', 5, 120);
          else bad(`recovery.${rk}`, 'unknown recovery field');
        }
        mark(k);
        break;
      }
      case 'incentives': {
        mark(k);
        if (v === null) {
          next.incentives = null;
          break;
        }
        if (!isObj(v)) bad(k, 'incentives must be an object or null');
        const couponIds = uuids(v.couponIds ?? [], 'incentives.couponIds', 10);
        if (!couponIds.length) bad('incentives.couponIds', 'pick at least one coupon');
        const reasons = v.reasons;
        if (
          !Array.isArray(reasons) ||
          !reasons.length ||
          reasons.some((r) => !['recovery', 'first_order', 'hesitation'].includes(r as string))
        )
          bad('incentives.reasons', 'reasons must be recovery, first_order or hesitation');
        refs.couponIds.push(...couponIds);
        next.incentives = {
          couponIds,
          reasons: [...new Set(reasons as IncentiveReason[])],
          minOrderCents: int(v.minOrderCents ?? 0, 'incentives.minOrderCents', 0, 10_000_000),
          monthlyBudgetCents: int(
            v.monthlyBudgetCents,
            'incentives.monthlyBudgetCents',
            0,
            10_000_000,
          ),
          perCustomerDays: int(v.perCustomerDays ?? 30, 'incentives.perCustomerDays', 1, 365),
        };
        break;
      }
      case 'pixOnlyAfterCancels':
        mark(k);
        next.pixOnlyAfterCancels = v === null ? null : int(v, k, 1, 10);
        break;
      case 'voiceReplies':
        mark(k);
        next.voiceReplies = bool(v, k);
        break;
      default:
        bad(k, `unknown setting ${k}`);
    }
  }
  return { ...(enabled === undefined ? {} : { enabled }), settings: next, refs, changed };
}

/** The greeting the merchant previews and the shopper reads first. */
export function introduction(s: StoreAgentSettings, storeName: string): string {
  return s.disclose
    ? `${s.name}, assistente virtual da ${storeName}`
    : `${s.name}, da ${storeName}`;
}
