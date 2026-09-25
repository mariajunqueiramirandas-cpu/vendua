import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ErrorBoundary } from './error-boundary.tsx';
import { useKernel, useQuery } from './provider.tsx';
import type { Notice, NoticeAction, SurfacesEnvelope } from './api.ts';
import type { SlotKey } from './config.ts';

// server-driven surfaces at fixed mount points (05-system-surfaces.md);
// unknown kinds/severities/action types degrade per the forward-compat rules,
// overrides render inside an error boundary with the generic notice as fallback

const SEVERITIES = new Set(['info', 'warning', 'blocking']);

function severityOf(n: Notice): 'info' | 'warning' | 'blocking' {
  if (n.kind === 'emergency') return 'blocking';
  const s = String(n.severity);
  return SEVERITIES.has(s) ? (s as 'info' | 'warning' | 'blocking') : 'info';
}

function actionToLink(a: NoticeAction): { label: string; href: string } | null {
  // forward-compat: unknown action types render as a link if they carry href
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

// props every `system.*` notice override receives
export interface NoticeOverrideProps {
  notice: Notice;
  onDismiss?: () => void;
}

// override → error boundary → generic fallback
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
  // key carries zoneMatched so a cached envelope can't render for a new result
  const key = `surfaces:${zoneMatched === undefined ? 'any' : zoneMatched}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  // Injected state is only a valid first paint for the unscoped query.
  const envelope = q.data ?? (zoneMatched === undefined ? injected : undefined);

  // schedule one re-render at the nearest future startsAt/endsAt boundary
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!envelope) return;
    const now = Date.now();
    let nearest = Infinity;
    for (const n of envelope.notices) {
      for (const b of [n.startsAt, n.endsAt]) {
        if (!b) continue;
        const t = Date.parse(b);
        if (t > now && t < nearest) nearest = t;
      }
    }
    if (nearest === Infinity) return;
    const id = setTimeout(() => setTick((t) => t + 1), nearest - now + 50);
    return () => clearTimeout(id);
  }, [envelope]);

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
      {/* mount point 1 */}
      <div className="v-banner-stack" data-vendua="banner-stack">
        {banners.map((n) => (
          <NoticeView key={n.id} notice={n} />
        ))}
      </div>
      {/* mount point 2 */}
      {blocking.length > 0 ? (
        <div className="v-blocking-overlay" data-vendua="blocking-overlay">
          {blocking.map((n) => (
            <SlotNotice key={n.id} notice={n} />
          ))}
        </div>
      ) : null}
      {/* mount points 3 (consent) and 4 (emergency/loader-owned) are Phase 1+ */}
    </>
  );
}

// inline surface region (05: SurfaceRegion)
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
