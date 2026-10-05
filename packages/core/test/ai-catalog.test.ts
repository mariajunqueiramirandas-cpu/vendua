import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mountAgentRuntimeAi } from '../src/agent-host/control-ai.ts';
import { catalogFromZdr, createModelCatalog } from '../src/agent-host/model-catalog.ts';
import type { Sql } from '../src/platform/db.ts';
import { HttpError } from '../src/platform/http.ts';

// GET /control/v1/ai/catalog: OpenRouter's ZDR endpoints as the CRM's model picker. No network:
// every fetch here is a stub.

const TOOLS = ['tools', 'tool_choice', 'temperature'];
const ep = (over: Record<string, unknown> = {}) => ({
  model_id: 'acme/fast-1',
  model_name: 'Acme: Fast 1',
  provider_name: 'P1',
  context_length: 128_000,
  pricing: { prompt: '0.0000008', completion: '0.000002', input_cache_read: '0.00000008' },
  supported_parameters: TOOLS,
  ...over,
});
const body = (data: unknown[]) => ({ data });

function stub(responses: (() => Response | Promise<Response>)[]) {
  const calls: string[] = [];
  let i = 0;
  const f = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return r();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const ok = (b: unknown) => () => Response.json(b);
const down = () => () => new Response('bad gateway', { status: 502 });

describe('catalogFromZdr', () => {
  test('one entry per model, priced at its dearest ZDR endpoint, per 1M tokens', () => {
    const out = catalogFromZdr(
      body([
        ep(),
        ep({
          provider_name: 'P2',
          context_length: 200_000,
          pricing: { prompt: '0.000001', completion: '0.0000015', input_cache_write: '0.00000125' },
        }),
        ep({
          model_id: 'zeta/z',
          model_name: 'Zeta: Z',
          pricing: { prompt: '0', completion: '0' },
          context_length: null,
        }),
      ]),
    );
    expect(out).toEqual([
      {
        id: 'acme/fast-1',
        name: 'Acme: Fast 1',
        contextLength: 200_000,
        providers: 2,
        pricing: {
          inputPerMTok: 1,
          outputPerMTok: 2,
          cacheReadPerMTok: 0.08,
          cacheWritePerMTok: 1.25,
        },
      },
      {
        id: 'zeta/z',
        name: 'Zeta: Z',
        contextLength: null,
        providers: 1,
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
      },
    ]);
  });

  test('drops endpoints without tool calls, unusable prices and ids validateSetting refuses', () => {
    const out = catalogFromZdr(
      body([
        ep({ model_id: 'no/tools', supported_parameters: ['temperature'] }),
        ep({ model_id: 'no/params', supported_parameters: undefined }),
        ep({ model_id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }),
        ep({ model_id: 'too/dear', pricing: { prompt: '0.002', completion: '0.002' } }),
        ep({ model_id: 'no/price', pricing: {} }),
        ep({ model_id: 'bad id!' }),
        ep({ model_id: 'x'.repeat(201) }),
        ep({ model_id: 'free/one:free', model_name: '' }),
        'garbage',
        null,
      ]),
    );
    expect(out.map((m) => [m.id, m.name])).toEqual([['free/one:free', 'free/one:free']]);
    // a model counts only the endpoints that passed
    expect(catalogFromZdr(body([ep(), ep({ supported_parameters: [] })]))[0]!.providers).toBe(1);
    expect(catalogFromZdr({})).toEqual([]);
    expect(catalogFromZdr(null)).toEqual([]);
    // one ZDR endpoint OpenRouter could route to has no usable price: the dearest is unknown
    expect(
      catalogFromZdr(
        body([ep(), ep({ provider_name: 'P2', pricing: { prompt: '-1', completion: '-1' } })]),
      ),
    ).toEqual([]);
  });

  test('sorted by name', () => {
    const out = catalogFromZdr(
      body([
        ep({ model_id: 'b/b', model_name: 'Beta' }),
        ep({ model_id: 'a/a', model_name: 'alpha' }),
        ep({ model_id: 'c/c', model_name: 'Gamma' }),
      ]),
    );
    expect(out.map((m) => m.id)).toEqual(['a/a', 'b/b', 'c/c']);
  });
});

describe('createModelCatalog', () => {
  test('caches an hour, then serves the stale copy while it refreshes', async () => {
    let t = 1_000_000;
    const s = stub([ok(body([ep()])), ok(body([ep({ model_id: 'acme/fast-2' })]))]);
    const cat = createModelCatalog({ fetch: s.f, now: () => t });
    const a = await cat.get();
    expect(a?.models.map((m) => m.id)).toEqual(['acme/fast-1']);
    expect(a?.source).toBe('openrouter');
    expect(a?.fetchedAt).toBe(new Date(1_000_000).toISOString());
    t += 59 * 60_000;
    await cat.get();
    expect(s.calls).toHaveLength(1);
    t += 2 * 60_000;
    // past the hour: this answer is the old copy, the refresh lands for the next one
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-1');
    await Bun.sleep(5);
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-2');
    expect(s.calls).toEqual([
      'https://openrouter.ai/api/v1/endpoints/zdr',
      'https://openrouter.ai/api/v1/endpoints/zdr',
    ]);
  });

  test('keeps the last good copy when OpenRouter fails, and waits a minute between tries', async () => {
    let t = 0;
    const s = stub([ok(body([ep()])), down(), ok(body([])), ok(body([ep({ model_id: 'n/n' })]))]);
    const cat = createModelCatalog({ fetch: s.f, now: () => t });
    await cat.get();
    t += 61 * 60_000;
    await cat.get();
    await Bun.sleep(5);
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-1');
    expect(s.calls).toHaveLength(2);
    t += 61_000;
    await cat.get(); // an empty list is treated as a failure too
    await Bun.sleep(5);
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-1');
    t += 61_000;
    await cat.get();
    await Bun.sleep(5);
    expect((await cat.get())?.models[0]!.id).toBe('n/n');
    expect(s.calls).toHaveLength(4);
  });

  test('null until a fetch succeeds; concurrent first loads share one fetch', async () => {
    let t = 0;
    const s = stub([
      () => {
        throw new Error('ECONNREFUSED');
      },
      ok(body([ep()])),
    ]);
    const cat = createModelCatalog({ fetch: s.f, now: () => t });
    expect(await cat.get()).toBeNull();
    expect(await cat.get()).toBeNull();
    expect(s.calls).toHaveLength(1);
    t += 61_000;
    const [a, b] = await Promise.all([cat.get(), cat.get()]);
    expect(a?.models).toHaveLength(1);
    expect(b).toBe(a);
    expect(s.calls).toHaveLength(2);
  });

  test('a body that is too large or not JSON is a failure', async () => {
    const big = () =>
      new Response('{}', { headers: { 'content-length': String(64 * 1024 * 1024) } });
    const cat = createModelCatalog({ fetch: stub([big]).f, now: () => 0 });
    expect(await cat.get()).toBeNull();
    const cat2 = createModelCatalog({ fetch: stub([() => new Response('<html>')]).f });
    expect(await cat2.get()).toBeNull();
    // no content-length (chunked): the body is still cut off at the cap while it's read
    const endless = () =>
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(1024 * 1024).fill(32));
          },
        }),
      );
    const cat3 = createModelCatalog({ fetch: stub([endless]).f, now: () => 0 });
    expect(await cat3.get()).toBeNull();
  });
});

