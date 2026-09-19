import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react';
import { ErrorBoundary } from './error-boundary.tsx';
import { useKernel, useQuery } from './provider.tsx';
import type { Notice, NoticeAction, SurfacesEnvelope } from './api.ts';
import type { SlotKey } from './config.ts';

/**
 * <SystemSurfaces /> — renders server-driven surfaces at fixed mount points
 * (05-system-surfaces.md#placement-points). Phase 0 ships ONLY the generic
 * `system.Notice` renderer: unknown kinds, severities, and action types must
 * degrade gracefully per the forward-compat rules.
 *
 * Overrides: each surface consults the slot registry; an override renders
 * inside an error boundary and falls back to the Kernel default on throw.
 */

const SEVERITIES = new Set(['info', 'warning', 'blocking']);

function severityOf(n: Notice): 'info' | 'warning' | 'blocking' {
  if (n.kind === 'emergency') return 'blocking';
  const s = String(n.severity);
  return SEVERITIES.has(s) ? (s as 'info' | 'warning' | 'blocking') : 'info';
}

function actionToLink(a: NoticeAction): { label: string; href: string } | null {
  // Forward-compat rule 3: unknown action types render as a link if they
  // carry an href, else are omitted.
  if (a.type === 'link' && typeof a.href === 'string') return { label: a.label, href: a.href };
  if (typeof (a as Record<string, unknown>).href === 'string') {
    return { label: a.label, href: (a as Record<string, unknown>).href as string };
  }
  return null;
}

export function GenericNotice({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss?: (() => void) | undefined;
}) {
  const severity = severityOf(notice);
  const links = (notice.actions ?? [])
    .map(actionToLink)
    .filter((x): x is NonNullable<typeof x> => x != null);
  return (
    <div
      className={`v-notice v-notice-${severity}`}
      data-vendua="notice"
      data-kind={notice.kind}
      data-severity={severity}
      role={severity === 'blocking' ? 'alertdialog' : 'status'}
      aria-modal={severity === 'blocking' || undefined}
    >
      <strong className="v-notice-title">{notice.title}</strong>
      {notice.body ? <p className="v-notice-body">{notice.body}</p> : null}
      {links.length > 0 ? (
        <p className="v-notice-actions">
          {links.map((l, i) => (
            <a key={i} className="v-notice-action" href={l.href}>
              {l.label}
            </a>
          ))}
        </p>
      ) : null}
      {notice.dismissible && onDismiss ? (
        <button
          type="button"
          className="v-notice-dismiss"
          aria-label="dispensar"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** Props every `system.*` notice override receives — type overrides as
 *  `ComponentType<NoticeOverrideProps>` instead of hand-narrowing. */
export interface NoticeOverrideProps {
  notice: Notice;
  onDismiss?: () => void;
}

/** Renders a notice through the slot registry: override → error boundary → generic. */
function SlotNotice({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  const { config } = useKernel();
  const slotForKind = `system.${notice.kind
    .split('_')
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join('')}Notice` as SlotKey;
  const overrideFactory = config.overrides?.[slotForKind] ?? config.overrides?.['system.Notice'];

  const Override = useMemo(
    () => (overrideFactory ? lazy(overrideFactory) : null),
    [overrideFactory],
  );

  if (!Override) return <GenericNotice notice={notice} onDismiss={onDismiss} />;
  return (
    <ErrorBoundary
      fallback={<GenericNotice notice={notice} {...(onDismiss ? { onDismiss } : {})} />}
    >
      <Suspense fallback={<GenericNotice notice={notice} />}>
        <Override {...({ notice, onDismiss } as Record<string, unknown>)} />
      </Suspense>
    </ErrorBoundary>
  );
}

function NoticeView({ notice }: { notice: Notice }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <SlotNotice notice={notice} onDismiss={() => setDismissed(true)} />;
}

export function SystemSurfaces({ zoneMatched }: { zoneMatched?: boolean } = {}) {
  const { api } = useKernel();
  // First paint uses edge-injected state when present (zero flicker).
  const injected = (globalThis as Record<string, unknown>).__VENDUA_STATE__ as
    SurfacesEnvelope | undefined;
  // The key carries zoneMatched: a cached envelope from the previous address
  // result must not render for the new one (Review finding).
  const key = `surfaces:${zoneMatched === undefined ? 'any' : zoneMatched}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  // Injected state is only a valid first paint for the unscoped query.
  const envelope = q.data ?? (zoneMatched === undefined ? injected : undefined);

  if (!envelope) return null;
  const now = Date.now();
  const visible = envelope.notices.filter(
    (n) =>
      (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || Date.parse(n.endsAt) > now),
  );
  const blocking = visible.filter((n) => severityOf(n) === 'blocking');
  const banners = visible.filter((n) => severityOf(n) !== 'blocking');

  return (
    <>
      {/* Mount point 1: banner-stack — non-blocking notices, top of viewport. */}
      <div className="v-banner-stack" data-vendua="banner-stack">
        {banners.map((n) => (
          <NoticeView key={n.id} notice={n} />
        ))}
      </div>
      {/* Mount point 2: blocking-overlay — covers the page. */}
      {blocking.length > 0 ? (
        <div className="v-blocking-overlay" data-vendua="blocking-overlay">
          {blocking.map((n) => (
            <SlotNotice key={n.id} notice={n} />
          ))}
        </div>
      ) : null}
      {/* Mount points 3 (consent) and 4 (emergency/loader-owned) are Phase 1+. */}
    </>
  );
}

/** Inline surface region for brand pages (05: SurfaceRegion). */
export function SurfaceRegion({ name }: { name: string }): ReactNode {
  const { api } = useKernel();
  const q = useQuery(`surfaces:region:${name}`, () => api.surfaces());
  const notices = (q.data?.notices ?? []).filter(
    (n) => severityOf(n) !== 'blocking' && (n.payload?.region === name || n.kind === name),
  );
  if (notices.length === 0) return null;
  return (
    <div className="v-surface-region" data-vendua="surface-region" data-region={name}>
      {notices.map((n) => (
        <NoticeView key={n.id} notice={n} />
      ))}
    </div>
  );
}
