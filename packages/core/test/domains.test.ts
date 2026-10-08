// ADR 0038: own domains with no staff step — connected (CNAME or delegated nameservers) and the
// .com.br Venduá registers, renews and lapses. Outside services are the fakes in domain-fakes.ts;
// DNS is a stub map; jobs run with an explicit `now`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { setDnsResolver } from '../src/modules/billing/domains.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import {
  aliasOf,
  comBrLabel,
  isRoot,
  labelFromQuery,
  maskDocument,
} from '../src/modules/domains/hosts.ts';
import { runDomainJobs } from '../src/modules/domains/jobs.ts';
import type { DnsRecord } from '../src/modules/domains/providers.ts';
import { parseRecords } from '../src/modules/domains/records.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { HttpError } from '../src/platform/http.ts';
import { migrate } from '../src/platform/db.ts';
import { fakeDnsHost, fakeProviders, fakeRdap, fakeRegistrar } from './domain-fakes.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const CF_PAIR = ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'];

const httpError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected an HttpError');
};

describe('domain names (hosts.ts)', () => {
  test('isRoot and aliasOf', () => {
    expect(isRoot('loja.com.br')).toBe(true);
    expect(isRoot('loja.com')).toBe(true);
    expect(isRoot('loja.co.uk')).toBe(true);
    expect(isRoot('www.loja.com.br')).toBe(false);
    expect(isRoot('pedidos.loja.com.br')).toBe(false);
    expect(aliasOf('loja.com.br')).toBe('www.loja.com.br');
    expect(aliasOf('www.loja.com.br')).toBe('loja.com.br');
    expect(aliasOf('pedidos.loja.com.br')).toBeNull();
    expect(aliasOf('www.pedidos.loja.com.br')).toBeNull();
  });

  test('isRoot: a public suffix itself is not a root', () => {
    expect(isRoot('com.br')).toBe(false);
    expect(isRoot('co.uk')).toBe(false);
    expect(aliasOf('com.br')).toBeNull();
  });

  test('comBrLabel: registro.br rules', () => {
    expect(comBrLabel('loja.com.br')).toBe('loja');
    expect(comBrLabel('loja-2.com.br')).toBe('loja-2');
    expect(comBrLabel('12345.com.br')).toBeNull(); // only digits
    expect(comBrLabel(`${'a'.repeat(26)}.com.br`)).toBe('a'.repeat(26));
    expect(comBrLabel(`${'a'.repeat(27)}.com.br`)).toBeNull();
    expect(comBrLabel('a.com.br')).toBeNull();
    expect(comBrLabel('-loja.com.br')).toBeNull();
    expect(comBrLabel('loja-.com.br')).toBeNull();
    expect(comBrLabel('lo--ja.com.br')).toBeNull();
    expect(comBrLabel('www.loja.com.br')).toBeNull();
    expect(comBrLabel('loja.net.br')).toBeNull();
  });

  test('labelFromQuery and maskDocument', () => {
    expect(labelFromQuery('Pizzaria do Zé')).toBe('pizzariadoze');
    expect(labelFromQuery('https://www.Doces.com.br/x')).toBe('doces');
    expect(labelFromQuery('12345')).toBeNull();
    expect(labelFromQuery('')).toBeNull();
    expect(labelFromQuery('a'.repeat(40))).toBe('a'.repeat(26));
    expect(maskDocument('12345678000199')).toBe('12.345.678/0001-**');
    expect(maskDocument('12345678901')).toBe('***.456.789-**');
  });
});

