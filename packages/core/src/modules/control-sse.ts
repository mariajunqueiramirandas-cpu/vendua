// SSE stream of the control-events bus: a connect-time `sync` frame (refetch
// signal, covers events missed while reconnecting), verbatim events, a comment
// heartbeat. No payloads — clients refetch the endpoints they already poll.
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { subscribeControlEvents } from './control-events.ts';

// proxy idle timeouts sit at 30–60s; 20s keeps the stream warm
const HEARTBEAT_MS = 20_000;

export function controlSse(c: Context, heartbeatMs = HEARTBEAT_MS): Response {
  const res = streamSSE(c, async (stream) => {
    // stay synchronous until `await done`: the response ships on first yield,
    // and an abort before onAbort registration would leak the listener
    const unsubscribe = subscribeControlEvents((event) => {
      // write() swallows errors on a dead socket — a stalled consumer only stalls its own stream
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
  // c.header, not res.headers: a middleware that materialized c.res earlier
  // (cors does) makes compose merge the stale headers back over the response,
  // silently clobbering res.headers writes — newResponse picks up the store
  c.header('cache-control', 'no-cache, no-transform'); // no proxy transforms
  c.header('x-accel-buffering', 'no'); // nginx: never buffer the stream
  return c.newResponse(res.body);
}
