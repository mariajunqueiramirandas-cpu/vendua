import type {
  AiBudgetsSetting,
  AiModelsView,
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

export const emptyRoute = (): RouteDraft => ({
  uid: uid(),
  provider: '',
  model: '',
  // an attestation, not a default: staff turn it on knowing the endpoint retains nothing
  zdr: false,
  inputPerMTok: '',
  outputPerMTok: '',
  cacheReadPerMTok: '',
  cacheWritePerMTok: '',
  timeoutS: '',
});
export const emptyTiers = (): TierDraft => ({ fast: [], strong: [] });

const routeFrom = (r: ModelRouteSetting): RouteDraft => ({
  uid: uid(),
  provider: r.provider,
  model: r.model,
  zdr: r.zdr === true,
  inputPerMTok: str(r.pricing?.inputPerMTok),
  outputPerMTok: str(r.pricing?.outputPerMTok),
  cacheReadPerMTok: str(r.pricing?.cacheReadPerMTok),
  cacheWritePerMTok: str(r.pricing?.cacheWritePerMTok),
  timeoutS: r.timeoutMs == null ? '' : String(r.timeoutMs / 1000),
});
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
  if (PRICE_FIELDS.some((f) => filled(d[f]))) {
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
        for (const f of ['provider', 'model', 'zdr', 'pricing', 'timeoutMs']) out.add(`${p}.${f}`);
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
        if (!r.zdr) errs[`${p}.zdr`] = 'rotas sem retenção zero são recusadas';
        const anyPrice = PRICE_FIELDS.some((f) => filled(r[f]));
        for (const f of PRICE_FIELDS) {
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
