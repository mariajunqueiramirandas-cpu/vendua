import { useEffect, useSyncExternalStore } from 'react';
import { queryClient, qk } from './query.ts';
import { chimeNewOrder, chimePaid } from './sound.ts';
import { haptic } from './haptics.ts';
import { checkForUpdate, ordersSeen } from './pwa.ts';
import type { Board, Order } from './api.ts';
import { money } from './format.ts';

// One EventSource per signed-in tab (Core: GET /admin/v1/events). Each change
// invalidates what shows it; a new order also rings: chime + double vibration +
// a live-region announcement, repeating every 20 s until someone looks (§5.2, §6.3).

type Topic =
  | 'order.placed'
  | 'order.changed'
  | 'catalog'
  | 'store'
  | 'marketing'
  | 'team'
  | 'appearance'
  | 'surfaces'
  | 'payment.received'
  | 'billing'
  | 'alerts'
  | 'import'
  | 'whatsapp'
  | 'printers'
  | 'kitchen';

const TOPIC_KEYS: Record<Topic, readonly (readonly unknown[])[]> = {
  'order.placed': [['orders'], qk.home, ['customers'], ['catalog'], qk.activity],
  'order.changed': [['orders'], qk.home, qk.payments, ['customers'], ['reports'], qk.activity],
  catalog: [['catalog'], qk.home, qk.share, qk.activity],
  store: [qk.store, qk.home, qk.payments, qk.activity],
  marketing: [qk.marketing, qk.home, qk.activity],
  team: [qk.team, qk.activity],
  appearance: [qk.appearance, qk.activity],
  // storefront operations changed elsewhere (prep time, demand) show in Loja too
  surfaces: [qk.store],
  'payment.received': [['orders'], qk.home, ['payments'], ['reports'], qk.activity],
  // a payment can open a plan's features: the session carries what is open
  billing: [qk.account, qk.payments, qk.home, qk.store, qk.session],
  alerts: [qk.alerts, qk.home],
  import: [qk.imports],
  whatsapp: [qk.whatsapp],
  printers: [['printers']],
  kitchen: [qk.kitchen],
};

// ── connection + alert state (a tiny external store) ───────────────────────
interface LiveState {
  online: boolean;
  streaming: boolean;
  unseen: string[];
  /** who's in the storefront right now — null until the stream says (or while it's down) */
  presence: { viewers: number; carts: number } | null;
}
let state: LiveState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  streaming: false,
  unseen: [],
  presence: null,
};
const subs = new Set<() => void>();
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch };
  subs.forEach((s) => s());
};
/**
 * How often a screen should poll: the stream pushes every change while it's up, so polling
 * is only the fallback for when it's down (or a long safety net where missing one costs).
 */
export function usePollWhenOffline(ms: number, whileStreaming: number | false = false) {
  const streaming = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state.streaming,
  );
  return streaming ? whileStreaming : ms;
}

/** ms until an ISO instant (+2 s so the server's clock has passed it), capped for timers. */
export function untilChange(iso: string | null | undefined): number | false {
  if (!iso) return false;
  const ms = Date.parse(iso) - Date.now() + 2000;
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 5000), 6 * 60 * 60_000) : false;
}

export function useLiveState(): LiveState {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state,
  );
}

let soundOn = true;
export function setSoundOn(v: boolean) {
  soundOn = v;
}

let announce: (text: string) => void = () => {};
export function setAnnouncer(fn: (text: string) => void) {
  announce = fn;
}

function ring() {
  if (soundOn) chimeNewOrder();
  haptic.newOrder();
}

/** The board calls this when it's on screen — the merchant has seen them. */
export function markOrdersSeen() {
  ordersSeen();
  if (state.unseen.length) set({ unseen: [] });
}

let repeat: ReturnType<typeof setInterval> | null = null;
function scheduleRepeat() {
  if (repeat) return;
  repeat = setInterval(() => {
    if (!state.unseen.length) {
      clearInterval(repeat!);
      repeat = null;
      return;
    }
    ring();
  }, 20_000);
}

async function onPlaced(orderId: string) {
  set({ unseen: [...new Set([...state.unseen, orderId])] });
  ring();
  scheduleRepeat();
  try {
    const { api } = await import('./api.ts');
    const { order } = await api.order(orderId);
    announce(`Pedido ${order.number} chegou, ${money(order.totalCents)}`);
    window.dispatchEvent(new CustomEvent('vendua:new-order', { detail: order }));
  } catch {
    announce('Pedido novo chegou');
  }
}

// A burst of events (a drag across lanes, a bulk edit) becomes one refetch per key, not one each.
const INVALIDATE_MS = 150;
let dirty = new Map<string, readonly unknown[]>();
let everything = false;
let paidWatch = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueInvalidate(keys: readonly (readonly unknown[])[] | 'all') {
  if (keys === 'all') everything = true;
  else for (const k of keys) dirty.set(JSON.stringify(k), k);
  flushTimer ??= setTimeout(() => void flush(), INVALIDATE_MS);
}

