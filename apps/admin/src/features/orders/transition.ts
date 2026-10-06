import { MutationObserver, type MutationOptions } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { orderPath } from '@vendua/kernel/rules';
import { pathMode } from '../../ui/orderMode.ts';
import { api, ApiError, type Board, type Order, type OrderState } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { markOrdersSeen } from '../../lib/live.ts';
import { qk, queryClient } from '../../lib/query.ts';
import { payError } from '../../ui/PaymentChip.tsx';
import { dismiss, toast } from '../../ui/Toast.tsx';

// Moving an order forward is held a moment (§2.2.1, undo beats confirm): the card moves at once,
// "desfazer" shows for 6 s, and only then does Core hear of it — the shopper's WhatsApp and the
// kitchen ticket go out when the window ends. The hold lives here, not in a screen, so leaving
// Pedidos doesn't drop it. Hiding the app sends it at once; a send the page didn't live to see
// answered is kept in localStorage and replayed on the next start, with the same Idempotency-Key.

export interface MoveVars {
  order: Order;
  to: OrderState;
  prepMinutes?: number;
  reason?: string;
  idem: string;
}

export const TRANSITION = ['orders', 'transition'] as const;
export const UNDO_MS = 6000;
/** Início checks it on start, so a closed app's leftovers replay without opening Pedidos */
export const STORE_KEY = 'vendua.moves';
/** a move the page never saw answered, older than this, is stale: someone handled it since */
const REPLAY_MAX_MS = 30 * 60_000;

export const DONE_TOAST: Partial<Record<OrderState, (o: Order) => string>> = {
  confirmed: (o) => `Pedido #${o.number} aceito`,
  preparing: (o) => `#${o.number} em preparo`,
  ready: (o) => `#${o.number} pronto`,
  out_for_delivery: (o) => `#${o.number} saiu para entrega`,
  delivered: (o) => `#${o.number} entregue ✓`,
  cancelled: (o) => `Pedido #${o.number} cancelado`,
  refunded: (o) => `#${o.number} marcado como estornado`,
};

type OrderData = { customer: unknown; order: Order };

// Several cards can be in flight at once (a busy kitchen taps fast): each touches only its own
// order, so one failing or landing never snaps another back to its old lane.
function put(id: string, f: (o: Order) => Order) {
  queryClient.setQueryData<Board>(qk.board, (b) =>
    b ? { ...b, orders: b.orders.map((o) => (o.id === id ? f(o) : o)) } : b,
  );
  queryClient.setQueryData<OrderData>(qk.order(id), (d) => (d ? { ...d, order: f(d.order) } : d));
}

/** `to` lies ahead of where the order is (closing it always does) */
function ahead(o: Order, to: OrderState) {
  if (to === 'cancelled' || to === 'refunded') return true;
  const path = orderPath(pathMode(o.delivery.mode));
  return path.indexOf(to) > path.indexOf(o.state);
}

