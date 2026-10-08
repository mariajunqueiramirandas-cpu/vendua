import type {
  ChatMessage,
  Json,
  JsonObject,
  ModelRequest,
  ModelResponse,
  Usage,
} from '../types.ts';
import { CircuitBreaker, LatencyTracker, type BreakerOpts } from './breaker.ts';
import { createPiiVault, redactRequest, restoreResponse } from './pii.ts';
import type {
  CostEstimate,
  GenerateOpts,
  ModelGateway,
  ModelRoute,
  Pricing,
  ProviderAdapter,
  ProviderRequest,
  RouteResolver,
} from './types.ts';

// ── errors ────────────────────────────────────────────────────────────────────

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    opts: { status?: number; retryable?: boolean; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.status = opts.status;
    this.retryable =
      opts.retryable ?? (opts.status === undefined ? true : isRetryableStatus(opts.status));
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export class NoRouteError extends Error {
  override readonly name: string = 'NoRouteError';
  constructor(
    readonly tenantId: string,
    readonly agentId: string,
    readonly tier: string,
  ) {
    super(`no model route for ${agentId}/${tier} (tenant ${tenantId})`);
  }
}

/**
 * The name from when every route had to be ZDR (until 2026-10-05). The gateway still throws this
 * subclass when a request has no route at all, so `instanceof` on either name holds.
 */
export class NoZdrRouteError extends NoRouteError {
  override readonly name: string = 'NoZdrRouteError';
}

export interface RouteFailure {
  provider: string;
  model: string;
  status?: number;
  error: string;
}

export class AllRoutesFailedError extends Error {
  override readonly name = 'AllRoutesFailedError';
  constructor(readonly failures: RouteFailure[]) {
    super(
      `all model routes failed: ${failures.map((f) => `${f.provider}/${f.model}: ${f.error}`).join('; ')}`,
    );
  }
}

export type BudgetScope = 'turn' | 'subject' | 'tenant';

/** Thrown by a `Meter`; the gateway lets it through without calling a provider. */
export class BudgetExceededError extends Error {
  override readonly name = 'BudgetExceededError';
  constructor(
    message: string,
    readonly scope: BudgetScope,
  ) {
    super(message);
  }
}

// ── shared adapter plumbing ───────────────────────────────────────────────────

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A Retry-After header (seconds or an HTTP date) in ms, capped at 90 s. */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 90_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 90_000) : undefined;
}

export function withTimeout(signal: AbortSignal, timeoutMs: number | undefined): AbortSignal {
  return timeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : signal;
}

