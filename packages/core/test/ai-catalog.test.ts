import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mountAgentRuntimeAi } from '../src/agent-host/control-ai.ts';
import {
  catalogFrom,
  createModelCatalog,
  directFor,
  providerIds,
} from '../src/agent-host/model-catalog.ts';
import type { Sql } from '../src/platform/db.ts';
import { HttpError } from '../src/platform/http.ts';

// GET /control/v1/ai/catalog: OpenRouter's models and ZDR endpoints, plus each model's id on its
// maker's own API, as the CRM's model picker. No network: every fetch here is a stub.

const TOOLS = ['tools', 'tool_choice', 'temperature'];
const model = (over: Record<string, unknown> = {}) => ({
  id: 'acme/fast-1',
  name: 'Acme: Fast 1',
  context_length: 128_000,
  pricing: { prompt: '0.0000005', completion: '0.0000015' },
  supported_parameters: TOOLS,
  ...over,
});
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

const MODELS = 'https://openrouter.ai/api/v1/models';
const ZDR = 'https://openrouter.ai/api/v1/endpoints/zdr';
const ANTHROPIC = 'https://api.anthropic.com/v1/models?limit=1000';
const OPENAI = 'https://api.openai.com/v1/models';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';

type Reply = () => Response | Promise<Response>;
/** answers each URL from its own queue (the last reply repeats) and records every call */
function stub(routes: Record<string, Reply[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const seen = new Map<string, number>();
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: { ...(init?.headers as Record<string, string>) } });
    const queue = routes[u];
    if (!queue) return new Response('not found', { status: 404 });
    const i = seen.get(u) ?? 0;
    seen.set(u, i + 1);
    return queue[Math.min(i, queue.length - 1)]!();
  }) as unknown as typeof fetch;
  return { f, calls, urls: () => calls.map((c) => c.url) };
}
const ok = (b: unknown) => () => Response.json(b);
const down = () => () => new Response('bad gateway', { status: 502 });
const openrouter = (models: unknown[], zdr: unknown[] = [ep()]) => ({
  [MODELS]: [ok(body(models))],
  [ZDR]: [ok(body(zdr))],
});

describe('catalogFrom', () => {
  test('merges /models (default prices) with /endpoints/zdr (dearest ZDR endpoint)', () => {
    const out = catalogFrom(
      body([
        model({ pricing: { prompt: '0.0000005', completion: '0.0000015', input_cache_read: '0' } }),
        model({ id: 'zeta/z', name: 'Zeta: Z', context_length: null }),
      ]),
      body([
        ep(),
        ep({
          provider_name: 'P2',
          pricing: { prompt: '0.000001', completion: '0.0000015', input_cache_write: '0.00000125' },
        }),
        // an endpoint without tool calls isn't counted
        ep({ provider_name: 'P3', supported_parameters: ['temperature'] }),
      ]),
    );
    expect(out).toEqual([
      {
        id: 'acme/fast-1',
        name: 'Acme: Fast 1',
        contextLength: 128_000,
        pricing: { inputPerMTok: 0.5, outputPerMTok: 1.5, cacheReadPerMTok: 0 },
        zdr: {
          providers: 2,
          pricing: {
            inputPerMTok: 1,
            outputPerMTok: 2,
            cacheReadPerMTok: 0.08,
            cacheWritePerMTok: 1.25,
          },
        },
        direct: null,
      },
      {
        id: 'zeta/z',
        name: 'Zeta: Z',
        contextLength: null,
        pricing: { inputPerMTok: 0.5, outputPerMTok: 1.5 },
        zdr: null,
        direct: null,
      },
    ]);
  });

  test('zdr is null for a model with an unpriceable ZDR endpoint', () => {
    const out = catalogFrom(
      body([model()]),
      body([ep(), ep({ provider_name: 'P2', pricing: { prompt: '-1', completion: '-1' } })]),
    );
    expect(out[0]!.zdr).toBeNull();
    expect(out[0]!.pricing).toEqual({ inputPerMTok: 0.5, outputPerMTok: 1.5 });
  });

  test('drops models without tool calls, unusable prices and ids validateSetting refuses', () => {
    const out = catalogFrom(
      body([
        model({ id: 'no/tools', supported_parameters: ['temperature'] }),
        model({ id: 'no/params', supported_parameters: undefined }),
        model({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }),
        model({ id: 'too/dear', pricing: { prompt: '0.002', completion: '0.002' } }),
        model({ id: 'no/price', pricing: {} }),
        model({ id: 'bad id!' }),
        model({ id: 'x'.repeat(201) }),
        model({ id: 'free/one:free', name: '' }),
        'garbage',
        null,
      ]),
      body([]),
    );
    expect(out.map((m) => [m.id, m.name])).toEqual([['free/one:free', 'free/one:free']]);
    expect(catalogFrom({}, {})).toEqual([]);
    expect(catalogFrom(null, null)).toEqual([]);
  });

  test('sorted by name', () => {
    const out = catalogFrom(
      body([
        model({ id: 'b/b', name: 'Beta' }),
        model({ id: 'a/a', name: 'alpha' }),
        model({ id: 'c/c', name: 'Gamma' }),
      ]),
      body([]),
    );
    expect(out.map((m) => m.id)).toEqual(['a/a', 'b/b', 'c/c']);
  });
});