/** The transition mutation, shared by the screens' hook and the held sends. */
export function transitionOptions(): MutationOptions<{ order: Order }, Error, MoveVars> {
  const qc = queryClient;
  return {
    mutationKey: TRANSITION,
    mutationFn: (v) =>
      api.transition(
        v.order.id,
        v.to,
        {
          ...(v.prepMinutes ? { prepMinutes: v.prepMinutes } : {}),
          ...(v.reason ? { reason: v.reason } : {}),
        },
        v.idem,
      ),
    onMutate: async (v) => {
      markOrdersSeen();
      await Promise.all([
        qc.cancelQueries({ queryKey: qk.board }),
        qc.cancelQueries({ queryKey: qk.order(v.order.id) }),
      ]);
      // a chain's earlier step never pulls the card back from where the hold showed it
      put(v.order.id, (o) => (ahead(o, v.to) ? { ...o, state: v.to } : o));
    },
    onError: (e, v) => {
      // undo only our guess, and only if nothing newer replaced it
      put(v.order.id, (o) => (o.state === v.to ? { ...o, state: v.order.state } : o));
      // someone else (the kitchen, another screen) moved it first: not worth an alarm
      if (e instanceof ApiError && e.code === 'INVALID_ORDER_TRANSITION') {
        toast(`O pedido #${v.order.number} já tinha mudado. Atualizando.`, { tone: 'info' });
        return;
      }
      haptic.error();
      toast.error(payError(e));
    },
    onSuccess: ({ order }, v) => {
      put(order.id, (o) => (o.version > order.version ? o : order));
      qc.setQueryData<OrderData>(qk.order(order.id), (old) => ({
        customer: old?.customer ?? null,
        order: old && old.order.version > order.version ? old.order : order,
      }));
      // a forward step said so when it was held; closing an order says so now
      if (v.to !== 'cancelled' && v.to !== 'refunded') return;
      const paidOnline =
        !!v.order.payment.online &&
        (v.order.payment.status === 'paid' || v.order.payment.status === 'partially_refunded');
      toast(
        v.to === 'cancelled' && paidOnline
          ? `Pedido #${order.number} cancelado. O dinheiro volta para o cliente pelo Mercado Pago.`
          : (DONE_TOAST[v.to]?.(order) ?? 'Pedido atualizado'),
      );
    },
    onSettled: () => {
      // a refetch while another move is in flight would briefly show that one's old lane
      if (qc.isMutating({ mutationKey: TRANSITION }) > 1) return;
      void qc.invalidateQueries({ queryKey: qk.board });
      void qc.invalidateQueries({ queryKey: qk.home });
    },
  };
}

// ── the hold ────────────────────────────────────────────────────────────────

interface Held {
  steps: MoveVars[];
  timer: number;
  toast: number;
}
const held = new Map<string, Held>();
/** steps sent and not yet answered, per order: what the card shows meanwhile */
const sending = new Map<string, MoveVars[]>();
/** per order, sends go out one after another: a step never overtakes the one before it */
const tails = new Map<string, Promise<void>>();

let shown = new Map<string, OrderState>();
const subs = new Set<() => void>();
function changed() {
  const next = new Map<string, OrderState>();
  for (const [id, s] of sending) if (s.length) next.set(id, s[s.length - 1]!.to);
  for (const [id, h] of held) next.set(id, h.steps[h.steps.length - 1]!.to);
  shown = next;
  subs.forEach((f) => f());
}

/** What the screens show while a move is held or on its way, whatever a refetch brought back. */
export function useHeldStates(): ReadonlyMap<string, OrderState> {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => shown,
  );
}

export function withHeld<T extends { id: string; state: OrderState }>(
  o: T,
  states: ReadonlyMap<string, OrderState>,
): T {
  const s = states.get(o.id);
  return s && s !== o.state ? { ...o, state: s } : o;
}

/** Keep what isn't answered yet across a reload or a closed app (replayed on the next start). */
function persist() {
  const rows = [...sending.values(), ...[...held.values()].map((h) => h.steps)]
    .filter((s) => s.length)
    .map((steps) => ({ at: Date.now(), steps }));
  try {
    if (rows.length) localStorage.setItem(STORE_KEY, JSON.stringify(rows));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: the keepalive send is all there is */
  }
}

function send(steps: MoveVars[], opts: { keepalive?: boolean } = {}): Promise<void> {
  const id = steps[0]!.order.id;
  sending.set(id, [...(sending.get(id) ?? []), ...steps]);
  changed();
  // the page is going away: the first step straight to Core, outliving it (the rest replay)
  if (opts.keepalive) {
    const v = steps[0]!;
    void api
      .transition(
        v.order.id,
        v.to,
        {
          ...(v.prepMinutes ? { prepMinutes: v.prepMinutes } : {}),
          ...(v.reason ? { reason: v.reason } : {}),
        },
        v.idem,
        { keepalive: true },
      )
      .catch(() => undefined);
  }
  const run = (tails.get(id) ?? Promise.resolve()).then(async () => {
    try {
      for (const v of steps) {
        await new MutationObserver(queryClient, transitionOptions()).mutate(v);
        sending.set(
          id,
          (sending.get(id) ?? []).filter((x) => x !== v),
        );
        changed();
      }
    } catch {
      // the step said why (onError); the ones after it can't happen
    } finally {
      const left = (sending.get(id) ?? []).filter((x) => !steps.includes(x));
      if (left.length) sending.set(id, left);
      else sending.delete(id);
      changed();
      persist();
    }
  });
  tails.set(id, run);
  void run.finally(() => {
    if (tails.get(id) === run) tails.delete(id);
  });
  return run;
}

