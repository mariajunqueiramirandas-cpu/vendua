import { describe, expect, test } from 'bun:test';
import type { ModelRequest, ModelResponse } from '../src/types.ts';
import {
  AllRoutesFailedError,
  BudgetExceededError,
  NoZdrRouteError,
  anthropicAdapter,
  createGateway,
  createPiiVault,
  openAiCompatibleAdapter,
  redactText,
  restoreText,
  scriptedAdapter,
  type CostEstimate,
  type FetchLike,
  type ModelRoute,
  type ProviderAdapter,
  type RouteResolver,
} from '../src/model/index.ts';
import type { Usage } from '../src/types.ts';

const resolver = (routes: ModelRoute[]): RouteResolver => ({ routes: async () => routes });
const route = (provider: string, extra: Partial<ModelRoute> = {}): ModelRoute => ({
  provider,
  model: `${provider}-m`,
  zdr: true,
  ...extra,
});

function request(over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    tier: 'fast',
    system: [{ id: 'base', tier: 'static', text: 'Você é a atendente.', cache: true }],
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
    volatile: 'AGORA: sexta 10h',
    tools: [{ name: 'search', description: 'busca', parameters: { type: 'object' } }],
    maxTokens: 500,
    meta: { tenantId: 't1', agentId: 'shop', actorId: 'a1', turnId: 'u1', lane: 'interactive' },
    ...over,
  };
}

const fastRetry = { retry: { baseMs: 1, maxMs: 1 } };

describe('routing', () => {
  test('refuses routes without zero data retention', async () => {
    const a = scriptedAdapter([{ text: 'x' }], 'a');
    const gw = createGateway({ adapters: [a], routes: resolver([route('a', { zdr: false })]) });
    await expect(gw.generate(request())).rejects.toBeInstanceOf(NoZdrRouteError);
    expect(a.requests).toHaveLength(0);
  });

  test('skips a non-zdr route and uses the next', async () => {
    const a = scriptedAdapter([{ text: 'from a' }], 'a');
    const b = scriptedAdapter([{ text: 'from b' }], 'b');
    const gw = createGateway({
      adapters: [a, b],
      routes: resolver([route('a', { zdr: false }), route('b')]),
    });
    const res = await gw.generate(request());
    expect(res.text).toBe('from b');
    expect(res.provider).toBe('b');
    expect(a.requests).toHaveLength(0);
    expect(b.requests[0]!.model).toBe('b-m');
    expect('meta' in b.requests[0]!).toBe(false);
  });

  test('retries a 500 once, then falls back', async () => {
    const a = scriptedAdapter(() => ({ error: { status: 500, message: 'boom' } }), 'a');
    const b = scriptedAdapter([{ text: 'ok' }], 'b');
    const gw = createGateway({
      adapters: [a, b],
      routes: resolver([route('a'), route('b')]),
      ...fastRetry,
    });
    const res = await gw.generate(request());
    expect(res.text).toBe('ok');
    expect(a.requests).toHaveLength(2);
  });

  test('a 400 falls back without a retry', async () => {
    const a = scriptedAdapter(() => ({ error: { status: 400, message: 'bad' } }), 'a');
    const b = scriptedAdapter([{ text: 'ok' }], 'b');
    const gw = createGateway({
      adapters: [a, b],
      routes: resolver([route('a'), route('b')]),
      ...fastRetry,
    });
    await gw.generate(request());
    expect(a.requests).toHaveLength(1);
  });

  test('all routes failing reports each failure', async () => {
    const a = scriptedAdapter(() => ({ error: { status: 503, message: 'down' } }), 'a');
    const gw = createGateway({ adapters: [a], routes: resolver([route('a')]), ...fastRetry });
    const err = await gw.generate(request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllRoutesFailedError);
    expect((err as AllRoutesFailedError).failures).toHaveLength(2);
    expect((err as AllRoutesFailedError).failures[0]!.status).toBe(503);
  });

  test('a route timeout is transient and falls back', async () => {
    const a = scriptedAdapter(() => ({ delayMs: 200, text: 'late' }), 'a');
    const b = scriptedAdapter([{ text: 'ok' }], 'b');
    const gw = createGateway({
      adapters: [a, b],
      routes: resolver([route('a', { timeoutMs: 20 }), route('b')]),
      ...fastRetry,
    });
    const t0 = Date.now();
    expect((await gw.generate(request())).text).toBe('ok');
    expect(a.requests).toHaveLength(2);
    expect(Date.now() - t0).toBeLessThan(150);
  });

  test('the circuit breaker opens, then admits a probe after the cooldown', async () => {
    let t = 0;
    const clock = { now: () => new Date(t) };
    let fail = true;
    const a = scriptedAdapter(
      () => (fail ? { error: { status: 502, message: 'bad gateway' } } : { text: 'a back' }),
      'a',
    );
    const b = scriptedAdapter(() => ({ text: 'b' }), 'b');
    const gw = createGateway({
      adapters: [a, b],
      routes: resolver([route('a'), route('b')]),
      breaker: { failureThreshold: 2, cooldownMs: 1000 },
      clock,
      ...fastRetry,
    });
    await gw.generate(request());
    expect(a.requests).toHaveLength(2);
    await gw.generate(request());
    expect(a.requests).toHaveLength(2);
    t = 1500;
    fail = false;
    expect((await gw.generate(request())).text).toBe('a back');
    expect(a.requests).toHaveLength(3);
  });

  test('caller abort stops without falling back', async () => {
    const a = scriptedAdapter(() => ({ delayMs: 500, text: 'x' }), 'a');
    const b = scriptedAdapter([{ text: 'b' }], 'b');
    const gw = createGateway({ adapters: [a, b], routes: resolver([route('a'), route('b')]) });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error('cancelled')), 10);
    await expect(gw.generate(request(), { signal: ctrl.signal })).rejects.toThrow('cancelled');
    expect(b.requests).toHaveLength(0);
  });
});