describe('direct ids', () => {
  test('maps the three makers, skips variants and others', () => {
    expect(directFor('anthropic/claude-haiku-4.5')).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
    expect(directFor('anthropic/claude-3.7-sonnet')).toEqual({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
    });
    expect(directFor('openai/gpt-5-mini')).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
    expect(directFor('openai/gpt-4.1')).toEqual({ provider: 'openai', model: 'gpt-4.1' });
    expect(directFor('google/gemini-2.5-pro')).toEqual({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    });
    for (const id of [
      'anthropic/claude-3.7-sonnet:thinking',
      'openai/gpt-4o:extended',
      'google/gemini-2.0-flash-exp:free',
      'openai/gpt-oss-120b',
      'google/gemma-3-27b-it',
      'meta-llama/llama-3.3-70b-instruct',
      'acme/fast-1',
      'openai',
    ])
      expect({ id, d: directFor(id) }).toEqual({ id, d: null });
  });

  test('provider lists: ids, with Gemini ids unwrapped', () => {
    expect([...providerIds('anthropic', body([{ id: 'claude-x' }, { id: 'a b' }, 1]))]).toEqual([
      'claude-x',
    ]);
    expect([...providerIds('openai', body([{ id: 'gpt-5' }]))]).toEqual(['gpt-5']);
    expect([
      ...providerIds('gemini', { models: [{ name: 'models/gemini-2.5-pro' }, { name: 7 }] }),
    ]).toEqual(['gemini-2.5-pro']);
    expect(providerIds('gemini', null).size).toBe(0);
  });

  test('verified against a loaded list; absent from it → no direct route', () => {
    const models = body([
      model({ id: 'anthropic/claude-haiku-4.5', name: 'A' }),
      model({ id: 'anthropic/claude-3.7-sonnet', name: 'B' }),
      model({ id: 'openai/gpt-5-mini', name: 'C' }),
      model({ id: 'openai/gpt-4o-mini-search-preview', name: 'D' }),
      model({ id: 'google/gemini-2.5-pro', name: 'E' }),
    ]);
    const lists = {
      anthropic: new Set([
        'claude-haiku-4-5',
        'claude-3-7-sonnet-20250101',
        'claude-3-7-sonnet-20250219',
      ]),
      openai: new Set(['gpt-5-mini']),
    };
    const direct = Object.fromEntries(
      catalogFrom(models, body([]), lists).map((m) => [m.id, m.direct]),
    );
    expect(direct).toEqual({
      'anthropic/claude-haiku-4.5': {
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        verified: true,
      },
      // Anthropic lists dated snapshots: the latest stands in for the alias
      'anthropic/claude-3.7-sonnet': {
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
        verified: true,
      },
      'openai/gpt-5-mini': { provider: 'openai', model: 'gpt-5-mini', verified: true },
      'openai/gpt-4o-mini-search-preview': null,
      // no Gemini list: kept, unverified
      'google/gemini-2.5-pro': { provider: 'gemini', model: 'gemini-2.5-pro', verified: false },
    });
  });
});

