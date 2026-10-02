import { useQuery, useQueryClient } from '@tanstack/react-query';
import { orderPath } from '@vendua/kernel/rules';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type Kitchen,
  type KitchenState,
  type KitchenTicket,
  type OrderState,
} from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { markOrdersSeen, usePollWhenOffline } from '../../lib/live.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { toast } from '../../ui/Toast.tsx';

export function useKitchen() {
  // pushed over the live stream; a slow net while it's up, a quicker one while it's down
  const poll = usePollWhenOffline(20_000, 2 * 60_000);
  return useQuery({ queryKey: qk.kitchen, queryFn: api.kitchen, refetchInterval: poll });
}

const WRITE = ['kitchen', 'write'] as const;

function useCache() {
  const qc = useQueryClient();
  const put = (id: string, f: (t: KitchenTicket) => KitchenTicket | null) =>
    qc.setQueryData<Kitchen>(qk.kitchen, (k) =>
      k
        ? {
            ...k,
            tickets: k.tickets.flatMap((t) => {
              if (t.id !== id) return [t];
              const n = f(t);
              return n ? [n] : [];
            }),
          }
        : k,
    );
  const restore = (t: KitchenTicket) =>
    qc.setQueryData<Kitchen>(qk.kitchen, (k) =>
      k
        ? {
            ...k,
            tickets: k.tickets.some((x) => x.id === t.id)
              ? k.tickets.map((x) => (x.id === t.id ? t : x))
              : [...k.tickets, t],
          }
        : k,
    );
  // a refetch while another tap is in flight would briefly undo that one on screen
  const settle = () => {
    if (qc.isMutating({ mutationKey: WRITE }) > 1) return;
    void qc.invalidateQueries({ queryKey: qk.kitchen });
  };
  const hold = () => qc.cancelQueries({ queryKey: qk.kitchen });
  return { qc, put, restore, settle, hold };
}

/** Tap an item: made / not made. Marking the first one starts the order ("em preparo"). */
export function useMarkItems() {
  const { put, settle, hold } = useCache();
  return useMutation({
    mutationKey: WRITE,
    mutationFn: (v: { ticket: KitchenTicket; items: string[]; done: boolean }) =>
      api.kitchenItems(v.ticket.id, v.items, v.done),
    onMutate: async (v) => {
      haptic.tick();
      await hold();
      const at = new Date().toISOString();
      put(v.ticket.id, (t) => ({
        ...t,
        ...(v.done && t.state === 'confirmed' ? { state: 'preparing', startedAt: at } : {}),
        items: t.items.map((i) =>
          v.items.includes(i.id) ? { ...i, doneAt: v.done ? (i.doneAt ?? at) : null } : i,
        ),
      }));
    },
    onError: (e, v) => {
      put(v.ticket.id, (t) => ({
        ...t,
        state: t.state === 'preparing' && v.ticket.state === 'confirmed' ? 'confirmed' : t.state,
        items: t.items.map((i) =>
          v.items.includes(i.id) ? (v.ticket.items.find((x) => x.id === i.id) ?? i) : i,
        ),
      }));
      haptic.error();
      toast.error(
        e instanceof ApiError && e.code === 'KITCHEN_CLOSED'
          ? `O pedido #${v.ticket.number} já saiu da cozinha.`
          : messageOf(e),
      );
    },
    onSuccess: ({ ticket }, v) =>
      // only what this tap touched: other taps on the same ticket may still be in flight
      put(ticket.id, (t) => ({
        ...t,
        state: ticket.state,
        startedAt: ticket.startedAt,
        version: ticket.version,
        items: t.items.map((i) =>
          v.items.includes(i.id) ? (ticket.items.find((x) => x.id === i.id) ?? i) : i,
        ),
      })),
    onSettled: settle,
  });
}

export function useRush() {
  const { put, settle, hold } = useCache();
  return useMutation({
    mutationKey: WRITE,
    mutationFn: (v: { ticket: KitchenTicket; rush: boolean }) =>
      api.kitchenRush(v.ticket.id, v.rush),
    onMutate: async (v) => {
      haptic.tick();
      await hold();
      put(v.ticket.id, (t) => ({ ...t, rush: v.rush }));
    },
    onError: (e, v) => {
      put(v.ticket.id, (t) => ({ ...t, rush: v.ticket.rush }));
      toast.error(messageOf(e));
    },
    onSuccess: ({ ticket }) => {
      put(ticket.id, (t) => ({ ...t, rush: ticket.rush }));
      toast(
        ticket.rush ? `#${ticket.number} passou na frente` : `#${ticket.number} sem prioridade`,
      );
    },
    onSettled: settle,
  });
}

const KITCHEN_STATES: readonly OrderState[] = ['placed', 'confirmed', 'preparing', 'ready'];

