import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  createGateway,
  defineAgent,
  defineTool,
  grounded,
  LeaseLostError,
  Runtime,
  s,
  ToolError,
  type Agent,
  type AgentDefinition,
  type ModelGateway,
} from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import type { ScriptedOutput } from '@vendua/agent-runtime';
import { createApp } from '../src/app.ts';
import { dispatchTx } from '../src/agent-host/dispatch.ts';
import { forgetSubjectTx } from '../src/agent-host/forget.ts';
import { hostHooks } from '../src/agent-host/hooks.ts';
import { hostOnlineQa } from '../src/agent-host/qa.ts';
import { registerAgent } from '../src/agent-host/registry.ts';
import { ensurePartitions, startAgentRuntime, WAKE_CHANNEL } from '../src/agent-host/scheduler.ts';
import { pgMemory } from '../src/agent-host/store/memory.ts';
import { PgActorStore } from '../src/agent-host/store/pg-store.ts';
import { noTransport, whatsappTransport } from '../src/agent-host/transports/whatsapp.ts';
import {
  deployVersions,
  pgVersionResolver,
  ringPass,
  setStage,
} from '../src/agent-host/versions.ts';
import { controlTx } from '../src/modules/control.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';

// ADR 0030: Agent Runtime v3 on Postgres. The runtime runs as vendua_app, so every read and
// write a turn makes goes through RLS, as in production.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const remember = defineTool<{ note: string; fail?: boolean | undefined }, Sql>({
  name: 'remember_note',
  description: 'Writes a note (a business write) in the step transaction.',
  effect: 'write',
  input: s.object({ note: s.string({ max: 100 }), fail: s.boolean().optional() }),
  run: async (ctx, input) => {
    await ctx.tx`
      insert into agent_memory (tenant_id, scope, key, value, confidence, provenance)
      values (${ctx.tenantId}, ${'test:' + ctx.subject.id}, 'nota', ${ctx.tx.json(input.note)}, 1, 'test')
      on conflict (tenant_id, scope, key) do update set value = excluded.value`;
    if (input.fail) throw new ToolError('não deu');
    return { content: 'anotado' };
  },
});

function def(over: Partial<AgentDefinition<Sql>> = {}): AgentDefinition<Sql> {
  return {
    id: 'rt_test',
    subject: 'thread',
    lane: 'interactive',
    transport: 'whatsapp',
    models: { default: 'fast' },
    instructions: [{ id: 'base', tier: 'static', text: 'Teste.', priority: 100 }],
    tools: [remember],
    guards: { output: [grounded()] },
    mailbox: { preempt: true },
    compaction: false,
    ...over,
  };
}

const transport = whatsappTransport({ recipient: async () => '11987654321' });

function gatewayFor(script: ScriptedOutput[]): ModelGateway {
  return createGateway({
    adapters: [scriptedAdapter(script)],
    routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
  });
}

const reply = (text: string): ScriptedOutput => ({
  toolCalls: [{ name: 'reply', args: { text } }],
});