/** POSTs JSON; a non-2xx becomes a `ProviderError` carrying status and Retry-After. */
export async function postJson(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  label: string,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    const retryAfter = retryAfterMs(res.headers);
    throw new ProviderError(`${label} ${res.status}: ${text.slice(0, 300)}`, {
      status: res.status,
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(`${label}: response is not JSON`, { retryable: true });
  }
}

/** Tool arguments as an object: string args are parsed, anything unusable is kept for the model to see. */
export function toolArgs(raw: Json | undefined): JsonObject {
  if (raw === undefined || raw === null || raw === '') return {};
  let value: Json = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as Json;
    } catch {
      return { __invalid_json: raw.slice(0, 500) };
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return { __invalid_json: (typeof raw === 'string' ? raw : JSON.stringify(raw)).slice(0, 500) };
}

// ── cost ──────────────────────────────────────────────────────────────────────

export function costUsd(usage: Omit<Usage, 'costUsd'>, pricing: Pricing): number {
  const read = pricing.cacheReadPerMTok ?? pricing.inputPerMTok * 0.1;
  const write = pricing.cacheWritePerMTok ?? pricing.inputPerMTok * 1.25;
  return (
    (usage.inputTokens * pricing.inputPerMTok +
      usage.cacheReadTokens * read +
      usage.cacheWriteTokens * write +
      usage.outputTokens * pricing.outputPerMTok) /
    1_000_000
  );
}

function messageChars(m: ChatMessage): number {
  if (m.role === 'tool') return m.content.length + m.name.length;
  if (m.role === 'assistant') {
    return (
      m.text.length +
      m.toolCalls.reduce((n, c) => n + c.name.length + JSON.stringify(c.args).length, 0)
    );
  }
  return m.parts.reduce(
    (n, p) =>
      n +
      (p.type === 'text'
        ? p.text.length
        : p.type === 'image'
          ? (p.description?.length ?? 0) + 1000
          : (p.transcript?.length ?? 0)),
    0,
  );
}

/** Pessimistic: all input uncached, output at `maxTokens`. */
export function estimateCost(
  req: Omit<ProviderRequest, 'model'>,
  pricing: Pricing | undefined,
): CostEstimate {
  const chars =
    req.system.reduce((n, b) => n + b.text.length, 0) +
    req.messages.reduce((n, m) => n + messageChars(m), 0) +
    (req.volatile?.length ?? 0) +
    (req.tools.length ? JSON.stringify(req.tools).length : 0);
  const inputTokens = Math.ceil(chars / 4);
  const maxOutputTokens = req.maxTokens;
  return {
    inputTokens,
    maxOutputTokens,
    costUsd: pricing
      ? (inputTokens * pricing.inputPerMTok + maxOutputTokens * pricing.outputPerMTok) / 1_000_000
      : 0,
  };
}

// ── gateway ───────────────────────────────────────────────────────────────────

export interface GatewayOpts {
  adapters: ProviderAdapter[];
  routes: RouteResolver;
  clock?: { now(): Date };
  /** Hedge delay for a route with fewer than `hedgeMinSamples` latencies; after that, its p95. */
  hedgeAfterMs?: number;
  hedgeMinSamples?: number;
  breaker?: BreakerOpts;
  /** One retry per route on a transient error, after this backoff (Retry-After, capped at `maxMs`). */
  retry?: { baseMs?: number; maxMs?: number };
  /** For routes without `timeoutMs`. */
  defaultTimeoutMs?: number;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

const RETRYABLE_MESSAGE = /429|quota|rate.?limit|resource_exhausted|overload|temporarily|5\d\d/i;

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  const name = (e as { name?: unknown } | null)?.name;
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'TimeoutError') return new ProviderError('timeout', { retryable: true, cause: e });
  // fetch rejects with a TypeError on network failures
  const retryable = name === 'TypeError' || RETRYABLE_MESSAGE.test(message);
  return new ProviderError(message, { retryable, cause: e });
}

