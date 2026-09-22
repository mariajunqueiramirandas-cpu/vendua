/**
 * control events — thin in-process trigger bus behind the staff console's
 * realtime channel (GET /control/v1/events, SSE). Events carry no payload:
 * the client refetches the endpoints it already polls, so an event is a
 * hint, never a data source, and missed events are harmless (reconnects
 * re-sync, a slow poll is the floor).
 *
 * Single-process core: one emitter serves every SSE consumer. If core ever
 * runs multiple replicas, swap the fan-out for pg LISTEN/NOTIFY — the
 * subscriber contract stays identical.
 */

export const CONTROL_EVENT_TYPES = [
  /** a message row landed in a thread — inbound ingest or outbound dispatch */
  'thread.message',
  /** an agent run changed status/step/cost — claimed, started, finished, cancelled, errored */
  'run.update',
  /** a lead was created, updated, rescored, or deleted */
  'lead.change',
  /** a meeting was created, rescheduled, cancelled, or status-changed */
  'meeting.change',
  /** a draft pending approval appeared or was resolved (approved/rejected/superseded) */
  'draft.change',
  /** channel health/pairing state changed materially (wa connect, send counters, alert flips) */
  'channel.health',
] as const;

export type ControlEventType = (typeof CONTROL_EVENT_TYPES)[number];

export interface ControlEvent {
  /** Monotonic per process — dedupe/ordering within one connection only. */
  id: number;
  type: ControlEventType;
  /**
   * Optional narrow hint (a threadId, runId, leadId...). Advisory only —
   * consumers may use it to skip unrelated refetches but must still work
   * when it's absent.
   */
  ref?: string;
}

type ControlEventListener = (event: ControlEvent) => void;

const listeners = new Set<ControlEventListener>();
let seq = 0;

/**
 * Emit a control event. Fire-and-forget: never throws, never blocks, and a
 * failing listener cannot take down the write path that emitted it.
 */
export function emitControlEvent(type: ControlEventType, ref?: string): void {
  if (listeners.size === 0) return;
  const event: ControlEvent = { id: ++seq, type, ...(ref ? { ref } : {}) };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a dead consumer must not break the writer */
    }
  }
}

/** Subscribe; returns an unsubscribe for use when the SSE stream closes. */
export function subscribeControlEvents(listener: ControlEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook — how many SSE consumers are attached right now. */
export function controlEventListenerCount(): number {
  return listeners.size;
}
