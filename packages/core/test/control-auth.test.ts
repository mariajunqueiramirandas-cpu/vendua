import { describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';

// login/session never query — a lazy postgres.js client stands in for AppDeps
const app = createApp({
  sql: postgres('postgres://localhost:1/vendua'),
  sessionSecret: 's',
  controlSecret: 'ctl-secret',
  autoDrain: false,
});

const login = (key: string) =>
  app.request('/control/v1/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });

describe('control session cookie', () => {
  test('wrong key → 404, no cookie', async () => {
    const res = await login('nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('login sets a long-lived httpOnly cookie that /session renews', async () => {
    const res = await login('ctl-secret');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/control');
    expect(Number(/Max-Age=(\d+)/.exec(cookie)?.[1])).toBeGreaterThanOrEqual(60 * 60 * 24 * 365);

    const pair = cookie.split(';')[0]!;
    const session = await app.request('/control/v1/session', { headers: { cookie: pair } });
    expect(session.status).toBe(200);
    expect(session.headers.get('set-cookie')).toContain(pair);
  });

  test('header-authed /session does not mint a cookie', async () => {
    const res = await app.request('/control/v1/session', {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('stale cookie → 404', async () => {
    const res = await app.request('/control/v1/session', {
      headers: { cookie: 'vendua_control=forged' },
    });
    expect(res.status).toBe(404);
  });
});
