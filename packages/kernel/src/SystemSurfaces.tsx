import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { noticeSeverity } from '@vendua/ui-defaults';
import { useKernel, useQuery } from './provider.tsx';
import { Slot } from './slot.tsx';
import { dismissError, useTransientNotices } from './errors.ts';
import { useConsent } from './hooks.ts';
import { emit } from './telemetry.ts';
import type { Notice, NoticeAction, SurfacesEnvelope } from './api.ts';
import type { ConsentPurpose } from './config.ts';
import { attachToastRegion } from './toast-layer.ts';
import { reducedMotion, SPRING, springEasing } from './spring.ts';

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
        <Toasts notices={transient} />
      </div>
      {/* mount point 2 */}
      {blocking.length > 0 ? <BlockingOverlay notices={blocking} /> : null}
      {/* mount point 3 — mount point 4 (emergency) is v.js's */}
      <ConsentMount />
    </>
  );
}

/** where a swiped toast leaves to (by id); the others drop and fade */
const exitTo = new Map<string, string>();

/** One transient notice: enters from below, swipes away sideways or down, animates out. */
function Toast({
  notice,
  leaving,
  onGone,
}: {
  notice: Notice;
  leaving: boolean;
  onGone: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number; on: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!leaving) return;
    const el = ref.current;
    const gone = () => onGone(notice.id);
    if (!el || typeof el.animate !== 'function') return gone();
    const to = exitTo.get(notice.id) ?? 'translateY(12px) scale(0.96)';
    exitTo.delete(notice.id);
    const a = el.animate(
      [
        { transform: el.style.transform || 'none', opacity: el.style.opacity || 1 },
        { transform: reducedMotion() ? 'none' : to, opacity: 0 },
      ],
      { duration: reducedMotion() ? 120 : 200, easing: 'ease-in', fill: 'forwards' },
    );
    a.finished.then(gone, gone);
  }, [leaving, notice.id, onGone]);

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || leaving) return;
    const dx = e.clientX - d.x;
    const dy = Math.max(0, e.clientY - d.y);
    if (!d.on) {
      if (Math.hypot(dx, dy) < 8) return;
      d.on = true;
      el.setPointerCapture?.(e.pointerId);
    }
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(dx) / 240, dy / 120)));
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d?.on || !el) return;
    const dx = e.clientX - d.x;
    const dy = Math.max(0, e.clientY - d.y);
    const ms = Math.max(1, performance.now() - d.t);
    const fast = Math.hypot(dx, dy) / ms > 0.6;
    if (Math.abs(dx) > 80 || dy > 40 || fast) {
      exitTo.set(
        notice.id,
        Math.abs(dx) >= dy
          ? `translateX(${Math.sign(dx) * 120}%)`
          : `translate(${dx}px, ${dy + 80}px)`,
      );
      dismissError(notice.id);
      return;
    }
    const from = el.style.transform;
    el.style.transform = '';
    el.style.opacity = '';
    if (typeof el.animate === 'function')
      el.animate([{ transform: from }, { transform: 'none' }], springEasing(SPRING));
  };

  return (
    <div
      ref={ref}
      className="v-toast"
      data-part="toast"
      data-leaving={leaving || undefined}
      onPointerDown={(e) => {
        if (e.button === 0)
          drag.current = { x: e.clientX, y: e.clientY, t: performance.now(), on: false };
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <NoticeSlot notice={notice} onDismiss={() => dismissError(notice.id)} />
    </div>
  );
}

/** Transient errors/confirmations, in the top layer above the page, the bag bar and sheets. */
function Toasts({ notices }: { notices: Notice[] }) {
  const [leaving, setLeaving] = useState<Notice[]>([]);
  const prev = useRef<Notice[]>(notices);
  useLayoutEffect(() => {
    const gone = prev.current.filter((p) => !notices.some((n) => n.id === p.id));
    prev.current = notices;
    setLeaving((l) => {
      const kept = l.filter((x) => !notices.some((n) => n.id === x.id));
      const next = [...kept, ...gone.filter((g) => !kept.some((k) => k.id === g.id))];
      return next.length === l.length && next.every((x, i) => x === l[i]) ? l : next;
    });
  }, [notices]);
  const [onGone] = useState(() => (id: string) => setLeaving((l) => l.filter((x) => x.id !== id)));
  const shown = notices.length + leaving.length > 0;
  const region = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (shown) attachToastRegion(region.current);
  }, [shown]);
  if (!shown) return null;
  return (
    <div className="v-toast-region" data-vendua="toast-region" ref={region}>
      {notices.map((n) => (
        <Toast key={n.id} notice={n} leaving={false} onGone={onGone} />
      ))}
      {leaving.map((n) => (
        <Toast key={n.id} notice={n} leaving onGone={onGone} />
      ))}
    </div>
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