describe('GET /control/v1/ai/catalog', () => {
  const app = (f: typeof fetch, gate: () => void = () => {}) => {
    const h = new Hono();
    h.onError((e) =>
      e instanceof HttpError
        ? Response.json({ error: { code: e.code } }, { status: e.status })
        : Response.json({ error: { code: 'INTERNAL' } }, { status: 500 }),
    );
    mountAgentRuntimeAi({
      app: h,
      sql: null as unknown as Sql,
      controlGate: gate,
      env: {},
      catalog: createModelCatalog({ fetch: f }),
    });
    return h;
  };

  test('returns the catalog', async () => {
    const res = await app(stub([ok(body([ep()]))]).f).request(
      'http://core.localhost/control/v1/ai/catalog',
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.source).toBe('openrouter');
    expect(j.models).toEqual([
      {
        id: 'acme/fast-1',
        name: 'Acme: Fast 1',
        contextLength: 128_000,
        providers: 1,
        pricing: { inputPerMTok: 0.8, outputPerMTok: 2, cacheReadPerMTok: 0.08 },
      },
    ]);
    expect(typeof j.fetchedAt).toBe('string');
  });

  test('503 CATALOG_UNAVAILABLE when it never loaded', async () => {
    const res = await app(stub([down()]).f).request('http://core.localhost/control/v1/ai/catalog');
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('CATALOG_UNAVAILABLE');
  });

  test('behind the control gate', async () => {
    const s = stub([ok(body([ep()]))]);
    const res = await app(s.f, () => {
      throw new HttpError(401, 'UNAUTHORIZED', 'no');
    }).request('http://core.localhost/control/v1/ai/catalog');
    expect(res.status).toBe(401);
    expect(s.calls).toHaveLength(0);
  });
});
