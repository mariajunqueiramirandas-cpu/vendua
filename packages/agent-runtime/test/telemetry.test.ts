import { describe, expect, test } from 'bun:test';
import {
  createGateway,
  defineAgent,
  logTelemetry,
  memoryTelemetry,
  metadataOnly,
  noopTelemetry,
  otelTelemetry,
  Runtime,
  type OtelSpanLike,
} from '../src/index.ts';
import { drive, FakeClock, MemoryStore, scriptedAdapter } from '../src/testing/index.ts';
import { agentDef, call, reply, TENANT } from './helpers.ts';

describe('engine spans', () => {
  test('a turn is invoke_agent with chat and execute_tool children, metadata only', async () => {
    const telemetry = memoryTelemetry();
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    const agent = defineAgent(agentDef());
    const runtime = new Runtime({
      agents: [agent],
      store,
      gateway: createGateway({
        adapters: [
          scriptedAdapter([
            { ...call('add_item', { item: 'calabresa', qty: 1 }), usage: { inputTokens: 120 } },
            { ...reply('Anotado!'), usage: { inputTokens: 150, outputTokens: 9 } },
          ]),
        ],
        routes: { routes: async () => [{ provider: 'scripted', model: 'test', zdr: true }] },
      }),
      transports: [store.transport('memory')],
      owner: 'w',
      clock,
      telemetry,
    });
    const { actorId } = await store.dispatch({
      actor: { tenantId: TENANT, agentId: 'seller', subject: { kind: 'thread', id: 's1' } },
      kind: 'message.inbound',
      source: 'test',
      dedupeKey: 'in:1',
      payload: { text: 'uma calabresa' },
    });
    await drive(runtime, clock);

    const [turn] = telemetry.named('invoke_agent');
    expect(turn).toMatchObject({
      ended: true,
      error: null,
      parent: null,
      attrs: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': 'seller',
        'gen_ai.agent.version': agent.version,
        'gen_ai.conversation.id': actorId,
        'vendua.tenant_id': TENANT,
      },
    });
    const chats = telemetry.named('chat');
    expect(chats).toHaveLength(2);
    for (const c of chats) expect(telemetry.parentOf(c)).toBe(turn!);
    expect(chats.map((c) => c.attrs['gen_ai.usage.input_tokens'])).toEqual([120, 150]);
    expect(chats[1]!.attrs).toMatchObject({
      'gen_ai.provider.name': 'scripted',
      'gen_ai.response.model': 'test',
      'gen_ai.usage.output_tokens': 9,
    });
    const tools = telemetry.named('execute_tool');
    expect(tools.map((t) => t.attrs['gen_ai.tool.name'])).toEqual(['add_item']);
    expect(telemetry.parentOf(tools[0]!)).toBe(turn!);
    expect(telemetry.spans.every((s) => s.ended && s.durationMs !== null)).toBe(true);
    for (const s of telemetry.spans)
      for (const k of Object.keys(s.attrs)) expect(k).toMatch(/^(gen_ai|vendua)\./);
  });
});

describe('adapters', () => {
  test('metadataOnly drops foreign keys, long strings and undefined', () => {
    expect(
      metadataOnly({
        'gen_ai.agent.name': 'seller',
        'vendua.cost_usd': 0.01,
        'http.url': 'x',
        'gen_ai.prompt': 'x'.repeat(201),
        'vendua.flag': undefined,
        'vendua.ok': true,
      }),
    ).toEqual({ 'gen_ai.agent.name': 'seller', 'vendua.cost_usd': 0.01, 'vendua.ok': true });
  });

  test('noopTelemetry is inert', () => {
    const s = noopTelemetry.span('chat', {});
    s.setAttributes({ 'gen_ai.x': 1 });
    s.end(new Error('x'));
  });

  test('otelTelemetry starts spans with parent context, filters and records errors by type', () => {
    type Fake = OtelSpanLike & {
      name: string;
      attrs: Record<string, unknown>;
      ctx: unknown;
      status: { code: number; message?: string } | null;
      exceptions: { name: string; message: string }[];
      ended: number;
    };
    const started: Fake[] = [];
    const tracer = {
      startSpan(
        name: string,
        options?: { attributes?: Record<string, string | number | boolean> },
        ctx?: unknown,
      ): Fake {
        const f: Fake = {
          name,
          attrs: { ...options?.attributes },
          ctx,
          status: null,
          exceptions: [],
          ended: 0,
          setAttribute(k, v) {
            f.attrs[k] = v;
          },
          recordException(e) {
            f.exceptions.push(e);
          },
          setStatus(st) {
            f.status = st;
          },
          end() {
            f.ended += 1;
          },
        };
        started.push(f);
        return f;
      },
    };
    const t = otelTelemetry(tracer, { contextWith: (p) => ({ parent: (p as Fake).name }) });
    const root = t.span('invoke_agent', { 'gen_ai.agent.name': 'seller', 'shopper.phone': '55' });
    const child = t.span('chat', { 'gen_ai.operation.name': 'chat' }, root);
    child.setAttributes({ 'gen_ai.usage.input_tokens': 10, 'gen_ai.output.text': 'y'.repeat(300) });
    child.end(new TypeError('cliente Maria, 11 99999-9999'));
    child.end();
    root.end();
    const [r, c] = started;
    expect(r!.attrs).toEqual({ 'gen_ai.agent.name': 'seller' });
    expect(r!.ctx).toBeUndefined();
    expect(c!.ctx).toEqual({ parent: 'invoke_agent' });
    expect(c!.attrs).toEqual({
      'gen_ai.operation.name': 'chat',
      'gen_ai.usage.input_tokens': 10,
      'error.type': 'TypeError',
    });
    expect(c!.status).toEqual({ code: 2, message: 'TypeError' });
    expect(c!.exceptions).toEqual([{ name: 'TypeError', message: 'TypeError' }]);
    expect(c!.ended).toBe(1);
    expect(r!.status).toBeNull();
  });

  test('logTelemetry writes one line per ended span', () => {
    const lines: string[] = [];
    let now = 0;
    const t = logTelemetry(
      (line) => lines.push(line),
      () => now,
    );
    const s = t.span('execute_tool', { 'gen_ai.tool.name': 'quote', 'tool.input': 'segredo' });
    now = 12;
    s.end();
    s.end();
    const f = t.span('chat', {});
    now = 20;
    f.end(new RangeError('x'));
    expect(lines).toEqual([
      'span execute_tool 12ms gen_ai.tool.name=quote',
      'span chat 8ms error=RangeError',
    ]);
  });
});
