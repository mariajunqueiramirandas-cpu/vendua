import { afterEach, describe, expect, test } from 'bun:test';
import { harness, publish, releaseRoute, type Harness } from './helpers.ts';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

describe('redirect routes', () => {
  test('permanent: 301 to the target with path and query kept, cached briefly', async () => {
    h = await harness();
    h.core.redirects.set('www.loja.com.br', { to: 'https://loja.com.br', permanent: true });
    const res = await h.get('/produto/bolo?cor=azul&x=1', 'www.loja.com.br', {
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://loja.com.br/produto/bolo?cor=azul&x=1');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');

    const root = await h.get('/', 'www.loja.com.br', { method: 'HEAD', redirect: 'manual' });
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe('https://loja.com.br/');
  });

  test('temporary: 302, never cached, a trailing slash on the target is not doubled', async () => {
    h = await harness();
    h.core.redirects.set('loja.com.br', {
      to: 'https://loja.vendua.com.br/',
      permanent: false,
    });
    const res = await h.get('/sobre?utm=x', 'loja.com.br', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://loja.vendua.com.br/sobre?utm=x');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('other methods are still 405, before the redirect', async () => {
    h = await harness();
    h.core.redirects.set('www.loja.com.br', { to: 'https://loja.com.br', permanent: true });
    const res = await h.get('/', 'www.loja.com.br', { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
  });

  test('a malformed redirect is refused like any malformed route', async () => {
    h = await harness();
    const release = releaseRoute(await publish(h.store), h.store);
    const bad: unknown[] = [
      { to: 'http://loja.com.br', permanent: true },
      { to: 'https://loja.com.br/outro', permanent: true },
      { to: 'https://loja.com.br?x=1', permanent: true },
      { to: 'https://loja.com.br/#x', permanent: true },
      { to: 'https://user:pw@loja.com.br', permanent: true },
      { to: 'https://loja.com.br\\@evil.com', permanent: true },
      { to: 'https://loja com.br', permanent: true },
      { to: 'https://localhost', permanent: true },
      { to: 'https://-loja.com.br', permanent: true },
      { to: 'javascript:alert(1)', permanent: true },
      { to: '//loja.com.br', permanent: true },
      { to: 'https://loja.com.br', permanent: 'yes' },
      { to: 42, permanent: true },
      { permanent: true },
      'https://loja.com.br',
      true,
    ];
    for (const [i, redirect] of bad.entries()) {
      const host = `bad${i}.test`;
      h.core.routes.set(host, release); // servable if the redirect were ignored
      h.core.redirects.set(host, redirect);
      const res = await h.get('/', host, { redirect: 'manual' });
      expect(res.status, JSON.stringify(redirect)).toBe(503);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  test('a route without the field (or with null) serves the store as before', async () => {
    h = await harness();
    const m = await publish(h.store);
    h.core.routes.set('loja.test', releaseRoute(m, h.store)); // no `redirect` key at all
    const res = await h.get('/', 'loja.test', { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vendua-release')).toBe(m.release);

    h.core.routes.set('nulo.test', releaseRoute(m, h.store));
    h.core.redirects.set('nulo.test', null);
    expect((await h.get('/', 'nulo.test', { redirect: 'manual' })).status).toBe(200);
  });

  test('the redirect survives a restart during a Core outage (snapshot)', async () => {
    h = await harness({ routeTtlMs: 30 });
    h.core.redirects.set('www.loja.com.br', { to: 'https://loja.com.br', permanent: true });
    expect((await h.get('/', 'www.loja.com.br', { redirect: 'manual' })).status).toBe(301);
    h.core.down = true;
    await h.restart();
    const res = await h.get('/a?b=c', 'www.loja.com.br', { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://loja.com.br/a?b=c');
  });
});
