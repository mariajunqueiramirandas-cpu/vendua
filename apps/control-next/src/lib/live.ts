import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { onControlEvent, type ControlEventType } from './events.ts';

const REFRESH: Record<Exclude<ControlEventType, 'sync'>, string[]> = {
  'lead.change': [
    'leads',
    'lead',
    'stats',
    'tasks',
    'activities',
    'lead-threads',
    'lead-facts',
    'lead-autonomy',
    'segments',
    'duplicates',
  ],
  'thread.message': ['threads', 'thread', 'lead-threads', 'activities', 'approvals'],
  'run.update': ['runs', 'run', 'stats', 'agent-metrics', 'wakeups', 'lead', 'briefs', 'memory'],
  'draft.change': ['approvals', 'threads', 'thread', 'stats', 'leads'],
  'meeting.change': ['meetings', 'meetings-status'],
  'channel.health': ['channel-health', 'integrations'],
};

/** Turns the payload-free SSE triggers into cache invalidations. */
export function useLiveInvalidation(client: QueryClient, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // one subscription per type: events.ts throttles per subscriber and keeps only
    // the latest pending event, so a shared one would drop mixed-type bursts.
    // sync gets its own subscriber for the same reason — a resource event landing in
    // the throttle window must not replace a pending reconnect sync.
    const offs = (Object.keys(REFRESH) as (keyof typeof REFRESH)[]).map((type) =>
      onControlEvent(type, (e) => {
        if (e.type === 'sync') return;
        const roots = new Set(REFRESH[type]);
        void client.invalidateQueries({
          predicate: (q) => roots.has(String(q.queryKey[0])),
        });
      }),
    );
    offs.push(onControlEvent('sync', () => void client.invalidateQueries()));
    return () => offs.forEach((off) => off());
  }, [client, enabled]);
}
