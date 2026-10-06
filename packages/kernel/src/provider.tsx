import { injectedTokens } from './injected.ts';
import { reportPreview, usePreviewTokens } from './preview.ts';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createApi, type StoreProfile, type VenduaApi } from './api.ts';
import { vocabularyOf } from './rules/copy.ts';
import { plural } from './rules/format.ts';
import {
  KERNEL_PATHS,
  resolvePaths,
  type StorefrontConfig,
  type StorefrontTokens,
} from './config.ts';
import { setStatusRefresher, showError, showInfo } from './errors.ts';
import { beacon } from './telemetry.ts';
import type { StorefrontBundle } from './composition/registry.ts';
import { setThemeColor } from './theme-color.ts';

// tenant context, api client, token emission — mounted once per storefront root
// (03-storefront-contract.md#required-mounts); Phase 0 uses a minimal in-flight
// cache, not TanStack — the contract pins the hook shape, not the cache

interface KernelCtx {
  api: VenduaApi;
  config: StorefrontConfig;
  /** tokens in force: the store's live tokens (edge-injected, 1.10) over the build's snapshot
   *  of Core's over the config's */
  tokens: StorefrontTokens;
  /** sections + template snapshot the build bundled (virtual:vendua/storefront) */
  storefront: StorefrontBundle;
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

const EMPTY_BUNDLE: StorefrontBundle = { sections: {}, snapshot: { templates: {}, tokens: null } };

export function VenduaProvider({
  config,
  storefront = EMPTY_BUNDLE,
  baseUrl = '',
  children,
}: {
  config: StorefrontConfig;
  storefront?: StorefrontBundle;
  baseUrl?: string;
  children: ReactNode;
}) {
  const tokens = useMemo(
    () => injectedTokens() ?? storefront.snapshot.tokens ?? config.tokens,
    [storefront, config],
  );
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
      tokens,
      storefront,
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
    [config, api, tokens, storefront],
  );

  // analytics beacon + "server truth changed" refetch for unhandled STORE_* errors
  useEffect(() => {
    beacon.configure(baseUrl);
    setStatusRefresher(() => {
      for (const key of ['store', 'surfaces:any', 'surfaces:true', 'surfaces:false'])
        invalidateQuery(key);
    });
    return () => setStatusRefresher(null);
  }, [baseUrl]);

