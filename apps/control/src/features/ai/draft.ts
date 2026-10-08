import type {
  AiBudgetsSetting,
  AiCatalogModel,
  AiEndpoint,
  AiModelsView,
  AiPricing,
  DirectProviderId,
  ModelEffort,
  ModelProviderId,
  ModelRouteSetting,
  ModelRoutesSetting,
  ModelTier,
  TierRoutesSetting,
} from '@/lib/api.ts';

// Same bounds as Core's validateSetting — client checks are for fast feedback, Core decides.
export const TIERS: readonly ModelTier[] = ['fast', 'strong'];
export const PROVIDERS: readonly ModelProviderId[] = [
  'anthropic',
  'openrouter',
  'openai',
  'gemini',
];
export const DIRECT: readonly DirectProviderId[] = ['anthropic', 'openai', 'gemini'];
/** Core runs every Anthropic route on this model, at its list price; effort is the choice */
export const ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT: ModelEffort = 'medium';
export const MAX_ROUTES = 5;
const MODEL_RE = /^[A-Za-z0-9._/:@-]+$/;
const PRICE_MAX = 1000;
const TIMEOUT_S = [1, 300] as const;
export const BUDGET_MAX = 10_000;

/** Number fields stay strings while editing so "1," or "" don't fight the cursor. */
export interface RouteDraft {
  uid: string;
  provider: string;
  model: string;
  zdr: boolean;
  /** OpenRouter endpoint tag; '' = OpenRouter's own routing */
  endpoint: string;
  /** Anthropic only; '' = the default (medium) */
  effort: string;
  inputPerMTok: string;
  outputPerMTok: string;
  cacheReadPerMTok: string;
  cacheWritePerMTok: string;
  timeoutS: string;
}
export type PriceField =
  'inputPerMTok' | 'outputPerMTok' | 'cacheReadPerMTok' | 'cacheWritePerMTok';
export const PRICE_FIELDS: readonly PriceField[] = [
  'inputPerMTok',
  'outputPerMTok',
  'cacheReadPerMTok',
  'cacheWritePerMTok',
];
export type TierDraft = Record<ModelTier, RouteDraft[]>;
export interface Scoped<T> {
  id: string;
  value: T;
}
export interface RoutesDraft {
  default: TierDraft;
  agents: Scoped<TierDraft>[];
  tenants: Scoped<TierDraft>[];
}
export interface BudgetsDraft {
  defaults: Record<string, string>;
  tenants: Scoped<Record<string, string>>[];
}
export type Errors = Record<string, string>;

let seq = 0;
const uid = () => `r${++seq}`;
const str = (n: number | undefined) => (n == null ? '' : String(n));
const parse = (s: string) => {
  const t = s.trim().replace(',', '.');
  return t === '' ? NaN : Number(t);
};
const filled = (s: string) => s.trim() !== '';

export const validModelId = (s: string) => s.length <= 200 && MODEL_RE.test(s);

export const emptyRoute = (): RouteDraft => ({
  uid: uid(),
  provider: '',
  model: '',
  zdr: true,
  endpoint: '',
  effort: '',
  inputPerMTok: '',
  outputPerMTok: '',
  cacheReadPerMTok: '',
  cacheWritePerMTok: '',
  timeoutS: '',
});
export const emptyTiers = (): TierDraft => ({ fast: [], strong: [] });

const routeFrom = (r: ModelRouteSetting): RouteDraft => {
  const anthropic = r.provider === 'anthropic';
  // a route saved before the lock still runs the locked model: show and save that
  const pricing = anthropic ? undefined : r.pricing;
  return {
    uid: uid(),
    provider: r.provider,
    model: anthropic ? ANTHROPIC_MODEL : r.model,
    zdr: r.zdr === true,
    endpoint: r.endpoint ?? '',
    effort: anthropic && r.effort && EFFORTS.includes(r.effort) ? r.effort : '',
    inputPerMTok: str(pricing?.inputPerMTok),
    outputPerMTok: str(pricing?.outputPerMTok),
    cacheReadPerMTok: str(pricing?.cacheReadPerMTok),
    cacheWritePerMTok: str(pricing?.cacheWritePerMTok),
    timeoutS: r.timeoutMs == null ? '' : String(r.timeoutMs / 1000),
  };
};
const tiersFrom = (t: TierRoutesSetting | undefined): TierDraft => ({
  fast: (t?.fast ?? []).map(routeFrom),
  strong: (t?.strong ?? []).map(routeFrom),
});
const scopedFrom = <S, D>(m: Record<string, S> | undefined, f: (s: S) => D): Scoped<D>[] =>
  Object.entries(m ?? {}).map(([id, v]) => ({ id, value: f(v) }));

