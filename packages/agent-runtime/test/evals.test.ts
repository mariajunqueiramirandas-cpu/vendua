import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway, defineAgent, Runtime, type AgentEvent } from '../src/index.ts';
import {
  CassetteMissError,
  cassetteGateway,
  defineOnlineQa,
  diffReport,
  evaluateCandidate,
  judge,
  kvEquals,
  loadCassette,
  metricsFromEvents,
  nextStage,
  noFailedTurns,
  noHandoff,
  noLiteralFigures,
  passK,
  persona,
  recordingGateway,
  replay,
  requestHash,
  resolveStage,
  RollingScore,
  runScenario,
  saveCassette,
  scenario,
  scriptedPersona,
  sentMatches,
  shareBucket,
  shouldSample,
  stateReached,
  toolCalled,
  turnsAtMost,
  type VersionRollout,
} from '../src/evals/index.ts';
import type { ScriptedOutput } from '../src/model/adapters/scripted.ts';
import { drive, FakeClock, MemoryStore, scriptedAdapter } from '../src/testing/index.ts';
import { agentDef, call, reply, TENANT, type Script } from './helpers.ts';

function gw(script: Script) {
  const adapter = scriptedAdapter(script);
  const gateway = createGateway({
    adapters: [adapter],
    routes: { routes: async () => [{ provider: 'scripted', model: 'test', zdr: true }] },
  });
  return { adapter, gateway };
}

const seller = defineAgent(agentDef());

// turn 1: add, quote, cite the total; turn 2: thank
const sellerScript = (): ScriptedOutput[] => [
  call('add_item', { item: 'calabresa', qty: 2 }),
  call('quote'),
  reply('Total {{cart.total}}. Mais alguma coisa?'),
  reply('Obrigado, já já sai!'),
];

const duas = scenario('duas calabresas', {
  agent: seller,
  user: scriptedPersona(['quero 2 calabresas', 'só isso, obrigado [FIM]'], { calabresa: 2 }),
  expect: [
    noLiteralFigures(),
    turnsAtMost(2),
    noHandoff(),
    noFailedTurns(),
    toolCalled('add_item', (args) => (args as { qty: number }).qty === 2),
    stateReached('building'),
    sentMatches(/R\$ 50,00/),
    kvEquals('cart:eval-duas-calabresas', [{ item: 'calabresa', qty: 2 }]),
  ],
});

