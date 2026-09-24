import { describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { insertRun } from '../src/agent/runner.ts';
import {
  executeTool,
  registeredToolNames,
  toolsFor,
  type ToolContext,
} from '../src/agent/tools.ts';
import {
  ACTION_TOOLS,
  NON_IDEMPOTENT,
  PLAYBOOK_KINDS,
  READ_TOOLS,
  TOOL_META,
} from '../src/agent/tool-meta.ts';
import { PLAYBOOKS, mergePlaybook, playbookTools } from '../src/agent/playbooks.ts';
import {
  automationAllowedTx,
  claimPolicyTx,
  draftDecision,
  explainAutonomyTx,
} from '../src/agent/policy.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { parseWakeupAt, retireWakeupsOnInboundTx, sweepWakeups } from '../src/agent/wakeups.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert } from '../src/modules/leads.ts';

describe('agent v2 — pure', () => {
  test('tool meta covers exactly the registered tools', () => {
    expect(new Set(Object.keys(TOOL_META))).toEqual(new Set(registeredToolNames()));
  });

  test('derived sets keep the historical loop-guard semantics', () => {
    for (const t of ['send_message', 'draft_message', 'request_human', 'unsubscribe']) {
      expect(ACTION_TOOLS.has(t)).toBe(true);
      expect(NON_IDEMPOTENT.has(t)).toBe(true);
    }
    for (const t of ['set_state', 'update_lead', 'create_task'])
      expect(ACTION_TOOLS.has(t)).toBe(true);
    for (const t of ['add_note', 'create_lead', 'propose_brief'])
      expect(NON_IDEMPOTENT.has(t)).toBe(true);
    for (const t of ['update_lead', 'plan', 'remember', 'schedule'])
      expect(NON_IDEMPOTENT.has(t)).toBe(false);
    expect(READ_TOOLS.has('read_pages')).toBe(true);
    expect(READ_TOOLS.has('schedule')).toBe(false);
  });

  test('toolsets: triage never sees send_message; strategist sees no lead tools', () => {
    expect(toolsFor('triage').map((t) => t.name)).not.toContain('send_message');
    expect(toolsFor('reply').map((t) => t.name)).toContain('schedule');
    expect(
      toolsFor('strategist')
        .map((t) => t.name)
        .sort(),
    ).toEqual(['propose_brief', 'remember']);
    for (const k of PLAYBOOK_KINDS) {
      expect(playbookTools(k).sort()).toEqual(
        toolsFor(k)
          .map((t) => t.name)
          .sort(),
      );
    }
  });

  test('playbook merge clamps overrides and keeps code defaults', () => {
    expect(mergePlaybook('reply').stepBudget).toBe(14);
    expect(mergePlaybook('discovery').monidCapUsd).toBe(0.25);
    const pb = mergePlaybook('reply', {
      stepBudget: 500,
      monidCapUsd: -1,
      model: '  ',
      enabled: false,
    });
    expect(pb.stepBudget).toBe(60);
    expect(pb.monidCapUsd).toBe(0);
    expect(pb.model).toBeNull();
    expect(pb.enabled).toBe(false);
    expect(mergePlaybook('outreach', { stepBudget: 2.5 }).stepBudget).toBe(
      PLAYBOOKS.outreach.stepBudget,
    );
  });

  test('draft decision: supervised keeps firstContactDraftOnly, autopilot lifts it, copilot drafts all', () => {
    const base = { firstContact: true, firstContactDraftOnly: true, leadMode: 'auto' };
    expect(draftDecision({ ...base, level: 'supervised' }).forceDraft).toBe(true);
    expect(draftDecision({ ...base, level: 'autopilot' }).forceDraft).toBe(false);
    expect(draftDecision({ ...base, firstContact: false, level: 'supervised' }).forceDraft).toBe(
      false,
    );
    expect(draftDecision({ ...base, firstContact: false, level: 'copilot' }).forceDraft).toBe(true);
    expect(
      draftDecision({ ...base, firstContact: false, level: 'autopilot', leadMode: 'draft' })
        .forceDraft,
    ).toBe(true);
  });

  test('wakeup time bounds', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseWakeupAt('nope', now)).toBeTypeOf('string');
    expect(parseWakeupAt('2026-01-01T00:05:00Z', now)).toBeTypeOf('string');
    expect(parseWakeupAt('2026-06-01T00:00:00Z', now)).toBeTypeOf('string');
    expect(parseWakeupAt('2026-01-02T00:00:00Z', now)).toBeInstanceOf(Date);
  });
});

