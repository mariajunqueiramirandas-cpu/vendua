import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import { SLOT_DEFAULTS } from '@vendua/ui-defaults';
import { ErrorBoundary } from './error-boundary.tsx';
import { useKernel } from './provider.tsx';
import { SLOT_ALIASES, type SlotComponent, type SlotKey } from './config.ts';
import type { SlotProps } from './slot-props.ts';
import { reportFailure } from './telemetry.ts';

// Every slot: storefront override (if registered) inside an error boundary,
// Kernel default as the fallback — "an outdated override degrades to generic,
// never to broken" (04). A deprecated alias key still reaches its new slot.

const lazyCache = new WeakMap<() => Promise<{ default: SlotComponent }>, SlotComponent>();

function lazyOnce(factory: () => Promise<{ default: SlotComponent }>): SlotComponent {
  let c = lazyCache.get(factory);
  if (!c) lazyCache.set(factory, (c = lazy(factory)));
  return c;
}

export function useSlotOverride(name: SlotKey): SlotComponent | null {
  const { config } = useKernel();
  const factory = useMemo(() => {
    const direct = config.overrides?.[name];
    if (direct) return direct;
    for (const [old, alias] of Object.entries(SLOT_ALIASES))
      if (alias.to === name && config.overrides?.[old as keyof typeof SLOT_ALIASES])
        return config.overrides[old as keyof typeof SLOT_ALIASES]!;
    return undefined;
  }, [config, name]);
  return factory ? lazyOnce(factory) : null;
}

export function Slot<K extends SlotKey>({ name, ...props }: { name: K } & SlotProps[K]) {
  const Default = SLOT_DEFAULTS[name] as unknown as ComponentType<SlotProps[K]>;
  const Override = useSlotOverride(name);
  const p = props as unknown as SlotProps[K];
  const fallback = <Default {...p} />;
  if (!Override) return fallback;
  return (
    <ErrorBoundary
      fallback={fallback}
      onError={(err) =>
        reportFailure({
          kind: 'slot_error',
          target: name,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    >
      <Suspense fallback={fallback}>
        <Override {...(p as Record<string, unknown>)} />
      </Suspense>
    </ErrorBoundary>
  );
}