describe('hedging', () => {
  test('a second request wins when the first passes the threshold; the slow one is aborted', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const adapter: ProviderAdapter = {
      id: 'a',
      generate(req, signal) {
        const i = calls++;
        signals.push(signal);
        const delay = i === 0 ? 400 : 10;
        return new Promise<ModelResponse>((resolve, reject) => {
          const t = setTimeout(
            () =>
              resolve({
                text: `answer ${i}`,
                toolCalls: [],
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  costUsd: 0,
                },
                provider: 'a',
                model: req.model,
                latencyMs: delay,
                finish: 'stop',
              }),
            delay,
          );
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(signal.reason);
          });
        });
      },
    };
    const gw = createGateway({
      adapters: [adapter],
      routes: resolver([route('a')]),
      hedgeAfterMs: 30,
    });
    const t0 = Date.now();
    const res = await gw.generate(request(), { hedge: true });
    expect(Date.now() - t0).toBeLessThan(200);
    expect(res.text).toBe('answer 1');
    expect(res.hedged).toBe(true);
    expect(calls).toBe(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  test('no hedge when the first answers in time', async () => {
    const a = scriptedAdapter(() => ({ delayMs: 5, text: 'fast' }), 'a');
    const gw = createGateway({ adapters: [a], routes: resolver([route('a')]), hedgeAfterMs: 100 });
    const res = await gw.generate(request(), { hedge: true });
    expect(res.hedged).toBeUndefined();
    expect(a.requests).toHaveLength(1);
  });
});

describe('metering', () => {
  const pricing = { inputPerMTok: 2, outputPerMTok: 10 };

  test('estimates before and reports actual usage after, pricing a cost the provider left out', async () => {
    const a = scriptedAdapter(
      [{ text: 'ok', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 10_000 } }],
      'a',
    );
    const seen: { before?: CostEstimate; after?: Usage } = {};
    const gw = createGateway({ adapters: [a], routes: resolver([route('a', { pricing })]) });
    const res = await gw.generate(request(), {
      meter: {
        before: (e) => {
          seen.before = e;
        },
        after: (u) => {
          seen.after = u;
        },
      },
    });
    expect(seen.before!.inputTokens).toBeGreaterThan(0);
    expect(seen.before!.maxOutputTokens).toBe(500);
    expect(seen.before!.costUsd).toBeCloseTo((seen.before!.inputTokens * 2 + 500 * 10) / 1e6, 12);
    // 1000×2 + 10 000×0.2 + 100×10
    expect(seen.after!.costUsd).toBeCloseTo(5000 / 1e6, 12);
    expect(res.usage.costUsd).toBe(seen.after!.costUsd);
  });

  test('a budget refusal never reaches the provider', async () => {
    const a = scriptedAdapter([{ text: 'x' }], 'a');
    const gw = createGateway({ adapters: [a], routes: resolver([route('a', { pricing })]) });
    const meter = {
      before: () => {
        throw new BudgetExceededError('turn budget spent', 'turn');
      },
      after: () => {},
    };
    const err = await gw.generate(request(), { meter }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).scope).toBe('turn');
    expect(a.requests).toHaveLength(0);
  });
});

