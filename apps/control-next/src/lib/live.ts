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
    // the latest pending event, so a shared one would drop mixed-type bursts
    let lastSync = -1;
    const offs = (Object.keys(REFRESH) as (keyof typeof REFRESH)[]).map((type) =>
      onControlEvent(type, (e) => {
        if (e.type === 'sync') {
          // sync lands on every subscriber — refetch once
          if (e.id === lastSync) return;
          lastSync = e.id;
          void client.invalidateQueries();
          return;
        }
        const roots = new Set(REFRESH[type]);
        void client.invalidateQueries({
          predicate: (q) => roots.has(String(q.queryKey[0])),
        });
      }),
    );
    return () => offs.forEach((off) => off());
  }, [client, enabled]);
}
