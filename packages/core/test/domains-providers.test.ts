import { afterEach, describe, expect, test } from 'bun:test';
import { brasilApiCnpj, parseCnpj } from '../src/modules/domains/cnpj.ts';
import { cloudflare } from '../src/modules/domains/cloudflare.ts';
import { domainProvidersFromEnv } from '../src/modules/domains/config.ts';
import {
  domainStatus,
  errorKind,
  maskCnpj,
  maskCpf,
  opDate,
  openprovider,
} from '../src/modules/domains/openprovider.ts';
import { httpsProbe } from '../src/modules/domains/probe.ts';
import { RegistrarError, type HolderInput } from '../src/modules/domains/providers.ts';
import { registroBrRdap } from '../src/modules/domains/rdap.ts';
import { fakeDnsHost, fakeProviders, fakeRdap, fakeRegistrar } from './domain-fakes.ts';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  init: RequestInit | undefined;
}
type Reply = { status?: number; body?: unknown; raw?: string } | 'throw';

function stub(reply: (s: Seen) => Reply) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const s: Seen = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      init,
    };
    seen.push(s);
    const r = reply(s);
    if (r === 'throw') throw new DOMException('timed out', 'TimeoutError');
    const text = r.raw ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(text, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

const path = (s: Seen) => new URL(s.url).pathname;
const ok = (data: unknown) => ({ body: { code: 0, desc: '', data } });

async function rejection(p: Promise<unknown>): Promise<RegistrarError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RegistrarError) return e;
    throw e;
  }
  throw new Error('expected a RegistrarError');
}

// ── Openprovider ─────────────────────────────────────────────────────────

function op(route: (s: Seen) => Reply) {
  let logins = 0;
  const { fetchImpl, seen } = stub((s) => {
    if (path(s) === '/v1/auth/login') {
      logins++;
      return ok({ token: `tok-${logins}`, reseller_id: 1 });
    }
    return route(s);
  });
  const r = openprovider({
    username: 'vendua-api',
    password: 's3cret-pass',
    contactHandle: 'VD000001-BR',
    url: 'https://op.test/',
    fetchImpl,
  });
  return { r, seen, logins: () => logins };
}

const HOLDER: HolderInput = {
  kind: 'cnpj',
  document: '12ABC34501DE35',
  name: 'Pizzaria Bella Napoli Ltda',
  email: 'dono@bella.com.br',
  phone: '11987654321',
  address: {
    street: 'Rua Augusta',
    number: '1200',
    complement: 'Loja 2',
    district: 'Consolação',
    city: 'São Paulo',
    state: 'sp',
    postalCode: '01304001',
  },
};

