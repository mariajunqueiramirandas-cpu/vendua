import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { Hono } from 'hono';
import { mountAgentRuntimeAi } from '../src/agent-host/control-ai.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { mediaProviders, phrasesHeader, type MediaRoute } from '../src/vendedor/media.ts';
import { migrate } from '../src/platform/db.ts';

// Voice-note transcription through the self-hosted STT sidecar (services/stt, ADR 0037).
describe.skipIf(!process.env.TEST_DATABASE_URL)('media transcribe via sidecar (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const KEY = 'agent_runtime.media_routes';
  const seen: {
    auth: string | null;
    type: string | null;
    bytes: number;
    phrases?: string | null;
  }[] = [];
  let reply: () => Response = () => Response.json({ text: ' oi, tem pizza? ', confidence: 0.93 });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/healthz')
        return Response.json({ ok: true, queue: 0, model: 'parakeet-tdt-0.6b-v3' });
      seen.push({
        auth: req.headers.get('authorization'),
        type: req.headers.get('content-type'),
        bytes: (await req.arrayBuffer()).byteLength,
        ...(req.headers.has('x-stt-phrases') ? { phrases: req.headers.get('x-stt-phrases') } : {}),
      });
      return reply();
    },
  });
  const env = { STT_URL: `http://127.0.0.1:${server.port}/`, STT_SECRET: 's3cret' };
  const audio = new Uint8Array([1, 2, 3, 4]);
  let prior: unknown;

  const setRoutes = async (value: { transcribe?: MediaRoute[] } | null) => {
    await sql`delete from control_settings where key = ${KEY}`;
    if (value)
      await sql`insert into control_settings (key, value) values (${KEY}, ${sql.json(value as never)})`;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    prior = (
      await sql<{ value: unknown }[]>`select value from control_settings where key = ${KEY}`
    )[0]?.value;
  });
  afterAll(async () => {
    await setRoutes((prior as never) ?? null);
    server.stop(true);
    await sql.end();
  });

  test('no transcribe route: the configured sidecar is the default', async () => {
    await setRoutes(null);
    seen.length = 0;
    const t = await mediaProviders(sql, env).transcribe(audio, 'audio/ogg; codecs=opus');
    expect(t).toEqual({ text: 'oi, tem pizza?', confidence: 0.93, language: null });
    expect(seen).toEqual([{ auth: 'Bearer s3cret', type: 'audio/ogg; codecs=opus', bytes: 4 }]);
  });

  test('staff routes win: a cloud-only list never reaches the sidecar', async () => {
    await setRoutes({ transcribe: [{ provider: 'openai', model: 'whisper-1', zdr: false }] });
    seen.length = 0;
    // no OPENAI_API_KEY in this env, so the only route is skipped
    expect(await mediaProviders(sql, env).transcribe(audio, 'audio/ogg')).toBeNull();
    expect(seen).toHaveLength(0);
  });

  test('an explicit sidecar route, and its failure falls through to null', async () => {
    await setRoutes({
      transcribe: [{ provider: 'sidecar', model: 'parakeet-tdt-0.6b-v3', zdr: true }],
    });
    expect((await mediaProviders(sql, env).transcribe(audio, 'audio/ogg'))?.text).toBe(
      'oi, tem pizza?',
    );
    reply = () => Response.json({ error: 'overloaded' }, { status: 503 });
    expect(await mediaProviders(sql, env).transcribe(audio, 'audio/ogg')).toBeNull();
  });

  test('the store catalog goes along as phrases to boost', async () => {
    await setRoutes(null);
    seen.length = 0;
    reply = () => Response.json({ text: 'uma pizza de catupiry', confidence: 0.9 });
    await mediaProviders(sql, env).transcribe(audio, 'audio/ogg', {
      phrases: ['Pizza de Catupiry', '  Açaí   500 ml ', 'Pizza de Catupiry', 'x'.repeat(81)],
    });
    expect(JSON.parse(decodeURIComponent(seen[0]!.phrases!))).toEqual([
      'Pizza de Catupiry',
      'Açaí 500 ml',
    ]);
    // ASCII only: header values can't carry raw UTF-8
    expect(seen[0]!.phrases).toMatch(/^[\x20-\x7e]+$/);
    expect(phrasesHeader([])).toBeNull();
    expect(
      JSON.parse(
        decodeURIComponent(phrasesHeader(Array.from({ length: 400 }, (_, i) => `p${i}`))!),
      ),
    ).toHaveLength(300);
    // long non-ASCII names: the header is capped, phrases dropped from the end
    const big = phrasesHeader(Array.from({ length: 300 }, (_, i) => `${i} ${'ã'.repeat(70)}`))!;
    expect(big.length).toBeLessThanOrEqual(16_384);
    expect(JSON.parse(decodeURIComponent(big)).length).toBeGreaterThan(10);
  });

  test('without STT_SECRET the sidecar is off', async () => {
    await setRoutes(null);
    seen.length = 0;
    expect(
      await mediaProviders(sql, { STT_URL: env.STT_URL }).transcribe(audio, 'audio/ogg'),
    ).toBeNull();
    expect(seen).toHaveLength(0);
  });

  test('CRM: the voice routes, the sidecar state and the cloud keys (never their values)', async () => {
    await setRoutes({ transcribe: [SIDECAR] });
    const view = async (e: Record<string, string>) => {
      const h = new Hono();
      mountAgentRuntimeAi({ app: h, sql, controlGate: () => {}, env: e });
      const text = await (await h.request('http://core.localhost/control/v1/ai/voice')).text();
      expect(text).not.toContain('sk-secret');
      return JSON.parse(text);
    };
    expect(await view({ ...env, OPENAI_API_KEY: 'sk-secret' })).toEqual({
      routes: { transcribe: [SIDECAR] },
      saved: true,
      sidecar: { configured: true, reachable: true, model: 'parakeet-tdt-0.6b-v3' },
      providers: [
        { id: 'openai', configured: true, secretName: 'OPENAI_API_KEY' },
        { id: 'elevenlabs', configured: false, secretName: 'ELEVENLABS_API_KEY' },
      ],
    });
    // configured but down: a closed port answers nothing
    const down = await view({ STT_URL: 'http://127.0.0.1:9', STT_SECRET: 's' });
    expect(down.sidecar).toEqual({ configured: true, reachable: false, model: null });
    await setRoutes(null);
    const off = await view({});
    expect(off).toMatchObject({ routes: {}, saved: false, sidecar: { configured: false } });
  });
});

