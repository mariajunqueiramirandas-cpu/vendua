// In-process trigger bus behind GET /control/v1/events (SSE) — payload-free hints.
// Single-process fan-out; if core ever replicates, swap for pg LISTEN/NOTIFY.

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
  /** Optional narrow hint (threadId, runId...) — advisory; consumers must work when absent. */
  ref?: string;
}

type ControlEventListener = (event: ControlEvent) => void;

const listeners = new Set<ControlEventListener>();
let seq = 0;

// Fire-and-forget: a failing listener must not take down the write path.
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

export function subscribeControlEvents(listener: ControlEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook. */
export function controlEventListenerCount(): number {
  return listeners.size;
}
