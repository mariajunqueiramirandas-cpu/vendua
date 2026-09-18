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
  const apiRef = useRef<VenduaApi>();
  if (!apiRef.current) apiRef.current = createApi(baseUrl);
  const listeners = useRef(new Map<string, Set<() => void>>());

  const ctx = useMemo<KernelCtx>(
    () => ({
      api: apiRef.current!,
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
    [config],
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

const cache = new Map<
  string,
  { data?: unknown; error?: ApiErrorShape; inflight?: Promise<void> }
>();

export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): QueryState<T> & {
  refetch: () => void;
} {
  const { subscribe } = useKernel();
  const [, setTick] = useState(0);
  const entry = cache.get(key) ?? {};

  useEffect(() => {
    let alive = true;
    const run = () => {
      const e = cache.get(key) ?? {};
      e.inflight = fetcher()
        .then((data) => {
          cache.set(key, { data });
        })
        .catch((error: ApiErrorShape) => {
          cache.set(key, { error });
        })
        .finally(() => {
          if (alive) setTick((t) => t + 1);
        });
      cache.set(key, e);
    };
    if (!entry.inflight && entry.data === undefined && entry.error === undefined) run();
    const unsub = subscribe(key, run);
    return () => {
      alive = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    data: entry.data as T | undefined,
    error: entry.error,
    loading: entry.data === undefined && entry.error === undefined,
    refetch: () => {
      cache.delete(key);
      setTick((t) => t + 1);
    },
  };
}

export function invalidateQuery(key: string) {
  cache.delete(key);
}
