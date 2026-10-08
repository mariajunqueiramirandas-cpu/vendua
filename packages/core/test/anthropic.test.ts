import { afterEach, describe, expect, test } from 'bun:test';
import {
  createGateway,
  ProviderError,
  type ModelRequest,
  type ModelRoute,
  type ProviderRequest,
  type RouteResolver,
} from '@vendua/agent-runtime';
import { anthropicAdapter, anthropicBody, THINKING_HEADROOM } from '../src/agent-host/anthropic.ts';
import { anthropicCostUsd, providerFor } from '../src/agent/llm.ts';
import { upsertIntegration, type IntegrationRow } from '../src/modules/integrations.ts';
import type { Sql } from '../src/platform/db.ts';

// Both Anthropic drivers on the official SDK: the runtime's adapter (agent-host) and the CRM
// agent's `llm.ts` driver. No network: every fetch here is a stub.

type Call = { url: string; headers: Headers; body: any };

function fakeFetch(
  ...replies: { json: unknown; status?: number; headers?: Record<string, string> }[]
) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body as string),
    });
    const r = replies[Math.min(calls.length, replies.length) - 1]!;
    return new Response(JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  };
  return { fetch, calls };
}

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-x',
  content: [{ type: 'text', text: 'Oi!' }],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 10, output_tokens: 5 },
  ...over,
});

const resolver = (routes: ModelRoute[]): RouteResolver => ({ routes: async () => routes });
const route: ModelRoute = { provider: 'anthropic', model: 'anthropic-m', zdr: true };

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

const providerRequest = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: 'm',
  system: [],
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'oi' }] }],
  volatile: null,
  tools: [],
  maxTokens: 10,
  ...over,
});

const signal = () => new AbortController().signal;