export const routesFromView = (r: ModelRoutesSetting): RoutesDraft => ({
  default: tiersFrom(r.default),
  agents: scopedFrom(r.agents, tiersFrom),
  tenants: scopedFrom(r.tenants, tiersFrom),
});

function routeOut(d: RouteDraft): ModelRouteSetting {
  const out: ModelRouteSetting = {
    provider: d.provider as ModelProviderId,
    model: d.model.trim(),
    zdr: d.zdr,
  };
  if (filled(d.endpoint)) out.endpoint = d.endpoint.trim();
  if (d.provider === 'anthropic') {
    out.model = ANTHROPIC_MODEL;
    if (filled(d.effort)) out.effort = d.effort as ModelEffort;
  } else if (PRICE_FIELDS.some((f) => filled(d[f]))) {
    out.pricing = { inputPerMTok: parse(d.inputPerMTok), outputPerMTok: parse(d.outputPerMTok) };
    if (filled(d.cacheReadPerMTok)) out.pricing.cacheReadPerMTok = parse(d.cacheReadPerMTok);
    if (filled(d.cacheWritePerMTok)) out.pricing.cacheWritePerMTok = parse(d.cacheWritePerMTok);
  }
  if (filled(d.timeoutS)) out.timeoutMs = Math.round(parse(d.timeoutS) * 1000);
  return out;
}

