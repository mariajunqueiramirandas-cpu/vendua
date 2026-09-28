import { useEffect, useSyncExternalStore } from 'react';
import { queryClient, qk } from './query.ts';
import { chimeNewOrder, chimePaid } from './sound.ts';
import { haptic } from './haptics.ts';
import { ordersSeen } from './pwa.ts';

// One EventSource per signed-in tab (Core: GET /admin/v1/events). Each change
// invalidates what shows it; a new order also rings: chime + double vibration +
// a live-region announcement, repeating every 20 s until someone looks (§5.2, §6.3).

type Topic =
  'order.placed' | 'order.changed' | 'catalog' | 'store' | 'marketing' | 'team' | 'appearance';

const TOPIC_KEYS: Record<Topic, readonly (readonly unknown[])[]> = {
  'order.placed': [['orders'], qk.home, ['customers'], ['catalog'], qk.activity],
  'order.changed': [['orders'], qk.home, qk.payments, ['customers'], ['reports'], qk.activity],
  catalog: [['catalog'], qk.home, qk.share, qk.activity],
  store: [qk.store, qk.home, qk.payments, qk.activity],
  marketing: [qk.marketing, qk.home, qk.activity],
  team: [qk.team, qk.activity],
  appearance: [qk.appearance, qk.activity],
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
    const total = (order.totalCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    announce(`Pedido ${order.number} chegou, ${total}`);
    window.dispatchEvent(new CustomEvent('vendua:new-order', { detail: order }));
  } catch {
    announce('Pedido novo chegou');
  }
}

export function useLiveStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      if (closed) return;
      es = new EventSource('/admin/v1/events');
      es.addEventListener('hello', () => set({ streaming: true }));
      es.addEventListener('presence', (ev) => {
        try {
          const p = JSON.parse((ev as MessageEvent).data) as { viewers: number; carts: number };
          if (Number.isFinite(p.viewers) && Number.isFinite(p.carts)) set({ presence: p });
        } catch {
          /* ignored: the next one replaces it */
        }
      });
      es.addEventListener('change', (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as { topic: Topic; id: string };
        if (e.id === 'resync') {
          void queryClient.invalidateQueries();
          return;
        }
        for (const key of TOPIC_KEYS[e.topic] ?? [])
          void queryClient.invalidateQueries({ queryKey: key });
        if (e.topic === 'order.changed' && e.id) {
          const before = queryClient.getQueryData<{ order: { payment: { status: string } } }>(
            qk.order(e.id),
          );
          void queryClient.invalidateQueries({ queryKey: qk.order(e.id) });
          void queryClient
            .fetchQuery({
              queryKey: qk.order(e.id),
              queryFn: async () => (await import('./api.ts')).api.order(e.id),
            })
            .then((after) => {
              if (
                before &&
                before.order.payment.status !== 'paid' &&
                after.order.payment.status === 'paid' &&
                soundOn
              )
                chimePaid();
            })
            .catch(() => undefined);
        }
        if (e.topic === 'order.placed' && e.id) void onPlaced(e.id);
      });
      es.onerror = () => {
        set({ streaming: false, presence: null });
        // the browser retries by itself; a hard close (401, proxy) needs us to
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(open, 5000);
        }
      };
    };
    open();
    const up = () => {
      set({ online: true });
      void queryClient.invalidateQueries();
      void queryClient.resumePausedMutations();
    };
    const down = () => set({ online: false, streaming: false, presence: null });
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // a closed laptop lid or a backgrounded phone misses events: catch up on return
    const vis = () => {
      if (document.visibilityState === 'visible')
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [enabled]);
}