const SIDECAR: MediaRoute = { provider: 'sidecar', model: 'parakeet-tdt-0.6b-v3', zdr: true };

describe('media routes, as the CRM saves them', () => {
  const field = (value: unknown) => {
    try {
      validateSetting('agent_runtime.media_routes', value);
      return null;
    } catch (e) {
      return (e as { details?: { field?: string } }).details?.field ?? String(e);
    }
  };

  test('valid lists pass', () => {
    expect(field({})).toBeNull();
    expect(field({ transcribe: [] })).toBeNull();
    expect(
      field({
        transcribe: [SIDECAR, { provider: 'openai', model: 'gpt-4o-transcribe', zdr: false }],
        speak: [{ provider: 'elevenlabs', model: 'eleven_flash_v2_5', zdr: true, voice: 'abc123' }],
      }),
    ).toBeNull();
  });

  test('bad shapes name their field', () => {
    expect(field(null)).toBe('value');
    expect(field({ hear: [] })).toBe('hear');
    expect(field({ transcribe: SIDECAR })).toBe('transcribe');
    expect(field({ transcribe: Array.from({ length: 6 }, () => SIDECAR) })).toBe('transcribe');
    expect(field({ transcribe: [{ ...SIDECAR, provider: 'whisper' }] })).toBe(
      'transcribe.0.provider',
    );
    expect(field({ speak: [{ ...SIDECAR }] })).toBe('speak.0.provider');
    expect(field({ transcribe: [SIDECAR, { ...SIDECAR, model: '' }] })).toBe('transcribe.1.model');
    expect(field({ transcribe: [{ ...SIDECAR, model: 'a b' }] })).toBe('transcribe.0.model');
    expect(field({ transcribe: [{ ...SIDECAR, zdr: 'yes' }] })).toBe('transcribe.0.zdr');
    expect(field({ speak: [{ provider: 'elevenlabs', model: 'm', zdr: true }] })).toBe(
      'speak.0.voice',
    );
  });
});