describe('agent v2 — settings validation', () => {
  test('agent_playbooks and agent_autonomy are bounded', () => {
    expect(() => validateSetting('agent_playbooks', { reply: { stepBudget: 20 } })).not.toThrow();
    expect(() => validateSetting('agent_playbooks', { reply: { stepBudget: 61 } })).toThrow();
    expect(() => validateSetting('agent_playbooks', { nope: {} })).toThrow();
    expect(() => validateSetting('agent_playbooks', { reply: { extra: 1 } })).toThrow();
    expect(() =>
      validateSetting('agent_playbooks', { reply: { instructions: 'x'.repeat(4001) } }),
    ).toThrow();
    expect(() => validateSetting('agent_autonomy', { level: 'autopilot' })).not.toThrow();
    expect(() => validateSetting('agent_autonomy', { level: 'yolo' })).toThrow();
    expect(() =>
      validateSetting('agent_autonomy', { level: 'supervised', strategistAutoApproveUsd: 51 }),
    ).toThrow();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('agent v2 (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const uniq = Date.now().toString(36);

  const mkCtx = (runKind: ToolContext['runKind'], leadId: string, tag: string): ToolContext => ({
    sql,
    runId: `test-${uniq}-${tag}`,
    runKind,
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
    pageReads: 0,
    draftOnly: false,
    claimToken: null,
  });

  const mkLead = (name: string) =>
    controlTx(sql, async (tx) => {
      const r = await insertLeadTx(tx, leadInsert({ name: `${name}-${uniq}`, whatsapp: null }));
      return r.body.lead.id;
    });

  const setSetting = (key: string, value: unknown) =>
    sql`
      insert into control_settings (key, value) values (${key}, ${sql.json(value as never)})
      on conflict (key) do update set value = excluded.value
    `;
  const clearSetting = (key: string) => sql`delete from control_settings where key = ${key}`;

  test('schedule replaces the pending wakeup; sweep fires it as an auto outreach', async () => {
    const leadId = await mkLead('wk');
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    const a = (await executeTool(mkCtx('reply', leadId, 'a'), 's1', 'schedule', {
      leadId,
      at: soon,
      focus: 'perguntar sobre o teste',
    })) as { scheduled: boolean; id: string };
    expect(a.scheduled).toBe(true);
    const b = (await executeTool(mkCtx('reply', leadId, 'b'), 's1', 'schedule', {
      leadId,
      at: soon,
      focus: 'segunda tentativa',
    })) as { scheduled: boolean; id: string; replaced: string };
    expect(b.replaced).toBe(a.id);
    const pending =
      await sql`select id from agent_wakeups where lead_id = ${leadId} and status = 'pending'`;
    expect(pending.map((r) => r.id)).toEqual([b.id]);

    // lead-binding: a run bound to another lead can't schedule this one
    const other = await mkLead('wk-other');
    const denied = (await executeTool(mkCtx('reply', other, 'c'), 's1', 'schedule', {
      leadId,
      at: soon,
      focus: 'x',
    })) as { error?: string };
    expect(denied.error).toBeTruthy();

    await sql`update agent_wakeups set at = now() - interval '1 minute' where id = ${b.id}`;
    expect(await sweepWakeups(sql)).toBeGreaterThanOrEqual(1);
    const w = (
      await sql<{ status: string; fired_run_id: string }[]>`
      select status, fired_run_id from agent_wakeups where id = ${b.id}
    `
    )[0]!;
    expect(w.status).toBe('fired');
    const run = (
      await sql<{ kind: string; params: Record<string, unknown> }[]>`
      select kind, params from agent_runs where id = ${w.fired_run_id}
    `
    )[0]!;
    expect(run.kind).toBe('outreach');
    expect(run.params.auto).toBe('wakeup');
    expect(String(run.params.focus)).toContain('segunda tentativa');
  });

  test('inbound retires agent wakeups but keeps lead-requested ones', async () => {
    const leadId = await mkLead('wk-in');
    const at = new Date(Date.now() + 86_400_000).toISOString();
    await executeTool(mkCtx('reply', leadId, 'd'), 's1', 'schedule', {
      leadId,
      at,
      focus: 'cadência',
    });
    const kept = await mkLead('wk-req');
    await executeTool(mkCtx('reply', kept, 'e'), 's1', 'schedule', {
      leadId: kept,
      at,
      focus: 'me chama terça',
      requested: true,
    });
    expect(await controlTx(sql, (tx) => retireWakeupsOnInboundTx(tx, leadId))).toBe(1);
    expect(await controlTx(sql, (tx) => retireWakeupsOnInboundTx(tx, kept))).toBe(0);
  });

  test('autonomy off and disabled playbooks stop automation; explanation reflects level', async () => {
    const leadId = await mkLead('pol');
    try {
      await setSetting('agent_autonomy', { level: 'off' });
      expect((await controlTx(sql, (tx) => automationAllowedTx(tx, 'outreach'))).ok).toBe(false);
      const ex = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(ex!.canRun).toBe(false);
      expect(ex!.reasons[0]!.code).toBe('workspace_off');

      await setSetting('agent_autonomy', { level: 'autopilot' });
      await setSetting('agent_playbooks', { outreach: { enabled: false } });
      const v = await controlTx(sql, (tx) => automationAllowedTx(tx, 'outreach'));
      expect(v.ok).toBe(false);
      expect((await controlTx(sql, (tx) => automationAllowedTx(tx, 'reply'))).ok).toBe(true);

      // a due wakeup stays pending while its playbook is off
      await controlTx(
        sql,
        (tx) =>
          tx`insert into agent_wakeups (lead_id, at, focus) values (${leadId}, now() - interval '1 minute', 'x')`,
      );
      await sweepWakeups(sql);
      const st = await sql`select status from agent_wakeups where lead_id = ${leadId}`;
      expect(st[0]!.status).toBe('pending');

      await setSetting('agent_autonomy', { level: 'copilot' });
      const cp = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(cp!.sendMode).toBe('blocked'); // no channel on this lead
      await sql`update leads set email = ${`pol-${uniq}@example.com`} where id = ${leadId}`;
      const cp2 = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(cp2!.sendMode).toBe('draft');
      expect(cp2!.reasons[0]!.code).toBe('workspace_copilot');
    } finally {
      await clearSetting('agent_autonomy');
      await clearSetting('agent_playbooks');
      await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
    }
  });

  test('strategist auto-approve activates a proposal within the weekly budget', async () => {
    try {
      await setSetting('agent_autonomy', { level: 'supervised', strategistAutoApproveUsd: 1000 });
      const out = (await executeTool(
        { ...mkCtx('strategist', '', 'f'), leadId: null },
        'p1',
        'propose_brief',
        { name: `auto-${uniq}`, query: `auto q ${uniq}`, reason: 'teste' },
      )) as { proposed: boolean; enabled: boolean; brief: { id: string } };
      expect(out.enabled).toBe(true);
      await sql`update discovery_briefs set enabled = false where id = ${out.brief.id}`;
    } finally {
      await clearSetting('agent_autonomy');
    }
  });

  test('insertRun still works for a lead with no settings rows', async () => {
    const leadId = await mkLead('ins');
    const id = await controlTx(sql, (tx) => insertRun(tx, { kind: 'triage', leadId }));
    expect(id).toBeTruthy();
    await sql`update agent_runs set status = 'canceled' where id = ${id}`;
  });

  test('claim policy parks disabled playbooks and, at level off, automation rows only', async () => {
    try {
      await setSetting('agent_autonomy', { level: 'off' });
      await setSetting('agent_playbooks', { discovery: { enabled: false } });
      const p = await controlTx(sql, (tx) => claimPolicyTx(tx));
      expect(p.autoOff).toBe(true);
      expect(p.disabledKinds).toEqual(['discovery']);
      const leadId = await mkLead('claim');
      const auto = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId, params: { auto: 'x' } }),
      );
      const staff = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId, params: { origin: 'staff' } }),
      );
      const rows = await sql<{ id: string }[]>`
        select r.id from agent_runs r where r.id in (${auto!}, ${staff!})
          and not (r.kind = any(${p.disabledKinds}::text[]))
          and not (${p.autoOff} and (r.params ? 'auto' or r.params->>'origin' = 'inbound'))
      `;
      expect(rows.map((r) => r.id)).toEqual([staff!]);
      await sql`update agent_runs set status = 'canceled' where id in (${auto!}, ${staff!})`;
    } finally {
      await clearSetting('agent_autonomy');
      await clearSetting('agent_playbooks');
    }
  });
});
