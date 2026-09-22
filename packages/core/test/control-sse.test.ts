import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  controlEventListenerCount,
  emitControlEvent,
} from '../src/modules/control-events.ts';
import { controlSse } from '../src/modules/control-sse.ts';

// The events stream never touches sql — a lazy client (postgres.js only
// dials on first query) stands in for AppDeps without a database.
const app = createApp({
  sql: postgres('postgres://localhost:1/vendua'),
  sessionSecret: 's',
  controlSecret: 'ctl-secret',
  autoDrain: false,
});
const authed = { 'x-vendua-control': 'ctl-secret' };

/** Read SSE frames (text up to the blank-line boundary) off a stream. */
function frameReader(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const next = async (): Promise<string> => {
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        return frame;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error('stream closed mid-frame');
      buf += dec.decode(value, { stream: true });
    }
  };
  return { next, cancel: () => reader.cancel() };
}

/** onAbort cleanup is synchronous but rides the cancel chain — poll briefly. */
async function expectListeners(n: number) {
  for (let i = 0; i < 100 && controlEventListenerCount() !== n; i++) {
    await Bun.sleep(5);
  }
  expect(controlEventListenerCount()).toBe(n);
}

describe('GET /control/v1/events', () => {
  test('unauthed → 404 like every gated route', async () => {
    const res = await app.request('/control/v1/events');
    expect(res.status).toBe(404);
  });

  test('authed → event stream: headers, sync frame, bus frames, abort cleanup', async () => {
    const baseline = controlEventListenerCount();
    const res = await app.request('/control/v1/events', { headers: authed });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const frames = frameReader(res);
    try {
      // The connect-time sync frame — also the resync signal on reconnect.
      const sync = await frames.next();
      expect(sync).toContain('event: sync');
      expect(sync).toContain('data: {}');
      await expectListeners(baseline + 1);

      // A bus event is forwarded verbatim: type → event name, payload → data,
      // monotonic id → SSE id for ordering/dedupe within the connection.
      emitControlEvent('lead.change', 'lead-1');
      const frame = await frames.next();
      expect(frame).toContain('event: lead.change');
      expect(frame).toContain('data: {"id":');
      expect(frame).toContain('"type":"lead.change"');
      expect(frame).toContain('"ref":"lead-1"');
      expect(frame).toMatch(/\nid: \d+/);
    } finally {
      await frames.cancel();
    }
    await expectListeners(baseline);
  });

  test('a second connection gets its own subscription; each abort frees it', async () => {
    const baseline = controlEventListenerCount();
    const res = await app.request('/control/v1/events', { headers: authed });
    const a = frameReader(res);
    const res2 = await app.request('/control/v1/events', { headers: authed });
    const b = frameReader(res2);
    try {
      await a.next();
      await b.next();
      await expectListeners(baseline + 2);
      emitControlEvent('run.update');
      expect(await a.next()).toContain('event: run.update');
      expect(await b.next()).toContain('event: run.update');
    } finally {
      await a.cancel();
      await b.cancel();
    }
    await expectListeners(baseline);
  });

  test('heartbeat comment frames keep the stream warm', async () => {
    // Mount the handler with a short interval — the route uses the 20s
    // default, which no test wants to wait through.
    const h = new Hono();
    h.get('/events', (c) => controlSse(c, 20));
    const res = await h.request('/events');
    const frames = frameReader(res);
    try {
      await frames.next(); // sync
      const ka = await frames.next();
      expect(ka).toBe(':ka');
    } finally {
      await frames.cancel();
    }
  });
});