// An empty list must be left out, not sent: the resolver's `??` only falls through on undefined,
// so `fast: []` on an override would silence that scope instead of inheriting.
function tiersOut(t: TierDraft): TierRoutesSetting | undefined {
  const out: TierRoutesSetting = {};
  for (const tier of TIERS) if (t[tier].length) out[tier] = t[tier].map(routeOut);
  return Object.keys(out).length ? out : undefined;
}
function scopedOut<D, S>(list: Scoped<D>[], f: (d: D) => S | undefined) {
  const out: Record<string, S> = {};
  for (const { id, value } of list) {
    const v = f(value);
    if (v !== undefined) out[id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function routesOut(d: RoutesDraft): ModelRoutesSetting {
  const out: ModelRoutesSetting = {};
  const def = tiersOut(d.default);
  const agents = scopedOut(d.agents, tiersOut);
  const tenants = scopedOut(d.tenants, tiersOut);
  if (def) out.default = def;
  if (agents) out.agents = agents;
  if (tenants) out.tenants = tenants;
  return out;
}

/** a different provider is a different account and model list. OpenRouter enforces zero retention
 *  itself (on by default); on a direct provider it's a claim about the account's contract, so it
 *  starts off until someone confirms it */
export const withProvider = (r: RouteDraft, provider: string): RouteDraft => ({
  ...emptyRoute(),
  uid: r.uid,
  provider,
  model: provider === 'anthropic' ? ANTHROPIC_MODEL : '',
  zdr: provider === 'openrouter' || provider === '' ? r.zdr : false,
  timeoutS: r.timeoutS,
});

/** One pickable model for a route's provider and ZDR choice, priced from the right source. */
export interface ModelOption {
  /** what the route stores: the OpenRouter id, or the id on the provider's own API */
  model: string;
  name: string;
  contextLength: number | null;
  pricing: AiPricing;
  /** OpenRouter with ZDR on: how many zero-retention providers serve it */
  zdrProviders?: number | undefined;
  /** direct: false when the id was derived from OpenRouter's and the server couldn't check it */
  verified: boolean;
}

/** OpenRouter: ZDR on prices by its zero-retention providers; direct: first-party list price. */
export const sourcePricing = (m: AiCatalogModel, provider: string, zdr: boolean) =>
  provider === 'openrouter' ? (zdr ? m.zdr?.pricing : m.pricing) : m.pricing;

/** null: no list for this provider (unknown or not chosen yet) */
export function catalogOptions(
  models: AiCatalogModel[],
  provider: string,
  zdr: boolean,
): ModelOption[] | null {
  const out = new Map<string, ModelOption>();
  if (provider === 'openrouter') {
    for (const m of models) {
      const pricing = sourcePricing(m, provider, zdr);
      if (!pricing) continue;
      out.set(m.id, {
        model: m.id,
        name: m.name,
        contextLength: m.contextLength,
        pricing,
        zdrProviders: zdr ? m.zdr?.providers : undefined,
        verified: true,
      });
    }
  } else if (DIRECT.includes(provider as DirectProviderId)) {
    for (const m of models) {
      const d = m.direct;
      if (d?.provider !== provider || out.has(d.model)) continue;
      out.set(d.model, {
        model: d.model,
        // "Anthropic: Claude Haiku 4.5" under Anthropic already says whose it is
        name: m.name.replace(/^[^:]{1,40}:\s+/, ''),
        contextLength: m.contextLength,
        pricing: m.pricing,
        verified: d.verified,
      });
    }
  } else return null;
  return [...out.values()];
}

export const withPricing = (r: RouteDraft, p: AiPricing): RouteDraft => ({
  ...r,
  inputPerMTok: str(p.inputPerMTok),
  outputPerMTok: str(p.outputPerMTok),
  cacheReadPerMTok: str(p.cacheReadPerMTok),
  cacheWritePerMTok: str(p.cacheWritePerMTok),
});

/** a catalog pick: model id and prices together, so the budget estimate matches; an endpoint
 *  belongs to the model it served */
export const withOption = (r: RouteDraft, o: ModelOption): RouteDraft =>
  withPricing({ ...r, model: o.model, endpoint: '' }, o.pricing);

/** a typed id: the old prices belonged to another model */
export const withCustomModel = (r: RouteDraft, model: string): RouteDraft => ({
  ...r,
  model,
  endpoint: '',
  inputPerMTok: '',
  outputPerMTok: '',
  cacheReadPerMTok: '',
  cacheWritePerMTok: '',
});

/** the draft's input/output price differs from `p` */
export const priceDrifted = (r: RouteDraft, p: AiPricing) =>
  parse(r.inputPerMTok) !== p.inputPerMTok || parse(r.outputPerMTok) !== p.outputPerMTok;

/**
 * On OpenRouter the switch changes which endpoints serve the model, so its price: follow the
 * new source unless the staff set their own price.
 */
export function withZdr(
  r: RouteDraft,
  zdr: boolean,
  models: AiCatalogModel[] | undefined,
  endpoints?: AiEndpoint[],
) {
  const next = { ...r, zdr };
  if (r.provider === 'openrouter' && filled(r.endpoint)) {
    // a pin that keeps data would fail every call under ZDR (no OpenRouter fallbacks)
    const pinned = endpoints?.find((e) => e.tag === r.endpoint);
    return zdr && pinned && !pinned.zdr ? { ...next, endpoint: '' } : next;
  }
  const m = r.provider === 'openrouter' ? models?.find((x) => x.id === r.model.trim()) : undefined;
  const from = m && sourcePricing(m, r.provider, r.zdr);
  const to = m && sourcePricing(m, r.provider, zdr);
  return from && to && !priceDrifted(r, from) ? withPricing(next, to) : next;
}

/** what the route's price follows: the pinned endpoint's, or OpenRouter's routing for its ZDR choice */
export function routeSourcePricing(
  r: RouteDraft,
  endpoints: AiEndpoint[] | undefined,
  models: AiCatalogModel[] | undefined,
): AiPricing | undefined {
  if (r.provider !== 'openrouter') return undefined;
  const tag = r.endpoint.trim();
  if (tag) return endpoints?.find((e) => e.tag === tag)?.pricing;
  const m = models?.find((x) => x.id === r.model.trim());
  return m ? (sourcePricing(m, r.provider, r.zdr) ?? undefined) : undefined;
}

/** pin an endpoint ('' = back to OpenRouter's routing); prices follow unless staff set their own */
export function withEndpoint(
  r: RouteDraft,
  tag: string,
  endpoints: AiEndpoint[] | undefined,
  models: AiCatalogModel[] | undefined,
): RouteDraft {
  const next = { ...r, endpoint: tag };
  const from = routeSourcePricing(r, endpoints, models);
  const to = routeSourcePricing(next, endpoints, models);
  return from && to && !priceDrifted(r, from) ? withPricing(next, to) : next;
}

// Duá's calls are prompt-heavy (system prompt, tools and history in, a short reply out), so input
// tokens dominate the bill: weigh them 3:1 rather than averaging the two prices.
export const blendedPrice = (p: AiPricing) => 0.75 * p.inputPerMTok + 0.25 * p.outputPerMTok;
/** US$/1M floor so a free endpoint scores high but finite (ranks by its speed among free ones) */
const PRICE_FLOOR = 0.01;

/** tokens/s per US$ of blended price per 1M tokens; null when OpenRouter has no speed sample */
export const valueScore = (e: Pick<AiEndpoint, 'tps' | 'pricing'>): number | null =>
  e.tps == null || !(e.tps > 0) ? null : e.tps / Math.max(blendedPrice(e.pricing), PRICE_FLOOR);

/** an endpoint a route can pin: with ZDR on, only zero-retention ones (others fail the call) */
export const endpointAllowed = (e: Pick<AiEndpoint, 'zdr'>, zdr: boolean) => !zdr || e.zdr;

/** best value first, unmeasured after (cheapest first), then by tag for a stable order */
export function rankEndpoints<E extends Pick<AiEndpoint, 'tag' | 'tps' | 'pricing'>>(
  list: E[],
): E[] {
  return list
    .map((e) => ({ e, s: valueScore(e) }))
    .sort(
      (a, b) =>
        (b.s ?? -1) - (a.s ?? -1) ||
        blendedPrice(a.e.pricing) - blendedPrice(b.e.pricing) ||
        a.e.tag.localeCompare(b.e.tag),
    )
    .map((x) => x.e);
}

/** the measured endpoint with the most tokens/s per dollar the route may use; null if none */
export function bestValueEndpoint<E extends Pick<AiEndpoint, 'tag' | 'tps' | 'pricing' | 'zdr'>>(
  list: E[],
  zdr: boolean,
): E | null {
  const top = rankEndpoints(list.filter((e) => endpointAllowed(e, zdr)))[0];
  return top && valueScore(top) != null ? top : null;
}

export const scopePath = (kind: 'default' | 'agents' | 'tenants', id?: string) =>
  kind === 'default' ? 'default' : `${kind}.${id}`;

/** Every path the editor renders a message slot for — server errors land on the closest one. */
export function routePaths(d: RoutesDraft): Set<string> {
  const out = new Set<string>(['agents', 'tenants']);
  const add = (scope: string, t: TierDraft) => {
    out.add(scope);
    for (const tier of TIERS) {
      out.add(`${scope}.${tier}`);
      t[tier].forEach((_, i) => {
        const p = `${scope}.${tier}.${i}`;
        out.add(p);
        for (const f of ['provider', 'model', 'zdr', 'endpoint', 'effort', 'pricing', 'timeoutMs'])
          out.add(`${p}.${f}`);
        for (const f of PRICE_FIELDS) out.add(`${p}.pricing.${f}`);
      });
    }
  };
  add('default', d.default);
  for (const a of d.agents) add(scopePath('agents', a.id), a.value);
  for (const t of d.tenants) add(scopePath('tenants', t.id), t.value);
  return out;
}

export function validateRoutes(d: RoutesDraft): Errors {
  const errs: Errors = {};
  const tiers = (scope: string, t: TierDraft) => {
    for (const tier of TIERS) {
      if (t[tier].length > MAX_ROUTES) errs[`${scope}.${tier}`] = `até ${MAX_ROUTES} rotas`;
      t[tier].forEach((r, i) => {
        const p = `${scope}.${tier}.${i}`;
        if (!PROVIDERS.includes(r.provider as ModelProviderId))
          errs[`${p}.provider`] = 'escolha o provedor';
        const m = r.model.trim();
        if (!m) errs[`${p}.model`] = 'informe o modelo';
        else if (m.length > 200) errs[`${p}.model`] = 'até 200 caracteres';
        else if (!MODEL_RE.test(m)) errs[`${p}.model`] = 'só letras, números e . _ / : @ -';
        const ep = r.endpoint.trim();
        if (ep) {
          if (r.provider !== 'openrouter') errs[`${p}.endpoint`] = 'só em rotas da OpenRouter';
          else if (!validModelId(ep)) errs[`${p}.endpoint`] = 'provedor inválido';
        }
        if (filled(r.effort)) {
          if (r.provider !== 'anthropic') errs[`${p}.effort`] = 'só em rotas da Anthropic';
          else if (!EFFORTS.includes(r.effort as ModelEffort))
            errs[`${p}.effort`] = 'esforço inválido';
        }
        // the price fields are hidden there: Core prices Anthropic routes itself
        const prices = r.provider === 'anthropic' ? [] : PRICE_FIELDS;
        const anyPrice = prices.some((f) => filled(r[f]));
        for (const f of prices) {
          const required = f === 'inputPerMTok' || f === 'outputPerMTok';
          if (!filled(r[f])) {
            if (anyPrice && required) errs[`${p}.pricing.${f}`] = 'obrigatório com preço';
            continue;
          }
          const n = parse(r[f]);
          if (!Number.isFinite(n) || n < 0 || n > PRICE_MAX)
            errs[`${p}.pricing.${f}`] = `de 0 a ${PRICE_MAX}`;
        }
        if (filled(r.timeoutS)) {
          const n = parse(r.timeoutS);
          if (!Number.isFinite(n) || n < TIMEOUT_S[0] || n > TIMEOUT_S[1])
            errs[`${p}.timeoutMs`] = `de ${TIMEOUT_S[0]} a ${TIMEOUT_S[1]} s`;
        }
      });
    }
  };
  tiers('default', d.default);
  for (const a of d.agents) tiers(scopePath('agents', a.id), a.value);
  for (const t of d.tenants) tiers(scopePath('tenants', t.id), t.value);
  return errs;
}

// ── budgets ──────────────────────────────────────────────────────────────────

export function budgetKeys(view: AiModelsView): string[] {
  const keys = new Set<string>();
  for (const a of view.agents) if (a.budgetKey) keys.add(a.budgetKey);
  for (const [k, v] of Object.entries(view.budgets)) if (k !== 'tenants' && v != null) keys.add(k);
  for (const m of Object.values(view.budgets.tenants ?? {}))
    for (const k of Object.keys(m)) keys.add(k);
  return [...keys];
}

export function budgetsFromView(b: AiBudgetsSetting): BudgetsDraft {
  const defaults: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) if (typeof v === 'number') defaults[k] = String(v);
  const tenants = scopedFrom(b.tenants, (m) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])),
  );
  return { defaults, tenants };
}

