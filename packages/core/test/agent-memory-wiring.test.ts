import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import {
  contextFor,
  insertRun,
  memoryForPrompt,
  writeDebrief,
  type RunRow,
} from '../src/agent/runner.ts';
import { leadFactsTx, rememberTx } from '../src/modules/agent-memory.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres). Covers the
// run-side wiring of memory v2: the remember/set_fact tools, the prompt feed
// (memoryForPrompt) and the discovery writeDebrief — all against real rows.
describe.skipIf(!process.env.TEST_DATABASE_URL)('agent memory v2 wiring (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const uniq = crypto.randomUUID().slice(0, 8);
  const nm = (s: string) => `wm-${uniq}-${s}`;
  let migrated = false;
  const setup = async () => {
    if (!migrated) {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      migrated = true;
    }
  };

  const mkCtx = (
    runKind: ToolContext['runKind'],
    leadId: string | null,
    runId: string,
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

  const mkLead = (name: string, segment: string | null = null) =>
    controlTx(sql, async (tx) => {
      const r = await insertLeadTx(tx, leadInsert({ name: `${name}-${uniq}`, whatsapp: null }));
      const id = r.body.lead.id;
      if (segment) await tx`update leads set segment = ${segment} where id = ${id}`;
      return id;
    });

  const mkRun = async (
    kind: RunRow['kind'],
    leadId: string | null = null,
    params: Record<string, unknown> = {},
  ): Promise<RunRow> => {
    const id = await controlTx(sql, (tx) => insertRun(tx, { kind, leadId, params }));
    if (!id) throw new Error('insertRun refused');
    // Leave the run 'done' — the suite shares one DB, and a queued discovery
    // run inflates discoveryBudgetTx's open-work reservation for tests that
    // check auto-approval.
    await sql`update agent_runs set status = 'done' where id = ${id}`;
    return (await sql<RunRow[]>`select * from agent_runs where id = ${id}`)[0]!;
  };

  const myItems = (scope?: string) =>
    sql<
      {
        scope: string;
        segment: string | null;
        content: string;
        source: string;
        source_run_id: string | null;
      }[]
    >`
      select scope, segment, content, source, source_run_id
      from agent_memory_items
      where content like ${`wm-${uniq}-%`}
      ${scope ? sql`and scope = ${scope}` : sql``}
      order by content`;

  test('remember writes agent_memory_items with agent source, dedupes', async () => {
    await setup();
    const leadId = await mkLead('rem');
    const run = await mkRun('reply', leadId);
    const ctx = mkCtx('reply', leadId, run.id);
    const out = (await executeTool(ctx, 's1', 'remember', {
      fact: nm('docerias respondem melhor à noite'),
    })) as { remembered: string };
    expect(out.remembered).toBe(nm('docerias respondem melhor à noite'));

    // dedupe — same content twice stays one row
    await executeTool(ctx, 's2', 'remember', { fact: nm('docerias respondem melhor à noite') });
    const rows = await myItems('workspace');
    expect(rows.map((r) => r.content)).toEqual([nm('docerias respondem melhor à noite')]);
    expect(rows[0]!.source).toBe('agent');
    expect(rows[0]!.source_run_id).toBe(run.id);

    // segment scope carries the segment; workspace ignores it
    await executeTool(ctx, 's3', 'remember', {
      fact: nm('padarias têm pico antes das 9h'),
      scope: 'segment',
      segment: nm('PADARIAS'),
    });
    const segRows = await myItems('segment');
    expect(segRows).toHaveLength(1);
    expect(segRows[0]!.segment).toBe(nm('padarias'));

    const bad = (await executeTool(ctx, 's4', 'remember', {
      fact: 'x',
      scope: 'segment',
    })) as { error?: string };
    expect(bad.error).toBeTruthy();
    const empty = (await executeTool(ctx, 's5', 'remember', { fact: '  ' })) as {
      error?: string;
    };
    expect(empty.error).toBeTruthy();

    // the tool never touches the legacy flat list anymore
    const legacy = await sql`
      select 1 from control_settings
      where key = 'agent_memory' and value::text like ${`%wm-${uniq}%`}
    `;
    expect(legacy).toHaveLength(0);
  });

  test('set_fact upserts lead_facts bound to the run lead', async () => {
    await setup();
    const leadId = await mkLead('fact');
    const run = await mkRun('reply', leadId);
    const ctx = mkCtx('reply', leadId, run.id);

    const bad = (await executeTool(ctx, 's1', 'set_fact', {
      leadId,
      key: 'BAD KEY',
      value: 'x',
    })) as { error?: string };
    expect(bad.error).toContain('snake_case');
    const badConf = (await executeTool(ctx, 's1b', 'set_fact', {
      leadId,
      key: 'size',
      value: 'x',
      confidence: 2,
    })) as { error?: string };
    expect(badConf.error).toContain('confidence');

    const out = (await executeTool(ctx, 's2', 'set_fact', {
      leadId,
      key: 'fleet_size',
      value: '12',
      confidence: 0.8,
    })) as {
      fact: {
        key: string;
        value: string;
        confidence: number;
        source: string;
        sourceRunId: string | null;
      };
    };
    expect(out.fact).toMatchObject({
      key: 'fleet_size',
      value: '12',
      confidence: 0.8,
      source: 'agent',
      sourceRunId: run.id,
    });

    // upsert — same key refreshes value/confidence
    await executeTool(ctx, 's3', 'set_fact', { leadId, key: 'fleet_size', value: '14' });
    const facts = await controlTx(sql, (tx) => leadFactsTx(tx, leadId));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ key: 'fleet_size', value: '14', confidence: 1 });

    // lead-binding — a run bound to another lead can't write this one's facts
    const other = await mkLead('fact-other');
    const denied = (await executeTool(mkCtx('reply', other, run.id), 's4', 'set_fact', {
      leadId,
      key: 'fleet_size',
      value: 'x',
    })) as { error?: string };
    expect(denied.error).toContain('LEAD_MISMATCH');

    // unbound ctx (sim-like): a ghost lead id is a clean error, not an FK 500
    const ghost = (await executeTool(mkCtx('reply', null, run.id), 's5', 'set_fact', {
      leadId: crypto.randomUUID(),
      key: 'size',
      value: 'x',
    })) as { error?: string };
    expect(ghost.error).toContain('no such lead');
  });

  test('contextFor renders a FATOS block for lead-bound runs', async () => {
    await setup();
    const leadId = await mkLead('fatos');
    const run = await mkRun('reply', leadId);
    await executeTool(mkCtx('reply', leadId, run.id), 'f1', 'set_fact', {
      leadId,
      key: 'team_size',
      value: '4 people',
      confidence: 0.5,
    });
    const { text } = await contextFor(sql, run);
    expect(text).toContain('FATOS');
    expect(text).toContain('team_size: 4 people (confiança 0.5)');
  });

  test('memoryForPrompt feeds segment learnings from the bound lead', async () => {
    await setup();
    const segment = nm('docerias');
    const leadId = await mkLead('feed', segment);
    const run = await mkRun('reply', leadId);
    await controlTx(sql, async (tx) => {
      await rememberTx(tx, {
        scope: 'segment',
        segment,
        content: nm('seg-learning'),
        source: 'agent',
      });
      await rememberTx(tx, { scope: 'workspace', content: nm('ws-learning'), source: 'agent' });
      await rememberTx(tx, {
        scope: 'segment',
        segment: 'outro-nicho',
        content: nm('miss'),
        source: 'agent',
      });
    });
    const feed = await memoryForPrompt(sql, run);
    expect(feed).toContain(nm('seg-learning'));
    expect(feed).toContain(nm('ws-learning'));
    expect(feed).not.toContain(nm('miss'));

    // params.segment wins over the lead's segment (discovery runs have no lead)
    const runParams = await mkRun('discovery', null, { segment: 'outro-nicho' });
    const feedParams = await memoryForPrompt(sql, runParams);
    expect(feedParams).toContain(nm('miss'));
  });

  test('writeDebrief stores a debrief-scope item tagged with the brief segment', async () => {
    await setup();
    const run = await mkRun('discovery', null, {
      query: nm('docerias'),
      segment: nm('padarias'),
    });
    const ctx = mkCtx('discovery', null, run.id);
    const steps = [
      {
        type: 'tool',
        name: 'create_lead',
        args: {},
        out: { lead: { id: 'l1', whatsapp: '+5511999' } },
      },
    ];
    await writeDebrief(sql, run, ctx, steps);
    const rows = await sql<{ source: string; content: string; segment: string | null }[]>`
      select source, content, segment from agent_memory_items
      where scope = 'debrief' and source_run_id = ${run.id}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('debrief');
    expect(rows[0]!.content).toContain('1 leads (1 c/ whatsapp)');
    expect(rows[0]!.segment).toBe(nm('padarias'));

    // the debrief lands in the next run's feed
    const feed = await memoryForPrompt(sql, run);
    expect(feed.some((c) => c.includes(nm('docerias')))).toBe(true);

    // no debrief when the run produced nothing
    const dry = await mkRun('discovery', null, { query: nm('dry') });
    await writeDebrief(sql, dry, mkCtx('discovery', null, dry.id), []);
    const dryRows = await sql`
      select 1 from agent_memory_items where scope = 'debrief' and source_run_id = ${dry.id}
    `;
    expect(dryRows).toHaveLength(0);

    // and nothing lands on the legacy row
    const legacy = await sql`
      select 1 from control_settings
      where key = 'agent_memory' and value::text like ${`%wm-${uniq}%`}
    `;
    expect(legacy).toHaveLength(0);
  });
});
