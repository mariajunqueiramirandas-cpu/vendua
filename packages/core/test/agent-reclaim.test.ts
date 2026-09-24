import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { claimRun, drain, enqueueRun, replayJournal, runOnce } from '../src/agent/runner.ts';
import { executeTool, assertRunClaimTx, type ToolContext } from '../src/agent/tools.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, getLeadDetail } from '../src/modules/leads.ts';
import { ensureThread } from '../src/modules/threads.ts';
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

  test('an empty retry does not hide the last substantive attempt', () => {
    // attempt 3 persisted its 'resumed' marker then died before the model —
    // the boundary must fall back to attempt 2, not the empty tail.
    const r = replayJournal([
      { type: 'model', content: 'primeiro', toolCalls: [] },
      { type: 'tool', name: 'add_note', args: {}, out: { activity: { id: '1' } } },
      { type: 'resumed', attempt: 1 },
      { type: 'model', content: 'segundo', toolCalls: [] },
      {
        type: 'tool',
        name: 'send_message',
        args: {},
        out: { message: { id: 'm1', status: 'sent' } },
      },
      { type: 'resumed', attempt: 2 },
    ]);
    expect(r.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
    expect(r.messages[0]!.content).toBe('segundo');
  });

  test('the latest stored plan rebuilds ctx.plan — no durable field backs it', () => {
    const r = replayJournal([
      {
        type: 'tool',
        name: 'plan',
        args: {},
        out: { stored: true, plan: 'maps first, then SERP' },
      },
      { type: 'resumed', attempt: 1 },
      {
        type: 'tool',
        name: 'plan',
        args: {},
        out: { stored: true, plan: 'serp only now' },
      },
      // a failed/non-plan out must not clobber the last stored plan
      { type: 'tool', name: 'plan', args: {}, out: { error: 'plan needs content' } },
      { type: 'model', content: 'continua', toolCalls: [] },
    ]);
    expect(r.plan).toBe('serp only now');
    // a stored EMPTY plan clears — it must not resurrect the previous string
    expect(
      replayJournal([
        { type: 'tool', name: 'plan', args: {}, out: { stored: true, plan: 'x' } },
        { type: 'tool', name: 'plan', args: {}, out: { stored: true, plan: '' } },
      ]).plan,
    ).toBe('');
    // a journal with no stored plan leaves ctx.plan null
    expect(replayJournal([{ type: 'model', content: 'x', toolCalls: [] }]).plan).toBeNull();
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

  const mkCtx = (
    runId: string,
    claimToken: string | null,
    leadId: string | null,
    runKind: ToolContext['runKind'] = 'reply',
    threadId: string | null = null,
  ): ToolContext => ({
    sql,
    runId,
    runKind,
    leadId,
    threadId,
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
    pageReads: 0,
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

  test('a stale strategist claim cannot land a proposed brief', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'strategist' });
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    await sql`update agent_runs set status='canceled', claim_token=null where id=${runId}`;
    await expect(
      executeTool(mkCtx(runId, claimed!.claim_token, null, 'strategist'), 's1', 'propose_brief', {
        name: 'docerias fortaleza',
        query: 'docerias em fortaleza',
        reason: 'boa densidade',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
    const briefs = await sql`select 1 from discovery_briefs where name = 'docerias fortaleza'`;
    expect(briefs).toHaveLength(0);
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
    // The handoff's own lead-wide marker parks the requeued run at claim —
    // staff resuming the lead (clearing the flag) releases it to heal.
    await sql`update leads set agent_paused_at = null where id = ${leadId}`;
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

  test('a stale claim fences dispatch — the queued message stays queued', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Dispatch Fence' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    const [msg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread!.id}, 'out', 'agent', 'não envia', 'queued') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId);
    // cancel/reclaim lands between compose-commit and the dispatch tx
    await sql`update agent_runs set status = 'canceled', claim_token = null where id = ${runId}`;
    await expect(
      dispatchMessage(sql, msg!.id, (tx) => assertRunClaimTx(tx, ctx)),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_CLAIM' });
    const [m] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${msg!.id}
    `;
    expect(m!.status).toBe('queued');
  });

  test('a staff-paused thread holds its queued runs — claim resumes on unpause', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Paused Thread' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel, agent_enabled)
      values (${leadId}, 'whatsapp', false) returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id });
    const claimed = await claimRun(sql);
    expect(claimed?.id ?? null).not.toBe(runId);
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
    await sql`update lead_threads set agent_enabled = true where id = ${thread!.id}`;
    const resumed = await claimRun(sql);
    expect(resumed?.id).toBe(runId);
  });

  test('an in-flight pause committing mid-claim is seen — the run stays queued', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Race Pause' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id });
    // A second connection holds an uncommitted pause — the claim's
    // select sees enabled (pre-pause snapshot) but its FOR UPDATE on the
    // thread row blocks until this commits and must re-read 'false'.
    const blocker = await sql.reserve();
    try {
      await blocker`begin`;
      await blocker`update lead_threads set agent_enabled = false where id = ${thread!.id}`;
      const claim = claimRun(sql);
      await blocker`commit`;
      const claimed = await claim;
      expect(claimed?.id ?? null).not.toBe(runId);
    } finally {
      blocker.release();
    }
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
  });

  test('stranded recovery fails agent messages whose run went terminal', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Stranded' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await claimRun(sql);
    // agent-authored row whose run died before/after the guarded dispatch —
    // created >20s ago so the stranded sweep owns it
    const [msg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'não envia', 'queued', ${runId}, now() - interval '30 seconds')
      returning id
    `;
    // staff-authored control: agent_run_id null → recovery must still send
    const [staffMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${thread!.id}, 'out', 'staff', 'pode enviar', 'queued', now() - interval '30 seconds')
      returning id
    `;
    // approved agent draft on the SAME terminal run: approved_by makes it
    // staff-owned — the sweep must not fail it
    const [approved] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, approved_by, approved_at, created_at)
      values (${thread!.id}, 'out', 'agent', 'aprovado envia', 'queued', ${runId}, 'staff@x', now(), now() - interval '30 seconds')
      returning id
    `;
    await sql`update agent_runs set status = 'canceled', claim_token = null where id = ${runId}`;
    await drain(sql, 0);
    const [m] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${msg!.id}
    `;
    expect(m!.status).toBe('failed');
    expect(m!.error).toBe('authoring run no longer active');
    const [s] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${staffMsg!.id}
    `;
    expect(s!.status).toBe('sent');
    const [a] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${approved!.id}
    `;
    expect(a!.status).toBe('sent');
  });

  test('stranded recovery defers to a live owner — only done runs dispatch', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Owners' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    // 'done' run: its committed send has no owner left — recovery delivers it
    const doneRun = await enqueueRun(sql, { kind: 'reply', leadId });
    const [doneMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'done envia', 'queued', ${doneRun}, now() - interval '30 seconds')
      returning id
    `;
    // 'queued' run: the next attempt owns the send — recovery must NOT dispatch
    const queuedRun = await enqueueRun(sql, { kind: 'reply', leadId });
    const [queuedMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'ainda não', 'queued', ${queuedRun}, now() - interval '30 seconds')
      returning id
    `;
    await sql`update agent_runs set status = 'done', claim_token = null where id = ${doneRun}`;
    // run_at in the future keeps the queued run unclaimable — drain can't
    // race it into 'running' mid-test
    await sql`update agent_runs set run_at = now() + interval '1 hour' where id = ${queuedRun}`;
    await drain(sql, 0);
    const [d] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${doneMsg!.id}
    `;
    expect(d!.status).toBe('sent');
    const [q] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${queuedMsg!.id}
    `;
    expect(q!.status).toBe('queued');
  });

  test('request_human on an unbound run sets the lead-wide pause marker', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Unbound Handoff' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp'), (${leadId}, 'email')
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'outreach', leadId });
    const claimed = await claimRun(sql);
    // outreach runs carry no threadId — the handoff is for the lead itself
    const ctx = mkCtx(runId, claimed!.claim_token, leadId, 'outreach');
    const out = (await executeTool(ctx, 'h1', 'request_human', {
      leadId,
      reason: 'lead pediu humano',
    })) as { handedOff?: boolean };
    expect(out.handedOff).toBe(true);
    const [l] = await sql<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `;
    expect(l!.agent_paused_at).not.toBeNull();
    // per-thread toggles stay untouched — resuming must not resurrect a
    // thread staff had already paused before the handoff
    const enabled = await sql<{ n: number }[]>`
      select count(*)::int as n from lead_threads
      where lead_id = ${leadId} and agent_enabled = true
    `;
    expect(enabled[0]!.n).toBe(2);
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks.length).toBe(1);
    // output on every channel is blocked while the flag stands — even on the
    // channels whose threads were never individually paused ('manual' always
    // resolves, so the pause check is what blocks)
    const draft = (await executeTool(mkCtx('ghost-unbound', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(draft.blocked).toBe(true);
    expect(draft.reason).toContain('paused');
  });

  test('request_human on a bound run pauses only that thread — other channels stay free', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Bound Handoff' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id });
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId, 'reply', thread!.id);
    const out = (await executeTool(ctx, 'h1', 'request_human', {
      leadId,
      reason: 'falar com humano',
    })) as { handedOff?: boolean };
    expect(out.handedOff).toBe(true);
    // thread-scoped handoff: the single paused thread is NOT a lead-wide
    // signal — the flag must stay clear so a channel hop keeps working
    const [l] = await sql<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `;
    expect(l!.agent_paused_at).toBeNull();
    const draft = (await executeTool(mkCtx('ghost-bound', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'canal novo deve compor',
    })) as { blocked?: boolean };
    expect(draft.blocked).toBeUndefined();
  });

  test('update_lead cannot self-promote agent_mode or unarchive', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Gate Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId);
    // draft → auto would bypass every approval gate staff configured
    await executeTool(ctx, 'u1', 'update_lead', { id: leadId, agentMode: 'auto' });
    let [l] = await sql<
      { agent_mode: string }[]
    >`select agent_mode from leads where id = ${leadId}`;
    expect(l!.agent_mode).toBe('draft');
    // 'off' is the human veto — lifting it back to draft is staff's call
    await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
    await executeTool(ctx, 'u2', 'update_lead', { id: leadId, agentMode: 'draft' });
    [l] = await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${leadId}`;
    expect(l!.agent_mode).toBe('off');
    // archived:false would resurrect a suppressed lead — stripped the same way
    await sql`update leads set archived_at = now() where id = ${leadId}`;
    await executeTool(ctx, 'u3', 'update_lead', { id: leadId, archived: false });
    const [a] = await sql<{ archived_at: string | null }[]>`
      select archived_at from leads where id = ${leadId}
    `;
    expect(a!.archived_at).not.toBeNull();
    // the rest of the patch still applies — stripping is surgical, not a veto
    await executeTool(ctx, 'u4', 'update_lead', { id: leadId, city: 'Sobral' });
    const [c] = await sql<{ city: string | null }[]>`select city from leads where id = ${leadId}`;
    expect(c!.city).toBe('Sobral');
  });

  test('draft_message honors a staff-paused thread like send_message does', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Paused Draft' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel, agent_enabled)
      values (${leadId}, 'manual', false)
    `;
    const out = (await executeTool(mkCtx('ghost-run', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('paused');
    const msgs = await sql`select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId}`;
    expect(msgs).toHaveLength(0);
  });

  test('a lead-wide handoff gates fresh channels via the flag — not a durable toggle', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Channel Hop' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp')
    `;
    await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
    // The flag alone carries the pause — a thread created during the handoff
    // must NOT store agent_enabled=false, or clearing the flag would leave
    // it permanently disabled (the pause marker blocks output regardless).
    const fresh = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'email'));
    expect(fresh.agent_enabled).toBe(true);
    // and the send-side check blocks before composing on that channel at all
    const out = (await executeTool(mkCtx('ghost-hop', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('paused');
    // a lead with zero threads is fresh — not paused
    const lead2 = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Fresh Lead' }));
    const fresh2 = await controlTx(sql, (tx) => ensureThread(tx, lead2.body.lead.id, 'manual'));
    expect(fresh2.agent_enabled).toBe(true);
  });

  test('a lead-paused run parks at claim and resumes when the flag lifts', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Parked Lead' }));
    const leadId = lead.body.lead.id;
    await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'outreach', leadId });
    const claimed = await claimRun(sql);
    expect(claimed?.id ?? null).not.toBe(runId);
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
    await sql`update leads set agent_paused_at = null where id = ${leadId}`;
    const resumed = await claimRun(sql);
    expect(resumed?.id).toBe(runId);
  });

  test('drain sweeps queued runs on terminally suppressed leads only', async () => {
    await migrate(sql, MIGRATIONS);
    const mkLead = async (name: string, flag: string) => {
      const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name }));
      await sql.unsafe(`update leads set ${flag} where id = '${lead.body.lead.id}'`);
      return lead.body.lead.id;
    };
    // raw flag writes simulate a suppression writer that skipped the inline
    // cancel (archive never had one) — the sweep is the catch-all.
    const archived = await mkLead('Swept Archived', 'archived_at = now()');
    const unsub = await mkLead('Swept Unsub', 'unsubscribed_at = now()');
    const paused = await mkLead('Kept Paused', 'agent_paused_at = now()');
    const off = await mkLead('Kept Off', `agent_mode = 'off'`);
    const live = await mkLead('Kept Live', 'name = name');
    await sql`delete from agent_runs where status = 'queued'`;
    const runs: Record<string, string> = {};
    for (const [k, id] of Object.entries({ archived, unsub, paused, off, live })) {
      runs[k] = await enqueueRun(sql, { kind: 'outreach', leadId: id });
    }
    // a 'running' run on an archived lead is mid-flight — not the sweep's
    const running = await enqueueRun(sql, { kind: 'outreach', leadId: archived });
    await sql`update agent_runs set status = 'running', started_at = now(), alive_at = now(),
      claim_token = 'tok' where id = ${running}`;
    await drain(sql, 0);
    const status = async (id: string) =>
      (
        await sql<{ status: string; error: string | null }[]>`
        select status, error from agent_runs where id = ${id}`
      )[0]!;
    expect(await status(runs.archived!)).toMatchObject({ status: 'canceled', error: 'arquivado' });
    expect(await status(runs.unsub!)).toMatchObject({ status: 'canceled', error: 'descadastrado' });
    // paused/'off' lift — their parked runs must resume, never die
    expect((await status(runs.paused!)).status).toBe('queued');
    expect((await status(runs.off!)).status).toBe('queued');
    expect((await status(runs.live!)).status).toBe('queued');
    expect((await status(running)).status).toBe('running');
  });

  test('unsubscribe cancels the lead’s queued runs — they could never claim', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'OptOut Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const replyRun = await enqueueRun(sql, { kind: 'reply', leadId });
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(replyRun);
    const queuedRun = await enqueueRun(sql, { kind: 'outreach', leadId });
    const ctx = mkCtx(replyRun, claimed!.claim_token, leadId);
    await executeTool(ctx, 'u1', 'unsubscribe', { leadId, reason: 'pediu para sair' });
    const [dead] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${queuedRun}
    `;
    expect(dead!.status).toBe('canceled');
    // the running run doing the unsubscribe finishes normally
    const [live] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${replyRun}
    `;
    expect(live!.status).toBe('running');
  });

  test('reply read_pages is bounded — the cap refuses the call before fetching', async () => {
    const ctx = mkCtx('rp-cap', null, null, 'reply');
    ctx.pageReads = 2;
    const out = (await executeTool(ctx, 'x', 'read_pages', {
      urls: ['https://x.co'],
    })) as { error?: string };
    expect(out.error).toContain('limite');
  });

  test('remember returns the fact the ≤100 cap evicted', async () => {
    await migrate(sql, MIGRATIONS);
    const facts = Array.from({ length: 100 }, (_, i) => `fato ${i}`);
    await sql`
      insert into control_settings (key, value)
      values ('agent_memory', ${sql.json({ facts })})
      on conflict (key) do update set value = excluded.value
    `;
    const out = (await executeTool(mkCtx('mem', null, null, 'strategist'), 'm1', 'remember', {
      fact: 'fato novo',
    })) as { remembered: string; total: number; evicted?: string[] };
    expect(out.total).toBe(100);
    expect(out.evicted).toEqual(['fato 0']);
  });

  test('a consecutive identical call is suppressed and nudged — once', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Loop Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'get_lead') as {
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(2);
    expect(reads[1]!.out?.error).toMatch(/^REPEAT/);
    // ONE loop nudge — and since request_human acted, no finish nudge joins it
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { content?: string }).content).toContain('LOOP');
  });

  test('a repeated call that errored is a retry, not a loop — it re-executes', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Retry Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'read_pages', args: { urls: [] } }] },
          { toolCalls: [{ name: 'read_pages', args: { urls: [] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(2);
    // both really ran — the second is the same validation error, not REPEAT
    expect(reads[0]!.out?.error).toMatch(/^read_pages needs urls/);
    expect(reads[1]!.out?.error).toMatch(/^read_pages needs urls/);
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(0);
  });

  test('a reply run closing without a visible action gets one finish nudge', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Silent Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({ script: [{ text: 'ok' }] } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { content?: string }).content).toContain('Ação pendente');
  });

  test('a blocked send is not a reusable result — its retry re-executes', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Blocked Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // the send blocks (this lead has no channel); a write lands after it
          {
            toolCalls: [
              { name: 'send_message', args: { leadId, body: 'olá' } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          // an identical send next turn must execute, not return REPEAT
          { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
      out?: { error?: string; blocked?: boolean };
    }[];
    expect(sends).toHaveLength(2);
    // still blocked (no channel ever appeared) — but it RAN, not REPEAT
    expect(sends[1]!.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(sends[1]!.out?.blocked).toBe(true);
  });

  test('a re-read after a mutation executes — the earlier result went stale', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Stale Read Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'get_lead', args: { id: leadId } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const gets = r.steps.filter((s) => (s as { name?: string }).name === 'get_lead') as {
      out?: unknown;
    }[];
    expect(gets).toHaveLength(2);
    // the second read ran fresh — current profile, not a REPEAT artifact
    expect(JSON.stringify(gets[1]!.out)).toContain('Recife');
  });

  test('a cached re-read does not spend the reply page budget', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Cached Page Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = await enqueueRun(sql, { kind: 'reply', leadId });
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'read_pages', args: { urls: ['https://shop.example/catalog'] } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          // same url again — served from pageCache, spends nothing
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/catalog'] } }] },
          // a new url still fits the cap; the one after hits it
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/prices'] } }] },
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/about'] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: boolean;
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(4);
    // every call executed — no REPEAT — but only the fetches spent
    expect(reads[0]!.readSpent).toBe(true);
    expect(reads[1]!.readSpent).toBe(false);
    expect(reads[2]!.readSpent).toBe(true);
    expect(reads[3]!.out?.error ?? '').toMatch(/^read_pages: limite/);
  });
});