describe('agent-host anthropic adapter', () => {
  test('cache breakpoints, volatile placement and tool mapping', async () => {
    const { fetch, calls } = fakeFetch({
      json: message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
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
      }),
    });
    const adapter = anthropicAdapter({ apiKey: 'k', fetch });
    const gw = createGateway({ adapters: [adapter], routes: resolver([route]) });
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
    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('x-api-key')).toBe('k');
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    // the route names anthropic-m: every call runs the locked model, at medium effort by default,
    // with room for thinking on top of the reply's 500 tokens
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body.max_tokens).toBe(500 + 4_096);
    expect(body.temperature).toBeUndefined();
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
    expect(res.text).toBe('Vou buscar.');
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'search', args: { q: 'bolo' } }]);
    expect(res.usage).toMatchObject({
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 4000,
      cacheWriteTokens: 300,
    });
    // Haiku 5.5: $0.10 in, a tenth for cache reads, 1.25× for writes, $0.50 out
    expect(res.usage.costUsd).toBeCloseTo(
      (50 * 0.1 + 4000 * 0.01 + 300 * 0.125 + 20 * 0.5) / 1e6,
      12,
    );
  });

  test("the route's effort sets output_config and the thinking headroom", async () => {
    const { fetch, calls } = fakeFetch({ json: message() });
    const gw = createGateway({
      adapters: [anthropicAdapter({ apiKey: 'k', fetch })],
      routes: resolver([{ ...route, effort: 'low' }]),
    });
    await gw.generate(request({ temperature: 0 }));
    expect(calls[0]!.body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 500 + THINKING_HEADROOM.low,
      output_config: { effort: 'low' },
    });
    expect(calls[0]!.body.temperature).toBeUndefined();
    for (const effort of ['medium', 'high', 'xhigh', 'max'] as const)
      expect(anthropicBody(providerRequest({ maxTokens: 120, effort }))).toMatchObject({
        max_tokens: 120 + THINKING_HEADROOM[effort],
        output_config: { effort },
      });
  });

  test('a prompt over 100K tokens is priced at the long card', async () => {
    const { fetch } = fakeFetch({
      json: message({ usage: { input_tokens: 150_000, output_tokens: 1_000 } }),
    });
    const res = await anthropicAdapter({ apiKey: 'k', fetch }).generate(
      providerRequest(),
      signal(),
    );
    expect(res.usage.costUsd).toBeCloseTo((150_000 * 0.5 + 1_000 * 2.5) / 1e6, 12);
    expect(res.model).toBe('claude-x');
  });

  test('volatile becomes its own user turn after an assistant message; errors carry status, no SDK retry', async () => {
    const { fetch, calls } = fakeFetch({
      json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      status: 529,
      headers: { 'retry-after': '2' },
    });
    const adapter = anthropicAdapter({ apiKey: 'k', fetch });
    const err = await adapter
      .generate(
        providerRequest({
          messages: [{ role: 'assistant', text: 'Oi!', toolCalls: [] }],
          volatile: 'AGORA',
        }),
        signal(),
      )
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Oi!', cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: [{ type: 'text', text: 'AGORA' }] },
    ]);
    expect(calls[0]!.body.system).toBeUndefined();
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ status: 529, retryable: true, retryAfterMs: 2000 });
  });

  test('a 400 is not retryable; a network failure is', async () => {
    const bad = fakeFetch({
      json: { type: 'error', error: { type: 'invalid_request_error', message: 'nope' } },
      status: 400,
    });
    const e400 = await anthropicAdapter({ apiKey: 'k', fetch: bad.fetch })
      .generate(providerRequest(), signal())
      .catch((e: unknown) => e);
    expect(e400).toMatchObject({ status: 400, retryable: false });

    const down = async () => {
      throw new TypeError('fetch failed');
    };
    const eNet = await anthropicAdapter({ apiKey: 'k', fetch: down })
      .generate(providerRequest(), signal())
      .catch((e: unknown) => e);
    expect(eNet).toBeInstanceOf(ProviderError);
    expect(eNet).toMatchObject({ status: undefined, retryable: true });
  });

  test('an aborted call rejects with the signal reason, for the gateway to read', async () => {
    const ctrl = new AbortController();
    const reason = new DOMException('route timeout', 'TimeoutError');
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const pending = anthropicAdapter({ apiKey: 'k', fetch: hang })
      .generate(providerRequest(), ctrl.signal)
      .catch((e: unknown) => e);
    ctrl.abort(reason);
    expect(await pending).toBe(reason);
  });

  test('a refusal moves the gateway to the next route', async () => {
    const refused = fakeFetch({
      json: message({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      }),
    });
    const err = await anthropicAdapter({ apiKey: 'k', fetch: refused.fetch })
      .generate(providerRequest(), signal())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ retryable: false, message: 'anthropic: refusal (cyber)' });

    const backup = fakeFetch({ json: message({ content: [{ type: 'text', text: 'Claro!' }] }) });
    const gw = createGateway({
      adapters: [
        anthropicAdapter({ apiKey: 'k', fetch: refused.fetch }),
        anthropicAdapter({ apiKey: 'k2', fetch: backup.fetch, id: 'backup' }),
      ],
      routes: resolver([route, { provider: 'backup', model: 'claude-opus-5-5', zdr: true }]),
    });
    const res = await gw.generate(request());
    expect(refused.calls).toHaveLength(2);
    expect(backup.calls).toHaveLength(1);
    expect(res).toMatchObject({ text: 'Claro!', provider: 'backup', finish: 'stop' });
  });

  test('max_tokens maps to length', async () => {
    const { fetch } = fakeFetch({ json: message({ stop_reason: 'max_tokens' }) });
    const res = await anthropicAdapter({ apiKey: 'k', fetch }).generate(
      providerRequest(),
      signal(),
    );
    expect(res.finish).toBe('length');
  });

  test('images the API takes go inline; others fall back to their url or description', () => {
    const body = anthropicBody(
      providerRequest({
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'image', mediaType: 'image/jpeg', data: 'AAA' },
              { type: 'image', mediaType: 'image/heic', data: 'BBB', description: 'um bolo' },
              { type: 'audio', mediaType: 'audio/ogg', transcript: 'quero dois' },
            ],
          },
        ],
      }),
    );
    expect(body.messages[0]!.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
      { type: 'text', text: '[image: um bolo]' },
      { type: 'text', text: '[audio: quero dois]', cache_control: { type: 'ephemeral' } },
    ]);
  });
});

