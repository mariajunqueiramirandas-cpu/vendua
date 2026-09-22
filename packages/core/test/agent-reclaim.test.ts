import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { claimRun, drain, enqueueRun, replayJournal, runOnce } from '../src/agent/runner.ts';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, getLeadDetail } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// ---------------------------------------------------------------------------
// replayJournal — pure journal → conversation rebuild (no DB).
// ---------------------------------------------------------------------------

describe('replayJournal', () => {
  test('empty journal replays nothing', () => {
    const r = replayJournal([]);
    expect(r.baseStep).toBe(0);
    expect(r.messages).toHaveLength(0);
    expect(r.book.size).toBe(0);
  });

  test('model + tool turns replay verbatim, in order', () => {
    const r = replayJournal([
      { type: 'system_prompt', content: 'SYS' },
      {
        type: 'model',
        content: 'buscando leads',
        toolCalls: [
          { id: 'call_1', name: 'web_search', args: { query: 'pudim' }, thoughtSignature: 'sig1' },
        ],
      },
      { type: 'tool', name: 'web_search', args: { query: 'pudim' }, out: { results: [] } },
      { type: 'model', content: 'fim', toolCalls: [] },
    ]);
    expect(r.baseStep).toBe(2);
    expect(r.messages).toEqual([
      {
        role: 'assistant',
        content: 'buscando leads',
        toolCalls: [
          { id: 'call_1', name: 'web_search', args: { query: 'pudim' }, thoughtSignature: 'sig1' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'web_search', content: '{"results":[]}' },
      { role: 'assistant', content: 'fim' },
    ]);
  });

  test('legacy names-only toolCalls still replay', () => {
    const r = replayJournal([
      { type: 'model', content: 'x', toolCalls: ['send_message'] },
      { type: 'tool', name: 'send_message', args: { body: 'oi' }, out: { ok: 1 } },
    ]);
    const assistant = r.messages[0]!;
    expect(assistant.role).toBe('assistant');
    const tc = (assistant as { toolCalls?: { id: string; args: unknown }[] }).toolCalls![0]!;
    // args restored from the journaled tool entry, id pairs with the result
    expect(tc.args).toEqual({ body: 'oi' });
    expect((r.messages[1] as { toolCallId: string }).toolCallId).toBe(tc.id);
  });

  test('a crashed batch replays interrupted results for unfulfilled calls', () => {
    const r = replayJournal([
      {
        type: 'model',
        content: null,
        toolCalls: [
          { id: 'a', name: 'maps_lookup', args: {} },
          { id: 'b', name: 'serp', args: {} },
        ],
      },
      // first call journaled pending (never resolved), second never journaled
      { type: 'tool', name: 'maps_lookup', args: {}, pending: true },
      { type: 'model', content: 'retry', toolCalls: [] },
    ]);
    const tools = r.messages.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(2);
    expect(JSON.parse(tools[0]!.content).interrupted).toBe(true);
    expect(JSON.parse(tools[1]!.content).interrupted).toBe(true);
    expect(tools[1]!.toolCallId).toBe('b');
  });

  test('nudge/reflection entries replay as user turns', () => {
    const r = replayJournal([
      { type: 'model', content: 'ok', toolCalls: [] },
      { type: 'nudge', content: 'continue' },
      { type: 'monid_spend', spentUsd: 0.01 },
    ]);
    expect(r.messages).toEqual([
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'continue' },
    ]);
  });

  test('only the latest attempt replays; baseStep counts all', () => {
    const prior = [
      { type: 'model', content: 'attempt1', toolCalls: [] },
      { type: 'resumed', attempt: 1 },
      { type: 'model', content: 'attempt2', toolCalls: [] },
    ];
    const r = replayJournal(prior);
    expect(r.baseStep).toBe(2);
    expect(r.messages).toEqual([{ role: 'assistant', content: 'attempt2' }]);
  });

  test('harness state accumulates across ALL attempts — not just the replayed one', () => {
    const r = replayJournal([
      // attempt 1: a maps hit and a serp contact — then the worker died
      {
        type: 'tool',
        name: 'maps_lookup',
        args: {},
        out: {
          candidates: [
            { name: 'A', phone: '+55111' },
            { name: 'B', phone: null },
          ],
        },
      },
      {
        type: 'tool',
        name: 'serp',
        args: {},
        out: {
          results: [{ contacts: { phones: ['+55222'], whatsappLinks: ['wa.me/1'], emails: [] } }],
        },
      },
      {
        type: 'tool',
        name: 'book',
        args: {},
        out: {
          entry: {
            name: 'Café Velho',
            city: null,
            status: 'open',
            channels: { email: 'a@velho.br' },
            tried: ['maps'],
            note: null,
          },
        },
      },
      { type: 'resumed', attempt: 1 },
      // attempt 2 replays only its own conversation — but the field state holds
      { type: 'model', content: 'other work', toolCalls: [] },
    ]);
    expect(r.seenContacts.has('+55111')).toBe(true);
    expect(r.seenContacts.has('+55222')).toBe(true);
    expect(r.seenContacts.has('wa.me/1')).toBe(true);
    expect(r.book.get('café velho')?.tried).toEqual(['maps']);
    expect(r.seenContacts.has('a@velho.br')).toBe(true);
    // conversation still bounded to the latest attempt
    expect(r.messages).toEqual([{ role: 'assistant', content: 'other work' }]);
  });

  test('book entries and banked contacts rebuild harness state', () => {
    const r = replayJournal([
      {
        type: 'model',
        content: null,
        toolCalls: [
          { id: 'b1', name: 'book', args: {} },
          { id: 'm1', name: 'instagram_profile', args: {} },
        ],
      },
      {
        type: 'tool',
        name: 'book',
        args: {},
        out: {
          entry: {
            name: 'Café Sol',
            city: 'Rio',
            status: 'open',
            channels: { whatsapp: '+5521999' },
            tried: ['ig'],
            note: null,
          },
        },
      },
      {
        type: 'tool',
        name: 'instagram_profile',
        args: {},
        out: { foundContacts: { phones: ['+5521888'], whatsappLinks: [], emails: ['a@b.co'] } },
      },
    ]);
    expect(r.book.get('café sol')?.tried).toEqual(['ig']);
    expect(r.seenContacts.has('+5521999')).toBe(true);
    expect(r.seenContacts.has('+5521888')).toBe(true);
    expect(r.seenContacts.has('a@b.co')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
// ---------------------------------------------------------------------------

const dbDescribe = describe.skipIf(!process.env.TEST_DATABASE_URL);

dbDescribe('worker robustness (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');

  const mkCtx = (runId: string, claimToken: string | null, leadId: string | null): ToolContext => ({
    sql,
    runId,
    runKind: 'reply',
    leadId,
    threadId: null,
    step: 0,
    claimToken,
    pageCache: new Map(),
    briefName: null,
    leadCap: 20,
    channelOverride: null,
    book: new Map(),
    plan: null,
    monid: null,
    seenContacts: new Set(),
    draftOnly: false,
  });

  /** Seed a run the lease has already expired on — drain() must reclaim it. */
  const seedStaleRun = async (steps: unknown[] = []): Promise<string> => {
    const id = await enqueueRun(sql, { kind: 'outreach' });
    const stale = new Date(Date.now() - 11 * 60_000); // past the 10-min lease
    await sql`
      update agent_runs set status = 'running', claim_token = 'stale-token',
        started_at = ${stale}, alive_at = ${stale},
        steps = ${sql.json(steps as never[])}
      where id = ${id}
    `;
    return id;
  };

  const getRun = (id: string) =>
    sql<
      {
        status: string;
        attempts: number;
        max_attempts: number;
        run_at: Date | null;
        claim_token: string | null;
        started_at: Date | null;
        error: string | null;
        finished_at: Date | null;
        steps: unknown[];
        tokens_in: number;
        tokens_out: number;
        cost_cents: number;
      }[]
    >`select status, attempts, max_attempts, run_at, claim_token, started_at, error, finished_at, steps,
      tokens_in, tokens_out, cost_cents
      from agent_runs where id = ${id}`.then((r) => r[0]!);

  test('reclaim requeues with attempts+1 and a ~2min backoff', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    const r = await getRun(id);
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(1);
    expect(r.claim_token).toBeNull();
    expect(r.started_at).toBeNull();
    const delayS = (r.run_at!.getTime() - Date.now()) / 1000;
    // 2^1 = 2min — wide bounds so CI timing noise can't flake it
    expect(delayS).toBeGreaterThan(100);
    expect(delayS).toBeLessThan(150);
    // run_at gates claimability: drain must not pick this run back up now
    await drain(sql, 1);
    expect((await getRun(id)).status).toBe('queued');
  });

  test('reclaims escalate backoff then land failed at max_attempts', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    // second stale period → attempts=2, backoff 2^2 = 4min
    await sql`update agent_runs set status='running',
      started_at=${new Date(Date.now() - 11 * 60_000)},
      alive_at=${new Date(Date.now() - 11 * 60_000)} where id=${id}`;
    await drain(sql, 0);
    let r = await getRun(id);
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(2);
    const delayS = (r.run_at!.getTime() - Date.now()) / 1000;
    expect(delayS).toBeGreaterThan(220);
    expect(delayS).toBeLessThan(260);
    // shrink the cap — the next reclaim must fail, not requeue
    await sql`update agent_runs set max_attempts = 3 where id = ${id}`;
    await sql`update agent_runs set status='running',
      started_at=${new Date(Date.now() - 11 * 60_000)},
      alive_at=${new Date(Date.now() - 11 * 60_000)} where id=${id}`;
    await drain(sql, 0);
    r = await getRun(id);
    expect(r.status).toBe('failed');
    expect(r.attempts).toBe(3);
    expect(r.error).toContain('attempt cap');
    expect(r.finished_at).not.toBeNull();
  });

  test('a requeued run claims once its backoff elapses — attempts intact', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now() - interval '1 second' where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(id);
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.claim_token).toBeTruthy();
  });

  test('mutating tools fence on a stale claim — no effect, STALE_CLAIM', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Fence Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);

    // live claim — update_lead applies
    const ok = (await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'u1', 'update_lead', {
      id: leadId,
      city: 'Niterói',
    })) as { lead: { city: string | null } };
    expect(ok.lead.city).toBe('Niterói');

    // simulate the reclaim the worker lost to: queued + cleared token
    await sql`update agent_runs set status='queued', claim_token=null where id=${runId}`;

    for (const call of [
      ['update_lead', { id: leadId, city: 'São Gonçalo' }],
      ['create_task', { leadId, title: 'não deve criar' }],
      ['draft_message', { leadId, body: 'não deve compor' }],
      ['send_message', { leadId, body: 'não deve enviar' }],
      ['unsubscribe', { leadId, reason: 'teste' }],
      ['add_note', { leadId, body: 'não deve anotar' }],
    ] as const) {
      await expect(
        executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'stale-1', call[0], call[1]),
      ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
    }
    const after = await getLeadDetail(sql, leadId);
    expect(after!.city).toBe('Niterói');
    expect(after!.unsubscribedAt).toBeNull();
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks).toHaveLength(0);
  });

  test('no claimToken = no fence (tests/sims path stays unfenced)', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'NoFence' }));
    const leadId = lead.body.lead.id;
    const out = (await executeTool(mkCtx('ghost-run', null, leadId), 'x', 'update_lead', {
      id: leadId,
      city: 'Rio',
    })) as { lead: { city: string | null } };
    expect(out.lead.city).toBe('Rio');
  });

  test('a canceled run also fences its tools', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'CancelLead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    await sql`update agent_runs set status='canceled' where id=${runId}`;
    await expect(
      executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'c1', 'update_lead', {
        id: leadId,
        city: 'X',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
  });

  test('resume replays the journal: entries kept, step ids continue past baseStep', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Resume Lead' }));
    const leadId = lead.body.lead.id;
    const priorJournal = [
      { type: 'system_prompt', content: 'SYS' },
      {
        type: 'model',
        content: 'vou anotar',
        toolCalls: [{ id: 'old-1', name: 'add_note', args: { leadId, body: 'primeiro' } }],
      },
      { type: 'tool', name: 'add_note', args: { leadId, body: 'primeiro' }, out: { ok: true } },
      {
        type: 'model',
        content: 'quase',
        toolCalls: [{ id: 'old-2', name: 'create_task', args: { leadId } }],
      },
      // crashed mid-batch — the create_task result was never journaled
    ];
    const id = await seedStaleRun(priorJournal);
    await sql`update agent_runs set lead_id = ${leadId} where id = ${id}`;
    await drain(sql, 0); // reclaim → queued, attempts=1
    // pull the backoff forward; the mock driver consumes params.script
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'add_note', args: { leadId, body: 'segundo' } }] },
          { text: 'pronto' },
        ],
      } as never)}
      where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;

    expect(await runOnce(sql)).toBe(true);

    const r = await getRun(id);
    expect(r.status).toBe('done');
    const types = r.steps.map((s) => (s as { type?: string }).type);
    // prior journal survived; resumed boundary + this attempt's entries follow
    expect(types.slice(0, priorJournal.length)).toEqual(priorJournal.map((s) => s.type));
    expect(types[priorJournal.length]).toBe('resumed');
    expect(types).toContain('system_prompt');
    // the resumed attempt's add_note claimed under the CONTINUED step index —
    // baseStep=2 prior model turns → this turn's key is step 2, not 0/1
    const keys = await sql<{ key: string }[]>`
      select key from control_idempotency_keys where key like ${`agent:${id}:%`}
    `;
    expect(keys.map((k) => k.key)).toContain(`agent:${id}:2:add_note:mock-1-0`);
    const notes = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${leadId} and kind = 'note'
    `;
    expect(notes.map((n) => n.body)).toContain('segundo');
  });

  test('reconcile heals a pending entry whose mutation committed pre-crash', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Reconcile Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // The mutation commits through claimControl under key agent:run:step:name:callId —
    // then the worker "dies" before the result reaches the journal.
    await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'n1', 'add_note', {
      leadId,
      body: 'committed',
    });
    const priorJournal = [
      {
        type: 'model',
        content: 'vou anotar',
        toolCalls: [{ id: 'n1', name: 'add_note', args: { leadId, body: 'committed' } }],
      },
      {
        type: 'tool',
        name: 'add_note',
        args: { leadId, body: 'committed' },
        callId: 'n1',
        step: 0,
        pending: true,
      },
    ];
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`update agent_runs set started_at = ${stale}, alive_at = ${stale},
      steps = ${sql.json(priorJournal as never[])} where id = ${runId}`;
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${runId}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    // the pending entry healed to the stored claim response — not 'interrupted'
    const healed = r.steps.find(
      (s) => (s as { type?: string; callId?: string }).callId === 'n1',
    ) as { pending?: boolean; out?: { activity?: unknown } };
    expect(healed.pending).toBeUndefined();
    expect(healed.out?.activity).toBeTruthy();
    // and no duplicate: the committed note is the only one on the lead
    const notes = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${leadId} and kind = 'note'
    `;
    expect(notes.map((n) => n.body)).toEqual(['committed']);
  });

  test('request_human heals under its canonical claim key', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Handoff Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // Whole handoff commits under ONE claim keyed exactly like the journal
    // entry — suffixed sub-keys would leave reconcile with nothing to find.
    await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'h1', 'request_human', {
      leadId,
      reason: 'precisa de humano',
    });
    const priorJournal = [
      {
        type: 'model',
        content: 'passando para humano',
        toolCalls: [
          { id: 'h1', name: 'request_human', args: { leadId, reason: 'precisa de humano' } },
        ],
      },
      {
        type: 'tool',
        name: 'request_human',
        args: { leadId, reason: 'precisa de humano' },
        callId: 'h1',
        step: 0,
        pending: true,
      },
    ];
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`update agent_runs set started_at = ${stale}, alive_at = ${stale},
      steps = ${sql.json(priorJournal as never[])} where id = ${runId}`;
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${runId}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const healed = r.steps.find(
      (s) => (s as { type?: string; callId?: string }).callId === 'h1',
    ) as { pending?: boolean; out?: { handedOff?: boolean } };
    expect(healed.pending).toBeUndefined();
    expect(healed.out?.handedOff).toBe(true);
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks.length).toBe(1);
    const notes = await sql`select 1 from lead_activities
      where lead_id = ${leadId} and kind = 'system' and body like 'Handoff para humano%'`;
    expect(notes.length).toBe(1);
  });

  test('resume carries prior-attempt usage into the stored counters', async () => {
    await migrate(sql, MIGRATIONS);
    // Attempt 1 paid for two model calls before dying — finishRun writes
    // counters wholesale, so without the journal usage they'd be lost.
    const id = await seedStaleRun([
      {
        type: 'model',
        content: 'turno um',
        toolCalls: [],
        usage: { tokensIn: 100, tokensOut: 20, costUsd: 0.1 },
      },
      {
        type: 'model',
        content: 'turno dois',
        toolCalls: [],
        usage: { tokensIn: 40, tokensOut: 10, costUsd: 0.15 },
      },
    ]);
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(id);
    expect(r.status).toBe('done');
    // prior 140/30 + the mock driver's zeros — not reset to this attempt only.
    expect(r.tokens_in).toBe(140);
    expect(r.tokens_out).toBe(30);
    expect(r.cost_cents).toBe(25);
  });
});
