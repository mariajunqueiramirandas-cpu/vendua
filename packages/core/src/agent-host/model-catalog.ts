import { log } from '../platform/log.ts';

// The CRM's model picker: OpenRouter's model list (default routing prices), its zero-data-retention
// endpoints folded per model, and the same model's id on Anthropic, OpenAI or Gemini directly —
// checked against that provider's own list when Core has its key. ZDR prices are the highest
// across a model's ZDR endpoints: OpenRouter may send a call to any of them, and the route price
// feeds the pre-call budget estimate.

export const MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const ZDR_ENDPOINTS_URL = 'https://openrouter.ai/api/v1/endpoints/zdr';

export type DirectProvider = 'anthropic' | 'openai' | 'gemini';

/** each provider's own model list, and the env key that unlocks it (as adaptersFromEnv) */
const PROVIDER_LISTS: Record<
  DirectProvider,
  { secretName: string; request(key: string): { url: string; headers: Record<string, string> } }
> = {
  anthropic: {
    secretName: 'ANTHROPIC_API_KEY',
    request: (key) => ({
      url: 'https://api.anthropic.com/v1/models?limit=1000',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }),
  },
  openai: {
    secretName: 'OPENAI_API_KEY',
    request: (key) => ({
      url: 'https://api.openai.com/v1/models',
      headers: { authorization: `Bearer ${key}` },
    }),
  },
  gemini: {
    secretName: 'GEMINI_API_KEY',
    // the key goes in a header, not `?key=`, so it never sits in a URL an error might print
    request: (key) => ({
      url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      headers: { 'x-goog-api-key': key },
    }),
  },
};
const DIRECT_PROVIDERS = Object.keys(PROVIDER_LISTS) as DirectProvider[];

const TTL_MS = 60 * 60_000;
/** after a failed fetch, serve what we have (or 503) for this long before trying again */
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ENDPOINTS = 10_000;
const MAX_MODELS = 2_000;
// validateSetting's bounds for a route's model id and pricing
const MODEL_RE = /^[A-Za-z0-9._/:@-]+$/;
const MODEL_MAX = 200;
const PRICE_MAX = 1000;

export interface CatalogPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}
export interface CatalogZdr {
  /** how many ZDR endpoints (providers) serve it with tool calls */
  providers: number;
  pricing: CatalogPricing;
}
export interface CatalogDirect {
  provider: DirectProvider;
  model: string;
  /** the id is in the provider's own model list (false: no key, or the list didn't load) */
  verified: boolean;
}
export interface CatalogModel {
  /** OpenRouter's id */
  id: string;
  name: string;
  contextLength: number | null;
  /** OpenRouter's default routing */
  pricing: CatalogPricing;
  zdr: CatalogZdr | null;
  direct: CatalogDirect | null;
}
export interface ModelCatalogView {
  fetchedAt: string;
  source: 'openrouter';
  models: CatalogModel[];
}

/** each provider's model ids, for the providers whose list loaded */
export type ProviderLists = Partial<Record<DirectProvider, Set<string>>>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const validId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MODEL_MAX && MODEL_RE.test(v);

