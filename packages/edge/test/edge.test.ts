import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactPath } from '../src/storefront.ts';
import { peerAddress } from '../src/proxy.ts';
import {
  INDEX_HTML,
  harness,
  injected,
  makeDist,
  publish,
  releaseRoute,
  SECRET,
  type Harness,
} from './helpers.ts';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

async function live(opts = {}) {
  h = await harness(opts);
  const m = await publish(h.store);
  h.core.routes.set('loja.test', releaseRoute(m, h.store));
  return m;
}

describe('storefront', () => {
  test('resolves the host and serves index.html with the state injected and escaped', async () => {
    const m = await live();
    const notice = 'fechado</script><script>alert(1)</script> & <!-- \u2028';
    h.core.states.set('loja.test', { status: 'closed', notice });
    const res = await h.get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vendua-release')).toBe(m.release);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    const html = await res.text();
    expect(html.match(/<\/script>/g)?.length).toBe(3); // v.js, app, state — none from the notice
    expect(html).not.toContain('alert(1)</script>');
    expect(html).not.toContain('\u2028');
    expect(html.indexOf('id="vendua-state"')).toBeLessThan(html.indexOf('</head>'));
    expect(injected(html)).toEqual({ status: 'closed', notice });
    expect(h.core.calls.resolve).toEqual(['loja.test']);
    expect(h.core.calls.secrets).toEqual([SECRET]);
    expect(h.core.calls.surfaces).toEqual(['loja.test']);
  });

  test('host is lowercased and its port stripped; bad hosts are 400', async () => {
    await live();
    expect((await h.get('/', 'LOJA.test:8080')).status).toBe(200);
    expect(h.core.calls.resolve).toEqual(['loja.test']);
    expect((await h.get('/', 'bad_host!')).status).toBe(400);
  });

  test('SPA fallback: extension-less and .html misses serve the entry, other misses 404', async () => {
    const m = await live();
    for (const p of ['/produto/bolo-de-pote', '/pedido/', '/sobre.html']) {
      const res = await h.get(p);
      expect(res.status).toBe(200);
      expect(injected(await res.text())).toBeDefined();
    }
    const miss = await h.get('/assets/missing-123.js');
    expect(miss.status).toBe(404);
    expect(miss.headers.get('x-vendua-release')).toBe(m.release);
    expect((await h.get('/robots.txt')).status).toBe(200);
  });

  test('assets: immutable cache, ETag/304, gzip with vary', async () => {
    await live();
    const res = await h.get('/assets/index-abc123.js', 'loja.test', {
      headers: { 'accept-encoding': 'gzip' },
      decompress: false,
    } as RequestInit);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('vary')).toBe('accept-encoding');
    const body = new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())));
    expect(body).toStartWith('console.log(');
    const etag = res.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{32}-gz"$/);

    const plain = await h.get('/assets/index-abc123.js', 'loja.test', {
      headers: { 'accept-encoding': 'identity' },
    });
    expect(plain.headers.get('content-encoding')).toBeNull();
    const again = await h.get('/assets/index-abc123.js', 'loja.test', {
      headers: { 'if-none-match': etag },
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');

    const png = await h.get('/assets/logo.png', 'loja.test', {
      headers: { 'accept-encoding': 'gzip' },
      decompress: false,
    } as RequestInit);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-encoding')).toBeNull();
    expect((await h.get('/robots.txt')).headers.get('cache-control')).toBe('no-cache');
  });

  test('HEAD works, other methods are 405', async () => {
    await live();
    const head = await h.get('/assets/index-def456.css', 'loja.test', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('etag')).toBeTruthy();
    const post = await h.get('/', 'loja.test', { method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
  });

  test('unknown host: the not-found page with 404 and a 10s negative cache', async () => {
    await live();
    const res = await h.get('/', 'nada.test');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('Essa loja não existe (ainda)');
    await h.get('/qualquer', 'nada.test');
    expect(h.core.calls.resolve.filter((x) => x === 'nada.test').length).toBe(1);
  });

  test('a store Core stops knowing is dropped at the next revalidation', async () => {
    await live({ routeTtlMs: 20, negativeTtlMs: 20 });
    expect((await h.get('/')).status).toBe(200);
    h.core.routes.set('loja.test', 'unknown');
    await Bun.sleep(40);
    expect((await h.get('/')).status).toBe(200); // stale while it revalidates
    await Bun.sleep(10);
    expect((await h.get('/')).status).toBe(404);
    await Bun.sleep(1100); // negative entry and the failure backoff both expire
    expect((await h.get('/')).status).toBe(404);
    const health = (await (await h.get('/_edge/healthz')).json()) as { routes: number };
    expect(health.routes).toBe(0);
    expect(h.core.calls.resolve.length).toBe(3);
  });

  test('path traversal, NUL and backslashes are refused', async () => {
    await live();
    for (const p of ['/assets/..%2f..%2fsnapshot.json', '/a%00b', '/a%5cb', '/%E0%A4%A']) {
      expect((await h.get(p)).status).toBe(400);
    }
  });

  test('artifactPath refuses traversal (Bun already folds dot segments of the raw URL)', () => {
    expect(artifactPath('/')).toBe('index.html');
    expect(artifactPath('/pedido/')).toBe('pedido/index.html');
    expect(artifactPath('/assets/a%20b.js')).toBe('assets/a b.js');
    for (const p of [
      '/../etc/passwd',
      '/a/%2e%2e/b',
      '/a/./b',
      '/a//b',
      '/a%5cb',
      '/a%00',
      '/%E0%A4%A',
    ])
      expect(artifactPath(p)).toBeNull();
  });

  test('a known store without a release gets the 503 page', async () => {
    h = await harness();
    h.core.routes.set('nova.test', null);
    const res = await h.get('/', 'nova.test');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('Loja em preparação');
  });

  test('a wrong edge secret is never an unknown host', async () => {
    await live({ edgeSecret: 'wrong' });
    const res = await h.get('/');
    expect(res.status).toBe(503);
    expect(h.core.calls.secrets).toEqual(['wrong']);
  });

  test('sha256 mismatch → 502 and nothing cached; a good copy is served afterwards', async () => {
    const m = await live();
    const file = join(h.storeDir, 'storefronts/_template', m.release, 'assets/index-abc123.js');
    const good = await Bun.file(file).bytes();
    writeFileSync(file, 'tampered');
    expect((await h.get('/assets/index-abc123.js')).status).toBe(502);
    writeFileSync(file, good);
    const ok = await h.get('/assets/index-abc123.js');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toStartWith('console.log(');
  });

  test('files are served from the disk cache once fetched', async () => {
    const m = await live();
    expect((await h.get('/robots.txt')).status).toBe(200);
    const cached = join(h.cacheDir, 'releases', m.release, 'robots.txt');
    expect(await Bun.file(cached).text()).toBe('User-agent: *\nAllow: /\n');
  });
});

