import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { recognise } from '../src/modules/menu-import/adapters/index.ts';
import {
  PLACE,
  pinnedGet,
  fingerprintHost,
  placeByPage,
  placeHost,
  type Page,
  type PlaceDeps,
} from '../src/modules/menu-import/custom-domain.ts';
import { USER_AGENT } from '../src/modules/menu-import/http.ts';
import { isPrivateHost } from '../src/platform/net-guard.ts';

// Menu import on the merchant's own domain (docs/menu-import.md §4.4): recognising the host,
// placing it on a platform (DNS, the platforms' lookups, then the one GET), and that GET's
// guards. DNS, the platforms and the merchant's server are all fakes or a local server.

const HOST = 'pedidos.pizzariaexemplo.com.br';
const OLA = (h: string) => `https://api.olaclick.app/ms-companies/public/hosts/${h}`;
const SAIPOS = (h: string) =>
  `https://delivery-api.saipos.com/v1/stores?filter=${encodeURIComponent(JSON.stringify({ domain_name: h }))}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string): Page => ({ status: 200, location: null, body });

/** Fakes for every outside party; OlaClick and Saipos know nothing unless `routes` says so. */
function world(
  opts: {
    routes?: Record<string, () => Response>;
    cname?: string[];
    addrs?: string[];
    page?: Page;
  } = {},
) {
  const seen: { url: string; ua: string | null }[] = [];
  const gets: { host: string; ip: string }[] = [];
  const deps: PlaceDeps = {
    fetch: async (url, init) => {
      seen.push({ url, ua: new Headers(init.headers).get('user-agent') });
      const route = opts.routes?.[url];
      if (route) return route();
      if (url.startsWith('https://delivery-api.saipos.com/')) return json([]);
      return json({ message: 'not found' }, 404);
    },
    dns: {
      cname: async () => {
        if (!opts.cname) throw Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
        return opts.cname;
      },
      lookup: async () => opts.addrs ?? ['203.0.113.10'],
    },
    fingerprint: async (host, ip) => {
      gets.push({ host, ip });
      return opts.page ?? html('<html><body>Bem-vindo</body></html>');
    },
  };
  return { deps, seen, gets };
}

describe('recognise: the merchant’s own domain', () => {
  test('a public hostname no platform owns is a custom domain', () => {
    const r = recognise(`https://${HOST}/cardapio?utm_source=ig`);
    expect(r).toMatchObject({ kind: 'custom', host: HOST });
    for (const [input, host] of [
      ['Minha-Loja.com.br', 'minha-loja.com.br'],
      ['http://www.pizzariaexemplo.com/', 'www.pizzariaexemplo.com'],
      ['loja.xn--caf-dma.com.br', 'loja.xn--caf-dma.com.br'],
    ] as const) {
      const c = recognise(input);
      expect(c.kind).toBe('custom');
      if (c.kind === 'custom') {
        expect(c.host).toBe(host);
        expect(c.url.protocol).toBe('https:');
      }
    }
  });

  test('a platform’s own pages stay unsupported, anota.ai and iFood blocked', () => {
    for (const u of [
      'https://www.goomer.app/',
      'https://app.cardapioweb.com/',
      'https://www.cardapioweb.com/planos',
      'https://cdn.cardapioweb.com.br/x.png',
      'https://ola.click/',
      'https://www.olaclick.app/precos',
      'https://www.saipos.com',
      'https://blog.instadelivery.com.br/x',
      'https://takeat.app/planos',
      'https://deliverydireto.com.br/',
    ])
      expect(recognise(u)).toEqual({ kind: 'unsupported', platform: null });
    expect(recognise('https://pedido.anota.ai/loja/x').kind).toBe('blocked');
    expect(recognise('https://www.ifood.com.br/').kind).toBe('blocked');
  });

  test('names that are not public, and IP literals, are unsupported', () => {
    for (const u of [
      'https://localhost/',
      'https://loja.localhost/',
      'https://impressora.local/',
      'https://db.internal/',
      'https://nas.lan/',
      'https://roteador.home.arpa/',
      'https://loja.test/',
      'https://loja.invalid/',
      'https://evil.example/x',
      'https://intranet/',
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://[2606:4700::1111]/',
      'https://loja.123abc/',
      'https://-loja.com.br/',
      'https://loja-.com.br/',
      'https://loja_x.com.br/',
      `https://${'a'.repeat(64)}.com.br/`,
      `https://${Array(5).fill('b'.repeat(60)).join('.')}.com/`,
    ])
      expect(recognise(u)).toEqual({ kind: 'unsupported', platform: null });
  });

  test('a port, a user or a password is not a store link', () => {
    for (const u of [
      `https://${HOST}:8443/`,
      `https://user:pw@${HOST}/`,
      `https://user@${HOST}/`,
      'https://instadelivery.com.br:8443/doceriaexemplo',
      `ftp://${HOST}/`,
      // a numeric last label is an IPv4 address to the URL parser, and not a valid one
      'https://loja.com.123/',
    ])
      expect(recognise(u)).toEqual({ kind: 'invalid' });
  });
});

