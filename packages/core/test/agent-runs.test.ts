import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { claimRun, enqueueRun } from '../src/agent/runner.ts';
import { executeTool, toolsFor, type ToolContext } from '../src/agent/tools.ts';
import { DEFAULT_GUARDRAILS, validateSetting } from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { getLeadDetail, insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('toolsets — research reaches triage/reply, not outreach', () => {
  const names = (kind: string) => toolsFor(kind).map((t) => t.name);

  test('triage gets the research kit', () => {
    const t = names('triage');
    for (const t_ of ['web_search', 'read_pages', 'serp', 'maps_lookup', 'instagram_profile']) {
      expect(t).toContain(t_);
    }
    // send stays out — a new lead can never be sent unreviewed
    expect(t).not.toContain('send_message');
    // the prospect ledger stays discovery's; `plan` reaches lead kinds as the
    // persisted negotiation checklist
    expect(t).not.toContain('book');
    expect(t).toContain('plan');
  });

  test('reply gets light lookups only', () => {
    const r = names('reply');
    expect(r).toContain('serp');
    expect(r).toContain('web_search');
    expect(r).not.toContain('read_pages');
    expect(r).not.toContain('maps_lookup');
    expect(r).toContain('send_message');
    expect(r).toContain('plan');
  });

  test('outreach is untouched', () => {
    const o = names('outreach');
    expect(o).not.toContain('web_search');
    expect(o).not.toContain('serp');
    expect(o).toContain('send_message');
    expect(o).toContain('plan');
  });
});

describe('guardrails — pacing knobs', () => {
  test('defaults: inbound reply immediate, first contact off', () => {
    expect(DEFAULT_GUARDRAILS.inboundReplyDelayMin).toBe(0);
    expect(DEFAULT_GUARDRAILS.firstContactDelayMin).toBe(0);
  });

  test('validateSetting accepts the new keys in range', () => {
    expect(() =>
      validateSetting('guardrails', { inboundReplyDelayMin: 15, firstContactDelayMin: 60 }),
    ).not.toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 0 })).not.toThrow();
  });

  test('validateSetting rejects out-of-range and non-integers', () => {
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1441 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1.5 })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: '60' })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 10081 })).toThrow();
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('plan — lead-scoped checklist (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);

  const replyCtx = (leadId: string): ToolContext => ({
    sql,
    runId: 'test-run',
    runKind: 'reply',
    leadId,
    threadId: null,
    step: 0,
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

  test('reply plan persists on the lead and ticks across calls', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Plan Lead', agent_mode: 'auto' }),
    );
    const leadId = created.body.lead.id;
    const c = replyCtx(leadId);

    const wrote = (await executeTool(c, `p1-${leadId}`, 'plan', {
      items: [
        { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
        { step: 'qualificação: quem decide', status: 'todo' },
        { step: 'commit: enviar proposta' },
      ],
    })) as { plan: unknown[] };
    expect(wrote.plan).toHaveLength(3);

    const detail = await getLeadDetail(sql, leadId);
    expect(detail!.agentPlan).toEqual([
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'qualificação: quem decide', status: 'todo', note: null },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ]);

    // tick — merge by step flips statuses, keeps notes
    await executeTool(c, `p2-${leadId}`, 'plan', {
      items: [
        { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
        { step: 'qualificação: quem decide', status: 'done', note: 'dona decide sozinha' },
        { step: 'commit: enviar proposta', status: 'todo' },
      ],
    });
    const after = await getLeadDetail(sql, leadId);
    expect(after!.agentPlan[1]).toEqual({
      step: 'qualificação: quem decide',
      status: 'done',
      note: 'dona decide sozinha',
    });
  });

  test('omitted steps survive a merge — only skip removes', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Merge Lead', agent_mode: 'auto' }),
    );
    const leadId = created.body.lead.id;
    const c = replyCtx(leadId);

    await executeTool(c, `m1-${leadId}`, 'plan', {
      items: [{ step: 'contexto', status: 'done' }, { step: 'qualificação' }],
    });
    // second call only mentions one step — the other must not be dropped
    await executeTool(c, `m2-${leadId}`, 'plan', {
      items: [
        { step: 'qualificação', status: 'done', note: 'decisor é a dona' },
        { step: 'commit' },
      ],
    });
    const detail = await getLeadDetail(sql, leadId);
    expect(detail!.agentPlan).toEqual([
      { step: 'contexto', status: 'done', note: null },
      { step: 'qualificação', status: 'done', note: 'decisor é a dona' },
      { step: 'commit', status: 'todo', note: null },
    ]);
  });

  test('skip frees a slot under the 12-item cap', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Cap Lead', agent_mode: 'auto' }),
    );
    const leadId = created.body.lead.id;
    const c = replyCtx(leadId);

    await executeTool(c, `c1-${leadId}`, 'plan', {
      items: Array.from({ length: 12 }, (_, i) => ({ step: `etapa ${i + 1}` })),
    });
    await executeTool(c, `c2-${leadId}`, 'plan', {
      items: [{ step: 'etapa 1', status: 'skip' }, { step: 'commit' }],
    });
    const detail = await getLeadDetail(sql, leadId);
    expect(detail!.agentPlan).toHaveLength(12);
    expect(detail!.agentPlan.map((s) => s.step)).toContain('commit');
    expect(detail!.agentPlan.map((s) => s.step)).not.toContain('etapa 1');
  });

  test('discovery still uses run-scoped memory', async () => {
    const c = { ...replyCtx('unused'), runKind: 'discovery' as const, leadId: null };
    const out = (await executeTool(c, 'p', 'plan', { content: 'campaign' })) as {
      plan: string;
    };
    expect(out.plan).toBe('campaign');
    expect(c.plan).toBe('campaign');
  });

  test('non-array items and empty plans are rejected', async () => {
    const c = replyCtx('unused');
    expect((await executeTool(c, 'x', 'plan', {})) as { error?: string }).toHaveProperty('error');
    expect(
      (await executeTool(c, 'x', 'plan', { items: [{ step: ' ' }] })) as { error?: string },
    ).toHaveProperty('error');
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'claimRun — suppressed leads hold their queue',
  () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!);

    test.each(['off', 'archived', 'unsubscribed'] as const)(
      'a queued run on a %s lead is not claimed',
      async (state) => {
        await migrate(sql, join(import.meta.dir, '../db/migrations'));
        await sql`update agent_runs set status = 'canceled' where status = 'queued'`;
        const created = await controlTx(sql, (tx) =>
          insertLeadTx(tx, { name: `Claim ${state} Lead`, agent_mode: 'auto' }),
        );
        const leadId = created.body.lead.id;
        if (state === 'off') {
          await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
        } else if (state === 'archived') {
          await sql`update leads set archived_at = now() where id = ${leadId}`;
        } else {
          await sql`update leads set unsubscribed_at = now() where id = ${leadId}`;
        }
        await enqueueRun(sql, { kind: 'outreach', leadId });
        expect(await claimRun(sql)).toBeNull();
        const back = await sql<{ status: string }[]>`
        select status from agent_runs where lead_id = ${leadId}`;
        expect(back[0]!.status).toBe('queued');
      },
    );

    test('a live lead still claims', async () => {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      await sql`update agent_runs set status = 'canceled' where status = 'queued'`;
      const created = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Claim Live Lead', agent_mode: 'auto' }),
      );
      await enqueueRun(sql, { kind: 'outreach', leadId: created.body.lead.id });
      expect(await claimRun(sql)).not.toBeNull();
    });
  },
);
