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

// tenant context, api client, token emission — mounted once per storefront root
// (03-storefront-contract.md#required-mounts); Phase 0 uses a minimal in-flight
// cache, not TanStack — the contract pins the hook shape, not the cache

interface KernelCtx {
  api: VenduaApi;
  config: StorefrontConfig;
  /** bumps refetch hooks subscribed to a key */
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
    // baseUrl change: the old client's cache/session belong to the previous
    // backend — drop the session and mint a fresh client
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

  // font-display: swap — contract default; brand fonts must never block first paint
  useEffect(() => {
    const srcs = config.tokens.font.srcs;
    if (!srcs?.length) return;
    const style = document.createElement('style');
    style.dataset.vendua = 'fonts';
    style.textContent = srcs
      .map(
        (s) =>
          `@font-face{font-family:${JSON.stringify(s.family)};` +
          `src:url(${JSON.stringify(s.src)});font-display:swap;` +
          (s.weight != null ? `font-weight:${s.weight};` : '') +
          (s.style ? `font-style:${s.style};` : '') +
          '}',
      )
      .join('');
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [config]);

  // track this provider's cache + notifier while mounted so invalidateQuery
  // reaches live providers only
  useEffect(() => {
    const live = { cache: cacheFor(api), invalidate: ctx.invalidate };
    liveProviders.add(live);
    return () => {
      liveProviders.delete(live);
    };
  }, [api, ctx.invalidate]);

  // mounted → v.js (the last-resort loader) yields and removes its overlay;
  // without the handoff a blocking notice renders twice
  useEffect(() => {
    (globalThis as Record<string, unknown>).__VENDUA_KERNEL_MOUNTED__ = true;
    document.getElementById('vendua-loader-overlay')?.remove();
  }, []);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

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

// `resolved` tracked separately from `data`: a fetcher resolving undefined
// (useCart w/o session) must not stay loading forever. Cache is per-api-client:
// a module-global map would leak the previous tenant's data into a remount.
type CacheEntry = {
  resolved?: boolean;
  data?: unknown;
  error?: ApiErrorShape;
  inflight?: Promise<void>;
  /** superseded requests must not write over the replacement */
  runToken?: symbol;
};
// WeakMap so an unmounted provider's cache GCs with its api client
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
      // one fetch per key: concurrent subscribers ride the in-flight promise
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
    // errored entries retry on mount/invalidate — else a transient failure wedges
    if (!entry.inflight && (!entry.resolved || entry.error)) run();
    // a subscriber mounting mid-flight still needs a tick when it lands
    entry.inflight?.finally(() => {
      if (alive) setTick((t) => t + 1);
    });
    const unsub = subscribe(key, run);
    return () => {
      alive = false;
      unsub();
    };
    // `api` dep: a baseUrl change mints a fresh client/cache — without
    // re-running, queries hang loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);

  return {
    data: entry.data as T | undefined,
    error: entry.error,
    loading: !entry.resolved && !entry.error,
    // delete alone keeps the key stable so the effect never re-fires — notify
    refetch: () => {
      cache.delete(key);
      invalidate(key);
    },
  };
}

// mounted providers only — unmounted caches are WeakMap-GC'd
const liveProviders = new Set<{
  cache: Map<string, CacheEntry>;
  invalidate: (key: string) => void;
}>();

export function invalidateQuery(key: string, data?: unknown) {
  // evict + notify so mounted hooks refetch; seed when the mutation already
  // holds the fresh value (cart mutations return Cart) — an evict→refetch gap
  // re-fires checkout's `items.length` effects and loops setDelivery calls
  for (const live of liveProviders) {
    if (data !== undefined) {
      live.cache.set(key, { resolved: true, data });
    } else {
      live.cache.delete(key);
    }
    live.invalidate(key);
  }
}
