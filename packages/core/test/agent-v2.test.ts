import { describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { insertRun, sweepBriefs, sweepOutreach } from '../src/agent/runner.ts';
import {
  executeTool,
  registeredToolNames,
  toolsFor,
  type ToolContext,
} from '../src/agent/tools.ts';
import {
  ACTION_TOOLS,
  NON_IDEMPOTENT,
  JOB_KINDS,
  READ_TOOLS,
  TOOL_META,
} from '../src/agent/tool-meta.ts';
import { JOBS, jobTools } from '../src/agent/jobs.ts';
import {
  automationAllowedTx,
  DEFAULT_INSTRUCTIONS,
  discoveryBudgetTx,
  draftDecision,
  explainAutonomyTx,
  normalizeAgent,
  parked,
  parkPolicyTx,
} from '../src/agent/policy.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import {
  parseWakeupAt,
  retireWakeupsOnInboundTx,
  scheduleWakeupTx,
  sweepWakeups,
} from '../src/agent/wakeups.ts';
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
    for (const k of JOB_KINDS) {
      expect(jobTools(k).sort()).toEqual(
        toolsFor(k)
          .map((t) => t.name)
          .sort(),
      );
    }
  });

  test('the agent setting normalizes to safe defaults; job defs stay in code', () => {
    const d = normalizeAgent(undefined);
    expect(d).toEqual({
      level: 'supervised',
      jobs: { reply: true, outreach: true, discovery: true, strategist: true },
      instructions: DEFAULT_INSTRUCTIONS,
      weeklyDiscoveryUsd: 0,
    });
    const n = normalizeAgent({
      level: 'yolo',
      jobs: { discovery: false, reply: 'no' },
      instructions: 'x'.repeat(9000),
      weeklyDiscoveryUsd: 99,
    });
    expect(n.level).toBe('supervised');
    // only an explicit false switches a job off
    expect(n.jobs).toEqual({ reply: true, outreach: true, discovery: false, strategist: true });
    expect(n.instructions).toHaveLength(8000);
    expect(n.weeklyDiscoveryUsd).toBe(50);
    // an explicitly emptied instructions box stays empty
    expect(normalizeAgent({ level: 'off', instructions: '' }).instructions).toBe('');
    expect(JOBS.reply.stepBudget).toBe(14);
    expect(JOBS.discovery.monidCapUsd).toBe(0.25);
    // debrief is a job flag — only discovery writes doctrine
    expect(JOBS.discovery.debrief).toBe(true);
    expect(JOB_KINDS.filter((k) => k !== 'discovery').every((k) => !JOBS[k].debrief)).toBe(true);
  });

  test('parking: only automation of a switched-off job (or preset off) parks', () => {
    const jobOff = { autoOff: false, offJobs: ['discovery' as const] };
    expect(parked(jobOff, 'discovery', { auto: 'brief' })).toBe(true);
    expect(parked(jobOff, 'discovery', { origin: 'staff' })).toBe(false);
    expect(parked(jobOff, 'discovery', {})).toBe(false);
    expect(parked(jobOff, 'reply', { origin: 'inbound' })).toBe(false);
    const off = { autoOff: true, offJobs: [] };
    expect(parked(off, 'reply', { origin: 'inbound' })).toBe(true);
    expect(parked(off, 'outreach', { wakeupId: 'w' })).toBe(false);
  });

  test('draft decision: supervised drafts first contact, autopilot sends, copilot drafts all', () => {
    const base = { firstContact: true, leadMode: 'auto' };
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

  test('wakeup `at` must be ISO-8601 — Date.parse leniency stays out', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    // a silently-guessed wakeup date is worse than an error the model retries — Date-only/offset-less forms reject too
    for (const v of [
      'January 2, 2026',
      '01/02/2026',
      '2026/01/02',
      '02-01-2026',
      '2026-01-02',
      '2026-01-02T10:00:00',
      '2026-01-02 10:00:00',
    ]) {
      expect(parseWakeupAt(v, now)).toBeTypeOf('string');
    }
    for (const v of [
      '2026-01-02T00:00:00Z',
      '2026-01-02T00:00:00.250Z',
      '2026-01-02T03:00:00+02:00',
    ]) {
      expect(parseWakeupAt(v, now)).toBeInstanceOf(Date);
    }
  });
});

