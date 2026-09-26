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

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres)
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
    // no live claim in tests — assertRunClaimTx skips its fence on null
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
    const id = await controlTx(sql, (tx) =>
      insertRun(tx, { source: 'staff', kind, leadId, params }),
    );
    if (!id) throw new Error('insertRun refused');
    // leave the run 'done' — a queued discovery run inflates the open-work
    // reservation for tests that check auto-approval
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

    await executeTool(ctx, 's2', 'remember', { fact: nm('docerias respondem melhor à noite') });
    const rows = await myItems('workspace');
    expect(rows.map((r) => r.content)).toEqual([nm('docerias respondem melhor à noite')]);
    expect(rows[0]!.source).toBe('agent');
    expect(rows[0]!.source_run_id).toBe(run.id);

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

    await executeTool(ctx, 's3', 'set_fact', { leadId, key: 'fleet_size', value: '14' });
    const facts = await controlTx(sql, (tx) => leadFactsTx(tx, leadId));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ key: 'fleet_size', value: '14', confidence: 1 });

    const other = await mkLead('fact-other');
    const denied = (await executeTool(mkCtx('reply', other, run.id), 's4', 'set_fact', {
      leadId,
      key: 'fleet_size',
      value: 'x',
    })) as { error?: string };
    expect(denied.error).toContain('LEAD_MISMATCH');

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

  test('contextFor stamps ORIGEM from who spoke first — only what reached the wire counts', async () => {
    await setup();
    const cold = await mkLead('origem-cold');
    const warm = await mkLead('origem-warm');
    const [ct] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${cold}, 'whatsapp') returning id`;
    const [wt] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${warm}, 'whatsapp') returning id`;
    // no conversation yet → cold approach
    expect((await contextFor(sql, await mkRun('outreach', cold))).text).toContain(
      'ORIGEM: outbound',
    );
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${ct!.id}, 'out', 'agent', 'oi', 'sent', now() - interval '2 hours'),
             (${ct!.id}, 'in', 'lead', 'quem é?', 'received', now() - interval '1 hour')`;
    expect((await contextFor(sql, await mkRun('reply', cold))).text).toContain('ORIGEM: outbound');
    // a rejected draft predating the lead's first message was never seen by them
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${wt!.id}, 'out', 'agent', 'rascunho', 'rejected', now() - interval '2 hours'),
             (${wt!.id}, 'in', 'lead', 'vocês fazem loja?', 'received', now() - interval '1 hour')`;
    expect((await contextFor(sql, await mkRun('reply', warm))).text).toContain('ORIGEM: inbound');
    // a send still queued when the lead wrote, and a staff note on a manual thread, never reached them
    const early = await mkLead('origem-early');
    const [et] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${early}, 'whatsapp') returning id`;
    const [mt] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${early}, 'manual') returning id`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${mt!.id}, 'out', 'staff', 'nota', 'sent', now() - interval '3 hours'),
             (${et!.id}, 'out', 'agent', 'oi', 'queued', now() - interval '2 hours'),
             (${et!.id}, 'in', 'lead', 'oi, vi o anúncio', 'received', now() - interval '1 hour')`;
    expect((await contextFor(sql, await mkRun('reply', early))).text).toContain('ORIGEM: inbound');
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

    const feed = await memoryForPrompt(sql, run);
    expect(feed.some((c) => c.includes(nm('docerias')))).toBe(true);

    const dry = await mkRun('discovery', null, { query: nm('dry') });
    await writeDebrief(sql, dry, mkCtx('discovery', null, dry.id), []);
    const dryRows = await sql`
      select 1 from agent_memory_items where scope = 'debrief' and source_run_id = ${dry.id}
    `;
    expect(dryRows).toHaveLength(0);

    const legacy = await sql`
      select 1 from control_settings
      where key = 'agent_memory' and value::text like ${`%wm-${uniq}%`}
    `;
    expect(legacy).toHaveLength(0);
  });

  test('an emptied v2 table stays empty — legacy facts don’t resurrect', async () => {
    await setup();
    // once the v2 table exists it's the only source — an empty feed must
    // not fall back to the legacy setting
    await sql`delete from agent_memory_items`;
    await controlTx(
      sql,
      (tx) => tx`
      insert into control_settings (key, value)
      values ('agent_memory', ${tx.json({ facts: [nm('legacy-fact')] } as never)})
      on conflict (key) do update set value = excluded.value
    `,
    );
    const leadId = await mkLead('empty-mem');
    const run = await mkRun('reply', leadId);
    const feed = await memoryForPrompt(sql, run);
    expect(feed.some((c) => c.includes(nm('legacy-fact')))).toBe(false);
    expect(feed).toEqual([]);
  });
});
