/**
 * control SSE — GET /control/v1/events serves the thin control-events bus
 * as an SSE stream: a connect-time `sync` frame (the client's refetch
 * signal, also covering events missed while reconnecting), each bus event
 * forwarded verbatim, and a comment-line heartbeat so proxy idle timeouts
 * don't kill the stream. Events carry no payload — clients refetch the
 * endpoints they already poll.
 */
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { subscribeControlEvents } from './control-events.ts';

/** Proxy idle timeouts sit at 30–60s; 20s keeps the stream warm. */
const HEARTBEAT_MS = 20_000;

export function controlSse(c: Context, heartbeatMs = HEARTBEAT_MS): Response {
  const res = streamSSE(c, async (stream) => {
    // Everything up to `await done` must stay synchronous: the response is
    // handed to the runtime as soon as this callback first yields, and an
    // abort landing before onAbort registration would leak the listener.
    const unsubscribe = subscribeControlEvents((event) => {
      // write() swallows errors on a dead socket — a stalled consumer only
      // stalls its own stream, never the bus.
      void stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
        id: String(event.id),
      });
    });
    const beat = setInterval(() => void stream.write(':ka\n\n'), heartbeatMs);
    const done = new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(beat);
        resolve();
      });
    });
    void stream.writeSSE({ event: 'sync', data: '{}' });
    await done;
  });
  // Headers go through c.header, not res.headers: a middleware that
  // materialized c.res before this handler (cors does, pre-next) makes
  // compose's `context.res = res` merge the stale stored headers back over
  // the returned response — res.headers.set('cache-control') would be
  // silently clobbered by the no-cache streamSSE wrote there. Rebuilding
  // via newResponse picks up this store in both dispatch paths.
  c.header('cache-control', 'no-cache, no-transform'); // no proxy transforms
  c.header('x-accel-buffering', 'no'); // nginx: never buffer the stream
  return c.newResponse(res.body);
}