const numbers = (m: Record<string, string>) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (filled(v)) out[k] = parse(v);
  return Object.keys(out).length ? out : undefined;
};

export function budgetsOut(d: BudgetsDraft): AiBudgetsSetting {
  const out: AiBudgetsSetting = { ...numbers(d.defaults) };
  const tenants = scopedOut(d.tenants, numbers);
  if (tenants) out.tenants = tenants;
  return out;
}

export function budgetPaths(d: BudgetsDraft, keys: string[]): Set<string> {
  const out = new Set<string>(['tenants', ...keys]);
  for (const t of d.tenants) {
    out.add(`tenants.${t.id}`);
    for (const k of keys) out.add(`tenants.${t.id}.${k}`);
  }
  return out;
}

export function validateBudgets(d: BudgetsDraft): Errors {
  const errs: Errors = {};
  const check = (path: string, v: string) => {
    if (!filled(v)) return;
    const n = parse(v);
    if (!Number.isFinite(n) || n < 0 || n > BUDGET_MAX) errs[path] = 'de 0 a 10.000';
  };
  for (const [k, v] of Object.entries(d.defaults)) check(k, v);
  for (const t of d.tenants)
    for (const [k, v] of Object.entries(t.value)) check(`tenants.${t.id}.${k}`, v);
  return errs;
}

// ── server errors ────────────────────────────────────────────────────────────

/**
 * Core's 422 `details.field` → the closest slot the editor renders ('*' when none fits).
 * Accepts `a.b[0].c` and a leading `settings.agent_runtime.<key>.`.
 */
export function resolveField(field: unknown, known: Set<string>): string {
  if (typeof field !== 'string' || !field) return '*';
  let p = field
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^(settings\.)?(agent_runtime\.)?(routes|budgets)\./, '');
  while (p) {
    if (known.has(p)) return p;
    const cut = p.lastIndexOf('.');
    p = cut < 0 ? '' : p.slice(0, cut);
  }
  return '*';
}

/** "settings.agent_runtime.routes.default.fast.0.zdr rotas sem…" → "rotas sem…" */
export const cleanMessage = (msg: string) =>
  msg.replace(/^settings\.agent_runtime\.\w+\.\S+\s+/, '').trim() || msg;
