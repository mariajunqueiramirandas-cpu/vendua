import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AdminEvent, AdminHub } from '../src/admin/live.ts';
import { mountStorefrontEvents, storefrontTopics } from '../src/modules/storefront-live.ts';
import { PresenceTracker } from '../src/modules/presence.ts';
import type { Tenant } from '../src/platform/tenancy.ts';

function fakeSql() {
  const sent: string[] = [];
  let onNotify: (payload: string) => void = () => {};
  const sql = Object.assign(
    async (_s: TemplateStringsArray, _c: string, payload: string) => void sent.push(payload),
    {
      listen: async (_ch: string, fn: (p: string) => void) => void (onNotify = fn),
    },
  ) as never;
  return { sql, sent, notify: (p: string) => onNotify(p) };
}

describe('PresenceTracker', () => {
  test('counts local streams and sums other processes, expiring silent ones', async () => {
    const f = fakeSql();
    const p = new PresenceTracker(f.sql);
    let moved = 0;
    await p.subscribe('t1', () => moved++);
    const a = await p.join('t1');
    const b = await p.join('t1');
    const other = await p.join('t2');
    expect(p.viewers('t1')).toBe(2);
    f.notify('t1|other-proc|3');
    f.notify('t1|other-proc|nope');
    expect(p.viewers('t1')).toBe(5);
    a();
    a(); // double close is a no-op
    expect(p.viewers('t1')).toBe(4);
    b();
    other();
    expect(p.viewers('t1')).toBe(3);
    expect(p.viewers('t2')).toBe(0);
    expect(moved).toBeGreaterThan(3);
    await Bun.sleep(1100);
    expect(f.sent.some((s) => s.startsWith(`t1|${p.procId}|`))).toBe(true);
    p.stop();
  });
});

describe('storefrontTopics', () => {
  test('maps admin changes to the storefront reads they stale', () => {
    const t = (topic: AdminEvent['topic']) => storefrontTopics({ topic, id: '' });
    expect(t('catalog')).toEqual(['catalog']);
    expect(t('order.placed')).toEqual(['catalog']);
    expect(t('store')).toEqual(['store', 'surfaces']);
    expect(t('surfaces')).toEqual(['surfaces']);
    expect(t('team')).toEqual([]);
    expect(t('marketing')).toEqual([]);
    expect(storefrontTopics({ topic: 'store', id: 'resync' })).toEqual([
      'catalog',
      'store',
      'surfaces',
    ]);
  });
});

describe('GET /events', () => {
  test('streams coalesced, payload-free hints for its tenant only', async () => {
    let push!: (e: AdminEvent) => void;
    let unsubscribed = 0;
    const hub = {
      subscribe: async (tenantId: string, fn: (e: AdminEvent) => void) => {
        expect(tenantId).toBe('t1');
        push = fn;
        return () => void unsubscribed++;
      },
    } as unknown as AdminHub;
    const app = new Hono<{ Variables: { tenant: Tenant } }>();
    app.use('*', async (c, next) => {
      c.set('tenant', { id: 't1' } as Tenant);
      await next();
    });
    const presence = new PresenceTracker(fakeSql().sql);
    mountStorefrontEvents(app, hub, presence);
    const res = await app.request('/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const until = async (needle: string) => {
      while (!buf.includes(needle)) buf += dec.decode((await reader.read()).value);
    };
    await until('event: hello');
    push({ topic: 'catalog', id: 'p1' });
    push({ topic: 'catalog', id: 'p2' });
    push({ topic: 'store', id: '' });
    push({ topic: 'team', id: '' });
    await until('event: change');
    await until('"topics"');
    const data = buf.split('\n').find((l) => l.startsWith('data: {"topics"'))!;
    expect(JSON.parse(data.slice(6)).topics.sort()).toEqual(['catalog', 'store', 'surfaces']);
    expect(buf).not.toContain('p1');
    await reader.cancel();
    for (let i = 0; i < 100 && !unsubscribed; i++) await Bun.sleep(5);
    expect(unsubscribed).toBe(1);
  });
});
