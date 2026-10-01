import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { PRODUCT, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.13 — Core says when the catalog next changes by itself (a timed promotion or a
// product's hours turning); an open page reads it again then.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

describe('catalog clock', () => {
  test('a read that comes back with the same moment arms the timer again', async () => {
    mockCore();
    const base = globalThis.fetch;
    let reads = 0;
    const soon = new Date(Date.now() + 100).toISOString();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://shop.test');
      if (url.pathname !== '/storefront/v1/catalog') return base(input, init);
      reads++;
      // a clock running ahead: the first re-read lands before the moment and gets it back
      return new Response(
        JSON.stringify({
          categories: [{ id: 'c1', slug: 'doces', name: 'Doces', sort: 1, products: [PRODUCT] }],
          ...(reads <= 2 ? { nextChangeAt: soon } : {}),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    m = await mount({ path: '/' });
    await act(async () => new Promise((r) => setTimeout(r, 1300)));
    await flush();
    expect(reads).toBe(2);
    await act(async () => new Promise((r) => setTimeout(r, 1200)));
    await flush();
    expect(reads).toBe(3);
  });

  test('the catalog is read again when Core says it next changes', async () => {
    const core = mockCore();
    const base = globalThis.fetch;
    let reads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://shop.test');
      if (url.pathname !== '/storefront/v1/catalog') return base(input, init);
      reads++;
      return new Response(
        JSON.stringify({
          categories: [{ id: 'c1', slug: 'doces', name: 'Doces', sort: 1, products: [PRODUCT] }],
          // the first answer says "in a moment"; the next has nothing coming
          ...(reads === 1 ? { nextChangeAt: new Date(Date.now() + 100).toISOString() } : {}),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    m = await mount({ path: '/' });
    expect(reads).toBe(1);
    expect(core.calls.length).toBeGreaterThan(0);
    await act(async () => new Promise((r) => setTimeout(r, 1300)));
    await flush();
    expect(reads).toBe(2);
    // no further change announced: no further read
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(reads).toBe(2);
  });
});