describe('openprovider', () => {
  test('logs in once, sends the bearer token and re-logs in on 401', async () => {
    let first = true;
    const { r, seen, logins } = op((s) => {
      if (path(s) === '/v1/domains/42') {
        if (first && s.headers.authorization === 'Bearer tok-1') {
          first = false;
          return { status: 401, body: { code: 196, desc: 'Authentication failed' } };
        }
        return ok({ id: 42, status: 'ACT', expiration_date: '2027-10-08 00:00:00' });
      }
      return { status: 404, body: { code: 1, desc: 'nope' } };
    });
    const d = await r.get('42');
    expect(d).toEqual({ ref: '42', status: 'active', expiresAt: new Date('2027-10-08T00:00:00Z') });
    await r.get('42');
    expect(logins()).toBe(2);
    const login = seen.find((s) => path(s) === '/v1/auth/login')!;
    expect(login.url).toBe('https://op.test/v1/auth/login');
    expect(login.body).toEqual({ username: 'vendua-api', password: 's3cret-pass', ip: '0.0.0.0' });
    expect(seen.at(-1)!.headers.authorization).toBe('Bearer tok-2');
    expect(seen.filter((s) => path(s) === '/v1/auth/login')).toHaveLength(2);
  });

  test('check maps status and reseller price to cents', async () => {
    const { r, seen } = op(() =>
      ok({
        results: [
          {
            domain: 'bella.com.br',
            status: 'free',
            price: { reseller: { price: 8.99, currency: 'EUR' } },
          },
          { domain: 'pizza.com.br', status: 'active' },
          { domain: 'odd.com.br', status: 'in use?' },
        ],
      }),
    );
    const out = await r.check(['Bella.com.br', 'pizza.com.br', 'odd.com.br', 'bad host']);
    expect(out.get('bella.com.br')).toEqual({
      available: true,
      price: { cents: 899, currency: 'EUR' },
    });
    expect(out.get('pizza.com.br')).toEqual({ available: false });
    expect(out.get('odd.com.br')).toEqual({ available: null });
    expect(out.get('bad host')).toEqual({ available: null });
    const call = seen.find((s) => path(s) === '/v1/domains/check')!;
    expect(call.body).toEqual({
      domains: [
        { name: 'bella', extension: 'com.br' },
        { name: 'pizza', extension: 'com.br' },
        { name: 'odd', extension: 'com.br' },
      ],
      with_price: true,
    });
  });

  test('find matches the exact name', async () => {
    const { r, seen } = op(() =>
      ok({
        results: [
          { id: 7, domain: { name: 'bellas', extension: 'com.br' }, status: 'ACT' },
          { id: 8, domain: { name: 'bella', extension: 'com.br' }, status: 'REQ' },
        ],
      }),
    );
    expect(await r.find('bella.com.br')).toEqual({ ref: '8', status: 'pending', expiresAt: null });
    const q = new URL(seen.at(-1)!.url).searchParams;
    expect(q.get('domain_name_pattern')).toBe('bella');
    expect(q.get('extension')).toBe('com.br');
    expect(q.get('limit')).toBe('10');

    const none = op(() => ok({ results: [] }));
    expect(await none.r.find('bella.com.br')).toBeNull();
  });

  test('createHolder sends the masked CNPJ, name split, phone and address', async () => {
    const { r, seen } = op(() => ok({ handle: 'BN000123-BR' }));
    expect(await r.createHolder(HOLDER)).toBe('BN000123-BR');
    expect(seen.at(-1)!.body).toEqual({
      name: { first_name: 'Pizzaria', last_name: 'Bella Napoli Ltda' },
      company_name: 'Pizzaria Bella Napoli Ltda',
      address: {
        street: 'Rua Augusta',
        number: '1200',
        suffix: 'Loja 2 - Consolação',
        zipcode: '01304-001',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
      },
      phone: { country_code: '+55', area_code: '11', subscriber_number: '987654321' },
      email: 'dono@bella.com.br',
      additional_data: { company_registration_number: '12.ABC.345/01DE-35' },
    });
  });

  test('createHolder for a CPF: social security number, one-word name repeated', async () => {
    const { r, seen } = op(() => ok({ handle: 'AS000001-BR' }));
    await r.createHolder({
      ...HOLDER,
      kind: 'cpf',
      document: '12345678909',
      name: 'Ana',
      phone: '1133334444',
      address: { ...HOLDER.address, complement: '' },
    });
    const b = seen.at(-1)!.body;
    expect(b.company_name).toBeUndefined();
    expect(b.additional_data).toEqual({ social_security_number: '123.456.789-09' });
    expect(b.name).toEqual({ first_name: 'Ana', last_name: 'Ana' });
    expect(b.phone).toEqual({
      country_code: '+55',
      area_code: '11',
      subscriber_number: '33334444',
    });
    expect(b.address.suffix).toBe('Consolação');
  });

  test('register sends parking nameservers and Venduá as admin/tech/billing', async () => {
    const { r, seen } = op(() => ok({ id: 991, status: 'REQ' }));
    expect(await r.register({ host: 'bella.com.br', holderHandle: 'BN000123-BR' })).toEqual({
      ref: '991',
      status: 'pending',
      expiresAt: null,
    });
    expect(seen.at(-1)!.body).toEqual({
      domain: { name: 'bella', extension: 'com.br' },
      period: 1,
      unit: 'y',
      owner_handle: 'BN000123-BR',
      admin_handle: 'VD000001-BR',
      tech_handle: 'VD000001-BR',
      billing_handle: 'VD000001-BR',
      name_servers: [
        { name: 'ns1.openprovider.nl', seq_nr: 1 },
        { name: 'ns2.openprovider.be', seq_nr: 2 },
        { name: 'ns3.openprovider.eu', seq_nr: 3 },
      ],
      autorenew: 'off',
    });
  });

  test('parkZone skips an existing zone and creates a missing one with A and AAAA', async () => {
    const exists = op(() => ok({ name: 'bella.com.br' }));
    await exists.r.parkZone('bella.com.br', '203.0.113.10', null);
    expect(exists.seen.filter((s) => s.method === 'POST' && path(s) === '/v1/dns/zones')).toEqual(
      [],
    );

    const missing = op((s) =>
      s.method === 'GET' ? { status: 404, body: { code: 817, desc: 'Zone not found' } } : ok(true),
    );
    await missing.r.parkZone('bella.com.br', '203.0.113.10', '2001:db8::10');
    const post = missing.seen.at(-1)!;
    expect(path(post)).toBe('/v1/dns/zones');
    expect(post.body).toEqual({
      domain: { name: 'bella', extension: 'com.br' },
      type: 'master',
      records: [
        { type: 'A', name: '', value: '203.0.113.10', ttl: 900 },
        { type: 'A', name: 'www', value: '203.0.113.10', ttl: 900 },
        { type: 'AAAA', name: '', value: '2001:db8::10', ttl: 900 },
        { type: 'AAAA', name: 'www', value: '2001:db8::10', ttl: 900 },
      ],
    });
  });

  test('renew posts then reads the domain; setNameservers puts the pair', async () => {
    const { r, seen } = op((s) =>
      s.method === 'GET'
        ? ok({ id: 5, status: 'ACT', expiration_date: '2028-10-08 00:00:00' })
        : ok({ status: 'ACT' }),
    );
    expect((await r.renew('5', 'bella.com.br')).expiresAt).toEqual(
      new Date('2028-10-08T00:00:00Z'),
    );
    const renew = seen.find((s) => path(s) === '/v1/domains/5/renew')!;
    expect(renew.body).toEqual({
      id: 5,
      domain: { name: 'bella', extension: 'com.br' },
      period: 1,
    });

    await r.setNameservers('5', 'bella.com.br', [
      'ANA.ns.cloudflare.com',
      'bob.ns.cloudflare.com.',
    ]);
    const put = seen.at(-1)!;
    expect(put.method).toBe('PUT');
    expect(path(put)).toBe('/v1/domains/5');
    expect(put.body.name_servers).toEqual([
      { name: 'ana.ns.cloudflare.com', seq_nr: 1 },
      { name: 'bob.ns.cloudflare.com', seq_nr: 2 },
    ]);
    expect((await rejection(r.get('5; drop'))).kind).toBe('invalid');
  });

  test('errors map to kinds and never echo secrets', async () => {
    const cases: [Reply, RegistrarError['kind']][] = [
      [
        {
          status: 400,
          body: { code: 399, desc: 'CNPJ belongs to another provider at registro.br' },
        },
        'conflict',
      ],
      [
        { status: 400, body: { code: 399, desc: 'Documento pertence a outro provedor' } },
        'conflict',
      ],
      [{ status: 400, body: { code: 346, desc: 'Domain already exists' } }, 'taken'],
      [{ status: 400, body: { code: 10010, desc: 'Invalid CPF/CNPJ' } }, 'invalid'],
      [{ status: 400, body: { code: 1, desc: 'Something odd happened' } }, 'other'],
      [{ status: 200, body: { code: 1, desc: 'Something odd happened' } }, 'other'],
      [{ status: 503, body: { code: 4005, desc: 'Temporary error' } }, 'unavailable'],
      [{ status: 200, body: { code: 1, desc: 'Down', maintenance: true } }, 'unavailable'],
      [{ status: 502, raw: '<html>bad gateway</html>' }, 'unavailable'],
      ['throw', 'unavailable'],
    ];
    for (const [reply, kind] of cases) {
      const { r } = op(() => reply);
      const e = await rejection(r.register({ host: 'bella.com.br', holderHandle: 'X' }));
      expect(e.kind).toBe(kind);
      expect(e.message).not.toContain('s3cret-pass');
      expect(e.message).not.toContain('tok-1');
    }
  });

  test('a failed login is unavailable and is retried on the next call', async () => {
    let n = 0;
    const { fetchImpl } = stub((s) => {
      if (path(s) === '/v1/auth/login')
        return ++n === 1
          ? { status: 401, body: { code: 196, desc: 'Authentication failed' } }
          : ok({ token: 't' });
      return ok({ id: 1, status: 'ACT' });
    });
    const r = openprovider({ username: 'u', password: 'pw-12345', contactHandle: 'H', fetchImpl });
    const e = await rejection(r.get('1'));
    expect(e.kind).toBe('unavailable');
    expect(e.message).not.toContain('pw-12345');
    expect((await r.get('1')).status).toBe('active');
  });

  test('helpers', () => {
    expect(maskCnpj('12345678000195')).toBe('12.345.678/0001-95');
    expect(maskCpf('12345678909')).toBe('123.456.789-09');
    expect(domainStatus('SCH')).toBe('pending');
    expect(domainStatus('DEL')).toBe('failed');
    expect(domainStatus('XYZ')).toBe('failed');
    expect(opDate('2027-10-08 12:30:00')).toEqual(new Date('2027-10-08T12:30:00Z'));
    expect(opDate('')).toBeNull();
    expect(errorKind('the CPF is registered with another registrar', 400, false)).toBe('conflict');
  });
});