describe('Core outages', () => {
  test('stale route and stale state keep serving while Core is down', async () => {
    const m = await live({ routeTtlMs: 30, stateTtlMs: 30 });
    h.core.states.set('loja.test', { status: 'open', n: 1 });
    expect((await h.get('/')).status).toBe(200);
    h.core.down = true;
    await Bun.sleep(60);
    for (let i = 0; i < 3; i++) {
      const res = await h.get('/');
      expect(res.status).toBe(200);
      expect(res.headers.get('x-vendua-release')).toBe(m.release);
      expect(injected(await res.text())).toEqual({ status: 'open', n: 1 });
      await Bun.sleep(20);
    }
    const health = (await (await h.get('/_edge/healthz', 'any.host')).json()) as {
      ok: boolean;
      core: string;
      routes: number;
    };
    expect(health).toEqual({ ok: true, routes: 1, core: 'down' });
  });

  test('a host first seen while Core is down gets the 503 page', async () => {
    await live();
    h.core.down = true;
    expect((await h.get('/')).status).toBe(503);
  });

  test('state missing and Core down: HTML is served without the script', async () => {
    await live({ routeTtlMs: 60_000 });
    h.core.status5xx = false;
    const first = await h.get('/assets/logo.png'); // route cached, no state fetched
    expect(first.status).toBe(200);
    h.core.down = true;
    const res = await h.get('/');
    expect(res.status).toBe(200);
    expect(injected(await res.text())).toBeUndefined();
  });

  test('last-known-good v.js, state and surfaces are served stale on errors and 5xx', async () => {
    await live();
    const vjs = await (await h.get('/v1/v.js')).text();
    const state = await (await h.get('/storefront/v1/state?cart=1')).json();
    const surf = await (await h.get('/storefront/v1/surfaces')).json();

    h.core.down = true;
    const s1 = await h.get('/v1/v.js', 'other.test');
    expect(s1.status).toBe(200);
    expect(s1.headers.get('x-vendua-edge-stale')).toBe('1');
    expect(await s1.text()).toBe(vjs);
    const s2 = await h.get('/storefront/v1/state?cart=1');
    expect(s2.headers.get('x-vendua-edge-stale')).toBe('1');
    expect(await s2.json()).toEqual(state);
    expect(await (await h.get('/storefront/v1/surfaces')).json()).toEqual(surf);
    // per host + query
    expect((await h.get('/storefront/v1/state?cart=2')).status).toBe(502);
    expect((await h.get('/storefront/v1/state?cart=1', 'other.test')).status).toBe(502);

    h.core.down = false;
    h.core.status5xx = true;
    const s3 = await h.get('/storefront/v1/state?cart=1');
    expect(s3.status).toBe(200);
    expect(s3.headers.get('x-vendua-edge-stale')).toBe('1');
    h.core.status5xx = false;
    expect(
      (await h.get('/storefront/v1/state?cart=1')).headers.get('x-vendua-edge-stale'),
    ).toBeNull();
  });

  test('a restart during a Core outage serves from the snapshot', async () => {
    const m = await live({ routeTtlMs: 30 });
    h.core.states.set('loja.test', { status: 'open', from: 'before' });
    expect((await h.get('/')).status).toBe(200);
    const vjs = await (await h.get('/v1/v.js')).text();
    h.core.down = true;
    await h.restart();
    const res = await h.get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vendua-release')).toBe(m.release);
    expect(injected(await res.text())).toEqual({ status: 'open', from: 'before' });
    const v = await h.get('/v1/v.js');
    expect(v.headers.get('x-vendua-edge-stale')).toBe('1');
    expect(await v.text()).toBe(vjs);
  });
});