/** One step on the order's path (the same transition Pedidos uses), shown at once. */
export function useStep() {
  const { qc, put, restore, settle, hold } = useCache();
  return useMutation({
    mutationKey: WRITE,
    mutationFn: (v: { ticket: KitchenTicket; to: OrderState; prepMinutes?: number }) =>
      api.transition(
        v.ticket.id,
        v.to,
        v.prepMinutes ? { prepMinutes: v.prepMinutes } : {},
        `kds-${v.ticket.id}-${v.to}`,
      ),
    onMutate: async (v) => {
      haptic.commit();
      markOrdersSeen();
      await hold();
      const at = new Date().toISOString();
      put(v.ticket.id, (t) =>
        KITCHEN_STATES.includes(v.to)
          ? {
              ...t,
              state: v.to as KitchenState,
              ...(v.to === 'confirmed'
                ? { acceptedAt: at, prepMinutes: v.prepMinutes ?? t.prepMinutes }
                : {}),
              ...(v.to === 'preparing' ? { startedAt: at } : {}),
              ...(v.to === 'ready' ? { readyAt: at } : {}),
            }
          : null,
      );
    },
    onError: (e, v) => {
      restore(v.ticket);
      // someone else (Pedidos, another screen) moved it first: not worth an alarm
      // (or another tablet sent this very step: its key is the same, Core says it's taken)
      if (
        e instanceof ApiError &&
        (e.code === 'INVALID_ORDER_TRANSITION' || e.code === 'IDEMPOTENCY_KEY_REUSED')
      ) {
        toast(`O pedido #${v.ticket.number} já tinha mudado. Atualizando.`, { tone: 'info' });
        return;
      }
      haptic.error();
      toast.error(messageOf(e));
    },
    onSettled: () => {
      settle();
      void qc.invalidateQueries({ queryKey: qk.board });
      void qc.invalidateQueries({ queryKey: qk.home });
    },
  });
}

/** Walk the order's own path to `target` (a transition skips no step; pickup never "sai"). */
export function useAdvance() {
  const step = useStep();
  const run = useCallback(
    async (ticket: KitchenTicket, target: OrderState, prepMinutes?: number) => {
      const path = orderPath(ticket.mode) as OrderState[];
      const i = path.indexOf(ticket.state);
      const j = path.indexOf(target);
      if (i < 0 || j <= i) return;
      let cur = ticket;
      for (const to of path.slice(i + 1, j + 1)) {
        const r = await step.mutateAsync({
          ticket: cur,
          to,
          ...(to === 'confirmed' && prepMinutes ? { prepMinutes } : {}),
        });
        cur = { ...cur, state: r.order.state as KitchenState };
      }
    },
    // the mutation object changes every render; mutateAsync is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step.mutateAsync],
  );
  return { run, pending: step.isPending };
}

export const UNDO_MS = 4500;

/**
 * "Pronto" can't be taken back once the customer is told, so a bump waits a few seconds on the
 * ticket with "desfazer" (undo beats confirm, §2.2.1). Leaving the page sends what's waiting.
 */
export function useBumpQueue(commit: (t: KitchenTicket) => void) {
  const [pending, setPending] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, { timer: number; ticket: KitchenTicket }>());
  const order = useRef<string[]>([]);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const drop = (id: string) => {
    const e = timers.current.get(id);
    if (e) clearTimeout(e.timer);
    timers.current.delete(id);
    order.current = order.current.filter((x) => x !== id);
    setPending((p) => {
      const { [id]: _, ...rest } = p;
      return rest;
    });
    return e?.ticket;
  };
  const fire = (id: string) => {
    const t = drop(id);
    if (t) commitRef.current(t);
  };
  const bump = (t: KitchenTicket) => {
    if (timers.current.has(t.id)) return fire(t.id);
    haptic.commit();
    const timer = window.setTimeout(() => fire(t.id), UNDO_MS);
    timers.current.set(t.id, { timer, ticket: t });
    order.current.push(t.id);
    setPending((p) => ({ ...p, [t.id]: Date.now() + UNDO_MS }));
  };
  /** the given ticket, or the latest bump */
  const undo = (id?: string) => {
    const target = id ?? order.current[order.current.length - 1];
    if (!target || !timers.current.has(target)) return false;
    drop(target);
    haptic.tick();
    return true;
  };

  useEffect(() => {
    const flush = () => [...timers.current.keys()].forEach(fire);
    const hidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
    // fire/drop only touch refs and setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pending, bump, undo };
}

/** A per-device choice (this screen is the Chapa; sound on), kept in localStorage. */
export function usePref<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [v, set] as const;
}

export function useStations() {
  const { qc } = useCache();
  return useMutation({
    mutationFn: (stations: { id?: string; name: string; categoryIds: string[] }[]) =>
      api.kitchenStations(stations),
    onSuccess: ({ stations }) => {
      qc.setQueryData<Kitchen>(qk.kitchen, (k) => (k ? { ...k, stations } : k));
      void qc.invalidateQueries({ queryKey: qk.kitchen });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}
