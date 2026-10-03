import {
  createGateway,
  defineAgent,
  defineStatechart,
  defineTool,
  grounded,
  noHumanClaim,
  Runtime,
  s,
  ToolError,
  type AgentDefinition,
  type HostHooks,
  type Json,
} from '../src/index.ts';
import { FakeClock, MemoryStore, scriptedAdapter, type MemoryHost } from '../src/testing/index.ts';
import type { ScriptedOutput } from '../src/model/adapters/scripted.ts';
import type { ProviderRequest } from '../src/model/types.ts';

export const TENANT = '00000000-0000-4000-8000-000000000001';

export const addItem = defineTool<{ item: string; qty: number }, MemoryHost>({
  name: 'add_item',
  description: 'Adds an item to the cart.',
  effect: 'write',
  input: s.object({ item: s.string({ max: 40 }), qty: s.int({ min: 1, max: 20 }) }),
  run: (ctx, input) => {
    if (input.item === 'esgotado') throw new ToolError('Item esgotado.');
    const key = `cart:${ctx.subject.id}`;
    const cart = (ctx.tx.kv.get(key) as { item: string; qty: number }[] | undefined) ?? [];
    ctx.tx.kv.set(key, [...cart, input] as unknown as Json);
    ctx.setSlot('items', cart.length + 1);
    return { content: `ok, ${ctx.alias('product', input.item)} no carrinho` };
  },
});

export const quote = defineTool<Record<string, never>, MemoryHost>({
  name: 'quote',
  description: 'Prices the cart.',
  effect: 'read',
  input: s.object({}),
  run: (ctx) => {
    const cart = (ctx.tx.kv.get(`cart:${ctx.subject.id}`) as { qty: number }[] | undefined) ?? [];
    const cents = cart.reduce((n, l) => n + l.qty * 2500, 0);
    ctx.figure('cart.total', {
      value: cents,
      text: `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`,
      kind: 'money',
    });
    return { content: 'Total no REGISTRO: {{cart.total}}' };
  },
});

export const placeOrder = defineTool<Record<string, never>, MemoryHost>({
  name: 'place_order',
  description: 'Places the order.',
  effect: 'money',
  input: s.object({}),
  confirm: (st) => (st.chart.slots.confirmed === true ? null : 'Peça a confirmação do cliente.'),
  run: (ctx) => {
    const n = ((ctx.tx.kv.get('orders') as number | undefined) ?? 0) + 1;
    ctx.tx.kv.set('orders', n);
    return { content: 'pedido feito' };
  },
});

export const setTimer = defineTool<{ minutes: number }, MemoryHost>({
  name: 'nudge_later',
  description: 'Schedules a nudge.',
  effect: 'write',
  input: s.object({ minutes: s.int({ min: 1, max: 60 }) }),
  run: async (ctx, input) => {
    await ctx.timer({
      name: 'nudge',
      key: 'nudge',
      deliverAt: new Date(ctx.now.getTime() + input.minutes * 60_000),
    });
    return { content: 'agendado' };
  },
});

export const chart = defineStatechart({
  initial: 'browsing',
  states: {
    browsing: {
      tools: ['add_item', 'quote', 'nudge_later'],
      on: { 'tool:add_item': 'building' },
    },
    building: { tools: ['add_item', 'quote', 'place_order', 'nudge_later'], required: ['address'] },
  },
});

export function agentDef(
  over: Partial<AgentDefinition<MemoryHost>> = {},
): AgentDefinition<MemoryHost> {
  return {
    id: 'seller',
    subject: 'thread',
    lane: 'interactive',
    transport: 'memory',
    models: { default: 'fast' },
    instructions: [{ id: 'base', tier: 'static', text: 'Você vende pizza.', priority: 100 }],
    tools: [addItem, quote, placeOrder, setTimer],
    statechart: chart,
    guards: { output: [grounded(), noHumanClaim] },
    mailbox: { preempt: true },
    compaction: false,
    ...over,
  };
}

export type Script = ScriptedOutput[] | ((req: ProviderRequest, i: number) => ScriptedOutput);

export function setup(
  script: Script,
  over: Partial<AgentDefinition<MemoryHost>> = {},
  hooks?: HostHooks<MemoryHost>,
) {
  const clock = new FakeClock();
  const store = new MemoryStore(clock);
  const adapter = scriptedAdapter(script);
  const gateway = createGateway({
    adapters: [adapter],
    routes: { routes: async () => [{ provider: 'scripted', model: 'test', zdr: true }] },
  });
  const agent = defineAgent(agentDef(over));
  const runtime = new Runtime<MemoryHost>({
    agents: [agent],
    store,
    gateway,
    transports: [store.transport('memory')],
    owner: 'w1',
    clock,
    memory: store.memoryPort(),
    ...(hooks ? { hooks } : {}),
  });
  let n = 0;
  const say = (text: string, subject = 's1') =>
    store.dispatch({
      actor: { tenantId: TENANT, agentId: 'seller', subject: { kind: 'thread', id: subject } },
      kind: 'message.inbound',
      source: 'test',
      dedupeKey: `in:${subject}:${++n}`,
      payload: { text },
    });
  return { clock, store, adapter, agent, runtime, say };
}

export function reply(text: string): ScriptedOutput {
  return { toolCalls: [{ name: 'reply', args: { text } }] };
}

export function call(name: string, args: Json = {}): ScriptedOutput {
  return { toolCalls: [{ name, args }] };
}

export function types(store: MemoryStore, actorId: string): string[] {
  return store.log(actorId).map((e) => e.type);
}