describe('page head', () => {
  const META = {
    title: 'Quero Pudim — pudins artesanais',
    description: 'Pudins de pote.',
    image: 'https://quero.example/v1/media/logo.png',
    url: 'https://quero.example',
    siteName: 'Quero Pudim',
  };
  const PUDIM = {
    id: 'p1',
    slug: 'pudim',
    name: 'Pudim de leite',
    description: 'Cremoso.',
    imageUrl: '/v1/media/pudim.jpg',
    basePriceCents: 1800,
  };
  const og = (html: string, key: string) =>
    new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html)?.[1];
  const title = (html: string) => /<title>(.*?)<\/title>/.exec(html)?.[1];

  async function withMeta(opts = {}) {
    await live(opts);
    h.core.states.set('loja.test', { version: 1, store: { status: 'open' }, meta: META });
  }

  test("a store page gets the store's head from the envelope, before the state", async () => {
    await withMeta();
    const res = await h.get('/cardapio?utm_source=x');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const html = await res.text();
    expect(title(html)).toBe('Quero Pudim — pudins artesanais');
    expect(og(html, 'og:type')).toBe('website');
    expect(og(html, 'og:url')).toBe('https://quero.example/cardapio');
    expect(og(html, 'og:image')).toBe(META.image);
    expect(og(html, 'twitter:card')).toBe('summary_large_image');
    expect(html).toContain('<link rel="canonical" href="https://quero.example/cardapio">');
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('id="vendua-state"'));
    expect(injected(html)).toMatchObject({ meta: META });
    expect(h.core.calls.products).toEqual([]);
  });

  test('a product page gets product · store, its description and its image', async () => {
    await withMeta();
    h.core.products.set('loja.test pudim', PUDIM);
    const html = await (await h.get('/produto/pudim')).text();
    expect(title(html)).toBe('Pudim de leite · Quero Pudim');
    expect(og(html, 'og:type')).toBe('product');
    expect(og(html, 'description')).toBe('Cremoso.');
    expect(og(html, 'og:image')).toBe('https://quero.example/v1/media/pudim.jpg');
    expect(og(html, 'og:url')).toBe('https://quero.example/produto/pudim');
    // cached: a second view does not ask Core again
    await h.get('/produto/pudim');
    expect(h.core.calls.products).toEqual(['loja.test pudim']);
  });

  test("an unknown product or a failing Core falls back to the store's head", async () => {
    await withMeta();
    h.core.products.set('loja.test quebrado', 500);
    for (const p of ['/produto/nada', '/produto/quebrado']) {
      const res = await h.get(p);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(title(html)).toBe(META.title);
      expect(og(html, 'og:type')).toBe('website');
      expect(injected(html)).toMatchObject({ meta: META });
    }
  });

  test('a slow product never slows the page; its head is there once Core answers', async () => {
    await withMeta({ stateWaitMs: 100 });
    h.core.products.set('loja.test pudim', PUDIM);
    h.core.productDelayMs = 500;
    await h.get('/assets/logo.png'); // route and manifest cached: the timing is the head's
    const t0 = performance.now();
    const html = await (await h.get('/produto/pudim')).text();
    expect(performance.now() - t0).toBeLessThan(350);
    expect(title(html)).toBe(META.title);
    expect(injected(html)).toMatchObject({ meta: META });
    await Bun.sleep(550);
    expect(title(await (await h.get('/produto/pudim')).text())).toBe(
      'Pudim de leite · Quero Pudim',
    );
  });

  test('an envelope without meta (an older Core) leaves the head as built', async () => {
    await live();
    h.core.states.set('loja.test', { version: 1, store: { status: 'open' } });
    const html = await (await h.get('/produto/pudim')).text();
    expect(title(html)).toBe('Loja');
    expect(html).not.toContain('og:');
    expect(html).not.toContain('canonical');
    expect(html.replace(/<script id="vendua-state">.*?<\/script>/, '')).toBe(INDEX_HTML);
  });

  test('another HTML file the store ships keeps its own head', async () => {
    h = await harness();
    const page = '<html><head><title>Privacidade</title></head><body></body></html>';
    const m = await publish(h.store, '_template', makeDist({ 'privacidade.html': page }));
    h.core.routes.set('loja.test', releaseRoute(m, h.store));
    h.core.states.set('loja.test', { version: 1, store: { status: 'open' }, meta: META });
    const html = await (await h.get('/privacidade.html')).text();
    expect(title(html)).toBe('Privacidade');
    expect(injected(html)).toMatchObject({ meta: META });
  });
});

