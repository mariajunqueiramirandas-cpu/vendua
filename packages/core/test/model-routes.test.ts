import { describe, expect, test } from 'bun:test';
import { createGateway, ProviderError, type ModelRequest } from '@vendua/agent-runtime';
import { mistralAdapter, MISTRAL_PRIMARY_ROUTE } from '../src/agent-host/mistral.ts';
import { adaptersFromEnv, preferMistralLarge4, routesFrom } from '../src/agent-host/models.ts';

test('registers a direct Mistral adapter only with a Mistral key', () => {
  expect(adaptersFromEnv({})).toHaveLength(0);
  expect(adaptersFromEnv({ MISTRAL_API_KEY: 'test-mistral-key' }).map((a) => a.id)).toEqual([
    'mistral',
  ]);
});

test('promotes a configured Large 4 once and keeps the chosen route options and fallback order', () => {
  const fallback = { provider: 'openrouter', model: 'mistralai/mistral-large-4-0', zdr: true };
  const chosen = { provider: 'mistral', model: 'mistral-large-4-0', zdr: true, timeoutMs: 30_000 };
  const claude = { provider: 'anthropic', model: 'claude-haiku-5-5', zdr: true };
  expect(preferMistralLarge4([fallback, chosen, MISTRAL_PRIMARY_ROUTE, claude])).toEqual([
    { ...MISTRAL_PRIMARY_ROUTE, ...chosen },
    fallback,
    claude,
  ]);
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

test('adds Large 4 reasoning tokens to both the API request and the gateway budget estimate', async () => {
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
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 8222, reasoning_effort: 'low' },
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 17584, reasoning_effort: 'medium' },
    { model: MISTRAL_PRIMARY_ROUTE.model, max_tokens: 36768, reasoning_effort: 'high' },
  ]);
  expect(estimates).toEqual([8222, 17584, 36768]);
  expect(result.usage.costUsd).toBeCloseTo(0.000287, 9);
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
  expect(result.usage.costUsd).toBeCloseTo(0.0174062, 9);
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
