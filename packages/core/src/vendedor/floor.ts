import type { StoreAgentSettings } from './settings.ts';

// Who answers a conversation right now (sales-agent.md §4.12, UX §3.9). Pure: Core computes it
// from the thread row, the merchant's coverage and the store's status, at every turn and in the
// sweeper that wakes waiting threads.

export type Floor =
  /** the Vendedor answers */
  | 'agent'
  /** Ensaio: it writes what it would say, sends nothing */
  | 'rehearsal'
  /** a person at the store has it (took over, or was handed it) */
  | 'store'
  /** quando eu demorar: the store has until `until` to answer first */
  | 'wait'
  /** "não é cliente", "pare de me responder" */
  | 'muted'
  /** the store paused him for a while (`until`): the store answers, he takes back after */
  | 'paused'
  /** the Vendedor is off, or this number isn't (or isn't yet) a shopper's */
  | 'off';

export interface FloorThread {
  owner: 'open' | 'agent' | 'human' | 'muted';
  humanUntil: Date | null;
  pendingSince: Date | null;
  class: 'unknown' | 'shopper' | 'other' | 'checking' | 'personal' | 'ask';
  channel: 'whatsapp' | 'test' | 'web' | 'instagram';
}

export interface FloorResult {
  floor: Floor;
  /** when a `wait` or `store` floor lapses on its own */
  until: Date | null;
}

export function floorOf(
  t: FloorThread,
  agent: { enabled: boolean; settings: StoreAgentSettings; pausedUntil?: Date | null },
  storeOpen: boolean,
  now: Date,
): FloorResult {
  if (t.owner === 'muted') return { floor: 'muted', until: null };
  // the admin's test chat and Cliente oculto reach the real Vendedor whatever its settings
  if (t.channel === 'test')
    return t.owner === 'human' && t.humanUntil && t.humanUntil > now
      ? { floor: 'store', until: t.humanUntil }
      : { floor: 'agent', until: null };
  if (!agent.enabled) return { floor: 'off', until: null };
  // not a shopper, a friend, or still waiting for a verdict or the owner (ADR 0033)
  if (t.class !== 'shopper' && t.class !== 'unknown') return { floor: 'off', until: null };
  if (agent.pausedUntil && agent.pausedUntil > now) {
    const until =
      t.owner === 'human' && t.humanUntil && t.humanUntil > agent.pausedUntil
        ? t.humanUntil
        : agent.pausedUntil;
    return { floor: 'paused', until };
  }
  const s = agent.settings;
  if (s.coverage === 'rehearsal') return { floor: 'rehearsal', until: null };
  // the site's chat answers at once: the merchant turned it on for that
  if (t.channel === 'web')
    return t.owner === 'human' && t.humanUntil && t.humanUntil > now
      ? { floor: 'store', until: t.humanUntil }
      : { floor: 'agent', until: null };
  if (t.owner === 'human') {
    if (t.humanUntil && t.humanUntil > now) return { floor: 'store', until: t.humanUntil };
    // the window lapsed: it takes back
    return { floor: 'agent', until: null };
  }
  if (t.owner === 'agent' || s.coverage === 'always' || !storeOpen)
    return { floor: 'agent', until: null };
  if (s.coverage === 'after_hours') return { floor: 'store', until: null };
  // when_slow, store open, nobody has the thread yet
  if (!t.pendingSince) return { floor: 'wait', until: null };
  const until = new Date(t.pendingSince.getTime() + s.slowAfterMin * 60_000);
  return until <= now ? { floor: 'agent', until: null } : { floor: 'wait', until };
}

/** Floors where the Vendedor writes this turn (rehearsal writes drafts). */
export const writes = (f: Floor) => f === 'agent' || f === 'rehearsal';
