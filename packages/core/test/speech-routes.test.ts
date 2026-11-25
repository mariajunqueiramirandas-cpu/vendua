import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import type { SpeakOptions } from '../src/vendedor/media.ts';
import { migrate, type Sql } from '../src/platform/db.ts';

// The store's spoken voice in the admin (ADR 0048): the voice picker's list and samples, and the
// kitchen's announcements in the store's voice.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

describe.skipIf(!OWNER_URL)('admin speech routes (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const codes = new Map<string, string>();
  const spoken: { text: string; opts: SpeakOptions | undefined }[] = [];
  let speaking = true;
  const tts = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        ok: true,
        model: 'phonon-40m-pt-balanced.fspeech',
        voice: 'rafaela',
        voices: [
          {
            id: 'rafaela',
            name: 'Rafaela',
            gender: 'female',
            age: 'young',
            description: 'Alegre.',
          },
          { id: 'kaua', name: 'Kauã', gender: 'male', age: 'young_adult', description: null },
        ],
      }),
  });
  const priorEnv = { url: process.env.TTS_URL, secret: process.env.TTS_SECRET };
  process.env.TTS_URL = `http://127.0.0.1:${tts.port}`;
  process.env.TTS_SECRET = 'speech-test';
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
    duaMedia: {
      media: {
        transcribe: async () => null,
        speak: async (text, opts) => {
          spoken.push({ text, opts });
          return speaking
            ? { bytes: new Uint8Array([73, 68, 51]), mime: 'audio/mpeg', seconds: 2 }
            : null;
        },
        canSpeak: async () => speaking,
      },
      gateway: null,
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  let idem = 0;
  let phones = 0;
  const phone = () => `23${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);
  let tenantId = '';
  let manager = '';
  let attendant = '';

  const request = async (method: string, path: string, cookie: string, body?: unknown) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        cookie,
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      headers: res.headers,
      body: (ct.includes('json')
        ? await res.json()
        : new Uint8Array(await res.arrayBuffer())) as any,
    };
  };

  async function signIn(p: string) {
    const start = await request('POST', '/auth/otp/start', '', { phone: p });
    expect(start.status).toBeLessThan(300);
    const res = await app.request('http://core.localhost/admin/v1/auth/otp/verify', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-${++idem}`,
        'x-vendua-admin': '1',
      },
      body: JSON.stringify({ phone: p, code: codes.get(p) }),
    });
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]!}`;
  }

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${`sp-${nonce}`}, 'Quero Pudim', 'pangolim')
      returning id`;
    tenantId = t!.id;
    await sql`insert into store_agent (tenant_id, enabled, settings)
      values (${tenantId}, false, ${sql.json({ speechVoice: 'davi' })})`;
    const managerPhone = phone();
    const attendantPhone = phone();
    await sql`insert into merchant_users (tenant_id, name, phone, role) values
      (${tenantId}, 'Gil', ${managerPhone}, 'manager'),
      (${tenantId}, 'Ana', ${attendantPhone}, 'attendant')`;
    manager = await signIn(managerPhone);
    attendant = await signIn(attendantPhone);
  });

  afterAll(async () => {
    await sql`delete from tenants where id = ${tenantId}`;
    process.env.TTS_URL = priorEnv.url;
    process.env.TTS_SECRET = priorEnv.secret;
    if (priorEnv.url === undefined) delete process.env.TTS_URL;
    if (priorEnv.secret === undefined) delete process.env.TTS_SECRET;
    tts.stop(true);
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test("the voice picker lists the sidecar's voices, for managers", async () => {
    const r = await request('GET', '/vendedor/voices', manager);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      available: true,
      default: 'rafaela',
      voices: [
        { id: 'rafaela', name: 'Rafaela', gender: 'female', age: 'young', description: 'Alegre.' },
        { id: 'kaua', name: 'Kauã', gender: 'male', age: 'young_adult', description: null },
      ],
    });
    expect((await request('GET', '/vendedor/voices', attendant)).status).toBe(403);
  });

  test("a sample is the store's own greeting in that voice, as MP3, made once", async () => {
    spoken.length = 0;
    const r = await request('GET', '/vendedor/voices/kaua/sample', manager);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(Array.from(r.body)).toEqual([73, 68, 51]);
    expect(spoken).toEqual([
      {
        text: 'Oi! Aqui é o Duá, assistente virtual da Quero Pudim. Como posso te ajudar hoje?',
        opts: { voice: 'kaua', format: 'mp3' },
      },
    ]);
    expect((await request('GET', '/vendedor/voices/kaua/sample', manager)).status).toBe(200);
    expect(spoken).toHaveLength(1);
    expect((await request('GET', '/vendedor/voices/Kau%C3%A3/sample', manager)).status).toBe(404);
  });

  test("kitchen announcements: the store's voice, bounded, never cached by the browser", async () => {
    spoken.length = 0;
    const r = await request('POST', '/speech', attendant, {
      text: 'Pedido 42. Pronto para retirada!',
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-speech-seconds')).toBe('2');
    expect(spoken).toEqual([
      { text: 'Pedido 42. Pronto para retirada!', opts: { voice: 'davi', format: 'mp3' } },
    ]);
    for (const text of ['', '   ', '😀 🎉', 'a'.repeat(301), 42])
      expect((await request('POST', '/speech', attendant, { text })).status).toBe(422);
    expect(spoken).toHaveLength(1);
  });

  test('no voice: a stable 503, and the screen falls back to the device', async () => {
    speaking = false;
    const r = await request('POST', '/speech', attendant, { text: 'Pedido 7 atrasado.' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('SPEECH_UNAVAILABLE');
    speaking = true;
  });
});