// ── Cloudflare ───────────────────────────────────────────────────────────

const cfOk = (result: unknown, result_info?: unknown) => ({
  body: {
    success: true,
    errors: [],
    messages: [],
    result,
    ...(result_info ? { result_info } : {}),
  },
});

function cf(route: (s: Seen) => Reply) {
  const { fetchImpl, seen } = stub(route);
  return { d: cloudflare({ token: 'cf-token-xyz', accountId: 'acc1', fetchImpl }), seen };
}

describe('cloudflare', () => {
  test('ensureZone reuses an existing zone', async () => {
    const { d, seen } = cf(() =>
      cfOk([
        {
          id: 'z1',
          name_servers: ['Ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
          status: 'active',
        },
      ]),
    );
    expect(await d.ensureZone('bella.com.br')).toEqual({
      id: 'z1',
      nameServers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      status: 'active',
    });
    expect(seen).toHaveLength(1);
    const q = new URL(seen[0]!.url).searchParams;
    expect(q.get('name')).toBe('bella.com.br');
    expect(q.get('account.id')).toBe('acc1');
    expect(seen[0]!.headers.authorization).toBe('Bearer cf-token-xyz');
  });

  test('ensureZone creates a missing zone', async () => {
    const { d, seen } = cf((s) =>
      s.method === 'GET'
        ? cfOk([])
        : cfOk({
            id: 'z2',
            name_servers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
            status: 'pending',
          }),
    );
    expect((await d.ensureZone('bella.com.br')).id).toBe('z2');
    expect(seen.at(-1)!.body).toEqual({
      name: 'bella.com.br',
      account: { id: 'acc1' },
      type: 'full',
      jump_start: false,
    });
  });

  test('zone answers null on 404; deleteZone accepts 404', async () => {
    const notFound = {
      status: 404,
      body: { success: false, errors: [{ code: 1001, message: 'nope' }] },
    };
    const { d, seen } = cf(() => notFound);
    expect(await d.zone('z9')).toBeNull();
    await d.deleteZone('z9');
    expect(seen.at(-1)!.method).toBe('DELETE');
    expect(path(seen.at(-1)!)).toBe('/client/v4/zones/z9');
  });

  test('errors carry Cloudflare message, never the token', async () => {
    const { d } = cf(() => ({
      status: 400,
      body: { success: false, errors: [{ code: 1049, message: 'not a registered domain' }] },
    }));
    const e = (await d.ensureZone('bella.com.br').catch((x) => x)) as Error;
    expect(e.message).toContain('not a registered domain (1049)');
    expect(e.message).not.toContain('cf-token-xyz');
  });

  test('syncRecords deletes extras, keeps matches and posts what is missing', async () => {
    const existing = [
      { id: 'ns', type: 'NS', name: 'bella.com.br', content: 'ana.ns.cloudflare.com' },
      { id: 'a1', type: 'A', name: 'bella.com.br', content: '203.0.113.10' },
      { id: 'a-old', type: 'A', name: 'www.bella.com.br', content: '198.51.100.1' },
      {
        id: 'txt',
        type: 'TXT',
        name: 'bella.com.br',
        content: '"v=spf1 include:_spf.google.com ~all"',
      },
      {
        id: 'mx-old',
        type: 'MX',
        name: 'bella.com.br',
        content: 'aspmx.l.google.com',
        priority: 5,
      },
      { id: 'srv', type: 'SRV', name: '_sip._tcp.bella.com.br', content: '1 1 5060 sip.x.com' },
    ];
    const { d, seen } = cf((s) => {
      if (s.method === 'GET') {
        const page = Number(new URL(s.url).searchParams.get('page'));
        return cfOk(page === 1 ? existing.slice(0, 3) : existing.slice(3), {
          page,
          total_pages: 2,
        });
      }
      return cfOk({ id: 'new' });
    });
    await d.syncRecords('z1', 'bella.com.br', { ipv4: '203.0.113.10', ipv6: null }, [
      { type: 'TXT', name: '@', value: 'v=spf1 include:_spf.google.com ~all' },
      { type: 'MX', name: '@', value: 'aspmx.l.google.com.', priority: 1 },
      { type: 'CNAME', name: 'mail', value: 'ghs.googlehosted.com' },
    ]);
    const gets = seen.filter((s) => s.method === 'GET');
    expect(gets).toHaveLength(2);
    expect(new URL(gets[0]!.url).searchParams.get('per_page')).toBe('500');
    const deleted = seen.filter((s) => s.method === 'DELETE').map((s) => path(s).split('/').pop());
    expect(deleted.sort()).toEqual(['a-old', 'mx-old', 'srv']);
    const posted = seen.filter((s) => s.method === 'POST').map((s) => s.body);
    expect(posted).toEqual([
      {
        type: 'A',
        name: 'www.bella.com.br',
        content: '203.0.113.10',
        ttl: 1,
        proxied: false,
      },
      { type: 'MX', name: 'bella.com.br', content: 'aspmx.l.google.com', ttl: 1, priority: 1 },
      {
        type: 'CNAME',
        name: 'mail.bella.com.br',
        content: 'ghs.googlehosted.com',
        ttl: 1,
        proxied: false,
      },
    ]);
    // deletes go first
    const firstPost = seen.findIndex((s) => s.method === 'POST');
    const lastDelete = seen.map((s) => s.method).lastIndexOf('DELETE');
    expect(lastDelete).toBeLessThan(firstPost);
  });

  test('syncRecords writes AAAA when the edge has IPv6', async () => {
    const { d, seen } = cf((s) => (s.method === 'GET' ? cfOk([], { total_pages: 1 }) : cfOk({})));
    await d.syncRecords('z1', 'bella.com.br', { ipv4: '203.0.113.10', ipv6: '2001:db8::10' }, []);
    expect(
      seen.filter((s) => s.method === 'POST').map((s) => `${s.body.type} ${s.body.name}`),
    ).toEqual([
      'A bella.com.br',
      'AAAA bella.com.br',
      'A www.bella.com.br',
      'AAAA www.bella.com.br',
    ]);
  });
});

// ── RDAP ─────────────────────────────────────────────────────────────────

describe('registro.br RDAP', () => {
  test('only .br hosts are asked', async () => {
    const { fetchImpl, seen } = stub(() => ({ status: 404 }));
    expect(await registroBrRdap({ fetchImpl })('loja.com')).toBeNull();
    expect(seen).toHaveLength(0);
  });

  test('404 is a free name', async () => {
    const { fetchImpl, seen } = stub(() => ({ status: 404 }));
    expect(await registroBrRdap({ fetchImpl })('Bella.com.br')).toEqual({
      registered: false,
      expiresAt: null,
      nameServers: [],
      signed: false,
    });
    expect(seen[0]!.url).toBe('https://rdap.registro.br/domain/bella.com.br');
  });

  test('200 reads expiry, nameservers and DNSSEC', async () => {
    const { fetchImpl } = stub(() => ({
      body: {
        objectClassName: 'domain',
        events: [
          { eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' },
          { eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' },
        ],
        nameservers: [{ ldhName: 'A.DNS.BR' }, { ldhName: 'b.dns.br' }],
        secureDNS: { delegationSigned: true },
      },
    }));
    expect(await registroBrRdap({ fetchImpl })('bella.com.br')).toEqual({
      registered: true,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
      nameServers: ['a.dns.br', 'b.dns.br'],
      signed: true,
    });
  });

  test('other status, bad JSON, oversized body and network errors are null', async () => {
    for (const reply of [
      { status: 500 },
      { status: 429 },
      { raw: '{not json' },
      { raw: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }) },
      'throw' as const,
    ]) {
      const { fetchImpl } = stub(() => reply);
      expect(await registroBrRdap({ fetchImpl })('bella.com.br')).toBeNull();
    }
  });
});

// ── CNPJ ─────────────────────────────────────────────────────────────────

describe('BrasilAPI CNPJ', () => {
  const RECORD = {
    cnpj: '12345678000195',
    razao_social: 'PIZZARIA BELLA NAPOLI LTDA',
    descricao_tipo_de_logradouro: 'RUA',
    logradouro: 'AUGUSTA',
    numero: '1200',
    complemento: 'LOJA 2',
    bairro: 'CONSOLACAO',
    municipio: 'SAO PAULO',
    uf: 'SP',
    cep: '01304001',
  };

  test('maps the public record', async () => {
    const { fetchImpl, seen } = stub(() => ({ body: RECORD }));
    expect(await brasilApiCnpj({ fetchImpl })('12.345.678/0001-95')).toEqual({
      name: 'PIZZARIA BELLA NAPOLI LTDA',
      address: {
        street: 'RUA AUGUSTA',
        number: '1200',
        complement: 'LOJA 2',
        district: 'CONSOLACAO',
        city: 'SAO PAULO',
        state: 'SP',
        postalCode: '01304001',
      },
    });
    expect(seen[0]!.url).toBe('https://brasilapi.com.br/api/cnpj/v1/12345678000195');
  });

  test('alphanumeric CNPJ, non-200 and errors are null', async () => {
    const { fetchImpl, seen } = stub(() => ({ status: 404, body: { message: 'not found' } }));
    const lookup = brasilApiCnpj({ fetchImpl });
    expect(await lookup('12ABC34501DE35')).toBeNull();
    expect(seen).toHaveLength(0);
    expect(await lookup('12345678000195')).toBeNull();
    const down = stub(() => 'throw');
    expect(await brasilApiCnpj({ fetchImpl: down.fetchImpl })('12345678000195')).toBeNull();
  });

  test('missing address parts leave address null; S/N for no number', () => {
    expect(parseCnpj({ razao_social: 'X LTDA', municipio: 'Y' })).toEqual({
      name: 'X LTDA',
      address: null,
    });
    expect(parseCnpj({ ...RECORD, numero: '', complemento: '', cep: 1304001 })!.address).toEqual({
      street: 'RUA AUGUSTA',
      number: 'S/N',
      district: 'CONSOLACAO',
      city: 'SAO PAULO',
      state: 'SP',
      postalCode: '01304001',
    });
  });
});

// ── TLS probe ────────────────────────────────────────────────────────────

describe('httpsProbe', () => {
  test('any HTTP answer is true, a throw is false', async () => {
    const answered = stub(() => ({ status: 301 }));
    expect(await httpsProbe({ fetchImpl: answered.fetchImpl })('bella.com.br')).toBe(true);
    expect(answered.seen[0]!.url).toBe('https://bella.com.br/_edge/healthz');
    expect(answered.seen[0]!.init?.redirect).toBe('manual');
    expect(answered.seen[0]!.init?.signal).toBeInstanceOf(AbortSignal);

    const failed = stub(() => 'throw');
    expect(await httpsProbe({ fetchImpl: failed.fetchImpl })('bella.com.br')).toBe(false);
  });
});

// ── env ──────────────────────────────────────────────────────────────────

describe('domainProvidersFromEnv', () => {
  const NAMES = [
    'OPENPROVIDER_USERNAME',
    'OPENPROVIDER_PASSWORD',
    'OPENPROVIDER_CONTACT_HANDLE',
    'OPENPROVIDER_URL',
    'OPENPROVIDER_PROVIDER_NAME',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'VENDUA_EDGE_IPV4',
    'VENDUA_EDGE_IPV6',
  ];
  afterEach(() => {
    for (const n of NAMES) delete process.env[n];
  });

  test('nothing set: no registrar, no DNS host, no edge', () => {
    const p = domainProvidersFromEnv();
    expect(p.registrar).toBeNull();
    expect(p.dnsHost).toBeNull();
    expect(p.edge).toBeNull();
    expect(p.providerName).toBeNull();
    expect(typeof p.rdap).toBe('function');
    expect(typeof p.cnpj).toBe('function');
    expect(typeof p.probeTls).toBe('function');
  });

  test('partial credentials stay off; complete ones turn each on', () => {
    process.env.OPENPROVIDER_USERNAME = 'u';
    process.env.OPENPROVIDER_PASSWORD = 'p';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    expect(domainProvidersFromEnv().registrar).toBeNull();
    expect(domainProvidersFromEnv().dnsHost).toBeNull();
    process.env.OPENPROVIDER_CONTACT_HANDLE = 'H';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.OPENPROVIDER_PROVIDER_NAME = ' Openprovider ';
    const p = domainProvidersFromEnv();
    expect(p.registrar).not.toBeNull();
    expect(p.dnsHost).not.toBeNull();
    expect(p.providerName).toBe('Openprovider');
  });

  test('edge addresses are validated', () => {
    process.env.VENDUA_EDGE_IPV4 = '203.0.113.10';
    process.env.VENDUA_EDGE_IPV6 = 'not-ipv6';
    expect(domainProvidersFromEnv().edge).toEqual({ ipv4: '203.0.113.10', ipv6: null });
    process.env.VENDUA_EDGE_IPV6 = '2001:db8::10';
    expect(domainProvidersFromEnv().edge).toEqual({ ipv4: '203.0.113.10', ipv6: '2001:db8::10' });
    process.env.VENDUA_EDGE_IPV4 = '2001:db8::10';
    expect(domainProvidersFromEnv().edge).toBeNull();
  });
});

// ── fakes ────────────────────────────────────────────────────────────────

describe('fakes', () => {
  test('registrar: async register, failNext, calls', async () => {
    const r = fakeRegistrar();
    r.registerAsync = true;
    r.failNext('conflict', 'belongs to another provider');
    expect((await rejection(r.createHolder(HOLDER))).kind).toBe('conflict');
    const handle = await r.createHolder(HOLDER);
    const d = await r.register({ host: 'bella.com.br', holderHandle: handle });
    expect(d.status).toBe('pending');
    r.complete('bella.com.br');
    expect((await r.get(d.ref)).status).toBe('active');
    expect((await r.check(['bella.com.br'])).get('bella.com.br')!.available).toBe(false);
    expect((await rejection(r.register({ host: 'bella.com.br', holderHandle: handle }))).kind).toBe(
      'taken',
    );
    expect(r.calls.map((c) => c.op)).toEqual([
      'createHolder',
      'createHolder',
      'register',
      'get',
      'check',
      'register',
    ]);
  });

  test('dns host, rdap and providers', async () => {
    const dns = fakeDnsHost();
    const z = await dns.ensureZone('bella.com.br');
    expect(z.nameServers).toEqual(['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    expect((await dns.ensureZone('bella.com.br')).id).toBe(z.id);
    await dns.syncRecords(z.id, 'bella.com.br', { ipv4: '203.0.113.10', ipv6: null }, [
      { type: 'MX', name: '@', value: 'mx.x.com', priority: 1 },
    ]);
    expect(dns.zones.get('bella.com.br')!.records).toHaveLength(1);
    await dns.deleteZone(z.id);
    expect(await dns.zone(z.id)).toBeNull();

    const rdap = fakeRdap({
      'bella.com.br': { registered: true, expiresAt: null, nameServers: [], signed: false },
    });
    expect((await rdap('bella.com.br'))!.registered).toBe(true);
    expect(await rdap('other.com.br')).toBeNull();

    const p = fakeProviders({ registrar: null });
    expect(p.registrar).toBeNull();
    expect(p.edge).toEqual({ ipv4: '203.0.113.10', ipv6: null });
    expect(await p.probeTls('x')).toBe(true);
    expect(await p.cnpj('12345678000195')).toBeNull();
  });
});
