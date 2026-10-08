import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AdminEvent, AdminHub } from '../admin/live.ts';
import type { PresenceTracker } from './presence.ts';
import { HttpError, clientIp } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';

// Public, payload-free hints behind `GET /storefront/v1/events`: "what you cached may be
// stale" — the Kernel (and v.js) refetch through the normal reads, so the stream leaks
// nothing a page load wouldn't. Fed by the same per-tenant hub as the admin stream.

export type StorefrontTopic = 'catalog' | 'store' | 'surfaces';

const HEARTBEAT_MS = 20_000;
const MAX_MS = 10 * 60_000;
/** bursts (an import touching 200 products) collapse into one hint per topic */
const COALESCE_MS = 250;
/** per process; over it Core answers 503 and clients keep their polling */
export const MAX_STOREFRONT_STREAMS = 2000;

/** Which storefront reads an admin-side change can have made stale. */
export function storefrontTopics(e: AdminEvent): StorefrontTopic[] {
  if (e.id === 'resync') return ['catalog', 'store', 'surfaces'];
  switch (e.topic) {
    // a placed order draws stock; a cancellation returns it
    case 'order.placed':
    case 'order.changed':
    case 'catalog':
      return ['catalog'];
    case 'store':
      // status/hours/zones, and the banners composed from them
      return ['store', 'surfaces'];
    case 'surfaces':
      return ['surfaces'];
    default:
      return [];
  }
}

// a script opening hundreds shouldn't take the process cap, but mobile carriers put many
// shoppers behind one address (CGNAT) — and a refused stream only falls back to polling
export const MAX_STREAMS_PER_IP = 100;
/** one store's flood stays in that store instead of filling the process cap for all */
export const MAX_STREAMS_PER_TENANT = 500;

/** Open-connection caps per process, per client IP and per key (a store, an order). `take`
 *  throws 503 (process or key full: clients fall back to polling) or 429 (this IP), else
 *  returns the release. */
export function liveSlots(caps: { max: number; perIp: number; perKey: number }) {
  let open = 0;
  const byIp = new Map<string, number>();
  const byKey = new Map<string, number>();
  const drop = (m: Map<string, number>, k: string) => {
    const left = (m.get(k) ?? 1) - 1;
    if (left > 0) m.set(k, left);
    else m.delete(k);
  };
  return {
    count: () => open,
    take(ip: string, key: string): () => void {
      if (open >= caps.max)
        throw new HttpError(503, 'STREAM_UNAVAILABLE', 'too many live connections, poll instead');
      const mine = byIp.get(ip) ?? 0;
      if (mine >= caps.perIp)
        throw new HttpError(429, 'RATE_LIMITED', 'too many live connections from this address');
      const theirs = byKey.get(key) ?? 0;
      if (theirs >= caps.perKey)
        throw new HttpError(503, 'STREAM_UNAVAILABLE', 'too many live connections, poll instead');
      open++;
      byIp.set(ip, mine + 1);
      byKey.set(key, theirs + 1);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        open--;
        drop(byIp, ip);
        drop(byKey, key);
      };
    },
  };
}

export type LiveSlots = ReturnType<typeof liveSlots>;

const slots = liveSlots({
  max: MAX_STOREFRONT_STREAMS,
  perIp: MAX_STREAMS_PER_IP,
  perKey: MAX_STREAMS_PER_TENANT,
});
export function storefrontStreamCount() {
  return slots.count();
}

export function mountStorefrontEvents(
  storefront: Hono<{ Variables: { tenant: Tenant } }>,
  hub: AdminHub,
  presence: PresenceTracker,
  ipFlags: { trustForwardedFor?: boolean; proxyHops?: number } = {},
) {
  storefront.get('/events', async (c) => {
    const tenant = c.get('tenant');
    const release = slots.take(clientIp(c, ipFlags), tenant.id);
    const res = streamSSE(c, async (stream) => {
      let finish!: () => void;
      const done = new Promise<void>((r) => (finish = r));
      stream.onAbort(() => finish());
      const pending = new Set<StorefrontTopic>();
      let flush: ReturnType<typeof setTimeout> | null = null;
      let seq = 0;
      const unsubscribe = await hub.subscribe(tenant.id, (e) => {
        for (const t of storefrontTopics(e)) pending.add(t);
        if (!pending.size || flush) return;
        flush = setTimeout(() => {
          flush = null;
          const topics = [...pending];
          pending.clear();
          void stream
            .writeSSE({ event: 'change', id: String(++seq), data: JSON.stringify({ topics }) })
            .catch(() => finish());
        }, COALESCE_MS);
      });
      const leave = await presence.join(tenant.id);
      await stream.writeSSE({ event: 'hello', data: '{}' });
      const beat = setInterval(
        () => void stream.write(':ka\n\n').catch(() => finish()),
        HEARTBEAT_MS,
      );
      const lifetime = setTimeout(finish, MAX_MS);
      try {
        await done;
      } finally {
        release();
        leave();
        unsubscribe();
        clearInterval(beat);
        clearTimeout(lifetime);
        if (flush) clearTimeout(flush);
      }
    });
    c.header('cache-control', 'no-cache, no-transform');
    c.header('x-accel-buffering', 'no');
    return c.newResponse(res.body);
  });
}