describe('tool calls', () => {
  test('args are re-validated into objects; unknown tools are kept', async () => {
    const a = scriptedAdapter(
      [
        {
          toolCalls: [
            { name: 'search', args: '{"q":"bolo"}' },
            { name: 'search', args: '{"q": oops' },
            { name: 'nope', args: { x: 1 } },
            { name: 'search', args: [1, 2] },
          ],
        },
      ],
      'a',
    );
    const gw = createGateway({ adapters: [a], routes: resolver([route('a')]) });
    const res = await gw.generate(request());
    expect(res.finish).toBe('tool_calls');
    expect(res.toolCalls.map((c) => c.args)).toEqual([
      { q: 'bolo' },
      { __invalid_json: '{"q": oops' },
      { x: 1 },
      { __invalid_json: '[1,2]' },
    ]);
    expect(res.toolCalls.map((c) => c.id)).toEqual([
      'call_0_0',
      'call_0_1',
      'call_0_2',
      'call_0_3',
    ]);
    expect(res.toolCalls[2]!.name).toBe('nope');
  });
});

describe('pii', () => {
  test('phones and emails are tokenized and restored', () => {
    const vault = createPiiVault();
    const cases = [
      '+55 (11) 91234-5678',
      '(11) 91234-5678',
      '11 91234 5678',
      '5511912345678',
      '+5511912345678',
      '11912345678',
      '(21) 3456-7890',
      '91234-5678',
    ];
    for (const c of cases) expect(redactText(`fone ${c}.`, vault)).toMatch(/^fone ⟦tel\d+⟧\.$/);
    for (const keep of ['2026-10-03', 'R$ 1.234,56', 'CEP 01310-100', 'pedido 4521', '10:30']) {
      expect(redactText(keep, vault)).toBe(keep);
    }
    const r = redactText('escreve pra ana.souza+loja@gmail.com ou (11) 91234-5678', vault);
    expect(r).toBe('escreve pra ⟦email1⟧ ou ⟦tel2⟧');
    expect(restoreText(r, vault)).toBe('escreve pra ana.souza+loja@gmail.com ou (11) 91234-5678');
  });

  test('round trip through the gateway', async () => {
    const a = scriptedAdapter(
      [
        {
          text: 'Anotei ⟦tel1⟧.',
          toolCalls: [{ name: 'save', args: { phone: '⟦tel1⟧', email: '⟦email1⟧' } }],
        },
      ],
      'a',
    );
    const gw = createGateway({ adapters: [a], routes: resolver([route('a')]) });
    const res = await gw.generate(
      request({
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'meu zap (11) 91234-5678, email jo@x.com.br' }],
          },
        ],
        volatile: 'CLIENTE: (11) 91234-5678',
      }),
    );
    const sent = JSON.stringify(a.requests[0]);
    expect(sent).not.toContain('91234');
    expect(sent).not.toContain('jo@x');
    expect(a.requests[0]!.volatile).toBe('CLIENTE: ⟦tel1⟧');
    expect(res.text).toBe('Anotei (11) 91234-5678.');
    expect(res.toolCalls[0]!.args).toEqual({ phone: '(11) 91234-5678', email: 'jo@x.com.br' });
  });
});

function fakeFetch(json: unknown, status = 200) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(json), { status });
  };
  return { fetch, calls };
}

