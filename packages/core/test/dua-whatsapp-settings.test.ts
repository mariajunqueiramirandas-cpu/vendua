import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate, type Sql } from '../src/platform/db.ts';

// Duá pelo WhatsApp's switches (dua-no-whatsapp §6): the person's opt-in in Perfil, the session's
// answer about who may use it, and the owner's per-store switch for managers in Equipe.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

describe.skipIf(!OWNER_URL)('Duá pelo WhatsApp settings (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const tenants: string[] = [];
  let idem = 0;

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
      replay: res.headers.get('x-idempotent-replay') === 'true',
    };
  };
  const as =
    (cookie: string) =>
    (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      request(method, path, body, { cookie, ...headers });

  async function signIn(phone: string) {
    await request('POST', '/auth/otp/start', { phone });
    const r = await request('POST', '/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  }

  let phones = 0;
  const phone = () => `24${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);

  async function store(plan: string) {
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${`dw-${nonce}-${tenants.length}`}, 'Quero Pudim', ${plan})
      returning id`;
    tenants.push(t!.id);
    await sql`insert into store_settings (tenant_id) values (${t!.id})`;
    return t!.id;
  }

  async function member(tenantId: string, role: 'owner' | 'manager' | 'attendant') {
    const p = phone();
    await sql`insert into merchant_users (tenant_id, name, phone, role)
      values (${tenantId}, ${`Pessoa ${role}`}, ${p}, ${role})`;
    return signIn(p);
  }

  let tenantId: string;
  let owner: string;
  let manager: string;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = await store('pangolim');
    owner = await member(tenantId, 'owner');
    manager = await member(tenantId, 'manager');
  });

  afterAll(async () => {
    for (const t of tenants) await sql`delete from tenants where id = ${t}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('prefs.duaWhatsapp is a boolean pref; absent means off', async () => {
    const before = await as(owner)('GET', '/session');
    expect(before.body.user.prefs.duaWhatsapp).toBeUndefined();
    const on = await as(owner)('PATCH', '/me', { prefs: { duaWhatsapp: true } });
    expect(on.status).toBe(200);
    expect(on.body.user.prefs.duaWhatsapp).toBe(true);
    // a wrong type is dropped, not stored
    await as(owner)('PATCH', '/me', { prefs: { duaWhatsapp: 'yes' } });
    expect((await as(owner)('GET', '/session')).body.user.prefs.duaWhatsapp).toBe(true);
    await as(owner)('PATCH', '/me', { prefs: { duaWhatsapp: false } });
    expect((await as(owner)('GET', '/session')).body.user.prefs.duaWhatsapp).toBe(false);
  });

  test('the session answers for owners and managers on a plan with the copilot only', async () => {
    const o = (await as(owner)('GET', '/session')).body.duaWhatsapp;
    expect(o).not.toBeNull();
    expect(o.allowed).toBe(true);
    expect(o.number === null || /^\d{10,15}$/.test(o.number)).toBe(true);
    const mg = (await as(manager)('GET', '/session')).body.duaWhatsapp;
    expect(mg.allowed).toBe(true);

    const attendant = await member(tenantId, 'attendant');
    expect((await as(attendant)('GET', '/session')).body.duaWhatsapp).toBeNull();

    const other = await store('bandeira');
    const lockedOwner = await member(other, 'owner');
    expect((await as(lockedOwner)('GET', '/session')).body.duaWhatsapp).toBeNull();
  });

  test('the managers switch: owner only, a boolean, replay-safe, and the session follows', async () => {
    const team = await as(owner)('GET', '/team');
    expect(team.body.duaWhatsappManagers).toBe(true);

    const denied = await as(manager)('PATCH', '/team/settings', { duaWhatsappManagers: false });
    expect(denied.status).toBe(403);
    const bad = await as(owner)('PATCH', '/team/settings', { duaWhatsappManagers: 'no' });
    expect(bad.status).toBe(422);
    expect((await as(owner)('PATCH', '/team/settings', {})).status).toBe(422);

    const key = { 'idempotency-key': `${nonce}-switch` };
    const off = await as(owner)('PATCH', '/team/settings', { duaWhatsappManagers: false }, key);
    expect(off.status).toBe(200);
    expect(off.body.duaWhatsappManagers).toBe(false);
    const again = await as(owner)('PATCH', '/team/settings', { duaWhatsappManagers: false }, key);
    expect(again.status).toBe(200);
    expect(again.replay).toBe(true);
    const [audited] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where tenant_id = ${tenantId} and action = 'team.settings'`;
    expect(audited!.n).toBe(1);

    expect((await as(manager)('GET', '/team')).body.duaWhatsappManagers).toBe(false);
    expect((await as(manager)('GET', '/session')).body.duaWhatsapp.allowed).toBe(false);
    expect((await as(owner)('GET', '/session')).body.duaWhatsapp.allowed).toBe(true);

    await as(owner)('PATCH', '/team/settings', { duaWhatsappManagers: true });
    expect((await as(manager)('GET', '/session')).body.duaWhatsapp.allowed).toBe(true);
  });
});