export function createGateway(opts: GatewayOpts): ModelGateway {
  const clock = opts.clock ?? { now: () => new Date() };
  const now = () => clock.now().getTime();
  const adapters = new Map(opts.adapters.map((a) => [a.id, a]));
  const breaker = new CircuitBreaker(opts.breaker, now);
  const latency = new LatencyTracker({ minSamples: opts.hedgeMinSamples ?? 20 });
  const hedgeAfterMs = opts.hedgeAfterMs ?? 8_000;
  const baseMs = opts.retry?.baseMs ?? 500;
  const maxMs = opts.retry?.maxMs ?? 4_000;
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 120_000;

  async function call(
    adapter: ProviderAdapter,
    route: ModelRoute,
    preq: ProviderRequest,
    gen: GenerateOpts,
  ): Promise<{ out: ModelResponse; hedged: boolean }> {
    const key = `${route.provider}/${route.model}`;
    const timeoutMs = route.timeoutMs ?? defaultTimeoutMs;
    const start = (ctrl: AbortController) => {
      const signals = [ctrl.signal, AbortSignal.timeout(timeoutMs)];
      if (gen.signal) signals.push(gen.signal);
      return adapter.generate(preq, AbortSignal.any(signals));
    };

    if (!gen.hedge) {
      const t0 = now();
      const out = await start(new AbortController());
      latency.record(key, now() - t0);
      return { out, hedged: false };
    }

    return new Promise((resolve, reject) => {
      const t0 = now();
      const primary = new AbortController();
      let hedge: AbortController | null = null;
      let settled = false;
      let pending = 0;
      let firstError: unknown;

      const launch = (ctrl: AbortController, isHedge: boolean) => {
        pending++;
        const s = now();
        start(ctrl).then(
          (out) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            latency.record(key, now() - s);
            // the aborted primary's elapsed time is a lower bound on its latency; keep it
            if (isHedge) latency.record(key, now() - t0);
            (isHedge ? primary : hedge)?.abort();
            resolve({ out, hedged: hedge !== null });
          },
          (err: unknown) => {
            if (settled) return;
            pending--;
            firstError ??= err;
            if (pending > 0) return;
            settled = true;
            clearTimeout(timer);
            reject(firstError);
          },
        );
      };

      const timer = setTimeout(
        () => {
          if (settled) return;
          hedge = new AbortController();
          launch(hedge, true);
        },
        latency.p95(key) ?? hedgeAfterMs,
      );
      launch(primary, false);
    });
  }

  return {
    async generate(req: ModelRequest, gen: GenerateOpts = {}): Promise<ModelResponse> {
      const started = now();
      const { meta, tier, ...rest } = req;
      const routes = await opts.routes.routes(meta.tenantId, meta.agentId, tier);
      if (routes.length === 0) throw new NoZdrRouteError(meta.tenantId, meta.agentId, tier);

      const vault = createPiiVault();
      const base = redactRequest(rest, vault);
      const pricingRoute = routes.find((r) => breaker.state(r.provider) !== 'open') ?? routes[0]!;
      const outputTokens = adapters.get(pricingRoute.provider)?.outputTokens?.({
        ...base,
        model: pricingRoute.model,
        ...(pricingRoute.effort ? { effort: pricingRoute.effort } : {}),
      });
      await gen.meter?.before(
        estimateCost(
          outputTokens === undefined ? base : { ...base, maxTokens: outputTokens },
          pricingRoute.pricing,
        ),
      );

      const failures: RouteFailure[] = [];
      for (const route of routes) {
        const adapter = adapters.get(route.provider);
        if (!adapter) {
          failures.push({ provider: route.provider, model: route.model, error: 'no adapter' });
          continue;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!breaker.tryAcquire(route.provider)) {
            failures.push({ provider: route.provider, model: route.model, error: 'circuit open' });
            break;
          }
          try {
            const { out, hedged } = await call(
              adapter,
              route,
              {
                ...base,
                model: route.model,
                zdr: route.zdr === true,
                ...(route.endpoint ? { endpoint: route.endpoint } : {}),
                ...(route.effort ? { effort: route.effort } : {}),
              },
              gen,
            );
            breaker.success(route.provider);
            const res = finish(out, route, hedged, started);
            await gen.meter?.after(res.usage);
            return restoreResponse(res, vault);
          } catch (e) {
            if (gen.signal?.aborted) throw gen.signal.reason ?? e;
            const err = toProviderError(e);
            // a 4xx means the provider answered: it's our request, not its health
            if (err.retryable) breaker.failure(route.provider);
            else breaker.success(route.provider);
            failures.push({
              provider: route.provider,
              model: route.model,
              ...(err.status === undefined ? {} : { status: err.status }),
              error: err.message,
            });
            if (!err.retryable || attempt > 0) break;
            await sleep(Math.min(err.retryAfterMs ?? baseMs, maxMs), gen.signal);
          }
        }
      }
      throw new AllRoutesFailedError(failures);
    },
  };

  function finish(
    out: ModelResponse,
    route: ModelRoute,
    hedged: boolean,
    started: number,
  ): ModelResponse {
    const toolCalls = out.toolCalls.map((c, i) => ({
      id: c.id || `call_${i}`,
      name: c.name,
      args: toolArgs(c.args),
    }));
    let usage = out.usage;
    const tokens =
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    if (!(usage.costUsd > 0) && tokens > 0 && route.pricing) {
      usage = { ...usage, costUsd: costUsd(usage, route.pricing) };
    }
    return {
      ...out,
      toolCalls,
      usage,
      provider: route.provider,
      model: out.model || route.model,
      latencyMs: now() - started,
      finish: toolCalls.length > 0 && out.finish === 'stop' ? 'tool_calls' : out.finish,
      ...(hedged ? { hedged: true } : {}),
    };
  }
}
