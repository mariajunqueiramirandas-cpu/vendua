import { describe, expect, test } from 'bun:test';
import { defineAgent, Runtime, createGateway, LeaseLostError } from '../src/index.ts';
import { drive, scriptedAdapter } from '../src/testing/index.ts';
import { agentDef, call, reply, setup, TENANT, types } from './helpers.ts';

describe('a turn', () => {
  test('input → model → reply → outbox, then a clean release', async () => {
    const { store, runtime, clock, say, adapter } = setup([reply('Olá! O que vai ser hoje?')]);
    const { actorId } = await say('oi');
    await drive(runtime, clock);
    expect(store.outbox.map((m) => m.text)).toEqual(['Olá! O que vai ser hoje?']);
    expect(types(store, actorId)).toEqual([
      'turn.started',
      'model.responded',
      'tool.returned',
      'message.sent',
      'turn.ended',
    ]);
    const actor = store.actor(actorId)!;
    expect(actor.attempts).toBe(0);
    expect(actor.nextWakeAt).toBeNull();
    expect(actor.projectionSeq).toBe(5);
    // the shopper's text is fenced as data
    const user = adapter.requests[0]!.messages[0]!;
    expect(user.role === 'user' && user.parts[0]!.type === 'text' && user.parts[0]!.text).toContain(
      'oi',
    );
    expect(store.mailbox.every((m) => m.consumedByTurn)).toBe(true);
  });

  test('every event carries the version that produced it', async () => {
    const { store, runtime, clock, say, agent } = setup([reply('Oi')]);
    const { actorId } = await say('oi');
    await drive(runtime, clock);
    expect(new Set(store.log(actorId).map((e) => e.version))).toEqual(new Set([agent.version]));
  });

  test('a burst inside the quiet window is one turn', async () => {
    const { store, runtime, clock, say, adapter } = setup([reply('Anotado!')], {
      mailbox: { quiet: { minMs: 2_500, maxMs: 20_000 }, preempt: true },
    });
    await say('quero uma pizza');
    clock.advance(1_000);
    await say('grande');
    await drive(runtime, clock, { horizonMs: 10_000 });
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]!.messages.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(store.outbox).toHaveLength(1);
  });

  test('dedupe keys make a re-delivered webhook a no-op', async () => {
    const { store } = setup([]);
    const input = {
      actor: { tenantId: TENANT, agentId: 'seller', subject: { kind: 'thread', id: 's1' } },
      kind: 'message.inbound',
      source: 'whatsapp',
      dedupeKey: 'wa:ABC',
      payload: { text: 'oi' },
    };
    expect((await store.dispatch(input)).inserted).toBe(true);
    expect((await store.dispatch(input)).inserted).toBe(false);
    expect(store.mailbox).toHaveLength(1);
  });
});

describe('grounding', () => {
  test('a typed amount is blocked; a cited one is rendered from the ledger', async () => {
    const { store, runtime, clock, say } = setup([
      call('add_item', { item: 'calabresa', qty: 2 }),
      reply('Deu R$ 50,00'),
      call('quote'),
      reply('Total {{cart.total}}. Confirma?'),
    ]);
    const { actorId } = await say('2 calabresas');
    await drive(runtime, clock);
    expect(store.outbox.map((m) => m.text)).toEqual(['Total R$ 50,00. Confirma?']);
    const blocked = store.log(actorId).find((e) => e.type === 'guard.blocked')!;
    expect((blocked.payload as { guard: string }).guard).toBe('grounded');
    expect(store.log(actorId).find((e) => e.type === 'state.changed')?.payload).toMatchObject({
      from: 'browsing',
      to: 'building',
    });
  });

  test('an unknown reference goes back to the model', async () => {
    const { store, runtime, clock, say, adapter } = setup([
      reply('Total {{cart.total}}'),
      reply('Já calculo.'),
    ]);
    const { actorId } = await say('quanto deu?');
    await drive(runtime, clock);
    expect(store.outbox.map((m) => m.text)).toEqual(['Já calculo.']);
    expect(types(store, actorId)).toContain('guard.blocked');
    const tool = adapter.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(tool && tool.role === 'tool' && tool.content).toContain('Referências inexistentes');
  });

  test('it never claims to be a person', async () => {
    const { store, runtime, clock, say } = setup([
      reply('Sou uma pessoa, pode confiar'),
      reply('Sou a assistente virtual da loja.'),
    ]);
    await say('você é robô?');
    await drive(runtime, clock);
    expect(store.outbox.map((m) => m.text)).toEqual(['Sou a assistente virtual da loja.']);
  });
});

