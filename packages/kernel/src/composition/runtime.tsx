import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  PAGE_CONTENT,
  type BlockInstance,
  type PageId,
  type PageTemplate,
  type SectionInstance,
  type TemplateSet,
} from '@vendua/templates';
import { ErrorBoundary } from '../error-boundary.tsx';
import { useKernel, useQuery } from '../provider.tsx';
import { reportFailure } from '../telemetry.ts';
import { DEFAULT_TEMPLATES } from '../sdk/defaults.ts';
import { buildRegistry, type RegisteredComponent } from './registry.ts';
import { resolveSettings, type SectionSchema } from './schema.ts';

// Template renderer (17): a page is a list of sections, sections hold blocks in
// named areas. Unknown types render nothing and are reported; every section and
// block sits in its own error boundary so one broken piece never takes the page.

const RegistryCtx = createContext<Map<string, RegisteredComponent> | null>(null);

export interface PageContextValue {
  page: PageId;
  params: Readonly<Record<string, string | undefined>>;
}
const PageCtx = createContext<PageContextValue>({ page: 'home', params: {} });

interface SectionCtxValue {
  instance: SectionInstance;
  schema: SectionSchema;
}
const SectionCtx = createContext<SectionCtxValue | null>(null);

/** Which page and route params a section/block is rendering for (product slug etc.). */
export function usePageContext(): PageContextValue {
  return useContext(PageCtx);
}

export function PageContextProvider({
  value,
  children,
}: {
  value: PageContextValue;
  children: ReactNode;
}) {
  return <PageCtx.Provider value={value}>{children}</PageCtx.Provider>;
}

export function useRegistry(): Map<string, RegisteredComponent> {
  return useContext(RegistryCtx) ?? EMPTY_REGISTRY;
}
const EMPTY_REGISTRY = new Map<string, RegisteredComponent>();

/** `sdk` is injected by the router so this module never imports SDK code (no cycle). */
export function RegistryProvider({
  sdk,
  children,
}: {
  sdk: RegisteredComponent[];
  children: ReactNode;
}) {
  const { storefront } = useKernel();
  const reg = useMemo(() => buildRegistry(sdk, storefront.sections), [sdk, storefront]);
  return <RegistryCtx.Provider value={reg}>{children}</RegistryCtx.Provider>;
}

const reported = new Set<string>();
function reportOnce(kind: 'section_unknown' | 'block_unknown', target: string, message: string) {
  if (reported.has(`${kind}:${target}`)) return;
  reported.add(`${kind}:${target}`);
  reportFailure({ kind, target, message });
}

/** Live templates from Core (`/state?templates=1`) win per page; the build's
 *  snapshot is last-known-good; Kernel defaults cover a store with neither. */
export function useTemplateSet(): TemplateSet {
  const { api, storefront } = useKernel();
  const q = useQuery('state:templates', () => api.state(true));
  return useMemo(
    () => ({
      ...DEFAULT_TEMPLATES,
      ...storefront.snapshot.templates,
      ...(q.data?.templates ?? {}),
    }),
    [storefront, q.data],
  );
}

export function useTemplate(page: PageId): PageTemplate | undefined {
  return useTemplateSet()[page];
}

function Unknown({ kind, type }: { kind: 'section_unknown' | 'block_unknown'; type: string }) {
  useEffect(() => {
    reportOnce(
      kind,
      type,
      `no ${kind === 'section_unknown' ? 'section' : 'block'} registered for '${type}' in this build`,
    );
  }, [kind, type]);
  return null;
}

export function SectionView({ instance }: { instance: SectionInstance }) {
  const reg = useRegistry();
  const entry = reg.get(instance.type);
  if (!entry || entry.schema.kind !== 'section')
    return <Unknown kind="section_unknown" type={instance.type} />;
  const settings = resolveSettings(entry.schema.settings, instance.settings);
  const { Component } = entry;
  return (
    <ErrorBoundary
      fallback={null}
      resetKey={instance}
      onError={(err) =>
        reportFailure({
          kind: 'section_error',
          target: `${instance.type}#${instance.id}`,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    >
      <SectionCtx.Provider value={{ instance, schema: entry.schema }}>
        <div
          data-section={instance.type}
          data-section-id={instance.id}
          style={{ display: 'contents' }}
        >
          <Component settings={settings as never} id={instance.id} />
        </div>
      </SectionCtx.Provider>
    </ErrorBoundary>
  );
}

function BlockView({ instance }: { instance: BlockInstance }) {
  const reg = useRegistry();
  const entry = reg.get(instance.type);
  if (!entry || entry.schema.kind !== 'block')
    return <Unknown kind="block_unknown" type={instance.type} />;
  const settings = resolveSettings(entry.schema.settings, instance.settings);
  const { Component } = entry;
  return (
    <ErrorBoundary
      fallback={null}
      resetKey={instance}
      onError={(err) =>
        reportFailure({
          kind: 'section_error',
          target: `${instance.type}#${instance.id}`,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    >
      <div data-block={instance.type} data-block-id={instance.id} style={{ display: 'contents' }}>
        <Component settings={settings as never} id={instance.id} />
      </div>
    </ErrorBoundary>
  );
}

/** Whether the current section's `area` holds a known block of `category`. */
export function useAreaHas(area: string, category: string): boolean {
  const ctx = useContext(SectionCtx);
  const reg = useRegistry();
  return (ctx?.instance.blocks?.[area] ?? []).some((b) => {
    const e = reg.get(b.type);
    return e?.schema.kind === 'block' && e.schema.category === category;
  });
}

/** Renders the blocks the template lists for `name` in the current section —
 *  only categories the area accepts, at most `max`. */
export function BlockArea({
  name,
  className,
  only,
}: {
  name: string;
  className?: string;
  /** render just these categories (a section splitting one area across positions) */
  only?: readonly string[];
}) {
  const ctx = useContext(SectionCtx);
  const reg = useRegistry();
  if (!ctx) return null;
  const spec = ctx.schema.areas?.[name];
  const listed = ctx.instance.blocks?.[name] ?? [];
  if (!spec || listed.length === 0) return null;
  const accepted = listed
    .filter((b) => {
      const entry = reg.get(b.type);
      // unknown blocks still render (→ nothing + report); known ones must fit the area
      if (!entry) return !only;
      return (
        entry.schema.kind === 'block' &&
        spec.accepts.includes(entry.schema.category) &&
        (!only || only.includes(entry.schema.category))
      );
    })
    .slice(0, spec.max ?? Infinity);
  if (accepted.length === 0) return null;
  return (
    <div className={className} data-area={name}>
      {accepted.map((b) => (
        <BlockView key={b.id} instance={b} />
      ))}
    </div>
  );
}

export function TemplateView({
  template,
  only,
}: {
  template: PageTemplate;
  only?: (s: SectionInstance) => boolean;
}) {
  return (
    <>
      {template.sections
        // the layout's page-content marker can't be disabled away — pages would vanish
        .filter((s) => (!s.disabled || s.type === PAGE_CONTENT) && (only ? only(s) : true))
        .map((s) => (
          <SectionView key={s.id} instance={s} />
        ))}
    </>
  );
}