describe('scenarios', () => {
  test('a scripted persona against a scripted agent passes pass^k', async () => {
    const r = await passK(duas, 3, (sc) =>
      runScenario(sc, { gateway: gw(sellerScript()).gateway }),
    );
    expect(r.runs).toHaveLength(3);
    expect(r.passed).toBe(true);
    expect(r.passAt1).toBe(1);
    const run = r.runs[0]!.result;
    expect(run.ended).toBe('persona');
    expect(run.transcript).toEqual([
      { role: 'user', text: 'quero 2 calabresas' },
      { role: 'agent', text: 'Total R$ 50,00. Mais alguma coisa?' },
      { role: 'user', text: 'só isso, obrigado' },
      { role: 'agent', text: 'Obrigado, já já sai!' },
    ]);
  });

  test('a failing assertion fails the run and names itself', async () => {
    const sc = scenario('falha', {
      agent: seller,
      user: scriptedPersona(['quero 2 calabresas', 'só isso']),
      expect: [turnsAtMost(1), sentMatches(/pix/i), noHandoff()],
    });
    const r = await runScenario(sc, { gateway: gw(sellerScript()).gateway });
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(['turnsAtMost(1): 2 turns', expect.stringContaining('sentMatches')]);
  });

  test('a typed amount that got out fails noLiteralFigures', async () => {
    const loose = defineAgent(agentDef({ guards: { output: [] } }));
    const sc = scenario('literal', {
      agent: loose,
      user: scriptedPersona(['quanto é?']),
      expect: [noLiteralFigures()],
    });
    const r = await runScenario(sc, { gateway: gw([reply('Deu R$ 50,00')]).gateway });
    expect(r.failures[0]).toMatch(/^noLiteralFigures: #\d+: /);
  });

  test('pass^k fails when one of k runs fails, and keeps pass@1', async () => {
    let n = 0;
    const r = await passK(duas, 3, (sc) => {
      const script = sellerScript();
      if (n++ === 1) script[2] = reply('Já anoto.');
      return runScenario(sc, { gateway: gw(script).gateway });
    });
    expect(r.passed).toBe(false);
    expect(r.passAt1).toBeCloseTo(2 / 3);
  });

  test('a model persona runs under every listed user model', async () => {
    const sc = scenario('persona modelo', {
      agent: seller,
      user: persona({ goal: 'duas calabresas', style: 'pressa', opening: 'oi' }),
      expect: [noFailedTurns()],
      models: ['user-a', 'user-b'],
      k: 2,
    });
    const userAdapters: ReturnType<typeof gw>['adapter'][] = [];
    const r = await passK(sc, undefined, (s, ctx) => {
      const user = gw([{ text: 'quero 2 calabresas' }, { text: 'valeu [FIM]' }]);
      userAdapters.push(user.adapter);
      return runScenario(
        s,
        {
          gateway: gw([reply('Olá!'), reply('Anotado.'), reply('Até mais!')]).gateway,
          userGateway: (model) => {
            expect(model).toBe(ctx.model!);
            return user.gateway;
          },
        },
        { userModel: ctx.model! },
      );
    });
    expect(r.runs).toHaveLength(4);
    expect(r.byModel.map((m) => m.model)).toEqual(['user-a', 'user-b']);
    expect(r.passed).toBe(true);
    const req = userAdapters[0]!.requests[0]!;
    expect(req.system[0]!.text).toContain('duas calabresas');
    expect(req.system[0]!.text).toContain('[FIM]');
    // the store speaks as `user` to the simulated shopper
    expect(req.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(r.runs[0]!.result.transcript.map((x) => x.text)).toEqual([
      'oi',
      'Olá!',
      'quero 2 calabresas',
      'Anotado.',
      'valeu',
      'Até mais!',
    ]);
  });

  test('judge passes or fails on the parsed verdict', async () => {
    const sc = () =>
      scenario('juiz', {
        agent: seller,
        user: scriptedPersona(['oi']),
        expect: [judge('Cordial e breve.')],
      });
    const ok = await runScenario(sc(), {
      gateway: gw([reply('Olá!')]).gateway,
      judgeGateway: gw([{ text: '{"pass": true, "score": 0.9, "reason": "Cordial."}' }]).gateway,
    });
    expect(ok.passed).toBe(true);
    const bad = await runScenario(sc(), {
      gateway: gw([reply('Olá!')]).gateway,
      judgeGateway: gw([{ text: 'Veredito: {"pass": false, "score": 0.2, "reason": "Seco."}' }])
        .gateway,
    });
    expect(bad.failures).toEqual([expect.stringContaining('0.2: Seco.')]);
  });
});

describe('cassettes', () => {
  test('a recorded run replays deterministically and survives a save/load', async () => {
    const rec = recordingGateway(gw(sellerScript()).gateway);
    const live = await runScenario(duas, { gateway: rec });
    expect(live.passed).toBe(true);
    expect(Object.values(rec.cassette.entries).flat()).toHaveLength(4);

    const path = join(tmpdir(), `cassette-${crypto.randomUUID()}.json`);
    await saveCassette(path, rec.cassette);
    const loaded = await loadCassette(path);
    const r = await passK(duas, 2, (sc) => runScenario(sc, { gateway: cassetteGateway(loaded) }));
    expect(r.passed).toBe(true);
    expect(r.runs[1]!.result.outbox.map((m) => m.text)).toEqual(live.outbox.map((m) => m.text));
  });

  test('a request the cassette never saw is a miss with its hash', async () => {
    const rec = recordingGateway(gw(sellerScript()).gateway);
    await runScenario(duas, { gateway: rec });
    const changed = defineAgent(
      agentDef({ instructions: [{ id: 'base', tier: 'static', text: 'Você vende esfirra.' }] }),
    );
    const replayGw = cassetteGateway(rec.cassette);
    const clock = new FakeClock();
    const store = new MemoryStore(clock);
    const misses: unknown[] = [];
    const runtime = new Runtime({
      agents: [changed],
      store,
      gateway: {
        generate: (req, o) =>
          replayGw.generate(req, o).catch((e) => {
            misses.push(e);
            throw e;
          }),
      },
      transports: [store.transport('memory')],
      owner: 't',
      clock,
    });
    await store.dispatch({
      actor: { tenantId: TENANT, agentId: 'seller', subject: { kind: 'thread', id: 'x' } },
      kind: 'message.inbound',
      source: 'test',
      dedupeKey: 'x1',
      payload: { text: 'quero 2 calabresas' },
    });
    await drive(runtime, clock);
    const miss = misses[0] as CassetteMissError;
    expect(miss).toBeInstanceOf(CassetteMissError);
    expect(miss.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.cassette.entries[miss.hash]).toBeUndefined();
  });

  test('the hash ignores routing metadata', () => {
    const base = {
      tier: 'fast' as const,
      system: [{ id: 'a', tier: 'static' as const, text: 'x', cache: true }],
      messages: [],
      volatile: null,
      tools: [],
      maxTokens: 10,
    };
    const meta = (turnId: string) => ({
      tenantId: 't',
      agentId: 'a',
      actorId: 'x',
      turnId,
      lane: 'interactive' as const,
    });
    expect(requestHash({ ...base, meta: meta('1') })).toBe(
      requestHash({ ...base, meta: meta('2') }),
    );
    expect(requestHash({ ...base, volatile: 'AGORA', meta: meta('1') })).not.toBe(
      requestHash({ ...base, meta: meta('1') }),
    );
  });
});

describe('counterfactual replay', () => {
  test('a candidate answers the recorded inputs and the diff says what changed', async () => {
    const live = await runScenario(duas, { gateway: gw(sellerScript()).gateway });
    const second = live.log.filter((e) => e.type === 'turn.started')[1]!;
    const candidate = defineAgent(
      agentDef({
        instructions: [{ id: 'base', tier: 'static', text: 'Você vende pizza. Seja caloroso.' }],
      }),
    );
    expect(candidate.version).not.toBe(seller.version);
    const cand = gw([reply('Valeu demais, até a próxima!')]);
    const r = await replay({
      log: live.log,
      fromSeq: second.seq,
      candidate,
      gateway: cand.gateway,
    });
    expect(r.original).toEqual(['Obrigado, já já sai!']);
    expect(r.candidate).toEqual(['Valeu demais, até a próxima!']);
    expect(r.diff.same).toBe(false);
    expect(r.diff.changed).toEqual([
      { index: 0, original: 'Obrigado, já já sai!', candidate: 'Valeu demais, até a próxima!' },
    ]);
    // the candidate saw the first turn from the log, then only the second input
    const msgs = cand.adapter.requests[0]!.messages;
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(r.log.every((e) => e.version === candidate.version)).toBe(true);
    const report = diffReport(r);
    expect(report).toContain('- Obrigado, já já sai!');
    expect(report).toContain('+ Valeu demais, até a próxima!');
  });

  test('replaying from the start with the same outputs reports no change', async () => {
    const live = await runScenario(duas, { gateway: gw(sellerScript()).gateway });
    const r = await replay({
      log: live.log,
      fromSeq: 1,
      candidate: seller,
      gateway: gw(sellerScript()).gateway,
    });
    expect(r.candidate).toEqual(r.original);
    expect(r.diff.same).toBe(true);
    expect(diffReport(r)).toBe(`replay from #1: no change`);
  });
});

describe('rings', () => {
  const versions: VersionRollout[] = [
    { version: 'v1', stage: 'all' },
    { version: 'v2', stage: 'share', sharePct: 50 },
    { version: 'v3', stage: 'canary' },
  ];
  const inShare = Array.from({ length: 200 }, (_, i) => `t${i}`).find((t) => shareBucket(t) < 50)!;
  const outShare = Array.from({ length: 200 }, (_, i) => `t${i}`).find(
    (t) => shareBucket(t) >= 50,
  )!;

  test('the newest version covering the ring wins', () => {
    expect(resolveStage('canary', 'any', versions)?.version).toBe('v3');
    expect(resolveStage('early', 'any', versions)?.version).toBe('v2');
    expect(resolveStage('stable', inShare, versions)?.version).toBe('v2');
    expect(resolveStage('stable', outShare, versions)?.version).toBe('v1');
    expect(resolveStage('stable', outShare, versions, 'v3')?.version).toBe('v3');
    expect(
      resolveStage('canary', 'any', [
        ...versions.slice(0, 2),
        { version: 'v3', stage: 'rolled_back' },
      ])?.version,
    ).toBe('v2');
    expect(resolveStage('stable', 'x', [{ version: 'v9', stage: 'canary' }])).toBeNull();
  });

  test('the share bucket is stable and roughly uniform', () => {
    expect(shareBucket('abc')).toBe(shareBucket('abc'));
    const n = Array.from({ length: 2000 }, (_, i) => shareBucket(`tenant-${i}`)).filter(
      (b) => b < 25,
    ).length;
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(600);
  });

  test('stages advance canary → early → share → all', () => {
    expect(nextStage('canary')).toBe('early');
    expect(nextStage('early')).toBe('share');
    expect(nextStage('share')).toBe('all');
    expect(nextStage('all')).toBeNull();
    expect(nextStage('rolled_back')).toBeNull();
  });

  test('promote, hold and rollback', () => {
    const base = { turns: 1000, failedTurns: 5, guardBlocks: 50, handoffs: 20, orders: 300 };
    const day = 25 * 3_600_000;
    expect(evaluateCandidate({ ...base, soakMs: day }, base).decision).toBe('promote');
    const young = evaluateCandidate(
      { turns: 100, failedTurns: 0, guardBlocks: 5, handoffs: 2, orders: 30, soakMs: 3_600_000 },
      base,
    );
    expect(young.decision).toBe('hold');
    expect(young.reasons.join()).toContain('100 of 200 turns');
    const blocks = evaluateCandidate({ ...base, guardBlocks: 75, soakMs: day }, base);
    expect(blocks).toEqual({ decision: 'hold', reasons: ['guard blocks 1.50× baseline'] });
    const bad = evaluateCandidate({ ...base, handoffs: 60, soakMs: day }, base);
    expect(bad.decision).toBe('rollback');
    expect(bad.reasons).toEqual(['handoffs 3.00× baseline']);
    const failing = evaluateCandidate({ ...base, turns: 40, failedTurns: 8 }, base);
    expect(failing.decision).toBe('rollback');
    const conv = evaluateCandidate({ ...base, orders: 100, soakMs: day }, base);
    expect(conv.decision).toBe('rollback');
    const qa = evaluateCandidate({ ...base, qaMean: 0.7, soakMs: day }, { ...base, qaMean: 0.82 });
    expect(qa.decision).toBe('hold');
  });

  test('metrics come from the log', async () => {
    const live = await runScenario(duas, { gateway: gw(sellerScript()).gateway });
    const m = metricsFromEvents(live.log, { orderTools: ['add_item'] });
    expect(m).toMatchObject({ turns: 2, failedTurns: 0, guardBlocks: 0, handoffs: 0, orders: 1 });
    expect(m.soakMs).toBeGreaterThan(0);
  });
});

describe('online QA', () => {
  test('a sampled conversation is scored through onScore', async () => {
    const scores: [string, number, string][] = [];
    const qa = defineOnlineQa<{ kv: Map<string, unknown> }>({
      rubric: 'Respondeu ao que o cliente pediu.',
      sampleRate: 1,
      alertBelow: 0.6,
      window: 3,
      transcript: async (ctx) => `conversa ${ctx.subject.id}\ncliente: oi\nloja: Olá!`,
      onScore: (ctx, score, reason) => {
        scores.push([ctx.subject.id, score, reason]);
      },
    });
    expect(qa.def.lane).toBe('background');
    const clock = new FakeClock();
    const store = new MemoryStore(clock, () => 'background');
    const { adapter, gateway } = gw([call('record_score', { score: 0.4, reason: 'Demorou.' })]);
    const runtime = new Runtime({
      agents: [qa],
      store,
      gateway,
      transports: [{ id: 'none', send: async () => ({ outboxId: 'none' }) }],
      owner: 'qa',
      clock,
    });
    const target = { tenantId: TENANT, actorId: 'actor-1', turnId: 'turn-1' };
    expect((await store.dispatch(qa.qa.sample(target))).inserted).toBe(true);
    expect((await store.dispatch(qa.qa.sample(target))).inserted).toBe(false);
    await drive(runtime, clock);
    expect(scores).toEqual([['actor-1', 0.4, 'Demorou.']]);
    expect(adapter.requests).toHaveLength(1);
    const system = adapter.requests[0]!.system.map((b) => b.text).join('\n');
    expect(system).toContain('RUBRICA:\nRespondeu ao que o cliente pediu.');
    expect(system).toContain('conversa actor-1');
    const log: AgentEvent[] = store.log(store.allActors()[0]!.id);
    expect(log.map((e) => e.type)).toContain('turn.ended');
    expect(store.outbox).toHaveLength(0);
  });

  test('sampling is deterministic by actor', () => {
    expect(shouldSample('a', 0)).toBe(false);
    expect(shouldSample('a', 1)).toBe(true);
    expect(shouldSample('abc', 0.3)).toBe(shouldSample('abc', 0.3));
    const n = Array.from({ length: 2000 }, (_, i) => shouldSample(`actor-${i}`, 0.1)).filter(
      Boolean,
    ).length;
    expect(n).toBeGreaterThan(140);
    expect(n).toBeLessThan(260);
  });

  test('a rolling mean alerts on drops once the window is full', () => {
    const r = new RollingScore(3, 0.6);
    expect(r.push(0.2).alert).toBe(false);
    expect(r.push(0.3).alert).toBe(false);
    expect(r.push(0.4)).toEqual({ mean: expect.closeTo(0.3), alert: true });
    r.push(1);
    r.push(1);
    expect(r.alert).toBe(false);
    expect(RollingScore.of([0.9, 0.1, 0.1, 0.2], 3, 0.5).mean).toBeCloseTo(0.4 / 3);
  });
});