/** "0.0000008645" USD/token → 0.8645 USD/1M tokens; undefined when absent or unusable */
function perMTok(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  // 1e-6 of a dollar per 1M tokens is far below anything a budget can see
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

/** OpenRouter's per-token pricing → per 1M tokens; null when a route couldn't carry it */
function pricingOf(raw: unknown): CatalogPricing | null {
  const p = isObject(raw) ? raw : {};
  const input = perMTok(p.prompt);
  const output = perMTok(p.completion);
  // negative/variable prices (a router model) or prices validateSetting would refuse
  if (input === undefined || output === undefined || input > PRICE_MAX || output > PRICE_MAX)
    return null;
  const pricing: CatalogPricing = { inputPerMTok: input, outputPerMTok: output };
  const cacheRead = perMTok(p.input_cache_read);
  const cacheWrite = perMTok(p.input_cache_write);
  if (cacheRead !== undefined && cacheRead <= PRICE_MAX) pricing.cacheReadPerMTok = cacheRead;
  if (cacheWrite !== undefined && cacheWrite <= PRICE_MAX) pricing.cacheWritePerMTok = cacheWrite;
  return pricing;
}

const contextOf = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null;

// Duá answers through tool calls; a model or endpoint without them can't run it
const takesTools = (v: unknown) => Array.isArray(v) && v.includes('tools');

const maxOpt = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** OpenRouter's /endpoints/zdr body → per model id, its tool-capable ZDR endpoints folded; null
 *  for a model with one OpenRouter could route to but that has no usable price. */
/** A model's ZDR endpoints: how many, and the dearest price among those that have one.
 *  `unpriced` when one of them has no usable price (OpenRouter may still route to it). */
export interface ZdrTally {
  providers: number;
  pricing: CatalogPricing | null;
  unpriced: boolean;
}

export function zdrFromEndpoints(body: unknown): Map<string, ZdrTally> {
  const data = isObject(body) && Array.isArray(body.data) ? body.data : [];
  const out = new Map<string, ZdrTally>();
  for (const e of data.slice(0, MAX_ENDPOINTS)) {
    if (!isObject(e) || !validId(e.model_id) || !takesTools(e.supported_parameters)) continue;
    const id = e.model_id;
    let cur = out.get(id);
    if (!cur) {
      if (out.size >= MAX_MODELS) continue;
      cur = { providers: 0, pricing: null, unpriced: false };
      out.set(id, cur);
    }
    cur.providers += 1;
    const p = pricingOf(e.pricing);
    if (!p) cur.unpriced = true;
    else cur.pricing = maxPricing(cur.pricing, p);
  }
  return out;
}

/** A model's ZDR entry: when some ZDR endpoint can't be priced, the normal price stands in as a
 *  floor (the budget estimate stays on the safe side); a model with no ZDR endpoint is null. */
function zdrOf(t: ZdrTally | undefined, normal: CatalogPricing): CatalogZdr | null {
  if (!t || t.providers === 0) return null;
  const pricing = t.unpriced || !t.pricing ? maxPricing(t.pricing, normal) : t.pricing;
  return { providers: t.providers, pricing };
}

/** The dearer of two prices, field by field. */
export function maxPricing(a: CatalogPricing | null, b: CatalogPricing): CatalogPricing {
  if (!a) return { ...b };
  const out: CatalogPricing = {
    inputPerMTok: Math.max(a.inputPerMTok, b.inputPerMTok),
    outputPerMTok: Math.max(a.outputPerMTok, b.outputPerMTok),
  };
  const cr = maxOpt(a.cacheReadPerMTok, b.cacheReadPerMTok);
  if (cr !== undefined) out.cacheReadPerMTok = cr;
  const cw = maxOpt(a.cacheWritePerMTok, b.cacheWritePerMTok);
  if (cw !== undefined) out.cacheWritePerMTok = cw;
  return out;
}

/** An OpenRouter id → the same model's id on its maker's own API, before any check against that
 *  API's list. Variants (`:free`, `:thinking`…) and open-weight models aren't served there. */
export function directFor(id: string): { provider: DirectProvider; model: string } | null {
  const slash = id.indexOf('/');
  if (slash < 0 || id.includes(':')) return null;
  const maker = id.slice(0, slash);
  const model = id.slice(slash + 1);
  if (!validId(model) || model.includes('/')) return null;
  if (maker === 'openai') return model.startsWith('gpt-oss') ? null : { provider: 'openai', model };
  if (maker === 'google') return model.startsWith('gemini-') ? { provider: 'gemini', model } : null;
  if (maker === 'anthropic' && model.startsWith('claude-'))
    // OpenRouter writes versions with dots (claude-haiku-4.5), Anthropic with dashes
    return { provider: 'anthropic', model: model.replace(/(\d)\.(\d)/g, '$1-$2') };
  return null;
}

function checkDirect(id: string, lists: ProviderLists): CatalogDirect | null {
  const d = directFor(id);
  if (!d) return null;
  const list = lists[d.provider];
  if (!list) return { ...d, verified: false };
  if (list.has(d.model)) return { ...d, verified: true };
  if (d.provider === 'anthropic') {
    // Anthropic lists dated snapshots (claude-3-7-sonnet-20250219), not every alias
    const dated = [...list].filter(
      (m) => m.startsWith(`${d.model}-`) && /^\d{8}$/.test(m.slice(d.model.length + 1)),
    );
    if (dated.length) return { ...d, model: dated.sort().at(-1)!, verified: true };
  }
  return null;
}

/** OpenRouter's /models and /endpoints/zdr bodies → the picker's models (tool-capable only),
 *  sorted by name. */
export function catalogFrom(
  modelsBody: unknown,
  zdrBody: unknown,
  lists: ProviderLists = {},
): CatalogModel[] {
  const data = isObject(modelsBody) && Array.isArray(modelsBody.data) ? modelsBody.data : [];
  const zdr = zdrFromEndpoints(zdrBody);
  const out = new Map<string, CatalogModel>();
  for (const m of data.slice(0, MAX_ENDPOINTS)) {
    if (out.size >= MAX_MODELS) break;
    if (!isObject(m) || !validId(m.id) || out.has(m.id)) continue;
    if (!takesTools(m.supported_parameters)) continue;
    const pricing = pricingOf(m.pricing);
    if (!pricing) continue;
    const rawName = typeof m.name === 'string' ? m.name.trim() : '';
    out.set(m.id, {
      id: m.id,
      name: (rawName || m.id).slice(0, 200),
      contextLength: contextOf(m.context_length),
      pricing,
      zdr: zdrOf(zdr.get(m.id), pricing),
      direct: checkDirect(m.id, lists),
    });
  }
  return [...out.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'),
  );
}

/** A provider's own list body → its model ids (Gemini's come as `models/<id>`). */
export function providerIds(provider: DirectProvider, body: unknown): Set<string> {
  const rows = isObject(body)
    ? provider === 'gemini'
      ? Array.isArray(body.models)
        ? body.models
        : []
      : Array.isArray(body.data)
        ? body.data
        : []
    : [];
  const ids = new Set<string>();
  for (const r of rows.slice(0, MAX_ENDPOINTS)) {
    if (!isObject(r)) continue;
    const raw = provider === 'gemini' ? r.name : r.id;
    const id =
      typeof raw === 'string' && provider === 'gemini' ? raw.replace(/^models\//, '') : raw;
    if (validId(id)) ids.add(id);
  }
  return ids;
}

export interface ModelCatalog {
  /** the cached catalog (refreshed in the background past an hour); null if never fetched */
  get(): Promise<ModelCatalogView | null>;
}

export function createModelCatalog(
  o: {
    fetch?: typeof fetch;
    now?: () => number;
    /** where the direct providers' keys are read (default process.env) */
    env?: Record<string, string | undefined>;
  } = {},
): ModelCatalog {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const env = o.env ?? process.env;
  let good: { at: number; view: ModelCatalogView } | null = null;
  let failedAt = -Infinity;
  let inflight: Promise<void> | null = null;
  // the last list each provider answered with, so one failed refresh doesn't unverify its models
  const lists: ProviderLists = {};

  async function getJson(url: string, headers: Record<string, string>, label: string) {
    const res = await doFetch(url, {
      headers: { accept: 'application/json', ...headers },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${label} ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BODY_BYTES) throw new Error(`${label} body too large`);
    return JSON.parse(await readCapped(res, MAX_BODY_BYTES, label)) as unknown;
  }

  async function loadList(provider: DirectProvider) {
    const spec = PROVIDER_LISTS[provider];
    const key = env[spec.secretName];
    if (!key) return;
    try {
      const { url, headers } = spec.request(key);
      const ids = providerIds(provider, await getJson(url, headers, provider));
      // an empty list is a broken answer, not "the provider has no models"
      if (!ids.size) throw new Error(`${provider} model list empty`);
      lists[provider] = ids;
    } catch (e) {
      log.warn(
        { mod: 'ai-catalog', provider, err: e instanceof Error ? e.message : String(e) },
        'provider model list fetch failed',
      );
    }
  }

  async function refresh() {
    try {
      const [modelsBody, zdrBody] = await Promise.all([
        getJson(MODELS_URL, {}, 'openrouter'),
        getJson(ZDR_ENDPOINTS_URL, {}, 'openrouter'),
        ...DIRECT_PROVIDERS.map(loadList),
      ]);
      // an empty ZDR list would mark every model as retaining data: treat it as broken too
      if (!isObject(zdrBody) || !Array.isArray(zdrBody.data) || !zdrBody.data.length)
        throw new Error('openrouter zdr list empty');
      const models = catalogFrom(modelsBody, zdrBody, lists);
      // an empty list is a broken upstream, not "no models": keep the last good copy
      if (!models.length) throw new Error('openrouter catalog empty');
      const at = now();
      good = { at, view: { fetchedAt: new Date(at).toISOString(), source: 'openrouter', models } };
    } catch (e) {
      failedAt = now();
      log.warn({ mod: 'ai-catalog', err: e }, 'openrouter catalog fetch failed');
    }
  }

  return {
    async get() {
      const t = now();
      const fresh = good && t - good.at < TTL_MS;
      if (!fresh && t - failedAt >= RETRY_MS) {
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        // a stale copy answers now while the refresh runs; only the first load waits for it
        if (!good) await inflight;
      }
      return good?.view ?? null;
    },
  };
}

/** The body as text, read in chunks and abandoned past `max` bytes (a missing or wrong
 *  content-length can't make Core buffer more). */
async function readCapped(res: Response, max: number, label: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`${label} body too large`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