function commit(id: string, opts: { keepalive?: boolean } = {}) {
  const h = held.get(id);
  if (!h) return tails.get(id) ?? Promise.resolve();
  clearTimeout(h.timer);
  held.delete(id);
  dismiss(h.toast);
  return send(h.steps, opts);
}

function undo(id: string) {
  const h = held.get(id);
  if (!h) return;
  clearTimeout(h.timer);
  held.delete(id);
  haptic.tick();
  changed();
  persist();
}

/**
 * Move `order` along its own path to `target` (a transition skips no step; pickup never "sai"),
 * on screen now and at Core after the undo window. `idem` keys each step: the same step from
 * any gesture is the same request, so Core never applies it twice.
 */
export function holdMove(order: Order, target: OrderState, prepMinutes?: number) {
  const path = orderPath(pathMode(order.delivery.mode)) as OrderState[];
  // a move already held on this order goes out now; this one waits behind it
  if (held.has(order.id)) void commit(order.id);
  const from = withHeld(order, shown);
  const i = path.indexOf(from.state);
  const j = path.indexOf(target);
  if (i < 0 || j <= i) return;
  let cur: Order = from;
  const steps = path.slice(i + 1, j + 1).map((to) => {
    const v: MoveVars = {
      order: cur,
      to,
      ...(to === 'confirmed' && prepMinutes ? { prepMinutes } : {}),
      idem: `adv-${order.id}-${to}`,
    };
    cur = { ...cur, state: to };
    return v;
  });
  haptic.commit();
  markOrdersSeen();
  const timer = window.setTimeout(() => void commit(order.id), UNDO_MS);
  const id = toast(DONE_TOAST[target]?.(order) ?? 'Pedido atualizado', {
    undo: () => undo(order.id),
    ms: UNDO_MS,
  });
  held.set(order.id, { steps, timer, toast: id });
  changed();
}

/** Before a step that isn't held (cancel, estorno): the held one goes first, and lands first. */
export function afterHeld(orderId: string): Promise<void> {
  return commit(orderId);
}

/** Send through the order's queue (after anything held or sent before it). */
export function sendMove(v: MoveVars): Promise<void> {
  return send([v]);
}

// Other reversible order actions ("atrasou") wait the same window; hiding the app sends them.
const actions = new Map<
  string,
  { timer: number; toast: number; run: (keepalive: boolean) => void }
>();

/**
 * Show it done now, do it after the undo window: `run` is called once (with `keepalive` when the
 * page is going away), `revert` puts the screen back when "desfazer" is tapped. A second hold
 * of the same `key` sends the first one now.
 */
export function holdAction(
  key: string,
  text: string,
  run: (keepalive: boolean) => void,
  revert: () => void,
) {
  sendAction(key, false);
  haptic.commit();
  const timer = window.setTimeout(() => sendAction(key, false), UNDO_MS);
  const id = toast(text, {
    undo: () => {
      const a = actions.get(key);
      if (!a) return;
      clearTimeout(a.timer);
      actions.delete(key);
      haptic.tick();
      revert();
    },
    ms: UNDO_MS,
  });
  actions.set(key, { timer, toast: id, run });
}

function sendAction(key: string, keepalive: boolean) {
  const a = actions.get(key);
  if (!a) return;
  clearTimeout(a.timer);
  actions.delete(key);
  dismiss(a.toast);
  a.run(keepalive);
}

function flush(keepalive: boolean) {
  for (const id of [...held.keys()]) void commit(id, { keepalive });
  for (const key of [...actions.keys()]) sendAction(key, keepalive);
  persist();
}

function replay() {
  let rows: { at: number; steps: MoveVars[] }[] = [];
  try {
    rows = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as typeof rows;
    localStorage.removeItem(STORE_KEY);
  } catch {
    return;
  }
  for (const r of Array.isArray(rows) ? rows : [])
    if (Date.now() - r.at < REPLAY_MAX_MS && Array.isArray(r.steps) && r.steps.length)
      void send(r.steps);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(false);
  });
  replay();
}
