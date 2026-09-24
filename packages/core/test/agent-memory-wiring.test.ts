import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { contextFor, writeDebrief, type RunRow } from '../src/agent/runner.ts';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { insertRun } from '../src/agent/runner.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres). Covers the
// run-side wiring of memory v2: the remember/set_fact tools and the
// discovery writeDebrief, all against real rows.
describe.skipIf(!process.env.TEST_DATABASE_URL)('agent memory v2 wiring (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const nonce = crypto.randomUUID().slice(0, 8);
  const nm = (s: string) => `zzw-${nonce}-${s}`;
  let migrated = false;
  const setup = async () => {
    if (!migrated) {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      migrated = true;
    }
  };

  const mkCtx = (
    runId: string,
    leadId: string | null,
    runKind: ToolContext['runKind'] = 'reply',
  ): ToolContext => ({
    sql,
    runId,
    runKind,
    leadId,
    threadId: null,
    step: 0,
    // No live claim in tests — assertRunClaimTx skips its fence on null.
    claimToken: null,
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

  const mkRunId = (kind: 'discovery' | 'reply' = 'reply', leadId?: string) =>
    controlTx(sql, (tx) => insertRun(tx, { kind, ...(leadId ? { leadId } : {}) })).then((id) => {
      if (!id) throw new Error('insertRun refused');
      return id;
    });
  const mkLeadId = () =>
    controlTx(sql, (tx) => insertLeadTx(tx, { name: `Wire ${nonce} ${crypto.randomUUID()}` })).then(
      (r) => r.body.lead.id,
    );

  const memRows = () =>
    sql<
      { scope: string; segment: string | null; source: string; source_run_id: string | null; content: string }[]
    >`select scope, segment, source, source_run_id, content from agent_memory_items
       where content like ${`zzw-${nonce}-%`} order by created_at`;

  test('remember tool writes workspace/segment memory items with the run id', async () => {
    await setup();
    const runId = await mkRunId('discovery');
    const ctx = mkCtx(runId, null, 'discovery');

    const ws = (await executeTool(ctx, 'w1', 'remember', { fact: nm('ws') })) as Record<
      string,
      unknown
    >;
    expect(ws).toMatchObject({ remembered: nm('ws'), scope: 'workspace' });
    expect(ws).not.toHaveProperty('segment');

    const seg = (await executeTool(ctx, 'w2', 'remember', {
      fact: nm('seg'),
      segment: 'Pudim Norte',
    })) as Record<string, unknown>;
    expect(seg).toMatchObject({ remembered: nm('seg'), scope: 'segment', segment: 'pudim norte' });

    // Dedupe: same content + scope, different case → same item id, no new row.
    const again = (await executeTool(ctx, 'w3', 'remember', {
      fact: nm('SEG'),
      segment: 'pudim norte',
    })) as Record<string, unknown>;
    expect(again).toMatchObject({ scope: 'segment', segment: 'pudim norte' });

    const rows = await memRows();
    expect(rows.map((r) => [r.scope, r.segment, r.source])).toEqual([
      ['workspace', null, 'agent'],
      ['segment', 'pudim norte', 'agent'],
    ]);
    expect(rows.every((r) => r.source_run_id === runId)).toBe(true);
    // Nothing lands on the legacy flat list anymore.
    const legacy = await sql`select 1 from control_settings where key = 'agent_memory'`;
    expect(legacy).toHaveLength(0);

    const empty = (await executeTool(ctx, 'w4', 'remember', { fact: '  ' })) as Record<
      string,
      unknown
    >;
    expect(String(empty.error)).toContain('content');
  });

  test('set_fact tool writes lead_facts, enforces the lead binding', async () => {
    await setup();
    const leadId = await mkLeadId();
    const runId = await mkRunId('reply', leadId);
    const ctx = mkCtx(runId, leadId, 'reply');

    const out = (await executeTool(ctx, 'f1', 'set_fact', {
      leadId,
      key: 'team_size',
      value: '4 people',
      confidence: 0.7,
    })) as { fact: { key: string; value: string; confidence: number; sourceRunId: string | null } };
    expect(out.fact).toMatchObject({
      key: 'team_size',
      value: '4 people',
      confidence: 0.7,
      source: 'agent',
      sourceRunId: runId,
    });
    const stored = await sql<
      { key: string; value: string; source_run_id: string | null }[]
    >`select key, value, source_run_id from lead_facts where lead_id = ${leadId}`;
    expect(stored).toHaveLength(1);

    const bound = (await executeTool(ctx, 'f2', 'set_fact', {
      leadId: crypto.randomUUID(), // not this run's lead
      key: 'x',
      value: 'y',
    })) as Record<string, unknown>;
    expect(String(bound.error)).toContain('LEAD_MISMATCH');

    const badKey = (await executeTool(ctx, 'f3', 'set_fact', {
      leadId,
      key: 'Bad Key',
      value: 'y',
    })) as Record<string, unknown>;
    expect(badKey.error).toBeDefined();
    const badConf = (await executeTool(ctx, 'f4', 'set_fact', {
      leadId,
      key: 'size',
      value: 'y',
      confidence: 2,
    })) as Record<string, unknown>;
    expect(badConf.error).toBeDefined();

    // Unbound ctx (sim-like): a ghost lead id is a clean error, not an FK 500.
    const ghost = (await executeTool(mkCtx(runId, null, 'reply'), 'f5', 'set_fact', {
      leadId: crypto.randomUUID(),
      key: 'size',
      value: 'y',
    })) as Record<string, unknown>;
    expect(String(ghost.error)).toContain('no such lead');
  });

  test('contextFor renders FATOS for lead-bound runs', async () => {
    await setup();
    const leadId = await mkLeadId();
    const runId = await mkRunId('reply', leadId);
    await executeTool(mkCtx(runId, leadId, 'reply'), 'f1', 'set_fact', {
      leadId,
      key: 'team_size',
      value: '4 people',
      confidence: 0.5,
    });
    const run = (
      await sql<RunRow[]>`select id, kind, lead_id, thread_id, params, claim_token, steps, attempts, max_attempts
         from agent_runs where id = ${runId}`
    )[0]!;
    const { text } = await contextFor(sql, run);
    expect(text).toContain('FATOS');
    expect(text).toContain('team_size: 4 people (confiança 0.5)');
  });

  test('writeDebrief stores a debrief-scope memory item, never the legacy row', async () => {
    await setup();
    const runId = await mkRunId('discovery');
    const run = (
      await sql<RunRow[]>`select id, kind, lead_id, thread_id, params, claim_token, steps, attempts, max_attempts
         from agent_runs where id = ${runId}`
    )[0]!;
    await sql`update agent_runs set params = ${sql.json({ query: nm('docerias'), city: 'Fortaleza' } as never)} where id = ${runId}`;
    run.params = { query: nm('docerias'), city: 'Fortaleza' };
    const ctx = mkCtx(runId, null, 'discovery');

    // No leads/merges/deads → no debrief.
    await writeDebrief(sql, run, ctx, []);
    expect(await memRows()).toHaveLength(0);

    await writeDebrief(sql, run, ctx, [
      { name: 'create_lead', out: { lead: { whatsapp: '+5585' } } },
      { name: 'maps_lookup', out: { foundContacts: { phones: ['1'] } } },
    ]);
    const rows = await memRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: 'debrief',
      source: 'debrief',
      source_run_id: runId,
    });
    expect(rows[0]!.content).toContain(`run ${nm('docerias')}/Fortaleza: 1 leads (1 c/ whatsapp)`);
    const legacy = await sql`select 1 from control_settings where key = 'agent_memory'`;
    expect(legacy).toHaveLength(0);
  });
});