describe('agent v2 — settings validation', () => {
  test('the agent setting is bounded', () => {
    expect(() =>
      validateSetting('agent', {
        level: 'autopilot',
        jobs: { discovery: false },
        instructions: 'x',
        weeklyDiscoveryUsd: 5,
      }),
    ).not.toThrow();
    expect(() => validateSetting('agent', { level: 'yolo' })).toThrow();
    expect(() => validateSetting('agent', { level: 'off', stepBudget: 3 })).toThrow();
    expect(() => validateSetting('agent', { level: 'off', jobs: { triage: false } })).toThrow();
    expect(() => validateSetting('agent', { level: 'off', jobs: { reply: 'no' } })).toThrow();
    expect(() =>
      validateSetting('agent', { level: 'off', instructions: 'x'.repeat(8001) }),
    ).toThrow();
    expect(() => validateSetting('agent', { level: 'off', weeklyDiscoveryUsd: 51 })).toThrow();
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
  // shared-DB discipline — pin what a test reads and restore it in finally so ambient state can't change the outcome
  const getSetting = async (key: string) =>
    (await sql<{ value: unknown }[]>`select value from control_settings where key = ${key}`)[0]
      ?.value;
  const restoreSetting = async (key: string, v: unknown) => {
    if (v === undefined) await clearSetting(key);
    else await setSetting(key, v);
  };
  /** Pin the policy inputs every sweep/policy read consults. */
  const pinPolicy = async () => ({
    agent: await getSetting('agent'),
    guardrails: await getSetting('guardrails'),
  });
  const unpinPolicy = async (s: { agent: unknown; guardrails: unknown }) => {
    await restoreSetting('agent', s.agent);
    await restoreSetting('guardrails', s.guardrails);
  };

  test('schedule replaces the pending wakeup; sweep fires it as an auto outreach', async () => {
    const prior = await pinPolicy();
    const leadId = await mkLead('wk');
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    try {
      // ambient leftovers must not block the fire — sweepWakeups gates on automationAllowedTx('outreach')
      await setSetting('agent', { level: 'supervised', jobs: { outreach: true } });
      await setSetting('guardrails', {});
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
    } finally {
      await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
      await unpinPolicy(prior);
    }
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

  test('an autonomous reschedule keeps the lead-requested callback; a new promise supersedes it', async () => {
    const leadId = await mkLead('wk-keep');
    const day = 86_400_000;
    // The lead asked for a callback — a promise, not the agent's plan.
    await executeTool(mkCtx('reply', leadId, 'k1'), 's1', 'schedule', {
      leadId,
      at: new Date(Date.now() + 2 * day).toISOString(),
      focus: 'me chama terça',
      requested: true,
    });
    // a reminder replaces only autonomous rows — canceling the promise would kill the requested callback
    await executeTool(mkCtx('reply', leadId, 'k2'), 's1', 'schedule', {
      leadId,
      at: new Date(Date.now() + day).toISOString(),
      focus: 'cadência',
    });
    const pending = await sql<{ focus: string; requested: boolean }[]>`
      select focus, requested from agent_wakeups
      where lead_id = ${leadId} and status = 'pending' order by at
    `;
    expect(pending.length).toBe(2);
    expect(pending.filter((p) => p.requested).map((p) => p.focus)).toEqual(['me chama terça']);
    // a second promise supersedes the first — the autonomous row stays
    await executeTool(mkCtx('reply', leadId, 'k3'), 's1', 'schedule', {
      leadId,
      at: new Date(Date.now() + 3 * day).toISOString(),
      focus: 'melhor sexta',
      requested: true,
    });
    const rows = await sql<{ focus: string; status: string }[]>`
      select focus, status from agent_wakeups where lead_id = ${leadId}
    `;
    expect(
      rows
        .filter((r) => r.status === 'pending')
        .map((r) => r.focus)
        .sort(),
    ).toEqual(['cadência', 'melhor sexta']);
    expect(rows.some((r) => r.status === 'canceled' && r.focus === 'me chama terça')).toBe(true);
    await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
  });

  test('preset off and a switched-off job stop automation; explanation reflects level', async () => {
    const prior = await pinPolicy();
    const priorEmail = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
    const leadId = await mkLead('pol');
    try {
      await setSetting('agent', { level: 'off' });
      expect((await controlTx(sql, (tx) => automationAllowedTx(tx, 'outreach'))).ok).toBe(false);
      const ex = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(ex!.canRun).toBe(false);
      expect(ex!.reasons[0]!.code).toBe('workspace_off');

      await setSetting('agent', { level: 'autopilot', jobs: { outreach: false } });
      const v = await controlTx(sql, (tx) => automationAllowedTx(tx, 'outreach'));
      expect(v.ok).toBe(false);
      expect((await controlTx(sql, (tx) => automationAllowedTx(tx, 'reply'))).ok).toBe(true);

      // the agent's own due wakeup stays pending while its job is off
      await controlTx(
        sql,
        (tx) =>
          tx`insert into agent_wakeups (lead_id, at, focus) values (${leadId}, now() - interval '1 minute', 'x')`,
      );
      await sweepWakeups(sql);
      const st = await sql`select status from agent_wakeups where lead_id = ${leadId}`;
      expect(st[0]!.status).toBe('pending');

      // …but a callback the lead asked for is a promise — it fires with the job off
      const promisedLead = await mkLead('pol-promised');
      await controlTx(
        sql,
        (tx) =>
          tx`insert into agent_wakeups (lead_id, at, focus, requested)
             values (${promisedLead}, now() - interval '1 minute', 'me chama hoje', true)`,
      );
      await sweepWakeups(sql);
      const fired = await sql<{ status: string; params: Record<string, unknown> }[]>`
        select w.status, r.params from agent_wakeups w
        join agent_runs r on r.id = w.fired_run_id
        where w.lead_id = ${promisedLead}
      `;
      expect(fired).toHaveLength(1);
      expect(fired[0]!.status).toBe('fired');
      expect('auto' in fired[0]!.params).toBe(false);
      await sql`update agent_runs set status = 'canceled' where lead_id = ${promisedLead} and status = 'queued'`;

      // an enabled email integration must exist — upsert past ambient cleanup leftovers
      await sql`insert into control_integrations (kind, driver, enabled)
                values ('email', 'log', true)
                on conflict (kind, driver) do update set enabled = true`;
      await setSetting('agent', { level: 'copilot' });
      const cp = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(cp!.sendMode).toBe('blocked'); // no channel on this lead
      await sql`update leads set email = ${`pol-${uniq}@example.com`} where id = ${leadId}`;
      const cp2 = await controlTx(sql, (tx) => explainAutonomyTx(tx, leadId));
      expect(cp2!.sendMode).toBe('draft');
      expect(cp2!.reasons[0]!.code).toBe('workspace_copilot');
    } finally {
      await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
      if (priorEmail) {
        await sql`
          update control_integrations set enabled = ${priorEmail.enabled}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
      await unpinPolicy(prior);
    }
  });

  test('strategist auto-approve activates a proposal within the weekly budget', async () => {
    const priorAuto = await getSetting('agent');
    // ambient budget inputs accumulate on the shared DB — snapshot, neutralize, restore
    const prevCosts = await sql<{ id: string; cost_cents: number }[]>`
      select id, cost_cents from agent_runs where kind = 'discovery' and cost_cents <> 0
    `;
    const prevOpen = await sql<{ id: string; status: string }[]>`
      select id, status from agent_runs where kind = 'discovery' and status in ('queued', 'running')
    `;
    const prevBriefs = await sql<{ id: string }[]>`
      select id from discovery_briefs where created_by = 'strategist' and enabled
    `;
    try {
      // Inside try so a mid-setup failure still runs the finally restore.
      await sql`update agent_runs set cost_cents = 0 where kind = 'discovery' and cost_cents <> 0`;
      await sql`update agent_runs set status = 'canceled'
                where kind = 'discovery' and status in ('queued', 'running')`;
      await sql`update discovery_briefs set enabled = false where created_by = 'strategist' and enabled`;
      await setSetting('agent', { level: 'supervised', weeklyDiscoveryUsd: 1000 });
      const out = (await executeTool(
        { ...mkCtx('strategist', '', 'f'), leadId: null },
        'p1',
        'propose_brief',
        { name: `auto-${uniq}`, query: `auto q ${uniq}`, reason: 'teste' },
      )) as { proposed: boolean; enabled: boolean; brief: { id: string } };
      expect(out.enabled).toBe(true);
      await sql`update discovery_briefs set enabled = false where id = ${out.brief.id}`;
    } finally {
      await restoreSetting('agent', priorAuto);
      for (const r of prevCosts) {
        await sql`update agent_runs set cost_cents = ${r.cost_cents} where id = ${r.id}`;
      }
      for (const r of prevOpen) {
        await sql`update agent_runs set status = ${r.status} where id = ${r.id}`;
      }
      for (const b of prevBriefs) {
        await sql`update discovery_briefs set enabled = true where id = ${b.id}`;
      }
    }
  });

  test('the discovery unit estimate ignores zero-cost done runs', async () => {
    // zero-cost finishes carry no price signal — averaging them in deflates the unit price
    const priorAuto = await getSetting('agent');
    const prevCosts = await sql<{ id: string; cost_cents: number }[]>`
      select id, cost_cents from agent_runs where kind = 'discovery' and cost_cents <> 0
    `;
    let seededRunId: string | null = null;
    try {
      await sql`update agent_runs set cost_cents = 0 where kind = 'discovery' and cost_cents <> 0`;
      // All-zero sample → the 50¢ floor stands instead of 0.
      let bdg = await controlTx(sql, (tx) => discoveryBudgetTx(tx));
      expect(bdg.est).toBe(50);
      // A real price still feeds the mean; zeros beside it are skipped.
      const [ins] = await sql<{ id: string }[]>`
        insert into agent_runs (kind, lead_id, status, steps, cost_cents, created_at, finished_at)
        values ('discovery', null, 'done', ${sql.json([] as never[])}, 200, now(), now())
        returning id
      `;
      bdg = await controlTx(sql, (tx) => discoveryBudgetTx(tx));
      expect(bdg.est).toBe(200);
      seededRunId = ins!.id;
    } finally {
      await restoreSetting('agent', priorAuto);
      for (const r of prevCosts) {
        await sql`update agent_runs set cost_cents = ${r.cost_cents} where id = ${r.id}`;
      }
      if (seededRunId) await sql`delete from agent_runs where id = ${seededRunId}`;
    }
  });

  test('insertRun still works for a lead with no settings rows', async () => {
    const leadId = await mkLead('ins');
    const id = await controlTx(sql, (tx) => insertRun(tx, { kind: 'triage', leadId }));
    expect(id).toBeTruthy();
    await sql`update agent_runs set status = 'canceled' where id = ${id}`;
  });

  test('scheduleWakeupTx re-checks the 10-minute floor against db now() inside the tx', async () => {
    const leadId = await mkLead('wk-floor');
    // a tx delayed past the floor can't insert an expired wakeup
    const expired = await controlTx(sql, (tx) =>
      scheduleWakeupTx(tx, {
        leadId,
        at: new Date(Date.now() + 5 * 60_000),
        focus: 'x',
        requested: false,
        runId: null,
      }),
    );
    expect('error' in expired && expired.error).toContain('10 minutes');
    const ok = await controlTx(sql, (tx) =>
      scheduleWakeupTx(tx, {
        leadId,
        at: new Date(Date.now() + 3_600_000),
        focus: 'x',
        requested: false,
        runId: null,
      }),
    );
    expect('error' in ok).toBe(false);
    await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
  });

  test('copilot keeps the opt-out but drafts the unsubscribe farewell', async () => {
    const priorWa = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations
        where kind = 'whatsapp' and driver = 'log'
      `
    )[0];
    const priorGuardrails = (
      await sql<{ value: unknown }[]>`
        select value from control_settings where key = 'guardrails'
      `
    )[0];
    const priorAutonomy = await getSetting('agent');
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('whatsapp', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    // quiet hours off — a blocked verdict would hide the forceDraft path.
    await setSetting('guardrails', { quietStart: '00:00', quietEnd: '00:00' });
    await setSetting('agent', { level: 'copilot' });
    try {
      const leadId = await mkLead('unsub');
      await sql`update leads set whatsapp = ${'+5511999' + uniq} where id = ${leadId}`;
      // a real run row also exercises that the opt-out's cancel-queued pass leaves the draft
      const runId = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId })))!;
      const out = (await executeTool(
        { ...mkCtx('reply', leadId, 'u'), runId },
        's1',
        'unsubscribe',
        {
          leadId,
          reason: 'pediu para sair',
          reply: 'tudo bem, não te incomodo mais',
        },
      )) as { unsubscribed: boolean; farewellSent: boolean; farewellDrafted?: boolean };
      expect(out.unsubscribed).toBe(true);
      expect(out.farewellSent).toBe(false);
      expect(out.farewellDrafted).toBe(true);
      const msg = (
        await sql<{ status: string; is_farewell: boolean; author: string }[]>`
          select m.status, m.is_farewell, m.author from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.direction = 'out'
        `
      )[0]!;
      expect(msg.status).toBe('draft');
      expect(msg.is_farewell).toBe(true);
      const lead = (
        await sql<{ unsubscribed_at: string | null }[]>`
          select unsubscribed_at from leads where id = ${leadId}
        `
      )[0]!;
      expect(lead.unsubscribed_at).toBeTruthy();
    } finally {
      if (priorWa) {
        await sql`
          update control_integrations set enabled = ${priorWa.enabled}
          where kind = 'whatsapp' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'whatsapp' and driver = 'log'`;
      }
      if (priorGuardrails) await setSetting('guardrails', priorGuardrails.value);
      else await clearSetting('guardrails');
      await restoreSetting('agent', priorAutonomy);
    }
  });

  test('sweepOutreach folds a due agent wakeup into the cadence run — focus survives', async () => {
    const prior = await pinPolicy();
    const leadId = await mkLead('fold');
    try {
      // sweepOutreach gates on automationAllowedTx('outreach').
      await setSetting('agent', { level: 'supervised', jobs: { outreach: true } });
      await setSetting('guardrails', {});
      await sql`
        update leads set next_action_at = now() - interval '1 minute',
                         next_action_source = 'cadence'
        where id = ${leadId}
      `;
      const w = (
        await sql<{ id: string }[]>`
        insert into agent_wakeups (lead_id, at, focus)
        values (${leadId}, now() - interval '1 minute', 'cobrar o orçamento')
        returning id
      `
      )[0]!;
      await sweepOutreach(sql);
      const fired = (
        await sql<{ status: string; fired_run_id: string | null }[]>`
        select status, fired_run_id from agent_wakeups where id = ${w.id}
      `
      )[0]!;
      expect(fired.status).toBe('fired');
      expect(fired.fired_run_id).toBeTruthy();
      const run = (
        await sql<{ kind: string; params: Record<string, unknown> }[]>`
        select kind, params from agent_runs where id = ${fired.fired_run_id!}
      `
      )[0]!;
      expect(run.kind).toBe('outreach');
      expect(run.params.auto).toBe('cadence');
      expect(String(run.params.focus)).toContain('cobrar o orçamento');
      expect(run.params.wakeupId).toBe(w.id);
    } finally {
      await sql`update agent_runs set status = 'canceled' where lead_id = ${leadId} and status = 'queued'`;
      await unpinPolicy(prior);
    }
  });

  test('sweepBriefs disables an over-budget strategist brief; a staff brief still fires', async () => {
    const priorPolicy = await pinPolicy();
    const strat = (
      await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, created_by, last_run_at)
        values (${`sw-cap-${uniq}`}, 'q', true, 'strategist', now() - interval '2 days')
        returning id
      `
    )[0]!;
    const staff = (
      await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, created_by, last_run_at)
        values (${`sw-staff-${uniq}`}, 'q', true, 'staff', now() - interval '2 days')
        returning id
      `
    )[0]!;
    // 60c spent in the rolling window vs a $0.50 cap — over regardless of
    // ambient spend on the shared test DB.
    const prior = await controlTx(sql, (tx) => insertRun(tx, { kind: 'discovery' }));
    await sql`update agent_runs set status = 'done', cost_cents = 60 where id = ${prior!}`;
    // the sweep touches ambient briefs too — snapshot so finally restores only the rest
    const preQueued = new Set(
      (
        await sql<{ id: string }[]>`
          select id from agent_runs where kind = 'discovery' and status = 'queued'
        `
      ).map((r) => r.id),
    );
    // firing advances last_run_at — keep the stamp to restore
    const preEnabled = new Map(
      (
        await sql<{ id: string; last_run_at: string | null }[]>`
          select id, last_run_at from discovery_briefs where enabled
        `
      ).map((r) => [r.id, r.last_run_at] as const),
    );
    try {
      // sweepBriefs gates on automationAllowedTx('discovery').
      await setSetting('agent', { level: 'supervised', weeklyDiscoveryUsd: 0.5 });
      await setSetting('guardrails', {});
      await sweepBriefs(sql);
      const rows = await sql<{ id: string; enabled: boolean; note: string | null }[]>`
        select id, enabled, note from discovery_briefs where id in (${strat.id}, ${staff.id})
      `;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[strat.id]!.enabled).toBe(false);
      expect(byId[strat.id]!.note).toContain('orçamento');
      expect(byId[staff.id]!.enabled).toBe(true);
      const staffRun = await sql<{ id: string; params: Record<string, unknown> }[]>`
        select id, params from agent_runs where kind = 'discovery' and params->>'briefId' = ${staff.id}
      `;
      expect(staffRun).toHaveLength(1);
      // a brief run is automation: switching discovery off after it queued must park it
      expect(staffRun[0]!.params.auto).toBe('brief');
      await setSetting('agent', { level: 'supervised', jobs: { discovery: false } });
      const pp = await controlTx(sql, (tx) => parkPolicyTx(tx));
      expect(parked(pp, 'discovery', staffRun[0]!.params)).toBe(true);
    } finally {
      // undo the seeded spend + sweep-queued runs — pre-queued rows stay
      await sql`update agent_runs set status = 'canceled', cost_cents = 0 where id = ${prior!}`;
      const spawned = (
        await sql<{ id: string }[]>`
          select id from agent_runs where kind = 'discovery' and status = 'queued'
        `
      )
        .map((r) => r.id)
        .filter((id) => !preQueued.has(id));
      if (spawned.length) {
        await sql`update agent_runs set status = 'canceled' where id in ${sql(spawned)}`;
      }
      // re-enable ambient briefs the sweep paused and roll their cadence back
      for (const [id, lastRunAt] of preEnabled) {
        if (id === strat.id || id === staff.id) continue;
        await sql`
          update discovery_briefs
          set enabled = true, last_run_at = ${lastRunAt}
          where id = ${id} and (enabled = false or last_run_at is distinct from ${lastRunAt})
        `;
      }
      await sql`delete from discovery_briefs where id in (${strat.id}, ${staff.id})`;
      await unpinPolicy(priorPolicy);
    }
  });

  test('staff-triggered runs ignore the job switches', async () => {
    const prior = await pinPolicy();
    const app = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl-secret',
      autoDrain: false,
    });
    const leadId = await mkLead('staff-run');
    try {
      await setSetting('agent', {
        level: 'supervised',
        jobs: { reply: false, outreach: false, discovery: false, strategist: false },
      });
      const res = await app.request(`/control/v1/leads/${leadId}/run`, {
        method: 'POST',
        headers: {
          'x-vendua-control': 'ctl-secret',
          'content-type': 'application/json',
          'idempotency-key': `staff-run-${uniq}`,
        },
        body: JSON.stringify({ kind: 'outreach' }),
      });
      expect(res.status).toBe(201);
      const cfg = await app.request('/control/v1/agent/config', {
        headers: { 'x-vendua-control': 'ctl-secret' },
      });
      expect(((await cfg.json()) as { jobs: Record<string, boolean> }).jobs.outreach).toBe(false);
    } finally {
      await sql`update agent_runs set status = 'canceled' where lead_id = ${leadId} and status = 'queued'`;
      await unpinPolicy(prior);
    }
  });

  test('GET /agent/wakeups takes leadId or lead_id and validates limit', async () => {
    const app = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl-secret',
      autoDrain: false,
    });
    const authed = { 'x-vendua-control': 'ctl-secret' };
    const leadId = await mkLead('wk-list');
    await sql`
      insert into agent_wakeups (lead_id, at, focus)
      values (${leadId}, now() + interval '1 hour', 'x')
    `;
    for (const q of ['limit=abc', 'limit=Infinity', 'limit=2.5']) {
      const res = await app.request(`/control/v1/agent/wakeups?${q}`, { headers: authed });
      expect(res.status).toBe(400);
    }
    const camel = await app.request(`/control/v1/agent/wakeups?leadId=${leadId}&limit=999`, {
      headers: authed,
    });
    expect(camel.status).toBe(200);
    const snake = await app.request(`/control/v1/agent/wakeups?lead_id=${leadId}&limit=1`, {
      headers: authed,
    });
    expect(snake.status).toBe(200);
    const body = (await snake.json()) as { wakeups: { leadId: string }[] };
    expect(body.wakeups.every((w) => w.leadId === leadId)).toBe(true);
    await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId}`;
  });

  test('claim policy parks automation rows only — preset off or a switched-off job', async () => {
    const prior = await pinPolicy();
    try {
      await setSetting('agent', { level: 'off', jobs: { discovery: false } });
      const p = await controlTx(sql, (tx) => parkPolicyTx(tx));
      expect(p.autoOff).toBe(true);
      expect(p.offJobs).toEqual(['discovery']);
      const leadId = await mkLead('claim');
      // one active run per lead — a second lead or insertRun would deliver into the auto run
      const staffLead = await mkLead('claim-staff');
      const auto = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId, params: { auto: 'x' } }),
      );
      const staff = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId: staffLead, params: { origin: 'staff' } }),
      );
      const rows = await sql<{ id: string }[]>`
        select r.id from agent_runs r where r.id in (${auto!}, ${staff!})
          and not ((${p.autoOff} or r.kind = any(${p.offJobs}::text[]))
                   and (r.params ? 'auto' or r.params->>'origin' = 'inbound'))
      `;
      expect(rows.map((r) => r.id)).toEqual([staff!]);
      await sql`update agent_runs set status = 'canceled' where id in (${auto!}, ${staff!})`;
    } finally {
      await unpinPolicy(prior);
    }
  });

  test('insertRun retires a policy-parked row, and pulls a runnable row to the earlier start', async () => {
    const prior = await pinPolicy();
    try {
      await setSetting('agent', { level: 'off' });
      // a staff request can't inherit a run that will never claim — the parked row retires
      const offLead = await mkLead('adopt-off');
      const auto = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId: offLead, params: { auto: 'x' } }),
      );
      // a same-kind staff item isn't the retired intent's stand-in — the retire still anchors
      await sql`
        insert into agent_inbox (lead_id, kind, payload)
        values (${offLead}, 'staff',
          ${sql.json({ text: 'pedido', requestedKind: 'triage', params: { origin: 'staff' } } as never)})
      `;
      const staff = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId: offLead, params: { origin: 'staff' } }),
      );
      expect(staff).toBeTruthy();
      expect(staff).not.toBe(auto);
      const offRows = await sql<{ id: string; status: string }[]>`
        select id, status from agent_runs where lead_id = ${offLead}
      `;
      expect(offRows.find((r) => r.id === auto)!.status).toBe('canceled');
      expect(offRows.find((r) => r.id === staff!)!.status).toBe('queued');
      const offAnchor = await sql<
        { payload: { requestedKind?: string; params?: { auto?: string } } }[]
      >`
        select payload from agent_inbox
        where lead_id = ${offLead} and kind = 'event' and consumed_at is null
      `;
      expect(offAnchor).toHaveLength(1);
      expect(offAnchor[0]!.payload.requestedKind).toBe('triage');
      expect(offAnchor[0]!.payload.params?.auto).toBe('x');

      // Same retire for a switched-off job's automation row.
      await setSetting('agent', { level: 'supervised', jobs: { discovery: false } });
      const disLead = await mkLead('adopt-disabled');
      const disc = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'discovery', leadId: disLead, params: { auto: 'brief' } }),
      );
      const staffDisc = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId: disLead, params: { origin: 'staff' } }),
      );
      expect(staffDisc).not.toBe(disc);
      const disRows = await sql<{ id: string; status: string }[]>`
        select id, status from agent_runs where lead_id = ${disLead}
      `;
      expect(disRows.find((r) => r.id === disc)!.status).toBe('canceled');
      expect(disRows.find((r) => r.id === staffDisc!)!.status).toBe('queued');

      // a future-dated runnable row can't be pulled early — it retires and re-anchors at its own deadline
      const dateLead = await mkLead('adopt-date');
      const later = new Date(Date.now() + 3_600_000);
      const parked = await controlTx(sql, (tx) =>
        insertRun(tx, {
          kind: 'triage',
          leadId: dateLead,
          runAt: later,
          params: { focus: 'triagem marcada' },
        }),
      );
      // an undated same-intent item can't cover the schedule — the retire still anchors
      await sql`
        insert into agent_inbox (lead_id, kind, payload)
        values (${dateLead}, 'staff',
          ${sql.json({
            text: 'pedido',
            requestedKind: 'triage',
            params: { origin: 'staff', focus: 'triagem marcada' },
          } as never)})
      `;
      const immediate = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'reply', leadId: dateLead }),
      );
      expect(immediate).toBeTruthy();
      expect(immediate).not.toBe(parked);
      const dateRows = await sql<{ id: string; status: string }[]>`
        select id, status from agent_runs where lead_id = ${dateLead}
      `;
      expect(dateRows.find((r) => r.id === parked)!.status).toBe('canceled');
      expect(dateRows.find((r) => r.id === immediate!)!.status).toBe('queued');
      const anchor = await sql<
        { payload: { requestedKind?: string; notBefore?: string; params?: { focus?: string } } }[]
      >`
        select payload from agent_inbox
        where lead_id = ${dateLead} and kind = 'event' and consumed_at is null
      `;
      expect(anchor).toHaveLength(1);
      expect(anchor[0]!.payload.requestedKind).toBe('triage');
      expect(anchor[0]!.payload.params?.focus).toBe('triagem marcada');
      expect(Math.abs(Date.parse(anchor[0]!.payload.notBefore!) - later.getTime())).toBeLessThan(
        5_000,
      );

      // mail already carrying the deadline covers the intent — no anchor written
      const replyLead = await mkLead('adopt-covered');
      const quiet = new Date(Date.now() + 3_600_000);
      const replyParked = await controlTx(sql, (tx) =>
        insertRun(tx, {
          kind: 'reply',
          leadId: replyLead,
          runAt: quiet,
          params: { origin: 'inbound', channel: 'whatsapp' },
        }),
      );
      await sql`
        insert into agent_inbox (lead_id, kind, payload)
        values (${replyLead}, 'inbound',
          ${sql.json({
            text: 'oi',
            requestedKind: 'reply',
            params: { origin: 'inbound', channel: 'whatsapp' },
            notBefore: quiet.toISOString(),
          } as never)})
      `;
      const staffReply = await controlTx(sql, (tx) =>
        insertRun(tx, { kind: 'triage', leadId: replyLead, params: { origin: 'staff' } }),
      );
      expect(staffReply).not.toBe(replyParked);
      const coveredMail = await sql<{ n: number }[]>`
        select count(*)::int n from agent_inbox
        where lead_id = ${replyLead} and kind = 'event'
      `;
      expect(coveredMail[0]!.n).toBe(0);
      const replyRow = await sql<{ status: string }[]>`
        select status from agent_runs where id = ${replyParked}
      `;
      expect(replyRow[0]!.status).toBe('canceled');

      await sql`
        update agent_runs set status = 'canceled'
        where lead_id in (${offLead}, ${disLead}, ${dateLead}, ${replyLead})
      `;
    } finally {
      await unpinPolicy(prior);
    }
  });
});