  // Kernel 1.6 — live storefront: Core's payload-free `GET /storefront/v1/events` says which
  // cached reads went stale (catalog, store, surfaces); they refetch in place, so open pages
  // update without a flash of loading. Paused while the tab is hidden; a reconnect resyncs.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const cache = cacheFor(api);
    const refresh = (topics: readonly string[]) => {
      const match = (key: string) =>
        topics.some((t) =>
          t === 'catalog'
            ? key === 'catalog' || key.startsWith('product:')
            : t === 'store'
              ? key === 'store' || key === 'zones'
              : key.startsWith('surfaces:'),
        );
      for (const key of [...cache.keys()]) {
        if (!match(key)) continue;
        const subs = listeners.current.get(key);
        // mounted readers revalidate in place; unmounted ones must not serve a stale entry later
        if (subs?.size) subs.forEach((fn) => fn());
        else cache.delete(key);
      }
      document.dispatchEvent(new CustomEvent('vendua:change', { detail: { topics } }));
    };
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let connected = false;
    const close = () => {
      clearTimeout(timer);
      es?.close();
      es = null;
    };
    const open = () => {
      if (es || document.hidden) return;
      const src = new EventSource(`${baseUrl}/storefront/v1/events`);
      es = src;
      src.addEventListener('hello', () => {
        // anything sent while we weren't connected is lost — catch up on a reconnect
        if (connected) refresh(['catalog', 'store', 'surfaces']);
        connected = true;
        failures = 0;
      });
      src.addEventListener('change', (ev) => {
        try {
          const { topics } = JSON.parse((ev as MessageEvent).data) as { topics: string[] };
          refresh(topics);
        } catch {
          /* a malformed hint is dropped; the next read still tells the truth */
        }
      });
      src.onerror = () => {
        // the browser retries transient drops itself; a hard close (503 at capacity, a
        // proxy without streaming) backs off up to a minute and quietly stays on plain reads
        if (src.readyState !== EventSource.CLOSED) return;
        close();
        timer = setTimeout(open, Math.min(60_000, 2000 * 2 ** failures++));
      };
    };
    const vis = () => {
      if (document.hidden) close();
      else open(); // `hello` resyncs
    };
    document.addEventListener('visibilitychange', vis);
    open();
    return () => {
      document.removeEventListener('visibilitychange', vis);
      close();
    };
  }, [api, baseUrl]);

  // Kernel 1.21: the cart session is the device's — another tab starting or closing a cart
  // rereads this one's bag; back online, every read asks Core again (in place, no flash)
  useEffect(() => {
    const cache = cacheFor(api);
    const refresh = (key: string) => {
      const subs = listeners.current.get(key);
      if (subs?.size) subs.forEach((fn) => fn());
      else cache.delete(key);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'vendua.session') refresh('cart');
    };
    const onOnline = () => {
      for (const key of [...cache.keys()]) refresh(key);
    };
    globalThis.addEventListener?.('storage', onStorage);
    globalThis.addEventListener?.('online', onOnline);
    return () => {
      globalThis.removeEventListener?.('storage', onStorage);
      globalThis.removeEventListener?.('online', onOnline);
    };
  }, [api]);

  // Kernel 1.2 links: `?cart=CODE` restores a shared sacola, `?cupom=CODE` applies a
  // coupon — both land on /sacola with the params stripped (the URL stays shareable once)
  useEffect(() => {
    const loc = globalThis.location;
    if (!loc) return;
    const params = new URLSearchParams(loc.search);
    const share = params.get('cart');
    const coupon = params.get('cupom');
    if (!share && !coupon) return;
    params.delete('cart');
    params.delete('cupom');
    const rest = params.toString();
    // the store's words when its profile is already read (else the defaults)
    const words = () => vocabularyOf(cacheFor(api).get('store')?.data as StoreProfile | undefined);
    globalThis.history?.replaceState(
      null,
      '',
      `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`,
    );
    void (async () => {
      try {
        if (share && /^[A-Za-z0-9]{6,16}$/.test(share)) {
          const { cart, report } = await api.importShare(share);
          invalidateQuery('cart', cart);
          const n = report.skipped.length;
          const v = words();
          showInfo(
            'cart-import',
            n ? `${v.yourBag} voltou em parte` : `${v.yourBag} está de volta`,
            n
              ? `${n} ${plural(n, v.itemSingular, v.itemPlural)} ${plural(n, 'não está disponível', 'não estão disponíveis')} agora.`
              : undefined,
          );
        }
        if (coupon && /^[A-Za-z0-9_-]{3,32}$/.test(coupon)) {
          const cart = await api.applyCoupon(coupon);
          invalidateQuery('cart', cart);
          showInfo(
            'coupon',
            `Cupom ${cart.coupon?.code ?? coupon.toUpperCase()} ${words().inBag}`,
            cart.coupon?.label,
          );
        }
      } catch (err) {
        showError(err);
        return;
      }
      if (share) {
        globalThis.history?.pushState(null, '', KERNEL_PATHS.cart);
        globalThis.dispatchEvent?.(new PopStateEvent('popstate'));
      }
    })();
    // once per client
  }, [api]);

  // Emit design tokens as --v-* vars on :root (02-kernel.md#design-tokens).
  // Inside the admin's editor frame, its draft colours win (Kernel 1.4 preview).
  const draftTokens = usePreviewTokens();
  const shown = draftTokens ?? tokens;
  useEffect(() => reportPreview(tokens, resolvePaths(config)), [tokens, config]);
  useEffect(() => {
    const root = document.documentElement;
    const vars = tokensToVars(shown);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [shown]);

  // the browser chrome wears the page's own background (Android status bar, Safari tint)
  const bg = shown.color.bg;
  const text = shown.color.text;
  useEffect(() => setThemeColor(bg, text), [bg, text]);

  // font-display: swap — contract default; brand fonts must never block first paint
  useEffect(() => {
    const srcs = tokens.font.srcs;
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
  }, [tokens]);

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
    // the maintenance kill switch outranks a healthy Kernel — only notice overlays yield
    const overlay = document.getElementById('vendua-loader-overlay');
    if (overlay?.dataset.mode !== 'maintenance') overlay?.remove();
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

/** Warm a query without subscribing (ProductLink hover/focus) — no-op when cached or in flight. */
export function prefetchQuery<T>(api: VenduaApi, key: string, fetcher: () => Promise<T>) {
  const cache = cacheFor(api);
  const e = cache.get(key);
  if (e?.resolved || e?.inflight) return;
  const runToken = Symbol(key);
  const entry: CacheEntry = { runToken };
  entry.inflight = fetcher()
    .then((data) => {
      if (cache.get(key)?.runToken === runToken) cache.set(key, { resolved: true, data });
    })
    .catch((error: ApiErrorShape) => {
      // same shape as useQuery: a subscriber riding this flight sees the error + can refetch
      if (cache.get(key)?.runToken === runToken) cache.set(key, { resolved: true, error });
    });
  cache.set(key, entry);
}

/** Evicts every cached read whose key matches, so mounted readers refetch in place. */
export function invalidateMatching(match: (key: string) => boolean) {
  for (const live of liveProviders)
    for (const key of [...live.cache.keys()])
      if (match(key)) {
        live.cache.delete(key);
        live.invalidate(key);
      }
}

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
