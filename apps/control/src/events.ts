// Shared SSE channel to /control/v1/events; events are payload-free triggers
// that accelerate the views' polls, which remain the floor.

// Mirrors CONTROL_EVENT_TYPES in packages/core — can't import across the package boundary.
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

// Throttle so event bursts don't turn into a burst of fetches.
const QUIET_MS = 300;

const subs = new Set<Sub>();
let source: EventSource | null = null;

function dispatch(e: ControlEvent): void {
  for (const s of subs) {
    // sync means "you may have missed things" — lands on every subscriber
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

/** `sync` always reaches the handler; other types only when listed. */
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