describe('placing a custom domain: the platforms answer first', () => {
  test('Goomer by its CNAME alone: nothing is sent anywhere', async () => {
    const w = world({ cname: ['PizzariaExemplo.goomer.app.'] });
    const p = await placeHost(HOST, w.deps);
    expect(p?.adapter.platform).toBe('goomer');
    expect(p?.ref).toBe('pizzariaexemplo');
    expect(w.seen).toEqual([]);
    expect(w.gets).toEqual([]);
  });

  test('a CNAME to a Goomer page, or elsewhere, is not a claim', async () => {
    for (const cname of [['www.goomer.app'], ['static.goomer.app'], ['loja.netlify.app']]) {
      const w = world({ cname });
      expect(await placeHost(HOST, w.deps)).toBeNull();
      expect(w.seen.map((s) => s.url)).toEqual([OLA(HOST), SAIPOS(HOST)]);
    }
  });

  test('OlaClick’s host lookup names the company: the ref is the host', async () => {
    const w = world({
      routes: {
        [OLA(HOST)]: () => json({ data: { company_id: '0b6f4f8e-9a3c-4c1e-8d7e-2f1a3b4c5d6e' } }),
      },
    });
    const p = await placeHost(HOST, w.deps);
    expect(p?.adapter.platform).toBe('olaclick');
    expect(p?.ref).toBe(HOST);
    expect(w.seen).toEqual([{ url: OLA(HOST), ua: USER_AGENT }]);
    expect(w.gets).toEqual([]);
  });

  test('Saipos by domain_name when OlaClick doesn’t know it', async () => {
    const w = world({
      routes: { [SAIPOS(HOST)]: () => json([{ id_store: 41, domain_name: HOST }]) },
    });
    const p = await placeHost(HOST, w.deps);
    expect(p?.adapter.platform).toBe('saipos');
    expect(p?.ref).toBe(HOST);
    expect(w.seen.map((s) => s.url)).toEqual([OLA(HOST), SAIPOS(HOST)]);
    expect(w.gets).toEqual([]);
  });

  test('a refused lookup rules out its platform only; with no claim at all it is BLOCKED', async () => {
    // never asked again, but the store may be on another platform
    const blocked = world({ routes: { [OLA(HOST)]: () => json({}, 403) } });
    await expect(placeHost(HOST, blocked.deps)).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(blocked.seen.map((s) => s.url)).toEqual([OLA(HOST), SAIPOS(HOST)]);
    expect(blocked.gets).toHaveLength(1);

    const onSaipos = world({
      routes: {
        [OLA(HOST)]: () => json({}, 429),
        [SAIPOS(HOST)]: () => json([{ id_store: 41, domain_name: HOST }]),
      },
    });
    expect((await placeHost(HOST, onSaipos.deps))?.adapter.platform).toBe('saipos');

    const onCardapio = world({
      routes: { [SAIPOS(HOST)]: () => json({}, 429) },
      page: html(
        '<script>Object.defineProperty(window,"companySlug",{value:"loja_exemplo"});</script>',
      ),
    });
    expect((await placeHost(HOST, onCardapio.deps))?.adapter.platform).toBe('cardapioweb');

    const broken = world({ routes: { [OLA(HOST)]: () => new Response('oops', { status: 500 }) } });
    expect(await placeHost(HOST, broken.deps)).toBeNull();
    expect(broken.gets).toHaveLength(1);
  });

  test('only then one GET, to an address that was checked (IPv4 first)', async () => {
    const w = world({ addrs: ['2606:4700::6810:84e5', '104.16.132.229'] });
    expect(await placeHost(HOST, w.deps)).toBeNull();
    expect(w.gets).toEqual([{ host: HOST, ip: '104.16.132.229' }]);
  });

  test('a host that is not a public name is never placed', async () => {
    const w = world({ cname: ['x.goomer.app'] });
    expect(await placeHost('localhost', w.deps)).toBeNull();
    expect(await placeHost('10.0.0.1', w.deps)).toBeNull();
    expect(w.seen).toEqual([]);
    expect(w.gets).toEqual([]);
  });
});