async function flush() {
  flushTimer = null;
  const keys = [...dirty.values()];
  const all = everything;
  const watch = paidWatch;
  dirty = new Map();
  everything = false;
  paidWatch = new Set();
  await Promise.all(
    all
      ? [queryClient.invalidateQueries()]
      : keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ).catch(() => undefined);
  for (const id of watch) void chimeIfPaid(id);
}

const isPaid = (id: string) =>
  queryClient.getQueryData<{ order: Order }>(qk.order(id))?.order.payment.status === 'paid' ||
  queryClient.getQueryData<Board>(qk.board)?.orders.find((o) => o.id === id)?.payment.status ===
    'paid';
const knows = (id: string) =>
  !!queryClient.getQueryData(qk.order(id)) ||
  !!queryClient.getQueryData<Board>(qk.board)?.orders.some((o) => o.id === id);

/** An order this device knew as unpaid changed: ring if it's paid now (Pix landed). */
async function chimeIfPaid(id: string) {
  try {
    // a fresh copy from the flush's own refetch counts; only an inactive one goes to the network
    const after = await queryClient.fetchQuery({
      queryKey: qk.order(id),
      queryFn: async () => (await import('./api.ts')).api.order(id),
      staleTime: 5_000,
    });
    if (after.order.payment.status === 'paid' && soundOn) chimePaid();
  } catch {
    /* the board still shows it */
  }
}

// Core pings every 20 s; a phone that hopped networks can hold a dead socket for minutes
// without the browser noticing, so silence past this means reconnect.
const SILENT_MS = 50_000;

export function useLiveStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let hellos = 0;
    let failures = 0;
    let lastSeen = Date.now();
    // armed by the first ping, so a Core without pings never trips it
    let pinged = false;
    const seen = () => void (lastSeen = Date.now());
    const open = () => {
      if (closed) return;
      clearTimeout(retry);
      es?.close();
      pinged = false;
      seen();
      const src = new EventSource('/admin/v1/events');
      es = src;
      src.addEventListener('hello', () => {
        seen();
        failures = 0;
        // events sent while we were away (a reconnect, Core's stream lifetime) are gone: catch
        // up, and a Core that went away may have been a deploy: look for the new app version
        if (hellos++ > 0) {
          queueInvalidate('all');
          checkForUpdate();
        }
        set({ streaming: true });
      });
      // signed out elsewhere (sair on another device, encerrar sessão, removed from the team):
      // straight to sign-in, no refresh needed
      src.addEventListener('signedout', () => {
        closed = true;
        src.close();
        set({ streaming: false, presence: null });
        window.dispatchEvent(new CustomEvent('vendua:unauthenticated'));
      });
      src.addEventListener('ping', () => {
        seen();
        pinged = true;
      });
      src.addEventListener('presence', (ev) => {
        seen();
        try {
          const p = JSON.parse((ev as MessageEvent).data) as { viewers: number; carts: number };
          if (Number.isFinite(p.viewers) && Number.isFinite(p.carts)) set({ presence: p });
        } catch {
          /* ignored: the next one replaces it */
        }
      });
      src.addEventListener('change', (ev) => {
        seen();
        let e: { topic: Topic; id: string };
        try {
          e = JSON.parse((ev as MessageEvent).data) as { topic: Topic; id: string };
        } catch {
          return queueInvalidate('all');
        }
        if (e.id === 'resync') return queueInvalidate('all');
        queueInvalidate(TOPIC_KEYS[e.topic] ?? []);
        if (e.topic === 'order.changed' && e.id && knows(e.id) && !isPaid(e.id))
          paidWatch.add(e.id);
        if (e.topic === 'order.placed' && e.id) void onPlaced(e.id);
      });
      src.onerror = () => {
        if (es !== src) return;
        set({ streaming: false, presence: null });
        // the browser retries by itself; a hard close (a 401, a proxy error mid-deploy) needs us to
        if (src.readyState !== EventSource.CLOSED) return;
        // Core refused the stream: maybe the session is gone (signed out, a redeploy with a fresh
        // database). Re-checking the session drops to sign-in on a 401, without a refresh.
        void queryClient.invalidateQueries({ queryKey: qk.session });
        checkForUpdate();
        // quick at first (a redeploy is back in seconds), then easing off to a minute
        retry = setTimeout(open, Math.min(60_000, 2000 * 2 ** failures++));
      };
    };
    open();
    const check = () => {
      if (!closed && pinged && navigator.onLine && Date.now() - lastSeen > SILENT_MS) {
        set({ streaming: false, presence: null });
        open();
      }
    };
    const watchdog = setInterval(check, 15_000);
    const up = () => {
      set({ online: true });
      void queryClient.invalidateQueries();
      void queryClient.resumePausedMutations();
      check();
    };
    const down = () => set({ online: false, streaming: false, presence: null });
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // a closed laptop lid or a backgrounded phone misses events: catch up on return
    const vis = () => {
      if (document.visibilityState !== 'visible') return;
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      check();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      es?.close();
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [enabled]);
}