describe('owner records (records.ts parseRecords)', () => {
  const parse = (r: unknown) => parseRecords(r, 'loja.com.br');

  test("refuses Venduá's names, bad values and too many records", () => {
    for (const other of [
      { type: 'A', name: 'shop', value: '1.2.3.4' },
      { type: 'CNAME', name: 'shop', value: 'b.example.com' },
      { type: 'TXT', name: 'shop', value: 'x' },
    ])
      expect(
        httpError(() => parse([{ type: 'CNAME', name: 'shop', value: 'a.example.com' }, other])),
      ).toMatchObject({ code: 'INVALID_RECORD' });
    for (const value of ['::::', '1:2:3:4:5:6:7:8:9', '2001:db8::g'])
      expect(httpError(() => parse([{ type: 'AAAA', name: 'v6', value }]))).toMatchObject({
        code: 'INVALID_RECORD',
      });
    expect(parse([{ type: 'AAAA', name: 'v6', value: '2001:DB8::1' }])[0]!.value).toBe(
      '2001:db8::1',
    );
    expect(httpError(() => parse([{ type: 'A', name: '@', value: '1.2.3.4' }]))).toMatchObject({
      status: 422,
      code: 'INVALID_RECORD',
      details: { field: 'records.0' },
    });
    expect(
      httpError(() =>
        parse([
          { type: 'TXT', name: '@', value: 'ok' },
          { type: 'CNAME', name: 'www', value: 'x.example.com' },
        ]),
      ),
    ).toMatchObject({ code: 'INVALID_RECORD', details: { field: 'records.1' } });
    expect(httpError(() => parse([{ type: 'A', name: 'mail', value: '300.1.1.1' }])).code).toBe(
      'INVALID_RECORD',
    );
    expect(httpError(() => parse([{ type: 'SRV', name: 'x', value: 'y' }])).code).toBe(
      'INVALID_RECORD',
    );
    expect(httpError(() => parse('nope')).code).toBe('INVALID_RECORD');
    const many = Array.from({ length: 51 }, (_, i) => ({ type: 'TXT', name: `t${i}`, value: 'x' }));
    expect(httpError(() => parse(many))).toMatchObject({
      status: 422,
      code: 'TOO_MANY_RECORDS',
    });
    expect(parse(many.slice(0, 50))).toHaveLength(50);
  });

  test('normalizes names, MX priority and values; dedupes', () => {
    expect(
      parse([
        { type: 'mx', name: '@', value: 'MX.Google.com.' },
        { type: 'MX', name: '', value: 'mx.google.com', priority: 10 },
        { type: 'MX', name: '@', value: 'alt.google.com', priority: 5 },
        { type: 'TXT', name: '_DMARC.', value: ' v=DMARC1; p=none ' },
        { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' },
        { type: 'A', name: 'Mail', value: '203.0.113.9' },
      ]),
    ).toEqual([
      { type: 'MX', name: '@', value: 'mx.google.com', priority: 10 },
      { type: 'MX', name: '@', value: 'alt.google.com', priority: 5 },
      { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' },
      { type: 'A', name: 'mail', value: '203.0.113.9' },
    ]);
    expect(
      httpError(() => parse([{ type: 'MX', name: '@', value: 'mx.x.com', priority: -1 }])).code,
    ).toBe('INVALID_RECORD');
  });

  test('names are read relative to the domain, so its own root and www stay protected', () => {
    for (const name of ['loja.com.br', 'loja.com.br.', 'www.loja.com.br', 'WWW.Loja.com.br.'])
      expect(httpError(() => parse([{ type: 'A', name, value: '1.2.3.4' }])).code).toBe(
        'INVALID_RECORD',
      );
    expect(
      httpError(() =>
        parse([
          { type: 'CNAME', name: 'shop.loja.com.br', value: 'a.example.com' },
          { type: 'TXT', name: 'shop', value: 'x' },
        ]),
      ).code,
    ).toBe('INVALID_RECORD');
    expect(
      parse([
        { type: 'MX', name: 'loja.com.br.', value: 'mx.x.com' },
        { type: 'TXT', name: '_dmarc.loja.com.br', value: 'v=DMARC1' },
      ]).map((r) => r.name),
    ).toEqual(['@', '_dmarc']);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('own domains (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const notify = {
    whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
    email: async () => {},
  };
  const registrar = fakeRegistrar();
  const dnsHost = fakeDnsHost();
  const tls = { ok: false };
  const providers = fakeProviders({
    registrar,
    dnsHost,
    rdap: fakeRdap(),
    probeTls: async () => tls.ok,
  });
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    notify,
    domains: providers,
    syncSecret: 'sync',
    edgeSecret: 'edge',
  });
  const jobs = (now: Date) =>
    runDomainJobs(appSql, { providers, notify, storeDomain: 'vendua.test' }, now);
  const later = (base: number, ms: number) => new Date(base + ms);
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];
  let idem = 0;
  const originalStaff = billingStaff.notify;

  // ── DNS: a stub map; a name it lacks has no records ────────────────────────
  interface Rec {
    cname?: string[] | undefined;
    a?: string[] | undefined;
    aaaa?: string[] | undefined;
    txt?: string[][] | undefined;
    caa?: { issue?: string }[] | undefined;
    ns?: string[] | undefined;
    mx?: { exchange: string; priority: number }[] | undefined;
  }
  const dns = new Map<string, Rec>();
  const miss = () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  const answer = <T>(h: string, k: keyof Rec) => {
    const v = dns.get(h)?.[k];
    return (v ? Promise.resolve(v) : miss()) as Promise<T>;
  };
  const set = (h: string, rec: Rec) => dns.set(h, { ...dns.get(h), ...rec });
  /** host (and its TXT proof) CNAMEd at the store's platform host */
  const pointCname = (host: string, slug: string, txt?: string) => {
    set(host, { cname: [`${slug}.vendua.test`] });
    if (txt) set(`_vendua.${host}`, { txt: [[txt]] });
  };

  // ── HTTP ──────────────────────────────────────────────────────────────────
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    o: { idem?: boolean } = {},
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'x-vendua-admin': '1' }),
        ...(method === 'GET' || o.idem === false
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
    };
  };
  const control = (method: string, path: string, body?: unknown, o: { idem?: boolean } = {}) =>
    call(method, path, body, { 'x-vendua-control': 'ctl' }, o);
  const edge = (host: string) =>
    call('GET', `/edge/v1/resolve?host=${encodeURIComponent(host)}`, undefined, {
      'x-vendua-edge': 'edge',
    });
  const syncHosts = async () => {
    const r = await call('GET', '/sync/v1/custom-hosts', undefined, { 'x-vendua-sync': 'sync' });
    expect(r.status).toBe(200);
    return r.body.hosts as string[];
  };

  // ── stores ────────────────────────────────────────────────────────────────
  type Store = Awaited<ReturnType<typeof store>>;
  /** a self-serve store (provision_store, behind billing_hold) with a signed-in owner */
  const store = async (name: string, plan: 'mirim' | 'pangolim') => {
    const slug = `dom-${nonce}-${name}`;
    const phone = `219${String(Date.now() + created.length * 13).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${plan}, ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, 'bia@example.com') as id
      `
    )[0]!.id;
    created.push(id);
    const m = (await membershipsFor(appSql, phone)).find((x) => x.tenant_id === id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const owner = (method: string, path: string, body?: unknown, headers = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie, ...headers });
    return { id, slug, phone, owner, platform: `${slug}.vendua.test` };
  };
  /** pays the plan: pix subscription, first invoice settled */
  const pay = async (s: Store, plan: 'mirim' | 'pangolim' = 'pangolim') => {
    const st = await s.owner('POST', '/account/subscription', {
      planId: plan,
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    expect(st.status).toBe(200);
    const paid = await call(
      'POST',
      `/admin/v1/dev/billing/invoices/${st.body.invoices[0].id}/pay`,
      {},
    );
    expect(paid.status).toBeLessThan(300);
  };
  const paidStore = async (name: string) => {
    const s = await store(name, 'pangolim');
    await pay(s);
    return s;
  };
  const account = async (s: Store) => {
    const r = await s.owner('GET', '/account');
    expect(r.status).toBe(200);
    return r.body;
  };
  const primaryOf = async (tenant: string) =>
    (
      await sql<
        { host: string }[]
      >`select host from domains where tenant_id = ${tenant} and is_primary`
    ).map((r) => r.host);
  const events = (tenant: string, kind: string) =>
    sql<{ data: Record<string, unknown> }[]>`
      select data from staff_events where tenant_id = ${tenant} and kind = ${kind} order by id
    `;
  const texts = (phone: string) => wa.filter((m) => m.phone === phone).map((m) => m.text);
  const row = async (id: string) => (await sql`select * from custom_domains where id = ${id}`)[0];
  const order = async (id: string) => (await sql`select * from domain_orders where id = ${id}`)[0];
  const calls = (op: string, host: string) =>
    registrar.calls.filter((c) => c.op === op && JSON.stringify(c.args).includes(host));

  /** a connected root domain (CNAME at our host for it and www) that went live */
  const connectLive = async (name: string) => {
    const s = await paidStore(name);
    const host = `${name}-${nonce}.com.br`;
    const add = await s.owner('POST', '/account/domains', { host });
    expect(add.status).toBe(201);
    const cd = add.body.customDomain;
    pointCname(host, s.slug, cd.txtValue);
    pointCname(`www.${host}`, s.slug);
    tls.ok = true;
    await jobs(new Date());
    expect((await account(s)).customDomain.status).toBe('active');
    return { s, host, cd, at: Date.now() };
  };

  const HOLDER = {
    document: '11.222.333/0001-81',
    name: 'Pizzaria do Zé Ltda',
    email: 'ze@example.com',
    phone: '(11) 91234-5678',
    address: {
      street: 'Praça da Sé',
      number: '100',
      district: 'Sé',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01001-000',
    },
  };
  const orderBody = (host: string, over: Record<string, unknown> = {}) => ({
    host,
    holder: HOLDER,
    authorize: true,
    ...over,
  });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await sql`update plans set available = true where id = 'pangolim'`;
    billingStaff.notify = async () => {};
    setDnsResolver({
      resolveCname: (h) => answer(h, 'cname'),
      resolve4: (h) => answer(h, 'a'),
      resolve6: (h) => answer(h, 'aaaa'),
      resolveTxt: (h) => answer(h, 'txt'),
      resolveCaa: (h) => answer(h, 'caa'),
      resolveNs: (h) => answer(h, 'ns'),
      resolveMx: (h) => answer(h, 'mx'),
    });
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    setDnsResolver(null);
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('connected cname: DNS verified → certificate stuck tells the team once → live', async () => {
    const T = Date.now();
    const s = await paidStore('cn');
    const host = `cn-${nonce}.com.br`;
    const add = await s.owner('POST', '/account/domains', { host });
    expect(add.status).toBe(201);
    const cd = add.body.customDomain;
    expect(cd).toMatchObject({
      host,
      status: 'pending_dns',
      source: 'connected',
      method: 'cname',
      aliasHost: `www.${host}`,
      cnameTarget: s.platform,
      nameServers: [],
      recordsConfirmed: false,
    });
    expect(add.body.domainOptions).toEqual({
      delegation: true,
      purchase: true,
      edgeIpv4: '203.0.113.10',
    });
    // a cname domain's records stay at the owner's DNS
    const recs = await s.owner('PUT', `/account/domains/${cd.id}/records`, { records: [] });
    expect(recs.status).toBe(409);
    expect(recs.body.error.code).toBe('NOT_HOSTED');

    pointCname(host, s.slug, cd.txtValue);
    pointCname(`www.${host}`, s.slug);
    tls.ok = false;
    await jobs(later(T, 0));
    let acct = await account(s);
    expect(acct.customDomain.status).toBe('dns_ok');
    expect((await row(cd.id))!.alias_ok).toBe(true);

    // the sidecar routes it (alias included); without its secret the read doesn't exist
    const hosts = await syncHosts();
    expect(hosts).toContain(host);
    expect(hosts).toContain(`www.${host}`);
    expect([...hosts].sort()).toEqual(hosts);
    expect((await call('GET', '/sync/v1/custom-hosts')).status).toBe(404);
    expect(
      (await call('GET', '/sync/v1/custom-hosts', undefined, { 'x-vendua-sync': 'nope' })).status,
    ).toBe(404);

    // no certificate after an hour: the team hears it once
    await jobs(later(T, 2 * HOUR));
    expect((await account(s)).customDomain.status).toBe('dns_ok');
    expect(await events(s.id, 'domain.tls_stuck')).toHaveLength(1);
    await jobs(later(T, 3 * HOUR));
    expect(await events(s.id, 'domain.tls_stuck')).toHaveLength(1);
    expect(await events(s.id, 'domain.live')).toHaveLength(0);

    tls.ok = true;
    await jobs(later(T, 4 * HOUR));
    acct = await account(s);
    expect(acct.customDomain.status).toBe('active');
    expect(acct.address).toBe(`https://${host}`);
    expect(acct.domains).toContainEqual({ host, kind: 'custom', status: 'active', primary: true });
    expect(await primaryOf(s.id)).toEqual([host]);
    const live = await events(s.id, 'domain.live');
    expect(live).toHaveLength(1);
    expect(live[0]!.data).toMatchObject({ host, storeName: 'Loja cn' });
    expect(texts(s.phone).some((t) => t.includes(host) && t.includes('Pronto'))).toBe(true);
    await jobs(later(T, 5 * HOUR));
    expect(await events(s.id, 'domain.live')).toHaveLength(1);
  });

  test('certificate blockers: an AAAA not ours, a CAA without letsencrypt.org', async () => {
    const s = await paidStore('caa');
    const host = `caa-${nonce}.com.br`;
    const cd = (await s.owner('POST', '/account/domains', { host })).body.customDomain;
    pointCname(host, s.slug, cd.txtValue);
    set(host, { aaaa: ['2001:db8::1'] });
    const check = async () =>
      (await s.owner('POST', `/account/domains/${cd.id}/check`, {})).body.customDomain;
    let got = await check();
    expect(got.status).toBe('pending_dns');
    expect(got.lastError).toContain('AAAA');

    set(host, { aaaa: undefined, caa: [{ issue: 'digicert.com' }] });
    got = await check();
    expect(got.status).toBe('pending_dns');
    expect(got.lastError).toContain('CAA');

    // the issuer is matched exactly, not as a substring
    set(host, { caa: [{ issue: 'notletsencrypt.org' }] });
    got = await check();
    expect(got.status).toBe('pending_dns');
    set(host, { caa: [{ issue: 'letsencrypt.org; validationmethods=http-01' }] });
    got = await check();
    expect(got.status).toBe('dns_ok');
    expect(got.lastError).toBeNull();
  });

  test('edge: the www alias redirects to the domain; the domain resolves to the store', async () => {
    const { s, host } = await connectLive('edg');
    const www = await edge(`www.${host}`);
    expect(www.status).toBe(200);
    expect(www.body).toMatchObject({
      tenant: { id: s.id },
      release: null,
      redirect: { to: `https://${host}`, permanent: true },
    });
    const own = await edge(host);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ tenant: { id: s.id }, primaryHost: host, redirect: null });
    expect((await call('GET', `/edge/v1/resolve?host=www.${host}`)).status).toBe(404);
    // under repair, the alias that still works sends customers to the store's own address
    await sql`update custom_domains set status = 'repairing' where host = ${host}`;
    expect((await edge(`www.${host}`)).body.redirect).toEqual({
      to: `https://${s.platform}`,
      permanent: false,
    });
  });

  test('repair: three misses 15 minutes apart → repairing on the platform host → back', async () => {
    const { s, host, cd, at } = await connectLive('rep');
    dns.delete(host);
    dns.delete(`www.${host}`);
    await jobs(later(at, 16 * MIN));
    await jobs(later(at, 32 * MIN));
    expect((await account(s)).customDomain.status).toBe('active');
    expect((await row(cd.id))!.miss_count).toBe(2);
    await jobs(later(at, 48 * MIN));
    let acct = await account(s);
    expect(acct.customDomain.status).toBe('repairing');
    expect(acct.address).toBe(`https://${s.platform}`);
    expect(await primaryOf(s.id)).toEqual([s.platform]);
    expect(await events(s.id, 'domain.repairing')).toHaveLength(1);
    expect(texts(s.phone).some((t) => t.includes('parou de apontar'))).toBe(true);
    // the sidecar keeps the route while it's under repair
    expect(await syncHosts()).toContain(host);
    await jobs(later(at, 64 * MIN));
    expect(await events(s.id, 'domain.repairing')).toHaveLength(1);

    pointCname(host, s.slug);
    pointCname(`www.${host}`, s.slug);
    await jobs(later(at, 80 * MIN));
    acct = await account(s);
    expect(acct.customDomain.status).toBe('active');
    expect(await primaryOf(s.id)).toEqual([host]);
  });

  test("repair: the owner's check brings a fixed domain back at once", async () => {
    const { s, host, cd, at } = await connectLive('rpk');
    dns.delete(host);
    for (const m of [16, 32, 48]) await jobs(later(at, m * MIN));
    expect((await row(cd.id))!.status).toBe('repairing');
    pointCname(host, s.slug);
    const res = await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    expect(res.body.customDomain.status).toBe('active');
    expect(await primaryOf(s.id)).toEqual([host]);
  });

  test('repair: an AAAA record that is not ours, added after go-live, counts as a miss', async () => {
    const { s, host, cd, at } = await connectLive('rp6');
    set(host, { aaaa: ['2001:db8::bad'] });
    for (const m of [16, 32, 48]) await jobs(later(at, m * MIN));
    expect((await row(cd.id))!.status).toBe('repairing');
    expect(await primaryOf(s.id)).toEqual([s.platform]);
  });

  test('lapse: the plan loses the domain → redirect to the platform host; back → live again', async () => {
    const { s, host, cd } = await connectLive('lap');
    await sql`update tenants set plan = 'mirim' where id = ${s.id}`;
    await jobs(new Date());
    let acct = await account(s);
    expect(acct.customDomain.status).toBe('lapsed');
    expect(acct.address).toBe(`https://${s.platform}`);
    expect(await primaryOf(s.id)).toEqual([s.platform]);
    expect(await sql`select 1 from domains where host = ${host}`).toHaveLength(0);
    expect(await events(s.id, 'domain.lapsed')).toHaveLength(1);
    for (const h of [host, `www.${host}`]) {
      const r = await edge(h);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        tenant: { id: s.id },
        release: null,
        redirect: { to: `https://${s.platform}`, permanent: false },
      });
    }
    // the route and certificate stay so the redirect answers over https
    expect(await syncHosts()).toContain(host);

    await sql`update tenants set plan = 'pangolim' where id = ${s.id}`;
    const T = Date.now();
    tls.ok = false;
    await jobs(later(T, 0));
    expect((await account(s)).customDomain.status).toBe('pending_dns');
    await jobs(later(T, MIN));
    expect((await row(cd.id))!.status).toBe('dns_ok');
    tls.ok = true;
    await jobs(later(T, 2 * MIN));
    acct = await account(s);
    expect(acct.customDomain.status).toBe('active');
    expect(acct.address).toBe(`https://${host}`);
    expect((await edge(host)).body.redirect).toBeNull();
  });

  test('lapsed: once the domain stops pointing at Venduá, the row and its redirect go', async () => {
    const { s, host, cd } = await connectLive('gone');
    await sql`update tenants set plan = 'mirim' where id = ${s.id}`;
    const T = Date.now();
    await jobs(later(T, 0));
    expect((await row(cd.id))!.status).toBe('lapsed');
    // still pointing a day later: kept
    await jobs(later(T, DAY + MIN));
    expect((await row(cd.id))!.status).toBe('lapsed');
    dns.delete(host);
    dns.delete(`www.${host}`);
    // a lookup that fails once or twice isn't the domain moving: three days in a row is
    await jobs(later(T, 2 * DAY + 2 * MIN));
    await jobs(later(T, 3 * DAY + 3 * MIN));
    expect((await row(cd.id))!.status).toBe('lapsed');
    await jobs(later(T, 4 * DAY + 4 * MIN));
    expect(await row(cd.id)).toBeUndefined();
    expect((await edge(host)).status).toBe(404);
    expect(await syncHosts()).not.toContain(host);
    expect((await account(s)).customDomain).toBeNull();
  });

  test('a name registered by someone else before placement asks for another one', async () => {
    const s = await paidStore('tkn');
    const host = `tk${nonce}.com.br`;
    const id = (await s.owner('POST', '/account/domains/order', orderBody(host))).body.domainOrder
      .id;
    registrar.availability.set(host, { available: false });
    await jobs(new Date());
    const acct = await account(s);
    expect(acct.domainOrder).toMatchObject({ id, status: 'failed' });
    expect(acct.domainOrder.lastError).toContain('Escolha outro nome');
    expect(calls('register', host)).toHaveLength(0);
    const ev = await events(s.id, 'domain.order_failed');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({ host, reason: 'error' });
    expect(texts(s.phone).some((t) => t.includes('Escolha outro nome'))).toBe(true);
    // the owner picks again: cancel frees the name, a new order goes through
    const cancel = await s.owner('POST', `/account/domains/order/${id}/cancel`, {});
    expect(cancel.body.customDomain).toBeNull();
    registrar.registerAsync = false;
    const next = await s.owner('POST', '/account/domains/order', orderBody(`tk${nonce}2.com.br`));
    expect(next.status).toBe(201);
    expect(next.body.domainOrder.status).toBe('queued');
  });

  test('delegation: ns domain → records confirmed → zone → nameservers → live → removed', async () => {
    const s = await paidStore('ns');
    const host = `ns-${nonce}.com.br`;
    const notRoot = await s.owner('POST', '/account/domains', {
      host: `www.${host}`,
      method: 'ns',
    });
    expect(notRoot.status).toBe(422);
    expect(notRoot.body.error.code).toBe('DOMAIN_NOT_ROOT');
    providers.dnsHost = null;
    try {
      const off = await s.owner('POST', '/account/domains', { host, method: 'ns' });
      expect(off.status).toBe(503);
      expect(off.body.error.code).toBe('DELEGATION_UNAVAILABLE');
      expect((await account(s)).domainOptions).toMatchObject({
        delegation: false,
        purchase: false,
      });
    } finally {
      providers.dnsHost = dnsHost;
    }
    const bad = await s.owner('POST', '/account/domains', { host, method: 'dns' });
    expect(bad.status).toBe(422);

    const add = await s.owner('POST', '/account/domains', { host, method: 'ns' });
    expect(add.status).toBe(201);
    const cd = add.body.customDomain;
    expect(cd).toMatchObject({ method: 'ns', aliasHost: `www.${host}`, nameServers: [] });

    // what Core finds on the current DNS, to copy into the zone
    set(host, { mx: [{ exchange: 'ASPMX.L.Google.com', priority: 1 }], txt: [['v=spf1 -all']] });
    const found = await s.owner('POST', `/account/domains/${cd.id}/discover`, {});
    expect(found.status).toBe(200);
    expect(found.body.records).toContainEqual({
      type: 'MX',
      name: '@',
      value: 'aspmx.l.google.com',
      priority: 1,
    });
    expect(found.body.records).toContainEqual({ type: 'TXT', name: '@', value: 'v=spf1 -all' });

    // nothing is created before the owner confirms the list
    const draft: DnsRecord[] = [
      { type: 'MX', name: '@', value: 'aspmx.l.google.com', priority: 1 },
    ];
    let put = await s.owner('PUT', `/account/domains/${cd.id}/records`, { records: draft });
    expect(put.body.customDomain.recordsConfirmed).toBe(false);
    await jobs(new Date());
    expect(dnsHost.zones.has(host)).toBe(false);
    const tooMany = await s.owner('PUT', `/account/domains/${cd.id}/records`, {
      records: Array.from({ length: 51 }, (_, i) => ({ type: 'TXT', name: `t${i}`, value: 'x' })),
    });
    expect(tooMany.status).toBe(422);
    put = await s.owner('PUT', `/account/domains/${cd.id}/records`, {
      records: draft,
      confirm: true,
    });
    expect(put.status).toBe(200);
    expect(put.body.customDomain).toMatchObject({ recordsConfirmed: true, records: draft });

    const T = Date.now();
    tls.ok = false;
    await jobs(later(T, 0));
    expect(dnsHost.calls.filter((c) => c.op === 'ensureZone' && c.args[0] === host)).toHaveLength(
      1,
    );
    const zone = dnsHost.zones.get(host)!;
    expect(zone.records).toEqual(draft);
    expect(zone.edge).toEqual({ ipv4: '203.0.113.10', ipv6: null });
    let acct = await account(s);
    expect(acct.customDomain).toMatchObject({ status: 'pending_dns', nameServers: CF_PAIR });
    // the next check names the nameservers the owner still has to set
    await jobs(later(T, 16 * MIN));
    expect((await account(s)).customDomain.lastError).toContain(CF_PAIR[0]);
    const syncedAt = (await row(cd.id))!.records_synced_at as Date;
    expect(syncedAt.getTime()).toBe(T);

    // one of the pair alone isn't a delegation
    set(host, { ns: [CF_PAIR[0]!] });
    const half = await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    expect(half.body.customDomain.status).toBe('pending_dns');
    set(host, { ns: CF_PAIR.map((n) => `${n.toUpperCase()}.`) });
    await jobs(later(T, 32 * MIN));
    acct = await account(s);
    expect(acct.customDomain.status).toBe('dns_ok');
    expect((await row(cd.id))!.alias_ok).toBe(true);
    expect(await syncHosts()).toEqual(expect.arrayContaining([host, `www.${host}`]));
    tls.ok = true;
    await jobs(later(T, 33 * MIN));
    expect((await account(s)).customDomain.status).toBe('active');

    // an edit after the zone exists is pushed by the job
    const edited: DnsRecord[] = [
      ...draft,
      { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none' },
    ];
    await s.owner('PUT', `/account/domains/${cd.id}/records`, { records: edited });
    await jobs(later(T, 34 * MIN));
    expect(((await row(cd.id))!.records_synced_at as Date).getTime()).toBe(T + 34 * MIN);
    expect(dnsHost.zones.get(host)!.records).toEqual(edited);
    expect(dnsHost.calls.filter((c) => c.op === 'ensureZone' && c.args[0] === host)).toHaveLength(
      1,
    );

    // the owner removes a live delegated domain: hidden at once, then zone, route and row go
    const del = await s.owner('DELETE', `/account/domains/${cd.id}`);
    expect(del.status).toBe(200);
    expect(del.body.customDomain).toBeNull();
    expect((await row(cd.id))!.status).toBe('removing');
    await jobs(later(T, 35 * MIN));
    expect(await row(cd.id)).toBeUndefined();
    expect(dnsHost.zones.has(host)).toBe(false);
    expect(dnsHost.calls.some((c) => c.op === 'deleteZone' && c.args[0] === zone.id)).toBe(true);
    expect(await sql`select 1 from domains where host = ${host}`).toHaveLength(0);
    expect((await account(s)).address).toBe(`https://${s.platform}`);
    expect(await syncHosts()).not.toContain(host);
  });

  test('purchase: search → order awaiting payment → paid → registered → nameservers → live', async () => {
    const s = await store('buy', 'pangolim');
    registrar.registerAsync = true;
    registrar.availability.set('pizzariadelivery.com.br', { available: false });
    const search = await s.owner('GET', '/account/domains/search?q=Pizzaria');
    expect(search.status).toBe(200);
    expect(search.body.query).toBe('pizzaria.com.br');
    expect(search.body.purchase).toBe(true);
    expect(search.body.results[0]).toEqual({ host: 'pizzaria.com.br', available: true });
    expect(search.body.results).toContainEqual({
      host: 'pizzariadelivery.com.br',
      available: false,
    });
    expect(search.body.results.length).toBeLessThanOrEqual(5);

    const holder = await s.owner(
      'GET',
      `/account/domains/holder?document=${encodeURIComponent(HOLDER.document)}`,
    );
    expect(holder.body).toEqual({
      kind: 'cnpj',
      document: '11222333000181',
      name: null,
      address: null,
    });
    expect((await s.owner('GET', '/account/domains/holder?document=123')).status).toBe(422);

    const host = `pz${nonce}.com.br`;
    const noAuth = await s.owner(
      'POST',
      '/account/domains/order',
      orderBody(host, { authorize: undefined }),
    );
    expect(noAuth.status).toBe(422);
    expect(noAuth.body.error.code).toBe('AUTHORIZATION_REQUIRED');
    const badUf = await s.owner(
      'POST',
      '/account/domains/order',
      orderBody(host, { holder: { ...HOLDER, address: { ...HOLDER.address, state: 'XX' } } }),
    );
    expect(badUf.status).toBe(422);
    expect(badUf.body.error.details.field).toBe('holder.address.state');
    const badHost = await s.owner('POST', '/account/domains/order', orderBody(`pz${nonce}.com`));
    expect(badHost.body.error.code).toBe('INVALID_DOMAIN');

    // trial/unpaid: the choice waits for the first payment
    const key = `${nonce}-order`;
    const first = await s.owner('POST', '/account/domains/order', orderBody(host), {
      'idempotency-key': key,
    });
    expect(first.status).toBe(201);
    expect(first.body.domainOrder).toMatchObject({
      host,
      status: 'awaiting_payment',
      holder: { kind: 'cnpj', document: '11.222.333/0001-**', name: HOLDER.name },
      placedAt: null,
      providerName: 'Openprovider',
    });
    expect(first.body.customDomain).toMatchObject({
      host,
      status: 'ordering',
      source: 'included',
      method: 'ns',
      aliasHost: `www.${host}`,
    });
    const replay = await s.owner('POST', '/account/domains/order', orderBody(host), {
      'idempotency-key': key,
    });
    expect(replay.status).toBe(first.status);
    expect(replay.body).toEqual(first.body);
    expect(await sql`select 1 from domain_orders where tenant_id = ${s.id}`).toHaveLength(1);
    const again = await s.owner('POST', '/account/domains/order', orderBody(host));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DOMAIN_EXISTS');
    // a trial or an unpaid plan can't connect a domain either
    const conn = await s.owner('POST', '/account/domains', { host: `other-${nonce}.com.br` });
    expect(conn.status).toBe(403);

    await jobs(new Date());
    expect(registrar.calls.filter((c) => JSON.stringify(c.args).includes(host))).toHaveLength(0);
    expect((await account(s)).domainOrder.status).toBe('awaiting_payment');

    await pay(s);
    // …and once paid, the domain Venduá registers can't be swapped for a connected one
    const swap = await s.owner('POST', '/account/domains', { host: `other-${nonce}.com.br` });
    expect(swap.status).toBe(409);
    expect(swap.body.error.code).toBe('DOMAIN_INCLUDED');
    const T = Date.now();
    await jobs(later(T, 0));
    let acct = await account(s);
    expect(acct.domainOrder.status).toBe('pending');
    expect(acct.domainOrder.placedAt).not.toBeNull();
    expect(registrar.parked.get(host)).toEqual({ ipv4: '203.0.113.10', ipv6: null });
    expect(calls('register', host)).toHaveLength(1);
    const handle = (calls('register', host)[0]!.args[0] as { holderHandle: string }).holderHandle;
    expect(registrar.holders.get(handle)).toMatchObject({
      kind: 'cnpj',
      document: '11222333000181',
      phone: '11912345678',
      address: { state: 'SP', postalCode: '01001000' },
    });
    expect(await events(s.id, 'domain.ordered')).toHaveLength(1);
    // still pending at the registry: polled again later, nothing moves
    await jobs(later(T, 11 * MIN));
    expect((await account(s)).domainOrder.status).toBe('pending');
    expect(calls('register', host)).toHaveLength(1);

    registrar.complete(host);
    await jobs(later(T, 22 * MIN));
    acct = await account(s);
    expect(acct.domainOrder.status).toBe('registered');
    expect(acct.customDomain).toMatchObject({
      host,
      status: 'pending_dns',
      source: 'included',
      method: 'ns',
      nameServers: CF_PAIR,
      recordsConfirmed: true,
    });
    expect(acct.customDomain.expiresAt).not.toBeNull();
    expect(dnsHost.zones.get(host)).toBeDefined();
    const setNs = calls('setNameservers', host);
    expect(setNs).toHaveLength(1);
    expect(setNs[0]!.args[2]).toEqual(CF_PAIR);
    expect(registrar.domains.get(host)!.nameServers).toEqual(CF_PAIR);
    expect(await events(s.id, 'domain.registered')).toHaveLength(1);
    expect(texts(s.phone).some((t) => t.includes(`${host} foi registrado`))).toBe(true);
    // the owner can't remove the domain Venduá registered
    const del = await s.owner('DELETE', `/account/domains/${acct.customDomain.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('DOMAIN_INCLUDED');

    set(host, { ns: CF_PAIR });
    tls.ok = true;
    await jobs(later(T, 40 * MIN));
    acct = await account(s);
    expect(acct.customDomain.status).toBe('active');
    expect(acct.address).toBe(`https://${host}`);
    expect(await syncHosts()).toEqual(expect.arrayContaining([host, `www.${host}`]));

    // the holder's document and name never reach the team's events or the account
    const all = await sql<{ data: string }[]>`
      select data::text as data from staff_events where tenant_id = ${s.id}
    `;
    for (const e of all) {
      expect(e.data).not.toContain('11222333000181');
      expect(e.data).not.toContain(HOLDER.name);
      expect(e.data).not.toContain(HOLDER.address.street);
    }
    const json = JSON.stringify(acct);
    expect(json).not.toContain('11222333000181');
    expect(json).not.toContain(HOLDER.address.street);
    expect(json).toContain('11.222.333/0001-**');
  });

  test('provider conflict: retried daily for 7 days, then failed; retry and cancel', async () => {
    const s = await paidStore('cfl');
    registrar.registerAsync = false;
    const host = `cf${nonce}.com.br`;
    const placed = await s.owner('POST', '/account/domains/order', orderBody(host));
    expect(placed.status).toBe(201);
    expect(placed.body.domainOrder.status).toBe('queued');
    const id = placed.body.domainOrder.id;
    // the ordered name is held: no other store orders or connects it
    const rival = await paidStore('cfr');
    const taken = await rival.owner('POST', '/account/domains/order', orderBody(host));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('DOMAIN_TAKEN');
    const takenWww = await rival.owner('POST', '/account/domains', { host: `www.${host}` });
    expect(takenWww.body.error?.code).toBe('DOMAIN_TAKEN');
    // a plan without the domain, or no registrar configured
    const mirim = await store('cfm', 'mirim');
    const noPlan = await mirim.owner('POST', '/account/domains/order', orderBody(`m${host}`));
    expect(noPlan.status).toBe(403);
    expect(noPlan.body.error.code).toBe('PLAN_REQUIRED');
    providers.registrar = null;
    try {
      const off = await rival.owner('POST', '/account/domains/order', orderBody(`r${host}`));
      expect(off.status).toBe(503);
      expect(off.body.error.code).toBe('DOMAIN_PURCHASE_UNAVAILABLE');
    } finally {
      providers.registrar = registrar;
    }

    const T = Date.now();
    registrar.failNext('conflict', 'belongs to another provider', 'register');
    await jobs(later(T, 0));
    let acct = await account(s);
    expect(acct.domainOrder).toMatchObject({ status: 'conflict', providerName: 'Openprovider' });
    expect(acct.domainOrder.conflictSince).not.toBeNull();
    expect(acct.domainOrder.lastError).toContain('outro provedor');
    let failed = await events(s.id, 'domain.order_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data).toMatchObject({ host, reason: 'conflict' });
    expect(calls('register', host)).toHaveLength(1);

    // not before a day
    await jobs(later(T, 12 * HOUR));
    expect(calls('register', host)).toHaveLength(1);
    registrar.failNext('conflict', 'belongs to another provider', 'register');
    await jobs(later(T, 25 * HOUR));
    expect(calls('register', host)).toHaveLength(2);
    expect((await order(id))!.status).toBe('conflict');
    expect(((await order(id))!.conflict_since as Date).getTime()).toBe(T);
    expect(await events(s.id, 'domain.order_failed')).toHaveLength(1);

    registrar.failNext('conflict', 'belongs to another provider', 'register');
    await jobs(later(T, 8 * DAY));
    acct = await account(s);
    expect(acct.domainOrder.status).toBe('failed');

    const retry = await s.owner('POST', `/account/domains/order/${id}/retry`, {});
    expect(retry.status).toBe(200);
    expect(retry.body.domainOrder.status).toBe('queued');
    const cancel = await s.owner('POST', `/account/domains/order/${id}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect(cancel.body.domainOrder.status).toBe('cancelled');
    expect(cancel.body.customDomain).toBeNull();
    expect(await sql`select 1 from custom_domains where tenant_id = ${s.id}`).toHaveLength(0);
    const twice = await s.owner('POST', `/account/domains/order/${id}/cancel`, {});
    expect(twice.status).toBe(409);
  });

  test('renewal: an included domain 20 days from expiry is renewed once; a lost plan is not', async () => {
    registrar.registerAsync = false;
    const included = async (name: string) => {
      const s = await paidStore(name);
      const host = `${name}${nonce}.com.br`;
      const dom = await registrar.register({ host, holderHandle: 'VH000000-BR' });
      const expires = new Date(Date.now() + 20 * DAY);
      registrar.domains.get(host)!.expiresAt = expires;
      const id = (
        await sql<{ id: string }[]>`
          insert into custom_domains (tenant_id, host, verify_token, status, source, method,
            alias_host, alias_ok, registrar_ref, expires_at, zone_id, name_servers, activated_at,
            records_synced_at)
          values (${s.id}, ${host}, ${'0'.repeat(32)}, 'active', 'included', 'ns', ${`www.${host}`},
            true, ${dom.ref}, ${expires}, 'zrenew', ${CF_PAIR}, now(), now())
          returning id
        `
      )[0]!.id;
      set(host, { ns: CF_PAIR });
      return { s, host, id, ref: dom.ref, expires };
    };
    const a = await included('rnw');
    await jobs(new Date());
    const renewals =
      await sql`select * from domain_orders where tenant_id = ${a.s.id} and kind = 'renew'`;
    expect(renewals).toHaveLength(1);
    expect(renewals[0]!.status).toBe('renewed');
    expect(calls('renew', a.ref)).toHaveLength(1);
    const until = (await row(a.id))!.expires_at as Date;
    expect(until.getTime()).toBe(a.expires.getTime() + YEAR);
    const ev = await events(a.s.id, 'domain.renewed');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({ host: a.host, until: until.toISOString() });
    await jobs(new Date(Date.now() + MIN));
    expect(calls('renew', a.ref)).toHaveLength(1);
    expect(
      await sql`select 1 from domain_orders where tenant_id = ${a.s.id} and kind = 'renew'`,
    ).toHaveLength(1);

    const b = await included('rnx');
    await sql`update tenants set plan = 'mirim' where id = ${b.s.id}`;
    await jobs(new Date());
    expect(calls('renew', b.ref)).toHaveLength(0);
    expect(
      await sql`select 1 from domain_orders where tenant_id = ${b.s.id} and kind = 'renew' and status <> 'cancelled'`,
    ).toHaveLength(0);
    expect((await row(b.id))!.status).toBe('lapsed');
    // the domain stays the merchant's: the owners hear it's about to expire, once per notice
    const before = texts(b.s.phone).length;
    await jobs(new Date(Date.now() + DAY + MIN));
    await jobs(new Date(Date.now() + 2 * DAY + 2 * MIN));
    const notices = texts(b.s.phone)
      .slice(before)
      .filter((t) => t.includes(b.host) && t.includes('Nenhum (0)'));
    expect(notices).toHaveLength(1);
    expect((await row(b.id))!.expiry_notice).toBe(30);

    // a renewal the registrar keeps refusing gives up and tells the team
    const c = await included('rny');
    for (let i = 0; i < 5; i++) registrar.failNext('unavailable', 'maintenance', 'renew');
    const T = Date.now();
    for (const at of [0, 6, 17, 38, 80]) await jobs(later(T, at * MIN));
    expect(calls('renew', c.ref)).toHaveLength(5);
    const failedRenewal = await sql`
      select status from domain_orders where tenant_id = ${c.s.id} and kind = 'renew'
    `;
    expect(failedRenewal.map((r) => r.status)).toEqual(['failed']);
    const rf = await events(c.s.id, 'domain.renewal_failed');
    expect(rf).toHaveLength(1);
    expect(rf[0]!.data).toMatchObject({ host: c.host });
    expect((await row(c.id))!.expires_at.getTime()).toBe(c.expires.getTime());
    // …and is tried again the next day, well before the expiry
    await jobs(later(T, DAY + 2 * 60 * MIN));
    expect(calls('renew', c.ref)).toHaveLength(6);
    expect((await row(c.id))!.expires_at.getTime()).toBe(c.expires.getTime() + YEAR);
  });

  test('CRM: store list shows the domain and the order; retry needs a key and a stuck order', async () => {
    const c = await paidStore('crmc');
    await c.owner('POST', '/account/domains', { host: `crmc-${nonce}.com.br` });
    let list = await control('GET', `/control/v1/billing/stores?tenant=${c.id}`);
    expect(list.status).toBe(200);
    expect(list.body.stores[0]).toMatchObject({
      customDomain: {
        host: `crmc-${nonce}.com.br`,
        status: 'pending_dns',
        source: 'connected',
        method: 'cname',
      },
      domainOrder: null,
    });

    const s = await paidStore('crm');
    const host = `crm${nonce}.com.br`;
    const id = (await s.owner('POST', '/account/domains/order', orderBody(host))).body.domainOrder
      .id;
    // queued: nothing to retry
    expect((await control('POST', `/control/v1/domain-orders/${id}/retry`)).status).toBe(409);
    registrar.failNext('conflict', 'belongs to another provider', 'register');
    await jobs(new Date());
    list = await control('GET', `/control/v1/billing/stores?tenant=${s.id}`);
    expect(list.body.stores[0]).toMatchObject({
      customDomain: { host, status: 'ordering', source: 'included', method: 'ns' },
      domainOrder: { id, host, status: 'conflict' },
    });
    expect(typeof list.body.stores[0].domainOrder.lastError).toBe('string');

    const noKey = await control('POST', `/control/v1/domain-orders/${id}/retry`, undefined, {
      idem: false,
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await call('POST', `/control/v1/domain-orders/${id}/retry`)).status).not.toBe(200);
    const ok = await control('POST', `/control/v1/domain-orders/${id}/retry`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect((await order(id))!.status).toBe('queued');
    expect((await control('POST', `/control/v1/domain-orders/${id}/retry`)).status).toBe(409);
    expect(
      (await control('POST', `/control/v1/domain-orders/${crypto.randomUUID()}/retry`)).status,
    ).toBe(404);
    expect((await control('POST', '/control/v1/domain-orders/nope/retry')).status).toBe(400);
  });

  test("a zone is never handed to another store's claim on the same name", async () => {
    const a = await paidStore('zna');
    const host = `zone-${nonce}.com.br`;
    const add = await a.owner('POST', '/account/domains', { host, method: 'ns' });
    const mine: DnsRecord[] = [{ type: 'MX', name: '@', value: 'mx.a.example', priority: 1 }];
    await a.owner('PUT', `/account/domains/${add.body.customDomain.id}/records`, {
      records: mine,
      confirm: true,
    });
    await jobs(new Date());
    expect(dnsHost.zones.get(host)!.records).toEqual(mine);
    // the name is held: another store can't start on it through the admin
    const b = await paidStore('znb');
    const rival = await b.owner('POST', '/account/domains', { host, method: 'ns' });
    expect(rival.status).toBe(409);
    expect(rival.body.error.code).toBe('DOMAIN_TAKEN');
    // nor through a row that got in before the zone existed: its job refuses to adopt the zone
    const bid = (
      await sql<{ id: string }[]>`
        insert into custom_domains (tenant_id, host, verify_token, method, records,
          records_confirmed_at)
        values (${b.id}, ${host}, ${'1'.repeat(32)}, 'ns',
          ${sql.json([{ type: 'MX', name: '@', value: 'mx.b.example', priority: 1 }] as never)}, now())
        returning id
      `
    )[0]!.id;
    await jobs(new Date());
    expect(dnsHost.zones.get(host)!.records).toEqual(mine);
    const theirs = (await row(bid))!;
    expect(theirs.zone_id).toBeNull();
    expect(theirs.last_error).toContain('Outra loja');
  });

  test('a renewal retried after the registrar already renewed is not paid again', async () => {
    registrar.registerAsync = false;
    const s = await paidStore('rtry');
    const host = `rtry${nonce}.com.br`;
    const dom = await registrar.register({ host, holderHandle: 'VH000000-BR' });
    const before = new Date(Date.now() + 20 * DAY);
    // the last attempt went through at the registrar, then Core lost the answer
    registrar.domains.get(host)!.expiresAt = new Date(before.getTime() + YEAR);
    const id = (
      await sql<{ id: string }[]>`
        insert into custom_domains (tenant_id, host, verify_token, status, source, method,
          alias_host, alias_ok, registrar_ref, expires_at, zone_id, name_servers, activated_at,
          records_synced_at)
        values (${s.id}, ${host}, ${'2'.repeat(32)}, 'active', 'included', 'ns', ${`www.${host}`},
          true, ${dom.ref}, ${before}, 'zretry', ${CF_PAIR}, now(), now())
        returning id
      `
    )[0]!.id;
    set(host, { ns: CF_PAIR });
    await sql`
      insert into domain_orders (tenant_id, custom_domain_id, kind, host, status, attempts,
        expires_before)
      values (${s.id}, ${id}, 'renew', ${host}, 'queued', 1, ${before})
    `;
    await jobs(new Date());
    expect(calls('renew', dom.ref)).toHaveLength(0);
    const o = (
      await sql`select status from domain_orders where custom_domain_id = ${id} and kind = 'renew'`
    )[0]!;
    expect(o.status).toBe('renewed');
    expect(((await row(id))!.expires_at as Date).getTime()).toBe(before.getTime() + YEAR);
  });

  test('an order a worker is placing can be neither cancelled nor retried', async () => {
    const s = await paidStore('busy');
    const host = `busy${nonce}.com.br`;
    const placed = await s.owner('POST', '/account/domains/order', orderBody(host));
    expect(placed.status).toBe(201);
    const id = placed.body.domainOrder.id;
    await sql`
      update domain_orders set status = 'conflict', claimed_until = now() + interval '5 minutes'
      where id = ${id}
    `;
    const cancel = await s.owner('POST', `/account/domains/order/${id}/cancel`, {});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('ORDER_BUSY');
    expect((await control('POST', `/control/v1/domain-orders/${id}/retry`)).status).toBe(409);
    await sql`update domain_orders set claimed_until = null where id = ${id}`;
    expect((await s.owner('POST', `/account/domains/order/${id}/cancel`, {})).status).toBe(200);
  });
  test("a root and its www can't be held by two stores, whichever column names them", async () => {
    const a = await paidStore('pra');
    const b = await paidStore('prb');
    const root = `pair-${nonce}.com.br`;
    await sql`
      insert into custom_domains (tenant_id, host, verify_token, status, alias_host)
      values (${a.id}, ${root}, ${'3'.repeat(32)}, 'active', ${`www.${root}`})
    `;
    const err = await sql`
      insert into custom_domains (tenant_id, host, verify_token, status, alias_host)
      values (${b.id}, ${`www.${root}`}, ${'4'.repeat(32)}, 'dns_ok', ${root})
    `.then(
      () => null,
      (e: { code?: string }) => e,
    );
    expect(err?.code).toBe('23505');
    // a claim still waiting for DNS holds nothing, so it may name the pair
    await sql`
      insert into custom_domains (tenant_id, host, verify_token, alias_host)
      values (${b.id}, ${`www.${root}`}, ${'5'.repeat(32)}, ${root})
    `;
  });

  test("an unpaid store's waiting order goes to the back of the line", async () => {
    const s = await store('unpd', 'pangolim');
    const host = `unpd${nonce}.com.br`;
    const placed = await s.owner('POST', '/account/domains/order', orderBody(host));
    expect(placed.body.domainOrder.status).toBe('awaiting_payment');
    const before = (await order(placed.body.domainOrder.id))!.updated_at as Date;
    await jobs(new Date(Date.now() + MIN));
    const after = (await order(placed.body.domainOrder.id))!;
    expect(after.status).toBe('awaiting_payment');
    expect((after.updated_at as Date).getTime()).toBeGreaterThan(before.getTime());
  });
  test("a renewal isn't asked for while the registrar can't say when the domain expires", async () => {
    registrar.registerAsync = false;
    const s = await paidStore('nexp');
    const host = `nexp${nonce}.com.br`;
    const dom = await registrar.register({ host, holderHandle: 'VH000000-BR' });
    registrar.domains.get(host)!.expiresAt = null;
    const id = (
      await sql<{ id: string }[]>`
        insert into custom_domains (tenant_id, host, verify_token, status, source, method,
          alias_host, alias_ok, registrar_ref, expires_at, zone_id, name_servers, activated_at,
          records_synced_at)
        values (${s.id}, ${host}, ${'6'.repeat(32)}, 'active', 'included', 'ns', ${`www.${host}`},
          true, ${dom.ref}, ${new Date(Date.now() + 10 * DAY)}, 'znexp', ${CF_PAIR}, now(), now())
        returning id
      `
    )[0]!.id;
    set(host, { ns: CF_PAIR });
    await jobs(new Date());
    expect(calls('renew', dom.ref)).toHaveLength(0);
    const o = (
      await sql`select status from domain_orders where custom_domain_id = ${id} and kind = 'renew'`
    )[0]!;
    expect(o.status).toBe('queued');
  });

  test('a domain removed while its zone is being created takes the zone with it', async () => {
    const s = await paidStore('zrm');
    const host = `zrm-${nonce}.com.br`;
    const add = await s.owner('POST', '/account/domains', { host, method: 'ns' });
    const id = add.body.customDomain.id;
    await s.owner('PUT', `/account/domains/${id}/records`, { records: [], confirm: true });
    const ensure = dnsHost.ensureZone;
    dnsHost.ensureZone = async (h) => {
      expect((await s.owner('DELETE', `/account/domains/${id}`)).status).toBe(200);
      return ensure(h);
    };
    try {
      await jobs(new Date());
    } finally {
      dnsHost.ensureZone = ensure;
    }
    expect(dnsHost.zones.has(host)).toBe(false);
    expect(await row(id)).toBeUndefined();
  });

  test('a removed domain whose zone claim was left by a dead job waits, then finds the zone', async () => {
    const s = await paidStore('zst');
    const host = `zst-${nonce}.com.br`;
    const id = (
      await sql<{ id: string }[]>`
        insert into custom_domains (tenant_id, host, verify_token, status, method, zone_id,
          zone_claimed_at)
        values (${s.id}, ${host}, ${'7'.repeat(32)}, 'removing', 'ns', 'pending', now())
        returning id
      `
    )[0]!.id;
    await dnsHost.ensureZone(host);
    await jobs(new Date());
    expect(await row(id)).toBeDefined();
    expect(dnsHost.zones.has(host)).toBe(true);
    await jobs(new Date(Date.now() + 11 * MIN));
    expect(dnsHost.zones.has(host)).toBe(false);
    expect(await row(id)).toBeUndefined();
  });
});
