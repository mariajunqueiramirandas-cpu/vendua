/**
 * events — one shared SSE channel to GET /control/v1/events for the whole
 * console. Events are thin triggers with no payload: each subscriber runs
 * the refetch it already runs on a poll, so a dead stream is invisible —
 * the views' slow polls remain the floor, and the server-sent `sync` on
 * (re)connect catches anything missed. The cookie rides same-origin, so
 * an unauthenticated stream simply never delivers.
 */

// Mirrors CONTROL_EVENT_TYPES in packages/core — the app can't import
// across the package boundary; the wire is the contract.
export type ControlEventType =
  | 'thread.message'
  | 'run.update'
  | 'lead.change'
  | 'meeting.change'
  | 'draft.change'
  | 'channel.health'
  /** server-sent on every (re)connect — refetch whatever the view shows */
  | 'sync';

export interface ControlEvent {
  id: number;
  type: ControlEventType;
  /** advisory hint (threadId, runId, leadId) — may be absent */
  ref?: string;
}

type ControlEventHandler = (e: ControlEvent) => void;

interface Sub {
  types: ReadonlySet<string>;
  fn: ControlEventHandler;
  last: number;
  pending: ControlEvent | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// Bursts (a run's step stream, a fan-out of lead changes) shouldn't turn
// into a burst of fetches — the stream accelerates the polls, it doesn't
// multiply them.
const QUIET_MS = 300;

const subs = new Set<Sub>();
let source: EventSource | null = null;

function dispatch(e: ControlEvent): void {
  for (const s of subs) {
    // sync lands on every subscriber — it means "you may have missed things"
    if (e.type !== 'sync' && !s.types.has(e.type)) continue;
    const wait = QUIET_MS - (Date.now() - s.last);
    if (wait <= 0) {
      s.last = Date.now();
      s.pending = undefined;
      s.fn(e);
    } else {
      s.pending = e;
      s.timer ??= setTimeout(() => {
        s.timer = undefined;
        s.last = Date.now();
        const p = s.pending;
        s.pending = undefined;
        if (p) s.fn(p);
      }, wait);
    }
  }
}

function open(): void {
  if (source || typeof EventSource === 'undefined') return;
  const es = new EventSource('/control/v1/events');
  for (const type of [
    'thread.message',
    'run.update',
    'lead.change',
    'meeting.change',
    'draft.change',
    'channel.health',
  ] as const) {
    es.addEventListener(type, (m) => {
      try {
        dispatch(JSON.parse((m as MessageEvent).data) as ControlEvent);
      } catch {
        /* a malformed frame is a missed hint, never a failure */
      }
    });
  }
  es.addEventListener('sync', () => dispatch({ id: 0, type: 'sync' }));
  // 'error' needs no handling — EventSource retries on its own.
  source = es;
}

function close(): void {
  source?.close();
  source = null;
}

/** Subscribe to control events. `sync` always reaches the handler; other
 *  types only when listed. Returns the unsubscribe. */
export function onControlEvent(
  types: ControlEventType | readonly ControlEventType[],
  fn: ControlEventHandler,
): () => void {
  const sub: Sub = {
    types: new Set(Array.isArray(types) ? types : [types]),
    fn,
    last: 0,
    pending: undefined,
    timer: undefined,
  };
  subs.add(sub);
  open();
  return () => {
    subs.delete(sub);
    if (sub.timer) clearTimeout(sub.timer);
    if (!subs.size) close();
  };
}