describe('CRM anthropic driver', () => {
  const realFetch = globalThis.fetch;
  const KEY = 'VENDUA_TEST_ANTHROPIC_KEY';
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env[KEY];
  });

  const integration = (config: Record<string, unknown>): IntegrationRow => ({
    id: 'i1',
    kind: 'llm',
    driver: 'anthropic',
    enabled: true,
    config,
    secret_ref: KEY,
    created_at: '',
    updated_at: '',
  });

  test('request shape, tool calls, cached usage and cost', async () => {
    process.env[KEY] = 'sk-ant-crm';
    const { fetch, calls } = fakeFetch({
      json: message({
        model: 'claude-opus-5',
        content: [
          { type: 'text', text: 'Vou anotar.' },
          { type: 'tool_use', id: 'tu_9', name: 'note', input: { text: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 0,
        },
      }),
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    // a stored model from before the lock is ignored
    const provider = providerFor(integration({ model: 'claude-opus-5' }));
    expect(provider.name).toBe('anthropic:claude-haiku-5-5');
    const res = await provider.chat({
      system: 'Você é o SDR.',
      messages: [
        { role: 'user', content: 'oi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tu_0', name: 'note', args: { text: 'a' } }],
        },
        { role: 'tool', toolCallId: 'tu_0', name: 'note', content: 'ok' },
      ],
      tools: [{ name: 'note', description: 'anota', parameters: { type: 'object' } }],
    });
    const { url, headers, body } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('x-api-key')).toBe('sk-ant-crm');
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 16_000,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: [{ type: 'text', text: 'Você é o SDR.', cache_control: { type: 'ephemeral' } }],
      messages: [
        { role: 'user', content: 'oi' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_0', name: 'note', input: { text: 'a' } }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_0', content: 'ok' }] },
      ],
      tools: [{ name: 'note', description: 'anota', input_schema: { type: 'object' } }],
    });
    expect(res).toMatchObject({
      text: 'Vou anotar.',
      toolCalls: [{ id: 'tu_9', name: 'note', args: { text: 'x' } }],
      tokensIn: 1100,
      tokensOut: 10,
    });
    // $0.10/M input, a tenth for cache reads, $0.50/M output
    expect(res.costUsd).toBeCloseTo((100 * 0.1 + 1000 * 0.01 + 10 * 0.5) / 1_000_000, 12);
  });

  test('config.effort picks the effort; anything else falls back to medium', async () => {
    process.env[KEY] = 'sk-ant-crm';
    const { fetch, calls } = fakeFetch({ json: message() });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const chat = { system: 's', messages: [{ role: 'user' as const, content: 'oi' }], tools: [] };
    await providerFor(integration({ effort: 'xhigh' })).chat(chat);
    await providerFor(integration({ effort: 'turbo' })).chat(chat);
    expect(calls.map((c) => c.body.output_config)).toEqual([
      { effort: 'xhigh' },
      { effort: 'medium' },
    ]);
  });

  test('cost: Haiku 5.5 bills a prompt over 100K tokens at the long card', () => {
    const u = (input: number) => ({ input, cacheRead: 0, cacheWrite: 0, output: 1_000 });
    expect(anthropicCostUsd('claude-haiku-5-5', u(100_000))).toBeCloseTo(
      (100_000 * 0.1 + 1_000 * 0.5) / 1e6,
      12,
    );
    expect(anthropicCostUsd('claude-haiku-5-5', u(100_001))).toBeCloseTo(
      (100_001 * 0.5 + 1_000 * 2.5) / 1e6,
      12,
    );
  });

  test('a refusal fails the call instead of reading as an empty reply', async () => {
    process.env[KEY] = 'sk-ant-crm';
    const { fetch } = fakeFetch({
      json: message({ content: [], stop_reason: 'refusal', stop_details: null }),
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const chat = providerFor(integration({})).chat({ system: 's', messages: [], tools: [] });
    await expect(chat).rejects.toThrow('anthropic refusal');
  });
});

describe('anthropic integration config', () => {
  // both checks run before the claim, so no database is reached
  const save = (config: Record<string, unknown>) =>
    upsertIntegration({} as Sql, { kind: 'llm', driver: 'anthropic', config }, 'k').then(
      () => null,
      (e: { status: number; details?: { field?: string } }) => [e.status, e.details?.field],
    );

  test('the model is fixed and effort is one of the five levels', async () => {
    expect(await save({ model: 'claude-opus-5-5' })).toEqual([422, 'config.model']);
    expect(await save({ effort: 'turbo' })).toEqual([422, 'config.effort']);
    expect(await save({ effort: 3 })).toEqual([422, 'config.effort']);
  });
});
