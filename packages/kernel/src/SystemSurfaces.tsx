import { useEffect, useRef, useState, type ReactNode } from 'react';
import { noticeSeverity } from '@vendua/ui-defaults';
import { useKernel, useQuery } from './provider.tsx';
import { Slot } from './slot.tsx';
import { dismissError, useTransientNotices } from './errors.ts';
import { useConsent } from './hooks.ts';
import { emit } from './telemetry.ts';
import type { Notice, NoticeAction, SurfacesEnvelope } from './api.ts';
import type { ConsentPurpose } from './config.ts';

// Server-driven surfaces at fixed mount points (05-system-surfaces.md): banner
// stack, blocking overlay, consent; the emergency mount belongs to v.js. Unknown
// kinds/severities/actions degrade per the forward-compat rules; every notice
// renders through its slot (override → error boundary → Kernel default).

const shown = new Set<string>();

function NoticeSlot({ notice, onDismiss }: { notice: Notice; onDismiss?: () => void }) {
  useEffect(() => {
    if (shown.has(notice.id)) return;
    shown.add(notice.id);
    emit('notice_shown', { kind: notice.kind, severity: noticeSeverity(notice) });
  }, [notice]);
  const onAction = (a: NoticeAction) =>
    emit('notice_action', { kind: notice.kind, severity: noticeSeverity(notice), action: a.type });
  const dismiss = onDismiss ? { onDismiss } : {};
  const resumesAt =
    typeof notice.payload?.resumesAt === 'string' ? notice.payload.resumesAt : undefined;
  switch (notice.kind) {
    case 'store_paused':
      return (
        <Slot
          name="system.PauseNotice"
          notice={notice}
          actions={notice.actions ?? []}
          {...(resumesAt ? { resumesAt } : {})}
          {...dismiss}
        />
      );
    case 'store_closed':
      return (
        <Slot
          name="system.StoreClosedNotice"
          notice={notice}
          {...(resumesAt ? { opensAt: resumesAt } : {})}
          {...dismiss}
        />
      );
    case 'promo':
    case 'promo_notice':
      return <Slot name="system.PromoNotice" notice={notice} {...dismiss} />;
    case 'emergency':
      return <Slot name="system.EmergencyOverlay" notice={notice} />;
    default:
      return <Slot name="system.Notice" notice={notice} onAction={onAction} {...dismiss} />;
  }
}

function NoticeView({ notice }: { notice: Notice }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <NoticeSlot notice={notice} onDismiss={() => setDismissed(true)} />;
}

const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  analytics: 'Métricas de uso',
  marketing: 'Ofertas personalizadas',
};

/** Mount point 3 — only when the store asks for non-essential purposes. */
function ConsentMount() {
  const { config } = useKernel();
  const { consent, decide } = useConsent();
  const purposes = config.consent?.purposes ?? [];
  if (purposes.length === 0 || consent) return null;
  return (
    <Slot
      name="system.ConsentBanner"
      purposes={purposes.map((id) => ({ id, label: PURPOSE_LABEL[id] }))}
      onAccept={(ids) => decide(ids)}
      onReject={() => decide([])}
    />
  );
}

/** Blocking notices take focus so keyboard/screen-reader users land on them. */
function BlockingOverlay({ notices }: { notices: Notice[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="alertdialog"]')?.setAttribute('tabindex', '-1');
    ref.current?.querySelector<HTMLElement>('[role="alertdialog"]')?.focus({ preventScroll: true });
  }, [notices.length]);
  return (
    <div className="v-blocking-overlay" data-vendua="blocking-overlay" ref={ref}>
      {notices.map((n) => (
        <NoticeSlot key={n.id} notice={n} />
      ))}
    </div>
  );
}

export function SystemSurfaces({ zoneMatched }: { zoneMatched?: boolean } = {}) {
  const { api } = useKernel();
  // First paint uses edge-injected state when present (zero flicker).
  const injected = (globalThis as Record<string, unknown>).__VENDUA_STATE__ as
    SurfacesEnvelope | undefined;
  // key carries zoneMatched so a cached envelope can't render for a new result
  const key = `surfaces:${zoneMatched === undefined ? 'any' : zoneMatched}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  const envelope = q.data ?? (zoneMatched === undefined ? injected : undefined);
  const transient = useTransientNotices();

  // re-render at the nearest future startsAt/endsAt boundary
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
    const id = setTimeout(() => setTick((t) => t + 1), Math.min(nearest - now + 50, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [envelope]);

  const now = Date.now();
  const visible = (envelope?.notices ?? []).filter(
    (n) =>
      (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || Date.parse(n.endsAt) > now),
  );
  const blocking = visible.filter((n) => noticeSeverity(n) === 'blocking');
  const banners = visible.filter((n) => noticeSeverity(n) !== 'blocking');

  return (
    <>
      {/* mount point 1 */}
      <div className="v-banner-stack" data-vendua="banner-stack" aria-live="polite">
        {banners.map((n) => (
          <NoticeView key={n.id} notice={n} />
        ))}
        {transient.length > 0 ? (
          <div className="v-toast-region" data-vendua="toast-region">
            {transient.map((n) => (
              <NoticeSlot key={n.id} notice={n} onDismiss={() => dismissError(n.id)} />
            ))}
          </div>
        ) : null}
      </div>
      {/* mount point 2 */}
      {blocking.length > 0 ? <BlockingOverlay notices={blocking} /> : null}
      {/* mount point 3 — mount point 4 (emergency) is v.js's */}
      <ConsentMount />
    </>
  );
}

/** Inline surface region a brand section may place (05 — SurfaceRegion). */
export function SurfaceRegion({ name }: { name: string }): ReactNode {
  const { api } = useKernel();
  const q = useQuery('surfaces:any', () => api.surfaces());
  const notices = (q.data?.notices ?? []).filter(
    (n) => noticeSeverity(n) !== 'blocking' && (n.payload?.region === name || n.kind === name),
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