describe('anthropic adapter', () => {
  test('cache breakpoints, volatile placement and tool mapping', async () => {
    const { fetch, calls } = fakeFetch({
      model: 'claude-x',
      content: [
        { type: 'text', text: 'Vou buscar.' },
        { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'bolo' } },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 300,
      },
    });
    const adapter = anthropicAdapter({ apiKey: 'k', fetch });
    const gw = createGateway({ adapters: [adapter], routes: resolver([route('anthropic')]) });
    const res = await gw.generate(
      request({
        system: [
          { id: 's1', tier: 'static', text: 'S1', cache: true },
          { id: 's2', tier: 'static', text: 'S2', cache: true },
          { id: 't1', tier: 'tenant', text: 'T1', cache: true },
          { id: 'u1', tier: 'subject', text: 'U1', cache: true },
          { id: 'c1', tier: 'conversation', text: 'C1', cache: false },
        ],
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'quero bolo' }] },
          {
            role: 'assistant',
            text: '',
            toolCalls: [{ id: 'c0', name: 'search', args: { q: 'bolo' } }],
          },
          { role: 'tool', callId: 'c0', name: 'search', content: '[]', isError: false },
        ],
      }),
    );
    const { url, init, body } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(body.model).toBe('anthropic-m');
    expect(body.max_tokens).toBe(500);
    expect(body.system.map((b: any) => Boolean(b.cache_control))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    const last = body.messages.at(-1);
    expect(last.role).toBe('user');
    expect(last.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'c0',
        content: '[]',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'AGORA: sexta 10h' },
    ]);
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'c0', name: 'search', input: { q: 'bolo' } }],
    });
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(4);
    expect(body.tools[0]).toEqual({
      name: 'search',
      description: 'busca',
      input_schema: { type: 'object' },
    });

    expect(res.finish).toBe('tool_calls');
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'search', args: { q: 'bolo' } }]);
    expect(res.usage).toMatchObject({
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 4000,
      cacheWriteTokens: 300,
    });
  });

  test('volatile becomes its own user turn after an assistant message; errors carry status', async () => {
    const { fetch, calls } = fakeFetch({ error: { type: 'overloaded_error' } }, 529);
    const adapter = anthropicAdapter({ apiKey: 'k', fetch });
    const err = await adapter
      .generate(
        {
          model: 'm',
          system: [],
          messages: [{ role: 'assistant', text: 'Oi!', toolCalls: [] }],
          volatile: 'AGORA',
          tools: [],
          maxTokens: 10,
        },
        new AbortController().signal,
      )
      .catch((e: unknown) => e);
    expect(calls[0]!.body.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Oi!', cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: [{ type: 'text', text: 'AGORA' }] },
    ]);
    expect(calls[0]!.body.system).toBeUndefined();
    expect(err).toMatchObject({ status: 529, retryable: true });
  });
});

describe('openai-compatible adapter', () => {
  test('request shape and parse of tool calls and usage', async () => {
    const { fetch, calls } = fakeFetch({
      model: 'openai/gpt-x',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_a',
                type: 'function',
                function: { name: 'search', arguments: '{"q":"bolo"}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 1000 },
        cost: 0.00042,
      },
    });
    const adapter = openAiCompatibleAdapter({
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'k',
      extraBody: { provider: { zdr: true, data_collection: 'deny' } },
      fetch,
    });
    const res = await adapter.generate(
      {
        model: 'openai/gpt-x',
        system: [
          { id: 'a', tier: 'static', text: 'A', cache: true },
          { id: 'b', tier: 'tenant', text: 'B', cache: true },
        ],
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'oi' }] },
          {
            role: 'assistant',
            text: '',
            toolCalls: [{ id: 'c0', name: 'search', args: { q: 'x' } }],
          },
          { role: 'tool', callId: 'c0', name: 'search', content: 'falhou', isError: true },
        ],
        volatile: 'AGORA',
        tools: [{ name: 'search', description: 'd', parameters: { type: 'object' } }],
        maxTokens: 100,
      },
      new AbortController().signal,
    );
    const { url, init, body } = calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
    expect(body.max_tokens).toBe(100);
    expect(body.messages).toEqual([
      { role: 'system', content: 'A\n\nB' },
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c0', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c0', content: 'Error: falhou' },
      { role: 'user', content: 'AGORA' },
    ]);
    expect(body.tools[0].function.name).toBe('search');

    expect(res.finish).toBe('tool_calls');
    expect(res.text).toBe('');
    expect(res.toolCalls).toEqual([{ id: 'call_a', name: 'search', args: { q: 'bolo' } }]);
    expect(res.usage).toEqual({
      inputTokens: 200,
      outputTokens: 30,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
      costUsd: 0.00042,
    });
  });

  test('replays provider extras (Gemini thought signatures) on the next step', async () => {
    const { fetch, calls } = fakeFetch({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'g1',
                function: { name: 'search', arguments: '{}' },
                extra_content: { google: { thought_signature: 'sig' } },
              },
            ],
          },
        },
      ],
    });
    const adapter = openAiCompatibleAdapter({
      id: 'gemini',
      baseUrl: 'https://g',
      apiKey: 'k',
      fetch,
    });
    const base = { model: 'm', system: [], volatile: null, tools: [], maxTokens: 10 };
    const signal = new AbortController().signal;
    const first = await adapter.generate({ ...base, messages: [] }, signal);
    await adapter.generate(
      {
        ...base,
        messages: [
          { role: 'assistant', text: '', toolCalls: first.toolCalls },
          { role: 'tool', callId: 'g1', name: 'search', content: '[]', isError: false },
        ],
      },
      signal,
    );
    expect(calls[1]!.body.messages[0].tool_calls[0].extra_content).toEqual({
      google: { thought_signature: 'sig' },
    });
  });
});
