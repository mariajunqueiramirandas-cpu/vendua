import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AdminEvent, AdminHub } from '../src/admin/live.ts';
import { mountStorefrontEvents, storefrontTopics } from '../src/modules/storefront-live.ts';
import type { Tenant } from '../src/platform/tenancy.ts';

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
    mountStorefrontEvents(app, hub);
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