describe('tools', () => {
  test('the statechart gates tools and moves on success', async () => {
    const { store, runtime, clock, say } = setup([
      call('place_order'),
      call('add_item', { item: 'margherita', qty: 1 }),
      reply('Anotado.'),
    ]);
    const { actorId } = await say('fecha');
    await drive(runtime, clock);
    const log = store.log(actorId);
    const block = log.find((e) => e.type === 'guard.blocked')!;
    expect(block.payload).toMatchObject({ tool: 'place_order', guard: 'state_gate' });
    expect(store.kv.get('orders')).toBeUndefined();
    expect(log.some((e) => e.type === 'state.changed')).toBe(true);
  });

  test('a declared confirmation holds a money tool', async () => {
    const { store, runtime, clock, say } = setup([
      call('add_item', { item: 'margherita', qty: 1 }),
      call('place_order'),
      reply('Posso fechar?'),
    ]);
    const { actorId } = await say('quero');
    await drive(runtime, clock);
    const block = store.log(actorId).find((e) => e.type === 'guard.blocked')!;
    expect(block.payload).toMatchObject({ guard: 'confirmation' });
    expect(store.kv.get('orders')).toBeUndefined();
  });

  test('a ToolError rolls back the tool’s writes and the model sees it', async () => {
    const { store, runtime, clock, say, adapter } = setup([
      call('add_item', { item: 'esgotado', qty: 1 }),
      reply('Esse acabou.'),
    ]);
    await say('quero');
    await drive(runtime, clock);
    expect(store.kv.get('cart:s1')).toBeUndefined();
    const tool = adapter.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(tool && tool.role === 'tool' && tool.isError && tool.content).toBe('Item esgotado.');
  });

  test('bad arguments are a validation error, not a crash', async () => {
    const { store, runtime, clock, say } = setup([
      call('add_item', { item: 'x', qty: 99 }),
      reply('Ops.'),
    ]);
    const { actorId } = await say('quero');
    await drive(runtime, clock);
    const ret = store.log(actorId).find((e) => e.type === 'tool.returned')!;
    expect(ret.payload).toMatchObject({ ok: false });
    expect(String((ret.payload as { content: string }).content)).toContain('at most 20');
  });

  test('aliases replace ids and stay stable', async () => {
    const { store, runtime, clock, say } = setup([
      {
        toolCalls: [
          { name: 'add_item', args: { item: 'calabresa', qty: 1 } },
          { name: 'add_item', args: { item: 'calabresa', qty: 1 } },
        ],
      },
      reply('Ok.'),
    ]);
    const { actorId } = await say('2x');
    await drive(runtime, clock);
    const aliases = store.log(actorId).filter((e) => e.type === 'alias.assigned');
    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.payload).toMatchObject({ alias: 'p1', kind: 'product', id: 'calabresa' });
  });

  test('timers are mailbox rows that wake the actor later', async () => {
    const { store, runtime, clock, say, adapter } = setup([
      {
        toolCalls: [
          { name: 'nudge_later', args: { minutes: 15 } },
          { name: 'reply', args: { text: 'Te chamo já.' } },
        ],
      },
      reply('Ainda quer a pizza?'),
    ]);
    const { actorId } = await say('vou pensar');
    await drive(runtime, clock);
    expect(store.outbox).toHaveLength(1);
    expect(store.mailbox.find((m) => m.kind === 'timer.nudge')?.consumedByTurn).toBeNull();
    await drive(runtime, clock, { horizonMs: 20 * 60_000 });
    expect(store.outbox.map((m) => m.text)).toEqual(['Te chamo já.', 'Ainda quer a pizza?']);
    expect(adapter.requests).toHaveLength(2);
    expect(store.log(actorId).filter((e) => e.type === 'turn.ended')).toHaveLength(2);
  });
});

