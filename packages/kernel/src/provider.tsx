import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createApi, type VenduaApi } from './api.ts';
import type { StorefrontConfig, StorefrontTokens } from './config.ts';

/**
 * VenduaProvider — tenant context, api client, token emission. Every
 * storefront root mounts it once (03-storefront-contract.md#required-mounts).
 *
 * Phase 0: data hooks use a minimal in-flight/result cache rather than
 * TanStack — the public hook shape is what the contract pins, not the cache.
 */

interface KernelCtx {
  api: VenduaApi;
  config: StorefrontConfig;
  /** Shared invalidation counter — bumps refetch hooks subscribed to a key. */
  invalidate: (key: string) => void;
  subscribe: (key: string, fn: () => void) => () => void;
}

const Ctx = createContext<KernelCtx | null>(null);

export function useKernel(): KernelCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useKernel must be used inside <VenduaProvider>');
  return ctx;
}

function tokensToVars(tokens: StorefrontTokens): Record<string, string> {
  const vars: Record<string, string> = {
    '--v-color-bg': tokens.color.bg,
    '--v-color-surface': tokens.color.surface,
    '--v-color-text': tokens.color.text,
    '--v-color-muted': tokens.color.muted,
    '--v-color-accent': tokens.color.accent,
    '--v-color-on-accent': tokens.color.onAccent,
    '--v-color-danger': tokens.color.danger,
    '--v-color-success': tokens.color.success,
    '--v-font-display': tokens.font.display,
    '--v-font-body': tokens.font.body,
    '--v-radius-sm': tokens.radius.sm,
    '--v-radius-md': tokens.radius.md,
    '--v-radius-lg': tokens.radius.lg,
    '--v-motion-duration': tokens.motion.duration,
    '--v-motion-easing': tokens.motion.easing,
  };
  if (tokens.font.mono) vars['--v-font-mono'] = tokens.font.mono;
  if (Array.isArray(tokens.space.scale)) {
    tokens.space.scale.forEach((v, i) => {
      vars[`--v-space-${i}`] = v;
    });
  } else {
    vars['--v-space-scale'] = String(tokens.space.scale);
  }
  return vars;
}

