import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { RESET_KEY, RESET_STALE_MS, resetIfRequested } from '../src/modules/instance-reset.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { migrate } from '../src/platform/db.ts';

// Wiping a test instance from the CRM: the route only leaves a request and restarts Core; the
// entrypoint's half drops and recreates the database. Its tests use scratch databases of their
// own, never vendua_test.

test('the generic settings route cannot write the reset request', () => {
  expect(() => validateSetting(RESET_KEY, { requestedAt: new Date().toISOString() })).toThrow(
    'is not a setting',
  );
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('instance reset (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const scratch: string[] = [];
  const urlOf = (name: string) => {
    const u = new URL(process.env.TEST_DATABASE_URL!);
    u.pathname = `/${name}`;
    return u.toString();
  };
  const fresh = async (marker: string | null) => {
    const name = `vendua_reset_${crypto.randomUUID().slice(0, 8)}`;
    scratch.push(name);
    await sql.unsafe(`create database "${name}"`);
    const db = postgres(urlOf(name), { onnotice: () => {}, max: 1 });
    try {
      await db`create table control_settings (key text primary key, value jsonb not null)`;
      await db`create table leftovers (id int)`;
      if (marker)
        await db`insert into control_settings values (${RESET_KEY}, ${db.json({ requestedAt: marker })})`;
    } finally {
      await db.end();
    }
    return name;
  };
  const tables = async (name: string) => {
    const db = postgres(urlOf(name), { onnotice: () => {}, max: 1 });
    try {
      return (
        await db<{ t: string }[]>`
          select table_name as t from information_schema.tables
          where table_schema = 'public' order by 1`
      ).map((r) => r.t);
    } finally {
      await db.end();
    }
  };

  const restarts: number[] = [];
  const deps = { sql, sessionSecret: 'x'.repeat(32), controlSecret: 'ctl' };
  const on = createApp({ ...deps, allowReset: true, onResetRequested: () => restarts.push(1) });
  const off = createApp(deps);
  const call = async (
    app: typeof on,
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        'x-vendua-control': 'ctl',
        'content-type': 'application/json',
        ...(method !== 'GET' ? { 'idempotency-key': key ?? crypto.randomUUID() } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  afterAll(async () => {
    await sql`delete from control_settings where key = ${RESET_KEY}`;
    for (const n of scratch) await sql.unsafe(`drop database if exists "${n}" with (force)`);
    await sql.end();
  });

  test('off unless VENDUA_ALLOW_RESET=1: the CRM is told, and nothing is written', async () => {
    expect((await call(off, 'GET', '/control/v1/instance')).body.resetEnabled).toBe(false);
    const r = await call(off, 'POST', '/control/v1/instance/reset', { confirm: 'resetar' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('RESET_DISABLED');
    expect((await sql`select 1 from control_settings where key = ${RESET_KEY}`).length).toBe(0);
  });

  test('needs the typed word; then it records the request once and restarts once', async () => {
    const wrong = await call(on, 'POST', '/control/v1/instance/reset', { confirm: 'sim' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('CONFIRM_MISMATCH');
    expect((await call(on, 'POST', '/control/v1/instance/reset', {})).status).toBe(422);
    expect(restarts.length).toBe(0);

    const key = crypto.randomUUID();
    const r = await call(on, 'POST', '/control/v1/instance/reset', { confirm: ' Resetar ' }, key);
    expect(r.status).toBe(202);
    expect(restarts.length).toBe(1);
    const again = await call(on, 'POST', '/control/v1/instance/reset', { confirm: 'resetar' }, key);
    expect(again.body.requestedAt).toBe(r.body.requestedAt);
    expect(restarts.length).toBe(1);
    const status = await call(on, 'GET', '/control/v1/instance');
    expect(status.body).toEqual({ resetEnabled: true, resetRequestedAt: r.body.requestedAt });
  });

  test('a fresh request drops and recreates the database', async () => {
    const name = await fresh(new Date().toISOString());
    expect(await resetIfRequested(urlOf(name))).toBe('reset');
    expect(await tables(name)).toEqual([]);
  });

  test('no request, or a stale one, wipes nothing (a stale one is dropped)', async () => {
    const none = await fresh(null);
    expect(await resetIfRequested(urlOf(none))).toBe('none');
    expect(await tables(none)).toEqual(['control_settings', 'leftovers']);

    const old = new Date(Date.now() - RESET_STALE_MS - 60_000).toISOString();
    const stale = await fresh(old);
    expect(await resetIfRequested(urlOf(stale))).toBe('stale');
    expect(await tables(stale)).toEqual(['control_settings', 'leftovers']);
    expect(await resetIfRequested(urlOf(stale))).toBe('none');
  });

  test('a reset cut off after its drop is finished on the next boot', async () => {
    const name = `vendua_reset_${crypto.randomUUID().slice(0, 8)}`;
    scratch.push(name);
    expect(await resetIfRequested(urlOf(name))).toBe('reset');
    expect(await tables(name)).toEqual([]);
  });
});
