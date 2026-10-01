import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useKernel, useQuery } from './provider.tsx';
import { Slot } from './slot.tsx';
import { dismissError, useTransientNotices } from './errors.ts';
import { useConsent, useNotices, useStore } from './hooks.ts';
import { isBlocking, noticeSeverity, visibleNotices } from './rules/notices.ts';
import { emit } from './telemetry.ts';
import type { Notice, NoticeAction, SurfacesEnvelope } from './api.ts';
import type { ConsentPurpose } from './config.ts';
import { attachToastRegion, subscribeToastHost, toastHost } from './toast-layer.ts';
import { blockSheet } from './transitions.tsx';
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
  // the moment is in the store's zone, not the shopper's
  const { store } = useStore();
  const time = store?.hours.timezone ? { timeZone: store.hours.timezone } : {};
  switch (notice.kind) {
    case 'store_paused':
      return (
        <Slot
          name="system.PauseNotice"
          notice={notice}
          actions={notice.actions ?? []}
          {...(resumesAt ? { resumesAt } : {})}
          {...time}
          {...dismiss}
        />
      );
    case 'store_closed':
      return (
        <Slot
          name="system.StoreClosedNotice"
          notice={notice}
          {...(resumesAt ? { opensAt: resumesAt } : {})}
          {...time}
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

  const visible = visibleNotices(envelope?.notices ?? []);
  const blocking = visible.filter(isBlocking);
  const banners = visible.filter((n) => !isBlocking(n));
  // a blocking notice is above everything: an open bag sheet (top layer) gets out of its way
  const blocked = blocking.length > 0;
  useEffect(() => blockSheet(blocked), [blocked]);

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
  const exit = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    if (!leaving) {
      // raised again while on its way out
      exit.current?.cancel();
      exit.current = null;
      return;
    }
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
    exit.current = a;
    a.finished.then(gone, () => {});
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
      aria-hidden={leaving || undefined}
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

interface ToastItem {
  notice: Notice;
  leaving: boolean;
}

/** a notice keeps its place (and DOM node) while it leaves */
function mergeToasts(items: ToastItem[], notices: Notice[]): ToastItem[] {
  const next = items.map((it) => {
    const live = notices.find((n) => n.id === it.notice.id);
    if (live) return it.leaving || it.notice !== live ? { notice: live, leaving: false } : it;
    return it.leaving ? it : { notice: it.notice, leaving: true };
  });
  for (const n of notices)
    if (!items.some((it) => it.notice.id === n.id)) next.push({ notice: n, leaving: false });
  return next.length === items.length && next.every((x, i) => x === items[i]) ? items : next;
}

/**
 * Transient errors/confirmations, in the top layer above the page and the bag bar — inside
 * the bag sheet while it is open (the only part of the page that isn't inert then).
 */
function Toasts({ notices }: { notices: Notice[] }) {
  const [items, setItems] = useState<ToastItem[]>(() => mergeToasts([], notices));
  const [from, setFrom] = useState(notices);
  let list = items;
  if (from !== notices) {
    list = mergeToasts(items, notices);
    setFrom(notices);
    if (list !== items) setItems(list);
  }
  const [onGone] = useState(
    () => (id: string) =>
      setItems((l) => {
        const next = l.filter((x) => !(x.leaving && x.notice.id === id));
        return next.length === l.length ? l : next;
      }),
  );
  const host = useSyncExternalStore(subscribeToastHost, toastHost, () => null);
  // in the sheet the region stays mounted, so a toast raised there is an announced addition
  if (list.length === 0 && !host) return null;
  const region = (
    <div
      className="v-toast-region"
      data-vendua="toast-region"
      ref={host ? undefined : attachToastRegion}
      aria-live={host ? 'polite' : undefined}
    >
      {list.map(({ notice, leaving }) => (
        <Toast key={notice.id} notice={notice} leaving={leaving} onGone={onGone} />
      ))}
    </div>
  );
  return host ? createPortal(region, host) : region;
}

/** Inline surface region a brand section may place (05 — SurfaceRegion). */
export function SurfaceRegion({ name }: { name: string }): ReactNode {
  // inside their window only (useNotices re-renders when one opens or closes)
  const notices = useNotices().notices.filter(
    (n) => !isBlocking(n) && (n.payload?.region === name || n.kind === name),
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
