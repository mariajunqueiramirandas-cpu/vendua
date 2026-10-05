import { log } from '../platform/log.ts';

// OpenRouter's public list of zero-data-retention endpoints, folded into one entry per model for
// the CRM's model picker. Prices are the highest across a model's ZDR endpoints: OpenRouter may
// send a call to any of them, and the route price feeds the pre-call budget estimate.

export const ZDR_ENDPOINTS_URL = 'https://openrouter.ai/api/v1/endpoints/zdr';

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
export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number | null;
  /** how many ZDR endpoints (providers) serve it with tool calls */
  providers: number;
  pricing: CatalogPricing;
}
export interface ModelCatalogView {
  fetchedAt: string;
  source: 'openrouter';
  models: CatalogModel[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** "0.0000008645" USD/token → 0.8645 USD/1M tokens; undefined when absent or unusable */
function perMTok(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  // 1e-6 of a dollar per 1M tokens is far below anything a budget can see
  return Math.round(n * 1e6 * 1e6) / 1e6;
}

const maxOpt = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

/** OpenRouter's /endpoints/zdr body → the picker's models (tools-capable only), sorted by name. */
export function catalogFromZdr(body: unknown): CatalogModel[] {
  const data = isObject(body) && Array.isArray(body.data) ? body.data : [];
  const byId = new Map<string, CatalogModel>();
  // OpenRouter may route a call to any ZDR endpoint of a model: one it can't price makes the
  // model's "dearest" price unknowable, so the model is left out
  const unpriced = new Set<string>();
  for (const e of data.slice(0, MAX_ENDPOINTS)) {
    if (!isObject(e)) continue;
    const id = e.model_id;
    if (typeof id !== 'string' || !id || id.length > MODEL_MAX || !MODEL_RE.test(id)) continue;
    const params = Array.isArray(e.supported_parameters) ? e.supported_parameters : [];
    // Duá answers through tool calls; an endpoint without them can't run it
    if (!params.includes('tools')) continue;
    const p = isObject(e.pricing) ? e.pricing : {};
    const input = perMTok(p.prompt);
    const output = perMTok(p.completion);
    // negative/variable prices (a router model) or prices validateSetting would refuse
    if (input === undefined || output === undefined || input > PRICE_MAX || output > PRICE_MAX) {
      unpriced.add(id);
      continue;
    }
    const cacheRead = perMTok(p.input_cache_read);
    const cacheWrite = perMTok(p.input_cache_write);
    const ctx =
      typeof e.context_length === 'number' && Number.isFinite(e.context_length)
        ? Math.max(0, Math.floor(e.context_length))
        : null;
    const rawName = typeof e.model_name === 'string' ? e.model_name.trim() : '';
    const name = (rawName || id).slice(0, 200);
    const cur = byId.get(id);
    if (!cur) {
      if (byId.size >= MAX_MODELS) continue;
      const pricing: CatalogPricing = { inputPerMTok: input, outputPerMTok: output };
      if (cacheRead !== undefined && cacheRead <= PRICE_MAX) pricing.cacheReadPerMTok = cacheRead;
      if (cacheWrite !== undefined && cacheWrite <= PRICE_MAX)
        pricing.cacheWritePerMTok = cacheWrite;
      byId.set(id, { id, name, contextLength: ctx, providers: 1, pricing });
      continue;
    }
    cur.providers += 1;
    cur.contextLength =
      cur.contextLength === null
        ? ctx
        : ctx === null
          ? cur.contextLength
          : Math.max(ctx, cur.contextLength);
    const pr = cur.pricing;
    pr.inputPerMTok = Math.max(pr.inputPerMTok, input);
    pr.outputPerMTok = Math.max(pr.outputPerMTok, output);
    const cr = maxOpt(pr.cacheReadPerMTok, cacheRead);
    if (cr !== undefined && cr <= PRICE_MAX) pr.cacheReadPerMTok = cr;
    const cw = maxOpt(pr.cacheWritePerMTok, cacheWrite);
    if (cw !== undefined && cw <= PRICE_MAX) pr.cacheWritePerMTok = cw;
  }
  return [...byId.values()]
    .filter((m) => !unpriced.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
}

export interface ModelCatalog {
  /** the cached catalog (refreshed in the background past an hour); null if never fetched */
  get(): Promise<ModelCatalogView | null>;
}

export function createModelCatalog(
  o: {
    fetch?: typeof fetch;
    now?: () => number;
    url?: string;
  } = {},
): ModelCatalog {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const url = o.url ?? ZDR_ENDPOINTS_URL;
  let good: { at: number; view: ModelCatalogView } | null = null;
  let failedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  async function refresh() {
    try {
      const res = await doFetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`openrouter ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > MAX_BODY_BYTES) throw new Error('openrouter catalog too large');
      const text = await readCapped(res, MAX_BODY_BYTES);
      const models = catalogFromZdr(JSON.parse(text));
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
async function readCapped(res: Response, max: number): Promise<string> {
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
      throw new Error('openrouter catalog too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