describe('createModelCatalog', () => {
  test('caches an hour, then serves the stale copy while it refreshes', async () => {
    let t = 1_000_000;
    const s = stub({
      [MODELS]: [ok(body([model()])), ok(body([model({ id: 'acme/fast-2' })]))],
      [ZDR]: [ok(body([ep()]))],
    });
    const cat = createModelCatalog({ fetch: s.f, now: () => t, env: {} });
    const a = await cat.get();
    expect(a?.models.map((m) => m.id)).toEqual(['acme/fast-1']);
    expect(a?.models[0]!.zdr?.providers).toBe(1);
    expect(a?.source).toBe('openrouter');
    expect(a?.fetchedAt).toBe(new Date(1_000_000).toISOString());
    t += 59 * 60_000;
    await cat.get();
    expect(s.calls).toHaveLength(2);
    t += 2 * 60_000;
    // past the hour: this answer is the old copy, the refresh lands for the next one
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-1');
    await Bun.sleep(5);
    expect((await cat.get())?.models[0]!.id).toBe('acme/fast-2');
    expect(s.urls().sort()).toEqual([MODELS, MODELS, ZDR, ZDR].sort());
    // no keys: no provider is asked
    expect(s.calls.every((c) => c.url.startsWith('https://openrouter.ai/'))).toBe(true);
  });

  test('keeps the last good copy when OpenRouter fails, and waits a minute between tries', async () => {
    let t = 0;
    const s = stub({
      [MODELS]: [
        ok(body([model()])),
        down(),
        ok(body([model()])),
        ok(body([])),
        ok(body([model({ id: 'n/n' })])),
      ],
      [ZDR]: [ok(body([ep()])), ok(body([ep()])), down(), ok(body([ep()]))],
    });
    const cat = createModelCatalog({ fetch: s.f, now: () => t, env: {} });
    await cat.get();
    const step = async () => {
      await cat.get();
      await Bun.sleep(5);
      return (await cat.get())?.models[0]!.id;
    };
    t += 61 * 60_000;
    expect(await step()).toBe('acme/fast-1'); // /models down
    expect(s.calls).toHaveLength(4);
    t += 61_000;
    expect(await step()).toBe('acme/fast-1'); // /endpoints/zdr down
    t += 61_000;
    expect(await step()).toBe('acme/fast-1'); // an empty model list is a failure too
    t += 61_000;
    expect(await step()).toBe('n/n');
    expect(s.calls).toHaveLength(10);
  });

  test('an empty ZDR list is a failure, not "nothing is ZDR"', async () => {
    const cat = createModelCatalog({ fetch: stub(openrouter([model()], [])).f, env: {} });
    expect(await cat.get()).toBeNull();
  });

  test('null until a fetch succeeds; concurrent first loads share one fetch', async () => {
    let t = 0;
    const s = stub({
      [MODELS]: [
        () => {
          throw new Error('ECONNREFUSED');
        },
        ok(body([model()])),
      ],
      [ZDR]: [ok(body([ep()]))],
    });
    const cat = createModelCatalog({ fetch: s.f, now: () => t, env: {} });
    expect(await cat.get()).toBeNull();
    expect(await cat.get()).toBeNull();
    expect(s.urls().filter((u) => u === MODELS)).toHaveLength(1);
    t += 61_000;
    const [a, b] = await Promise.all([cat.get(), cat.get()]);
    expect(a?.models).toHaveLength(1);
    expect(b).toBe(a);
    expect(s.urls().filter((u) => u === MODELS)).toHaveLength(2);
  });

  test('a body that is too large or not JSON is a failure', async () => {
    const big = () =>
      new Response('{}', { headers: { 'content-length': String(64 * 1024 * 1024) } });
    const zdr = [ok(body([ep()]))];
    const cat = createModelCatalog({ fetch: stub({ [MODELS]: [big], [ZDR]: zdr }).f, env: {} });
    expect(await cat.get()).toBeNull();
    const html = () => new Response('<html>');
    const cat2 = createModelCatalog({ fetch: stub({ [MODELS]: [html], [ZDR]: zdr }).f, env: {} });
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
    const cat3 = createModelCatalog({
      fetch: stub({ [MODELS]: [ok(body([model()]))], [ZDR]: [endless] }).f,
      env: {},
    });
    expect(await cat3.get()).toBeNull();
  });

  const KEYS = { ANTHROPIC_API_KEY: 'sk-ant-1', OPENAI_API_KEY: 'sk-oa-2', GEMINI_API_KEY: 'g-3' };
  const DIRECT_MODELS = [
    model({ id: 'anthropic/claude-haiku-4.5', name: 'A' }),
    model({ id: 'openai/gpt-5-mini', name: 'B' }),
    model({ id: 'google/gemini-2.5-pro', name: 'C' }),
    model({ id: 'google/gemini-9-gone', name: 'D' }),
  ];

  test('verifies direct ids with each keyed provider, each key only to its own host', async () => {
    const s = stub({
      ...openrouter(DIRECT_MODELS),
      [ANTHROPIC]: [ok(body([{ id: 'claude-haiku-4-5' }]))],
      [OPENAI]: [ok(body([{ id: 'gpt-5-mini' }]))],
      [GEMINI]: [ok({ models: [{ name: 'models/gemini-2.5-pro' }] })],
    });
    const view = await createModelCatalog({ fetch: s.f, env: KEYS }).get();
    expect(view?.models.map((m) => m.direct)).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5', verified: true },
      { provider: 'openai', model: 'gpt-5-mini', verified: true },
      { provider: 'gemini', model: 'gemini-2.5-pro', verified: true },
      null,
    ]);
    const byUrl = Object.fromEntries(s.calls.map((c) => [c.url, c.headers]));
    expect(byUrl[ANTHROPIC]).toMatchObject({
      'x-api-key': 'sk-ant-1',
      'anthropic-version': '2023-06-01',
    });
    expect(byUrl[OPENAI]).toMatchObject({ authorization: 'Bearer sk-oa-2' });
    expect(byUrl[GEMINI]).toMatchObject({ 'x-goog-api-key': 'g-3' });
    for (const { url, headers } of s.calls) {
      const sent = url + JSON.stringify(headers);
      for (const [name, key] of Object.entries(KEYS)) {
        const own = {
          ANTHROPIC_API_KEY: ANTHROPIC,
          OPENAI_API_KEY: OPENAI,
          GEMINI_API_KEY: GEMINI,
        };
        expect({ url, name, leaked: sent.includes(key) }).toEqual({
          url,
          name,
          leaked: url === own[name as keyof typeof own],
        });
      }
    }
  });

  test('a provider list that fails (or is empty) leaves its ids unverified, never the catalog down', async () => {
    const s = stub({
      ...openrouter(DIRECT_MODELS),
      [ANTHROPIC]: [down()],
      [OPENAI]: [ok(body([]))],
      [GEMINI]: [
        () => {
          throw new Error('ECONNRESET');
        },
      ],
    });
    const view = await createModelCatalog({ fetch: s.f, env: KEYS }).get();
    expect(view?.models.map((m) => m.direct)).toEqual([
      { provider: 'anthropic', model: 'claude-haiku-4-5', verified: false },
      { provider: 'openai', model: 'gpt-5-mini', verified: false },
      { provider: 'gemini', model: 'gemini-2.5-pro', verified: false },
      { provider: 'gemini', model: 'gemini-9-gone', verified: false },
    ]);
  });

  test("a provider's last good list outlives one failed refresh", async () => {
    let t = 0;
    const s = stub({
      ...openrouter(DIRECT_MODELS),
      [OPENAI]: [ok(body([{ id: 'gpt-5-mini' }])), down()],
    });
    const cat = createModelCatalog({ fetch: s.f, now: () => t, env: { OPENAI_API_KEY: 'k' } });
    await cat.get();
    t += 61 * 60_000;
    await cat.get();
    await Bun.sleep(5);
    const view = await cat.get();
    expect(view?.fetchedAt).toBe(new Date(t).toISOString());
    expect(view?.models[1]!.direct).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
      verified: true,
    });
    expect(s.urls().filter((u) => u === OPENAI)).toHaveLength(2);
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
      catalog: createModelCatalog({ fetch: f, env: {} }),
    });
    return h;
  };

  test('returns the catalog', async () => {
    const res = await app(stub(openrouter([model()])).f).request(
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
        pricing: { inputPerMTok: 0.5, outputPerMTok: 1.5 },
        zdr: {
          providers: 1,
          pricing: { inputPerMTok: 0.8, outputPerMTok: 2, cacheReadPerMTok: 0.08 },
        },
        direct: null,
      },
    ]);
    expect(typeof j.fetchedAt).toBe('string');
  });

  test('503 CATALOG_UNAVAILABLE when it never loaded', async () => {
    const res = await app(stub({ [MODELS]: [down()], [ZDR]: [down()] }).f).request(
      'http://core.localhost/control/v1/ai/catalog',
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('CATALOG_UNAVAILABLE');
  });

  test('behind the control gate', async () => {
    const s = stub(openrouter([model()]));
    const res = await app(s.f, () => {
      throw new HttpError(401, 'UNAUTHORIZED', 'no');
    }).request('http://core.localhost/control/v1/ai/catalog');
    expect(res.status).toBe(401);
    expect(s.calls).toHaveLength(0);
  });

  test('the default catalog reads provider keys from the mounted env', async () => {
    const realFetch = globalThis.fetch;
    const s = stub({
      ...openrouter([model({ id: 'openai/gpt-5-mini' })]),
      [OPENAI]: [ok(body([{ id: 'gpt-5-mini' }]))],
    });
    globalThis.fetch = s.f;
    try {
      const h = new Hono();
      mountAgentRuntimeAi({
        app: h,
        sql: null as unknown as Sql,
        controlGate: () => {},
        env: { OPENAI_API_KEY: 'k' },
      });
      const j = (await (
        await h.request('http://core.localhost/control/v1/ai/catalog')
      ).json()) as any;
      expect(j.models[0].direct).toEqual({
        provider: 'openai',
        model: 'gpt-5-mini',
        verified: true,
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
