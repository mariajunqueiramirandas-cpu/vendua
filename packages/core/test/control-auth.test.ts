import { afterAll, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';

// wrong keys never reach the DB — a lazy postgres.js client stands in for AppDeps
const offline = createApp({
  sql: postgres('postgres://localhost:1/vendua'),
  sessionSecret: 's',
  controlSecret: 'ctl-secret',
  autoDrain: false,
});

const loginOn = (app: typeof offline, key: string, headers: Record<string, string> = {}) =>
  app.request('/control/v1/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ key }),
  });

describe('control staff key', () => {
  test('wrong key → 404, no cookie', async () => {
    const res = await loginOn(offline, 'nope', { 'x-forwarded-for': '10.0.0.1' });
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('header-authed /session does not mint a cookie', async () => {
    const res = await offline.request('/control/v1/session', {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('the old HMAC-derived cookie is not a credential', async () => {
    const legacy = createHmac('sha256', 'ctl-secret').update('vendua.control').digest('hex');
    for (const v of [legacy, 'forged']) {
      const res = await offline.request('/control/v1/session', {
        headers: { cookie: `vendua_control=${v}` },
      });
      expect(res.status).toBe(404);
    }
  });

  test('wrong x-vendua-control headers spend the login bucket; then even the right key is 429', async () => {
    const app = createApp({
      sql: postgres('postgres://localhost:1/vendua'),
      sessionSecret: 's',
      controlSecret: 'ctl-secret',
      autoDrain: false,
    });
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/control/v1/leads', {
        headers: { 'x-vendua-control': `guess-${i}` },
      });
      expect(res.status).toBe(404);
    }
    const header = await app.request('/control/v1/session', {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    expect(header.status).toBe(429);
    // same bucket as POST /login
    expect((await loginOn(app, 'ctl-secret')).status).toBe(429);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('control sessions (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  afterAll(() => sql.end());
  const login = (key: string) => loginOn(app, key);
  const hashOf = (pair: string) => createHash('sha256').update(pair.split('=')[1]!).digest('hex');
  const row = async (pair: string) =>
    sql.begin(async (tx) => {
      await tx`select set_config('vendua.control', '1', true)`;
      return (
        await tx<{ expires_at: Date; revoked_at: Date | null }[]>`
          select expires_at, revoked_at from control_sessions where token_hash = ${hashOf(pair)}
        `
      )[0];
    });

  test('login mints a random per-device session stored only as a hash; /session renews it', async () => {
    const a = (await login('ctl-secret')).headers.get('set-cookie')!;
    const b = (await login('ctl-secret')).headers.get('set-cookie')!;
    expect(a).toContain('HttpOnly');
    expect(a).toContain('Path=/control');
    expect(Number(/Max-Age=(\d+)/.exec(a)?.[1])).toBe(60 * 60 * 24 * 30);
    const pairA = a.split(';')[0]!;
    const pairB = b.split(';')[0]!;
    expect(pairA).not.toBe(pairB);
    expect(pairA.split('=')[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await row(pairA);
    expect(stored).toBeDefined();
    expect(stored!.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const session = await app.request('/control/v1/session', { headers: { cookie: pairA } });
    expect(session.status).toBe(200);
    expect(session.headers.get('set-cookie')).toContain(pairA);
  });

  test('logout revokes the session server-side; other devices stay signed in', async () => {
    const a = (await login('ctl-secret')).headers.get('set-cookie')!.split(';')[0]!;
    const b = (await login('ctl-secret')).headers.get('set-cookie')!.split(';')[0]!;
    const out = await app.request('/control/v1/logout', {
      method: 'POST',
      headers: { cookie: a },
    });
    expect(out.status).toBe(200);
    expect((await row(a))!.revoked_at).not.toBeNull();
    expect((await app.request('/control/v1/session', { headers: { cookie: a } })).status).toBe(404);
    expect((await app.request('/control/v1/session', { headers: { cookie: b } })).status).toBe(200);
  });

  test('an expired session is rejected', async () => {
    const a = (await login('ctl-secret')).headers.get('set-cookie')!.split(';')[0]!;
    await sql.begin(async (tx) => {
      await tx`select set_config('vendua.control', '1', true)`;
      await tx`update control_sessions set expires_at = now() - interval '1 second'
               where token_hash = ${hashOf(a)}`;
    });
    expect((await app.request('/control/v1/session', { headers: { cookie: a } })).status).toBe(404);
  });
});