describe('API proxy', () => {
  test('forwards method, body, query, Host and X-Forwarded-*', async () => {
    await live();
    const res = await h.get('/checkout/v1/echo?a=1', 'Loja.test', {
      method: 'POST',
      body: JSON.stringify({ cart: 'c1' }),
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-proto': 'https',
      },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-core')).toBe('1');
    expect(await res.json()).toMatchObject({
      method: 'POST',
      host: 'loja.test',
      body: '{"cart":"c1"}',
      xff: '203.0.113.9, 127.0.0.1',
      xfh: 'loja.test',
      xfp: 'https',
      query: '?a=1',
    });
    const r2 = await h.get('/checkout/v1/echo', 'loja.test', { method: 'PUT', body: 'x' });
    expect(await r2.json()).toMatchObject({ method: 'PUT', xff: '127.0.0.1', xfp: 'http' });
    expect(h.core.calls.resolve).toEqual([]); // the API never resolves the host
  });

  test('an IPv4 peer on a dual-stack socket is appended as plain IPv4, like nginx', () => {
    expect(peerAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(peerAddress('::FFFF:10.0.0.7')).toBe('10.0.0.7');
    expect(peerAddress('::1')).toBe('::1');
    expect(peerAddress('2001:db8::1')).toBe('2001:db8::1');
    expect(peerAddress(undefined)).toBeUndefined();
  });

  test('drops hop-by-hop headers, including those named by Connection', async () => {
    await live();
    const res = await h.edge.fetch(
      new Request('http://loja.test/checkout/v1/echo', {
        method: 'POST',
        body: 'b',
        headers: {
          host: 'loja.test',
          connection: 'x-drop-me',
          'x-drop-me': '1',
          'keep-alive': 'timeout=5',
        },
      }),
    );
    expect(await res.json()).toMatchObject({ dropped: null, host: 'loja.test' });
  });

  test('streams SSE incrementally', async () => {
    await live();
    const res = await h.get('/storefront/v1/events');
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = await reader.read();
    expect(dec.decode(first.value)).toBe('data: first\n\n');
    h.core.sse.push('second');
    const second = await reader.read();
    expect(dec.decode(second.value)).toBe('data: second\n\n');
    h.core.sse.close();
    expect((await reader.read()).done).toBe(true);
  });

  test('Core down on a plain API call → 502 JSON', async () => {
    await live();
    h.core.down = true;
    const res = await h.get('/checkout/v1/session', 'loja.test', { method: 'POST', body: '{}' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: { code: 'CORE_UNAVAILABLE' } });
  });
});

test('healthz answers on any host', async () => {
  h = await harness();
  const res = await h.get('/_edge/healthz', 'not_a_valid_host');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, routes: 0, core: 'ok' });
});