describe('durability', () => {
  test('a crash after the model call resumes without calling the model again', async () => {
    const { store, runtime, clock, say, adapter } = setup([reply('Oi!')]);
    const { actorId } = await say('oi');
    store.failOnAppend = 'message.sent';
    await runtime.pump('interactive');
    expect(store.outbox).toHaveLength(0);
    expect(store.actor(actorId)!.attempts).toBe(1);
    await drive(runtime, clock, { horizonMs: 60_000 });
    expect(adapter.requests).toHaveLength(1);
    expect(store.outbox.map((m) => m.text)).toEqual(['Oi!']);
    expect(types(store, actorId).filter((t) => t === 'model.responded')).toHaveLength(1);
    expect(store.actor(actorId)!.attempts).toBe(0);
  });

  test('a tool write and its event commit together, once', async () => {
    const { store, runtime, clock, say } = setup([
      call('add_item', { item: 'calabresa', qty: 1 }),
      reply('Ok.'),
    ]);
    const { actorId } = await say('quero');
    store.failOnAppend = 'tool.returned';
    await runtime.pump('interactive');
    expect(store.kv.get('cart:s1')).toBeUndefined();
    await drive(runtime, clock, { horizonMs: 60_000 });
    expect(store.kv.get('cart:s1')).toEqual([{ item: 'calabresa', qty: 1 }]);
    expect(types(store, actorId).filter((t) => t === 'tool.returned')).toHaveLength(2);
  });

  test('a turn that keeps failing ends in turn.failed, degrades and tells the host', async () => {
    const failures: string[] = [];
    const { store, runtime, clock, say } = setup(
      [reply('Oi!'), reply('Oi!'), reply('Oi!'), reply('Oi!')],
      { degrade: async () => ({ text: 'Peça pelo link: https://loja.example/' }), maxAttempts: 2 },
      { turnFailed: async (_tx, f) => void failures.push(f.error) },
    );
    const { actorId } = await say('oi');
    for (let i = 0; i < 3; i++) {
      store.failOnAppend = 'message.sent';
      await drive(runtime, clock, { horizonMs: 60_000, maxPumps: 1 });
      clock.advance(120_000);
    }
    await drive(runtime, clock, { horizonMs: 600_000 });
    expect(types(store, actorId)).toContain('turn.failed');
    expect(store.outbox.map((m) => m.text)).toEqual(['Peça pelo link: https://loja.example/']);
    expect(failures).toHaveLength(1);
    expect(store.actor(actorId)!.attempts).toBe(0);
  });

  test('a degrade send that fails is rolled back alone and the turn still fails', async () => {
    const { store, clock, say } = setup([]);
    const agent = defineAgent(
      agentDef({ degrade: async () => ({ text: 'Peça pelo link.' }), maxAttempts: 2 }),
    );
    const memory = store.transport('memory');
    const runtime = new Runtime({
      agents: [agent],
      store,
      gateway: createGateway({
        adapters: [scriptedAdapter([reply('Oi!'), reply('Oi!'), reply('Oi!')])],
        routes: { routes: async () => [{ provider: 'scripted', model: 'm', zdr: true }] },
      }),
      transports: [
        {
          id: 'memory',
          send: async (tx, msg) => {
            if (msg.step !== 'degrade') return memory.send(tx, msg);
            // a write then an error: in Postgres, outside a savepoint, this aborts the transaction
            tx.host.kv.set('half-sent', true);
            throw new Error('wa_ref out of range');
          },
        },
      ],
      owner: 'w',
      clock,
    });
    const { actorId } = await say('oi');
    for (let i = 0; i < 3; i++) {
      store.failOnAppend = 'message.sent';
      await drive(runtime, clock, { horizonMs: 60_000, maxPumps: 1 });
      clock.advance(120_000);
    }
    await drive(runtime, clock, { horizonMs: 600_000 });
    expect(types(store, actorId)).toContain('degrade.failed');
    expect(types(store, actorId)).toContain('turn.failed');
    expect(store.kv.get('half-sent')).toBeUndefined();
    expect(store.actor(actorId)!.attempts).toBe(0);
  });

  test('a turn that runs out of steps without answering sends the safe line once', async () => {
    const blocked = { toolCalls: [{ name: 'reply', args: { text: 'Custa R$ 12,00.' } }] };
    const { store, runtime, clock, say } = setup([blocked, blocked, blocked, blocked], {
      budgets: { stepsPerTurn: 2 },
      degrade: async () => ({ text: 'Vou chamar a loja para te responder.' }),
    });
    const { actorId } = await say('quanto custa?');
    await drive(runtime, clock, { horizonMs: 60_000 });
    expect(types(store, actorId)).toContain('turn.step_limit');
    expect(store.outbox.map((m) => m.text)).toEqual(['Vou chamar a loja para te responder.']);
    expect(types(store, actorId)).toContain('turn.ended');
  });

  test('a worker that lost its lease cannot write', async () => {
    const { store, clock, say, agent } = setup([]);
    await say('oi');
    const claim = async (owner: string) =>
      store.claim({
        lane: 'interactive',
        owner,
        leaseMs: 1_000,
        limit: 1,
        agentIds: ['seller'],
        perTenantCap: 1,
        backoffMs: () => 0,
      });
    const [a] = await claim('a');
    clock.advance(1_500);
    const [b] = await claim('b');
    expect(b!.lease.epoch).toBe(a!.lease.epoch + 1);
    await expect(
      store.fenced(a!.lease, async (tx) =>
        tx.append(null, [{ type: 'x', payload: null }], agent.version),
      ),
    ).rejects.toBeInstanceOf(LeaseLostError);
    await store.fenced(b!.lease, async (tx) =>
      tx.append(null, [{ type: 'x', payload: null }], agent.version),
    );
  });
});