describe.skipIf(!OWNER_URL)('agent runtime v3 on Postgres', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const app = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const tenants: string[] = [];
  let tenantId = '';
  let otherTenant = '';
  let agent: Agent<Sql>;
  let n = 0;

  const newTenant = async () => {
    const slug = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const [t] = await sql<
      { id: string }[]
    >`insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`;
    tenants.push(t!.id);
    return t!.id;
  };

  const say = (text: string, subject = 's1', tenant = tenantId, agentId = 'rt_test') =>
    withTenant(app, tenant, (tx) =>
      dispatchTx(tx, {
        actor: { tenantId: tenant, agentId, subject: { kind: 'thread', id: subject } },
        kind: 'message.inbound',
        source: 'whatsapp',
        dedupeKey: `wa:${subject}:${++n}:${Math.random()}`,
        payload: { text },
      }),
    );

  const runtimeWith = (script: ScriptedOutput[], a: Agent<Sql> = agent, owner = 'w1') =>
    new Runtime<Sql>({
      agents: [a],
      store: new PgActorStore(app),
      gateway: gatewayFor(script),
      transports: [transport],
      owner,
      memory: pgMemory,
      hooks: hostHooks(),
      resolver: pgVersionResolver(app),
    });

  // the scripted model answers whichever actor is claimed: keep the others parked
  const only = (actorId: string) =>
    sql`update agent_actors set next_wake_at = null where id <> ${actorId} and agent_id like 'rt_%'`;

  const events = (actorId: string) =>
    sql<{ seq: number; type: string; payload: Record<string, unknown>; version: string }[]>`
      select seq::int as seq, type, payload, version from agent_events where actor_id = ${actorId} order by seq`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = await newTenant();
    otherTenant = await newTenant();
    agent = defineAgent(def());
    registerAgent(agent);
  });

  afterAll(async () => {
    for (const id of tenants) await sql`delete from tenants where id = ${id}`;
    await sql`delete from agent_versions where agent_id like 'rt_%'`;
    await sql.end();
    await (app as unknown as { end: () => Promise<void> }).end();
  });

  test('dispatchTx: one actor per subject, dedupe per store, and the actor becomes due', async () => {
    const first = await withTenant(app, tenantId, (tx) =>
      dispatchTx(tx, {
        actor: { tenantId, agentId: 'rt_test', subject: { kind: 'thread', id: 'dedupe' } },
        kind: 'webhook.pix_paid',
        source: 'mercadopago',
        dedupeKey: 'mp:123',
      }),
    );
    const again = await withTenant(app, tenantId, (tx) =>
      dispatchTx(tx, {
        actor: { tenantId, agentId: 'rt_test', subject: { kind: 'thread', id: 'dedupe' } },
        kind: 'webhook.pix_paid',
        source: 'mercadopago',
        dedupeKey: 'mp:123',
      }),
    );
    expect(first.inserted).toBe(true);
    expect(again).toEqual({ actorId: first.actorId, mailboxId: null, inserted: false });
    const [a] = await sql<{ next_wake_at: Date | null; lane: string }[]>`
      select next_wake_at, lane from agent_actors where id = ${first.actorId}`;
    expect(a!.lane).toBe('interactive');
    expect(a!.next_wake_at).not.toBeNull();
  });

  test('a store sees only its own actors (RLS)', async () => {
    const { actorId } = await say('oi', 'rls');
    const mine = await withTenant(
      app,
      tenantId,
      (tx) => tx`select 1 from agent_actors where id = ${actorId}`,
    );
    const theirs = await withTenant(
      app,
      otherTenant,
      (tx) => tx`select 1 from agent_actors where id = ${actorId}`,
    );
    const events = await withTenant(
      app,
      otherTenant,
      (tx) => tx`select 1 from agent_mailbox where actor_id = ${actorId}`,
    );
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  test('a turn: the reply is an outbox row of the store’s WhatsApp, committed with its events', async () => {
    const { actorId } = await say('oi', 'turn');
    await only(actorId);
    const rt = runtimeWith([reply('Olá! Em que posso ajudar?')]);
    let ran = 0;
    for (let i = 0; i < 5 && ran === 0; i++)
      ran = await rt.pump('interactive', { limit: 50, perTenantCap: 50 });
    const log = await events(actorId);
    expect(log.map((e) => e.type)).toEqual([
      'turn.started',
      'model.responded',
      'tool.returned',
      'message.sent',
      'turn.ended',
    ]);
    expect(new Set(log.map((e) => e.version))).toEqual(new Set([agent.version]));
    const sent = log.find((e) => e.type === 'message.sent')!;
    const [row] = await sql<{ kind: string; phone: string; body: string; agent_step: string }[]>`
      select kind, phone, body, agent_step from store_wa_messages where id = ${sent.payload.outboxId as string}`;
    expect(row).toMatchObject({
      kind: 'agent',
      phone: '11987654321',
      body: 'Olá! Em que posso ajudar?',
    });
    const [actor] = await sql<{ owner: string | null; attempts: number; projection_seq: number }[]>`
      select owner, attempts, projection_seq::int as projection_seq from agent_actors where id = ${actorId}`;
    expect(actor).toEqual({ owner: null, attempts: 0, projection_seq: 5 });
  });

  test('a ToolError rolls back the tool’s write; a success commits it with tool.returned', async () => {
    const { actorId } = await say('anota', 'tool');
    await only(actorId);
    const rt = runtimeWith([
      { toolCalls: [{ name: 'remember_note', args: { note: 'primeira', fail: true } }] },
      { toolCalls: [{ name: 'remember_note', args: { note: 'segunda' } }] },
      reply('Anotado.'),
    ]);
    for (let i = 0; i < 5; i++)
      if (await rt.pump('interactive', { limit: 50, perTenantCap: 50 })) break;
    const [note] = await sql<{ value: string }[]>`
      select value from agent_memory where tenant_id = ${tenantId} and scope = 'test:tool' and key = 'nota'`;
    expect(note!.value).toBe('segunda');
    const returned = (await events(actorId)).filter((e) => e.type === 'tool.returned');
    expect(returned.map((e) => e.payload.ok)).toEqual([false, true, true]);
  });

  test('the fence: a stolen lease can’t write, and the thief has the next epoch', async () => {
    const { actorId } = await say('oi', 'fence');
    const store = new PgActorStore(app);
    // make it the only due actor this test claims
    await sql`update agent_actors set next_wake_at = null where tenant_id = ${tenantId} and id <> ${actorId}`;
    const claim = (owner: string, leaseMs: number) =>
      store.claim({
        lane: 'interactive',
        owner,
        leaseMs,
        limit: 1,
        agentIds: ['rt_test'],
        perTenantCap: 5,
        backoffMs: () => 0,
      });
    const [a] = await claim('a', 200);
    expect(a!.actor.id).toBe(actorId);
    await sql`update agent_actors set lease_until = now() - interval '1 second', next_wake_at = now() where id = ${actorId}`;
    const [b] = await claim('b', 60_000);
    expect(b!.lease.epoch).toBe(a!.lease.epoch + 1);
    await expect(store.fenced(a!.lease, async () => 1)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await store.fenced(b!.lease, async (tx) => tx.actor.id)).toBe(actorId);
    await store.release(b!.lease, { clean: true });
  });

  test('claims rotate across stores and respect the per-store cap', async () => {
    await sql`update agent_actors set next_wake_at = null where agent_id = 'rt_test'`;
    for (let i = 0; i < 4; i++) await say('oi', `busy${i}`);
    await say('oi', 'quiet', otherTenant);
    const store = new PgActorStore(app);
    const claimed = await store.claim({
      lane: 'interactive',
      owner: 'fair',
      leaseMs: 60_000,
      limit: 3,
      agentIds: ['rt_test'],
      perTenantCap: 2,
      backoffMs: () => 0,
    });
    expect(claimed.map((c) => c.actor.tenantId).sort()).toEqual(
      [tenantId, tenantId, otherTenant].sort(),
    );
    for (const c of claimed) await store.release(c.lease, { clean: true });
    await sql`update agent_actors set next_wake_at = null where agent_id = 'rt_test'`;
  });

  test('a turn that keeps failing ends in turn.failed and a staff event for that store', async () => {
    const failing = defineAgent(def({ id: 'rt_fail', maxAttempts: 1 }));
    registerAgent(failing);
    const { actorId } = await say('oi', 'fail', tenantId, 'rt_fail');
    await only(actorId);
    const broken = createGateway({
      adapters: [
        scriptedAdapter([
          { error: { status: 400, message: 'bad request' } },
          { error: { status: 400, message: 'bad request' } },
        ]),
      ],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    const rt = new Runtime<Sql>({
      agents: [failing],
      store: new PgActorStore(app),
      gateway: broken,
      transports: [transport],
      owner: 'wf',
      hooks: hostHooks(),
    });
    for (let i = 0; i < 3; i++) {
      await sql`update agent_actors set next_wake_at = now() where id = ${actorId} and owner is null`;
      await rt.pump('interactive', { limit: 50, perTenantCap: 50 });
    }
    expect((await events(actorId)).map((e) => e.type)).toContain('turn.failed');
    const staff = await sql<{ kind: string; tenant_id: string; data: Record<string, unknown> }[]>`
      select kind, tenant_id, data from staff_events where kind = 'agent.turn_failed' and data ->> 'actorId' = ${actorId}`;
    expect(staff).toHaveLength(1);
    expect(staff[0]!.tenant_id).toBe(tenantId);
    expect(JSON.stringify(staff[0]!.data)).not.toContain('11987654321');
    await sql`delete from staff_events where kind = 'agent.turn_failed' and data ->> 'actorId' = ${actorId}`;
  });

  test('the scheduler wakes on NOTIFY and runs the turn by itself', async () => {
    const live = defineAgent(def({ id: 'rt_live' }));
    registerAgent(live);
    const handle = startAgentRuntime(app, {
      agents: [live],
      versions: [live],
      transports: [transport],
      gateway: gatewayFor([reply('Oi, já te atendo.')]),
      rings: false,
    });
    const woke: string[] = [];
    const sub = await sql.listen(WAKE_CHANNEL, (p) => void woke.push(p));
    try {
      await new Promise((r) => setTimeout(r, 300));
      const { actorId } = await say('oi', 'live', tenantId, 'rt_live');
      for (let i = 0; i < 50; i++) {
        const done =
          await sql`select 1 from agent_events where actor_id = ${actorId} and type = 'turn.ended'`;
        if (done.length) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect((await events(actorId)).map((e) => e.type)).toContain('message.sent');
      expect(woke).toContain('interactive');
    } finally {
      await sub.unlisten();
      await handle.stop(2_000);
    }
  });

  test('versions: first deploy is everyone’s, later ones are candidates; pins and rings resolve', async () => {
    const v1 = defineAgent(def({ id: 'rt_ring' }));
    const v2 = defineAgent(
      def({ id: 'rt_ring', instructions: [{ id: 'base', tier: 'static', text: 'v2' }] }),
    );
    expect(await deployVersions(app, [v1])).toEqual([v1.version]);
    expect(await deployVersions(app, [v2])).toEqual([v2.version]);
    const stages = await sql<{ version: string; stage: string }[]>`
      select version, stage from agent_versions where agent_id = 'rt_ring' order by created_at`;
    expect(stages.map((s) => s.stage)).toEqual(['all', 'candidate']);

    await sql`insert into storefront_ops (tenant_id, ring) values (${tenantId}, 'canary')
              on conflict (tenant_id) do update set ring = 'canary'`;
    expect(await pgVersionResolver(app).resolve(tenantId, 'rt_ring')).toBe(v1.version);
    await sql`update agent_versions set evals_passed_at = now() where version = ${v2.version}`;
    const pass = await ringPass(app);
    expect(pass.find((p) => p.version === v2.version)?.decision).toBe('promote');
    expect(await pgVersionResolver(app).resolve(tenantId, 'rt_ring')).toBe(v2.version);
    expect(await pgVersionResolver(app).resolve(otherTenant, 'rt_ring')).toBe(v1.version);

    await sql`insert into agent_version_pins (tenant_id, agent_id, version) values (${otherTenant}, 'rt_ring', ${v2.version})`;
    expect(await pgVersionResolver(app).resolve(otherTenant, 'rt_ring')).toBe(v2.version);

    await controlTx(app, (tx) =>
      setStage(tx, v2.version, 'rolled_back', { reason: 'guard blocks 3× baseline', by: 'rings' }),
    );
    const [rb] = await sql<{ data: { reasons: string[] } }[]>`
      select data from staff_events where kind = 'agent.version_rollback' and data ->> 'version' = ${v2.version}`;
    expect(rb!.data.reasons).toEqual(['guard blocks 3× baseline']);
    await sql`delete from staff_events where kind = 'agent.version_rollback' and data ->> 'version' = ${v2.version}`;
  });

  test('online QA: a sampled conversation is scored, and a low mean alerts the team', async () => {
    const qa = hostOnlineQa({ sampleRate: 1, window: 1, alertBelow: 0.5 });
    registerAgent(qa.agent);
    const { actorId } = await say('oi', 'qa');
    await only(actorId);
    const seller = new Runtime<Sql>({
      agents: [agent],
      store: new PgActorStore(app),
      gateway: gatewayFor([reply('Oi!')]),
      transports: [transport],
      owner: 'wq',
      hooks: hostHooks({ qa: qa.turnEnded }),
    });
    await seller.pump('interactive', { limit: 50, perTenantCap: 50 });
    const [sample] = await sql<{ id: string; actor_id: string }[]>`
      select m.id, m.actor_id from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.agent_id = 'online_qa' and a.subject_id = ${actorId}`;
    expect(sample).toBeDefined();
    await sql`update agent_mailbox set deliver_at = now() where id = ${sample!.id}`;
    await sql`update agent_actors set next_wake_at = now() where id = ${sample!.actor_id}`;
    const judge = new Runtime<Sql>({
      agents: [qa.agent],
      store: new PgActorStore(app),
      gateway: gatewayFor([
        {
          toolCalls: [{ name: 'record_score', args: { score: 0.2, reason: 'inventou um prazo' } }],
        },
      ]),
      transports: [noTransport],
      owner: 'wj',
      hooks: hostHooks(),
    });
    expect(await judge.pump('background', { limit: 5, perTenantCap: 5 })).toBe(1);
    const scored = await events(sample!.actor_id);
    expect(scored.find((e) => e.type === 'tool.returned')?.payload).toMatchObject({
      name: 'record_score',
      ok: true,
    });
    const alerts = await sql<{ tenant_id: string; data: { mean: number } }[]>`
      select tenant_id, data from staff_events where kind = 'agent.qa_alert' and tenant_id = ${tenantId}`;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.data.mean).toBeCloseTo(0.2);
    await sql`delete from staff_events where kind = 'agent.qa_alert' and tenant_id = ${tenantId}`;
  });

  test('review fixes: stray rows leave the default partition; stale stages, unknown stores and byte limits are refused', async () => {
    const { actorId } = await say('oi', 'stray');
    await sql`insert into agent_events (tenant_id, actor_id, seq, type, payload, version, at)
              values (${tenantId}, ${actorId}, 999, 'test.stray', '{}'::jsonb, 'v', '2031-05-10')`;
    await sql`select agent_events_partition('2031-05-01')`;
    const [moved] = await sql<
      { n: number }[]
    >`select count(*)::int as n from agent_events_y2031m05`;
    expect(moved!.n).toBe(1);
    await sql`delete from agent_events where actor_id = ${actorId} and seq = 999`;

    const v = defineAgent(def({ id: 'rt_stale' }));
    await deployVersions(app, [v]);
    // the controller decided from 'canary', but staff moved it meanwhile
    expect(
      await controlTx(app, (tx) =>
        setStage(tx, v.version, 'early', { by: 'rings', from: 'canary' }),
      ),
    ).toBe(false);
    const [still] = await sql<
      { stage: string }[]
    >`select stage from agent_versions where version = ${v.version}`;
    expect(still!.stage).toBe('all');

    const http = createApp({
      sql: app,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
    });
    const pin = await http.request(
      `/control/v1/agent-runtime/stores/00000000-0000-4000-8000-000000000000/pins/rt_stale`,
      {
        method: 'PUT',
        headers: {
          'x-vendua-control': 'ctl',
          'idempotency-key': `pin-${Math.random()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ version: v.version }),
      },
    );
    expect(pin.status).toBe(404);

    const big = 'é'.repeat(20_000); // 20k chars, 40 kB
    await expect(
      withTenant(app, tenantId, (tx) =>
        dispatchTx(tx, {
          actor: { tenantId, agentId: 'rt_test', subject: { kind: 'thread', id: 'big' } },
          kind: 'message.inbound',
          source: 'test',
          dedupeKey: `big:${Math.random()}`,
          payload: { text: big },
        }),
      ),
    ).rejects.toThrow('too large');
  });

  test('the turn inspector reads the log; bad ids are 4xx', async () => {
    const [actor] = await sql<
      { id: string }[]
    >`select id from agent_actors where tenant_id = ${tenantId} and subject_id = 'turn'`;
    const http = createApp({
      sql: app,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
    });
    const ok = await http.request(`/control/v1/agent-runtime/actors/${actor!.id}`, {
      headers: { 'x-vendua-control': 'ctl' },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { events: { type: string }[] };
    expect(body.events.map((e) => e.type)).toContain('message.sent');
    const bad = await http.request('/control/v1/agent-runtime/actors/not-a-uuid', {
      headers: { 'x-vendua-control': 'ctl' },
    });
    expect(bad.status).toBe(400);
    const none = await http.request(
      '/control/v1/agent-runtime/actors/00000000-0000-4000-8000-000000000000',
      {
        headers: { 'x-vendua-control': 'ctl' },
      },
    );
    expect(none.status).toBe(404);
  });

  test('partitions: the log lands in its month, and forget erases a conversation', async () => {
    await ensurePartitions(app);
    const month = new Date().toISOString().slice(0, 7).replace('-', 'm');
    const [part] = await sql<{ n: number }[]>`
      select count(*)::int as n from ${sql(`agent_events_y${month}`)}`;
    expect(part!.n).toBeGreaterThan(0);
    const [count] = await sql<
      { n: number }[]
    >`select count(*)::int as n from agent_actors where tenant_id = ${tenantId} and subject_id = 'turn'`;
    expect(count!.n).toBe(1);
    const gone = await withTenant(app, tenantId, (tx) =>
      forgetSubjectTx(tx, tenantId, { kind: 'thread', id: 'turn' }),
    );
    expect(gone).toBe(1);
  });
});