describe('the fingerprint: what the merchant’s page says', () => {
  const place = (page: Page) => placeHost(HOST, world({ page }).deps);

  test('Cardápio Web writes the store’s slug into the page', async () => {
    const p = await place(
      html(
        '<script>Object.defineProperty(window,"companySlug",{value:"Pizzaria_Exemplo",writable:false});</script>',
      ),
    );
    expect(p?.adapter.platform).toBe('cardapioweb');
    // the ref the link app.cardapioweb.com/Pizzaria_Exemplo gives
    const link = recognise('https://app.cardapioweb.com/Pizzaria_Exemplo');
    expect(link.kind === 'ok' && link.ref).toBe('pizzaria_exemplo');
    expect(p?.ref).toBe('pizzaria_exemplo');
    // a platform page's name is not a store
    expect(
      await place(html('Object.defineProperty(window,"companySlug",{value:"login"')),
    ).toBeNull();
  });

  test('Delivery Direto: the brand’s build on its host, or a redirect to /<brand>', async () => {
    const p = await place(
      html('<script src="https://deliverydireto.com.br/bs/PizzariaExemplo/dist/app.js"></script>'),
    );
    expect(p).toMatchObject({ adapter: { platform: 'deliverydireto' }, ref: 'pizzariaexemplo' });
    for (const location of ['/PizzariaExemplo', `https://${HOST}/pizzariaexemplo/`]) {
      const r = await place({ status: 302, location, body: '' });
      expect(r).toMatchObject({ adapter: { platform: 'deliverydireto' }, ref: 'pizzariaexemplo' });
    }
    for (const location of [
      `https://www.${HOST}/pizzariaexemplo`,
      'https://outra.com.br/pizzariaexemplo',
      `http://${HOST}/pizzariaexemplo`,
      '/pizzariaexemplo/centro',
      '/',
      null,
    ])
      expect(await place({ status: 301, location, body: '' })).toBeNull();
  });

  test('a page with neither is no claim; a block or a challenge is BLOCKED', async () => {
    expect(await place(html('<html>Pizzaria Exemplo — peça pelo WhatsApp</html>'))).toBeNull();
    expect(await place({ status: 404, location: null, body: 'not found' })).toBeNull();
    await expect(place({ status: 403, location: null, body: '' })).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(
      place(html('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x">')),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(placeByPage(HOST, { status: 500, location: null, body: '' })).toBeNull();
  });
});

describe('the fingerprint never reaches an inside address', () => {
  test('any private answer refuses the host before connecting', async () => {
    for (const addr of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.4',
      '192.168.0.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::',
      '::1',
      'fd00::1',
      'fe80::1',
      'ff02::1',
      '::ffff:10.0.0.1',
      '0:0:0:0:0:ffff:a00:1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      const w = world({ addrs: ['203.0.113.10', addr] });
      await expect(fingerprintHost(HOST, w.deps)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: expect.stringContaining('private address'),
      });
      expect(w.gets).toEqual([]);
    }
  });

  test('a name that does not resolve is NOT_FOUND, with no GET', async () => {
    const w = world();
    w.deps.dns!.lookup = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    await expect(fingerprintHost(HOST, w.deps)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const none = world({ addrs: [] });
    await expect(fingerprintHost(HOST, none.deps)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect([...w.gets, ...none.gets]).toEqual([]);
  });

  test('IPv6 spellings of a private address are caught', () => {
    for (const a of ['0:0:0:0:0:0:0:1', '::FFFF:192.168.1.1', 'FD12:3456::1', '0:0::ffff:7f00:1'])
      expect(isPrivateHost(a)).toBe(true);
    for (const a of ['2606:4700::6810:84e5', '203.0.113.10', '2001:4860:4860::8888'])
      expect(isPrivateHost(a)).toBe(false);
  });
});

// A test-only CA and a certificate for loja.pinned.test (valid 2020–2120). `.test` never
// resolves (RFC 6761), so a request that reaches this server reached it by the address given.
const CA = `-----BEGIN CERTIFICATE-----
MIIBZzCCAQygAwIBAgICEAAwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOVmVuZHVh
IFRlc3QgQ0EwIBcNMjAwMTAxMDAwMDAwWhgPMjEyMDAxMDEwMDAwMDBaMBkxFzAV
BgNVBAMMDlZlbmR1YSBUZXN0IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE
vSQpQDjVCq/A7gVsThPi4hNfZJljMDn4GU9HzL9zWx8EZ/K3pbBsNHWskmKhntJf
n91daHVQU59T0szGxfQzxqNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8E
BAMCAgQwHQYDVR0OBBYEFPcKNNzd6pUDOp9KByG/soRbBE5sMAoGCCqGSM49BAMC
A0kAMEYCIQDoOGjiBgK/U8Ug4+J/pZysOoTuh8bJUEmCEffjp/TqAQIhALsEUtpu
ZsZ5xx9gwx0RPjcbXU6UFqMobEYlVSfi1wCg
-----END CERTIFICATE-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIBpTCCAUugAwIBAgICEAEwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOVmVuZHVh
IFRlc3QgQ0EwIBcNMjAwMTAxMDAwMDAwWhgPMjEyMDAxMDEwMDAwMDBaMBsxGTAX
BgNVBAMMEGxvamEucGlubmVkLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AAQ/qlcpp+fHQkdHdCcaSHT/BWKCDj6CMIraTX5ZMa0YTQdAXZS+TR3ybCiopg0O
eYEEoG1AqEBaJ3p8qM3b+YYBo38wfTAJBgNVHRMEAjAAMBMGA1UdJQQMMAoGCCsG
AQUFBwMBMBsGA1UdEQQUMBKCEGxvamEucGlubmVkLnRlc3QwHQYDVR0OBBYEFBUG
e7DaZld9Lx139zbvhmLIGF+eMB8GA1UdIwQYMBaAFPcKNNzd6pUDOp9KByG/soRb
BE5sMAoGCCqGSM49BAMCA0gAMEUCIFxpmDKXM+0Xb/m+nmunIs2cfWH75wDYx2T6
wrl6K370AiEAxe9VKMvNmIWVmOqq3oS74AK+jgyJQYEmzsPOJNvp9Hs=
-----END CERTIFICATE-----`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg1yg4stoypeR+4DDd
w/W9IqPROVm6cRazMwvHVPMZXwWhRANCAAQ/qlcpp+fHQkdHdCcaSHT/BWKCDj6C
MIraTX5ZMa0YTQdAXZS+TR3ybCiopg0OeYEEoG1AqEBaJ3p8qM3b+YYB
-----END PRIVATE KEY-----`;

describe('pinnedGet: one GET to the checked address, for the host', () => {
  const PINNED = 'loja.pinned.test';
  let server: Server;
  let port = 0;
  let mode: 'page' | 'redirect' | 'huge' | 'silent' = 'page';
  const hits: { sni: string | undefined; headers: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer({ cert: CERT, key: KEY }, (req, res) => {
      hits.push({
        sni: (req.socket as { servername?: string }).servername,
        headers: { ...req.headers },
      });
      if (mode === 'redirect') {
        res.writeHead(302, { location: '/PizzariaExemplo', 'set-cookie': 'sid=1' });
        res.end('moved');
      } else if (mode === 'huge') {
        res.writeHead(200, { 'content-type': 'text/html' });
        const chunk = 'x'.repeat(64 * 1024);
        let sent = 0;
        const more = () => {
          while (sent < 16 && !res.destroyed) {
            sent++;
            if (!res.write(chunk)) return void res.once('drain', more);
          }
          res.end();
        };
        res.on('error', () => {});
        more();
      } else if (mode === 'page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html>Cardápio</html>');
      }
      // silent: never answers
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  test('connects to the address given, with SNI, certificate and Host naming the host', async () => {
    mode = 'page';
    hits.length = 0;
    const page = await pinnedGet(PINNED, '127.0.0.1', { port, ca: CA });
    expect(page).toEqual({ status: 200, location: null, body: '<html>Cardápio</html>' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sni).toBe(PINNED);
    expect(hits[0]!.headers).toMatchObject({
      host: PINNED,
      'user-agent': USER_AGENT,
      accept: 'text/html',
    });
    expect(hits[0]!.headers.cookie).toBeUndefined();
  });

  test('the certificate must be valid for the host', async () => {
    mode = 'page';
    hits.length = 0;
    // the same server under another name, and the same name without trusting the test CA
    await expect(
      pinnedGet('outra.pinned.test', '127.0.0.1', { port, ca: CA }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('ALTNAME') });
    await expect(pinnedGet(PINNED, '127.0.0.1', { port })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('VERIFY'),
    });
    expect(hits).toHaveLength(0);
  });

  test('a redirect is reported, never followed', async () => {
    mode = 'redirect';
    hits.length = 0;
    const page = await pinnedGet(PINNED, '127.0.0.1', { port, ca: CA });
    expect(page).toEqual({ status: 302, location: '/PizzariaExemplo', body: '' });
    expect(hits).toHaveLength(1);
    expect(placeByPage(PINNED, page)).toMatchObject({
      adapter: { platform: 'deliverydireto' },
      ref: 'pizzariaexemplo',
    });
  });

  test('reads 256 KB at most', async () => {
    mode = 'huge';
    const page = await pinnedGet(PINNED, '127.0.0.1', { port, ca: CA });
    expect(page.status).toBe(200);
    expect(page.body.length).toBe(PLACE.pageBytes);
  });

  test('a server that never answers is a TIMEOUT', async () => {
    mode = 'silent';
    await expect(
      pinnedGet(PINNED, '127.0.0.1', { port, ca: CA, timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