describe('preemption', () => {
  test('input mid-turn supersedes the reply; the next turn answers everything', async () => {
    let s!: ReturnType<typeof setup>;
    s = setup((req, i) => {
      if (i === 0) {
        void s.say('e uma coca');
        return reply('Uma pizza, certo?');
      }
      const users = req.messages.filter((m) => m.role === 'user').length;
      return reply(`Pizza e coca (${users} mensagens).`);
    });
    const { actorId } = await s.say('uma pizza');
    await drive(s.runtime, s.clock);
    expect(s.store.outbox.map((m) => m.text)).toEqual(['Pizza e coca (2 mensagens).']);
    const t = types(s.store, actorId);
    expect(t).toContain('turn.superseded');
    expect(t.filter((x) => x === 'turn.started')).toHaveLength(2);
    // the superseded reply never reached the shopper, so the model is told so
    const second = s.adapter.requests[1]!;
    const dangling = second.messages.find((m) => m.role === 'tool' && m.isError);
    expect(dangling).toBeDefined();
  });
});

describe('fairness', () => {
  test('claims rotate across tenants and respect the per-tenant cap', async () => {
    const { store } = setup([]);
    for (let i = 0; i < 5; i++)
      await store.dispatch({
        actor: { tenantId: 'busy', agentId: 'seller', subject: { kind: 'thread', id: `b${i}` } },
        kind: 'message.inbound',
        source: 't',
        dedupeKey: `b${i}`,
      });
    await store.dispatch({
      actor: { tenantId: 'quiet', agentId: 'seller', subject: { kind: 'thread', id: 'q' } },
      kind: 'message.inbound',
      source: 't',
      dedupeKey: 'q',
    });
    const claimed = await store.claim({
      lane: 'interactive',
      owner: 'w',
      leaseMs: 60_000,
      limit: 3,
      agentIds: ['seller'],
      perTenantCap: 2,
      backoffMs: () => 0,
    });
    expect(claimed.map((c) => c.actor.tenantId).sort()).toEqual(['busy', 'busy', 'quiet']);
  });
});

describe('versions', () => {
  test('the hash moves with any instruction, tool or guard change, and only then', () => {
    const a = defineAgent(agentDef());
    const b = defineAgent(agentDef());
    const c = defineAgent(
      agentDef({ instructions: [{ id: 'base', tier: 'static', text: 'Você vende esfiha.' }] }),
    );
    expect(a.version).toBe(b.version);
    expect(c.version).not.toBe(a.version);
  });

  test('a pinned version keeps running after a new current version ships', async () => {
    const { store, clock, say } = setup([]);
    const old = defineAgent(agentDef());
    const next = defineAgent(
      agentDef({ instructions: [{ id: 'base', tier: 'static', text: 'v2' }] }),
    );
    const adapter = scriptedAdapter([reply('oi')]);
    const runtime = new Runtime({
      agents: [next],
      versions: [old],
      store,
      gateway: createGateway({
        adapters: [adapter],
        routes: { routes: async () => [{ provider: 'scripted', model: 'm', zdr: true }] },
      }),
      transports: [store.transport('memory')],
      owner: 'w',
      clock,
      resolver: { resolve: async () => old.version },
    });
    const { actorId } = await say('oi');
    await drive(runtime, clock);
    expect(store.log(actorId)[0]!.version).toBe(old.version);
    expect(adapter.requests[0]!.system.some((b) => b.text === 'Você vende pizza.')).toBe(true);
  });
});
