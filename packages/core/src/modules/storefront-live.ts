import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AdminEvent, AdminHub } from '../admin/live.ts';
import { HttpError } from '../platform/http.ts';
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

let open = 0;
export function storefrontStreamCount() {
  return open;
}

export function mountStorefrontEvents(
  storefront: Hono<{ Variables: { tenant: Tenant } }>,
  hub: AdminHub,
) {
  storefront.get('/events', async (c) => {
    const tenant = c.get('tenant');
    if (open >= MAX_STOREFRONT_STREAMS)
      throw new HttpError(503, 'STREAM_UNAVAILABLE', 'too many live connections, poll instead');
    open++;
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
      await stream.writeSSE({ event: 'hello', data: '{}' });
      const beat = setInterval(
        () => void stream.write(':ka\n\n').catch(() => finish()),
        HEARTBEAT_MS,
      );
      const lifetime = setTimeout(finish, MAX_MS);
      try {
        await done;
      } finally {
        open--;
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
