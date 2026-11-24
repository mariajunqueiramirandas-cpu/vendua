import { describe, expect, test } from 'bun:test';
import { createGateway, ProviderError, type ModelRequest } from '@vendua/agent-runtime';
import { mistralAdapter, MISTRAL_PRIMARY_ROUTE } from '../src/agent-host/mistral.ts';
import { adaptersFromEnv, preferMistralPrimary, routesFrom } from '../src/agent-host/models.ts';

test('registers a direct Mistral adapter only with a Mistral key', () => {
  expect(adaptersFromEnv({})).toHaveLength(0);
  expect(adaptersFromEnv({ MISTRAL_API_KEY: 'test-mistral-key' }).map((a) => a.id)).toEqual([
    'mistral',
  ]);
});

test('promotes the Mistral primary once, keeps its chosen options and fallback order, and leaves Large 4 as a fallback', () => {
  const fallback = { provider: 'openrouter', model: 'mistralai/mistral-large-4-0', zdr: true };
  const chosen = {
    provider: 'mistral',
    model: MISTRAL_PRIMARY_ROUTE.model,
    zdr: true,
    timeoutMs: 30_000,
  };
  const largeFour = { provider: 'mistral', model: 'mistral-large-4-0', zdr: true };
  const claude = { provider: 'anthropic', model: 'claude-haiku-5-5', zdr: true };
  expect(
    preferMistralPrimary([fallback, largeFour, chosen, MISTRAL_PRIMARY_ROUTE, claude]),
  ).toEqual([{ ...MISTRAL_PRIMARY_ROUTE, ...chosen }, fallback, largeFour, claude]);
});

const shortRequest: ModelRequest = {
  tier: 'fast',
  meta: { tenantId: 't1', agentId: 'vendedor', actorId: 'a1', turnId: 'u1', lane: 'interactive' },
  system: [],
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'Answer yes or no' }] }],
  volatile: null,
  tools: [],
  maxTokens: 30,
};

test('adds reasoning tokens to the Mistral primary budget, without a reasoning_effort it does not document', async () => {
  const requests: unknown[] = [];
  const estimates: number[] = [];
  const adapter = mistralAdapter('test', async (_url, init) => {
    requests.push(JSON.parse(init.body as string));
    return Response.json({
      choices: [{ message: { content: [{ type: 'text', text: 'Yes' }] } }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 100,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    });
  });
  const gateway = createGateway({
    adapters: [adapter],
    routes: { routes: async () => [MISTRAL_PRIMARY_ROUTE] },
  });
  const meter = {
    before: (e: { maxOutputTokens: number }) => {
      estimates.push(e.maxOutputTokens);
    },
    after: () => {},
  };
  const result = await gateway.generate(shortRequest, { meter });
  await gateway.generate({ ...shortRequest, maxTokens: 1200 }, { meter });
  await gateway.generate({ ...shortRequest, tier: 'strong', maxTokens: 4000 }, { meter });
  expect(requests).toMatchObject([
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 8222 },
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 17584 },
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 36768 },
  ]);
  for (const body of requests) expect(body).not.toHaveProperty('reasoning_effort');
  expect(estimates).toEqual([8222, 17584, 36768]);
  // 100 uncached input at 0.3, 100 cached at 0.007, 100 output at 1.2 (per million)
  expect(result.usage.costUsd).toBeCloseTo(0.0001507, 9);
});

test('Large 4, if staff still route to it, keeps its reasoning_effort and headroom', async () => {
  const requests: Record<string, unknown>[] = [];
  const adapter = mistralAdapter('test', async (_url, init) => {
    requests.push(JSON.parse(init.body as string));
    return Response.json({ choices: [{ message: { content: 'Yes' } }] });
  });
  const gateway = createGateway({
    adapters: [adapter],
    routes: {
      routes: async () => [{ provider: 'mistral', model: 'mistral-large-4-0', zdr: true }],
    },
  });
  await gateway.generate({ ...shortRequest, maxTokens: 1200 });
  expect(requests).toMatchObject([
    { model: 'mistral-large-4-0', max_tokens: 17584, reasoning_effort: 'medium' },
  ]);
});

test('counts the bill for a reasoning-only response and lets the gateway fall back', async () => {
  const adapter = mistralAdapter('test', async () =>
    Response.json({
      choices: [
        { finish_reason: 'length', message: { content: [{ type: 'thinking', thinking: [] }] } },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 8222 },
    }),
  );
  await expect(
    adapter.generate(
      { ...shortRequest, model: MISTRAL_PRIMARY_ROUTE.model },
      new AbortController().signal,
    ),
  ).rejects.toBeInstanceOf(ProviderError);
  const gateway = createGateway({
    adapters: [
      adapter,
      {
        id: 'fallback',
        async generate(req) {
          return {
            provider: 'fallback',
            model: req.model,
            text: 'Yes',
            toolCalls: [],
            finish: 'stop',
            latencyMs: 0,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
            },
          };
        },
      },
    ],
    routes: {
      routes: async () => [
        MISTRAL_PRIMARY_ROUTE,
        { provider: 'fallback', model: 'backup', zdr: true },
      ],
    },
  });
  const result = await gateway.generate(shortRequest);
  expect(result).toMatchObject({ provider: 'fallback', text: 'Yes' });
  // the failed call's bill: 200 input at 0.3 + 8,222 output at 1.2, per million
  expect(result.usage.costUsd).toBeCloseTo(0.0099264, 9);
});

describe('routesFrom', () => {
  test('a route must say whether it wants zero retention (AGENT_MODEL_ROUTES skips validation)', () => {
    const setting = {
      default: {
        fast: [
          { provider: 'openrouter', model: 'a/one', zdr: true },
          { provider: 'openrouter', model: 'a/two', zdr: false },
          { provider: 'openrouter', model: 'a/three' },
          { provider: 'openrouter', model: 'a/four', zdr: 'true' },
        ],
      },
    } as never;
    expect(routesFrom(setting, 't', 'vendedor', 'fast').map((r) => r.model)).toEqual([
      'a/one',
      'a/two',
    ]);
  });

  test('anthropic routes run and price claude-haiku-5-5; effort only where it is valid', () => {
    const setting = {
      default: {
        fast: [
          {
            provider: 'anthropic',
            model: 'claude-opus-5',
            zdr: true,
            effort: 'high',
            pricing: { inputPerMTok: 5, outputPerMTok: 25 },
          },
          { provider: 'anthropic', model: 'claude-haiku-5-5', zdr: true, effort: 'huge' },
          { provider: 'openrouter', model: 'a/one', zdr: true, effort: 'high' },
        ],
      },
    } as never;
    expect(routesFrom(setting, 't', 'vendedor', 'fast')).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        zdr: true,
        effort: 'high',
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
      },
      {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        zdr: true,
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
      },
      { provider: 'openrouter', model: 'a/one', zdr: true },
    ]);
  });
});
