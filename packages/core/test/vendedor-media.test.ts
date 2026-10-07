import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
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
});