export function VenduaProvider({
  config,
  baseUrl = '',
  children,
}: {
  config: StorefrontConfig;
  baseUrl?: string;
  children: ReactNode;
}) {
  const apiRef = useRef<{ api: VenduaApi; baseUrl: string }>();
  if (!apiRef.current || apiRef.current.baseUrl !== baseUrl) {
    // baseUrl is effectively static — but if it ever changes, the old
    // client's cache and session belong to the previous backend: drop the
    // session and mint a fresh client (its WeakMap cache is separate).
    apiRef.current?.api.clearSession();
    apiRef.current = { api: createApi(baseUrl), baseUrl };
  }
  const api = apiRef.current.api;
  const listeners = useRef(new Map<string, Set<() => void>>());

  const ctx = useMemo<KernelCtx>(
    () => ({
      api,
      config,
      invalidate(key) {
        listeners.current.get(key)?.forEach((fn) => fn());
      },
      subscribe(key, fn) {
        let set = listeners.current.get(key);
        if (!set) listeners.current.set(key, (set = new Set()));
        set.add(fn);
        return () => set!.delete(fn);
      },
    }),
    [config, api],
  );

  // Emit design tokens as --v-* vars on :root (02-kernel.md#design-tokens).
  useEffect(() => {
    const root = document.documentElement;
    const vars = tokensToVars(config.tokens);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [config]);

  // Track this provider's cache while mounted so module-level invalidateQuery
  // can fan out to live providers without pinning unmounted ones.
  useEffect(() => {
    const cache = cacheFor(api);
    liveCaches.add(cache);
    return () => {
      liveCaches.delete(cache);
    };
  }, [api]);

  // Kernel mounted → v.js (the last-resort loader) yields: it removes its
  // blocking overlay and stops owning surfaces. Without the handoff, a
  // blocking notice would render twice — the loader's generic card at max
  // z-index hides the storefront's override.
  useEffect(() => {
    (globalThis as Record<string, unknown>).__VENDUA_KERNEL_MOUNTED__ = true;
    document.getElementById('vendua-loader-overlay')?.remove();
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

// ---- minimal query primitive ----------------------------------------------

interface QueryState<T> {
  data: T | undefined;
  error: ApiErrorShape | undefined;
  loading: boolean;
}

interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// `resolved` is tracked separately from `data`: a fetcher that legitimately
// resolves `undefined` (e.g. useCart without a session) must not read as
// still-loading forever.
//
// The cache is scoped per api client (one per provider): a module-global map
// would leak the previous tenant's store/cart into a remounted provider.
type CacheEntry = {
  resolved?: boolean;
  data?: unknown;
  error?: ApiErrorShape;
  inflight?: Promise<void>;
  /** Identifies the current fetch — a superseded request (refetch during
   *  flight) must not write its stale result over the replacement. */
  runToken?: symbol;
};
// WeakMap so an unmounted provider's cache is GC'd with its api client —
// a strong Map would retain every remount (e.g. forn's per-order session
// reset) forever.
const caches = new WeakMap<VenduaApi, Map<string, CacheEntry>>();

function cacheFor(api: VenduaApi): Map<string, CacheEntry> {
  let c = caches.get(api);
  if (!c) caches.set(api, (c = new Map()));
  return c;
}

export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): QueryState<T> & {
  refetch: () => void;
} {
  const { api, subscribe, invalidate } = useKernel();
  const [, setTick] = useState(0);
  const cache = cacheFor(api);
  const entry = cache.get(key) ?? {};

  useEffect(() => {
    let alive = true;
    const run = () => {
      const e = cache.get(key) ?? {};
      // One fetch per key: a second subscriber's run() during flight just
      // rides the existing promise instead of issuing a duplicate request.
      if (e.inflight) {
        e.inflight.finally(() => {
          if (alive) setTick((t) => t + 1);
        });
        return;
      }
      const runToken = Symbol(key);
      e.runToken = runToken;
      e.inflight = fetcher()
        .then((data) => {
          const cur = cache.get(key);
          if (cur?.runToken === runToken) cache.set(key, { resolved: true, data });
        })
        .catch((error: ApiErrorShape) => {
          const cur = cache.get(key);
          if (cur?.runToken === runToken) cache.set(key, { resolved: true, error });
        })
        .finally(() => {
          if (alive) setTick((t) => t + 1);
        });
      cache.set(key, e);
    };
    if (!entry.inflight && !entry.resolved) run();
    // A subscriber that mounts while a fetch is in flight still needs a tick
    // when it lands — otherwise it can hold a stale cache read.
    entry.inflight?.finally(() => {
      if (alive) setTick((t) => t + 1);
    });
    const unsub = subscribe(key, run);
    return () => {
      alive = false;
      unsub();
    };
    // `api` is a dep: a baseUrl change mints a new client with a fresh cache —
    // without re-running, entries stay unresolved and queries hang loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);

  return {
    data: entry.data as T | undefined,
    error: entry.error,
    loading: !entry.resolved && !entry.error,
    // Deleting alone leaves the key stable so the effect never re-fires —
    // notify subscribers (this hook's `run` included) to actually fetch.
    refetch: () => {
      cache.delete(key);
      invalidate(key);
    },
  };
}

// Live provider caches — maintained by VenduaProvider's mount effect so
// invalidateQuery clears the key for mounted providers only (unmounted
// caches are unreachable through the WeakMap and get GC'd).
const liveCaches = new Set<Map<string, CacheEntry>>();

export function invalidateQuery(key: string) {
  for (const cache of liveCaches) cache.delete(key);
}
