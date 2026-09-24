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
    // debrief is a playbook flag (ADR 0014) — only discovery writes doctrine
    expect(PLAYBOOKS.discovery.debrief).toBe(true);
    expect(
      PLAYBOOK_KINDS.filter((k) => k !== 'discovery').every((k) => !PLAYBOOKS[k].debrief),
    ).toBe(true);
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

  test('wakeup `at` must be ISO-8601 — Date.parse leniency stays out', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    // Strings Date.parse accepts but that are not unambiguous ISO
    // datetimes — a silently-guessed wakeup date is worse than an error
    // the model retries. Date-only and offset-less forms guess too
    // (UTC midnight / server tz), so they reject like non-ISO strings.
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
  // Shared-DB discipline: every test that reads workspace-global state
  // (settings, integrations, budget inputs) pins what it reads and restores
  // the prior rows in finally — never assumes defaults, never destroys
  // another file's leftovers. suite order and accumulated state must not
  // change the outcome.
  const getSetting = async (key: string) =>
    (await sql<{ value: unknown }[]>`select value from control_settings where key = ${key}`)[0]
      ?.value;
  const restoreSetting = async (key: string, v: unknown) => {
    if (v === undefined) await clearSetting(key);
    else await setSetting(key, v);
  };
  /** Pin the policy inputs every sweep/policy read consults. */
  const pinPolicy = async () => ({
    autonomy: await getSetting('agent_autonomy'),
    playbooks: await getSetting('agent_playbooks'),
    guardrails: await getSetting('guardrails'),
  });
  const unpinPolicy = async (s: { autonomy: unknown; playbooks: unknown; guardrails: unknown }) => {
    await restoreSetting('agent_autonomy', s.autonomy);
    await restoreSetting('agent_playbooks', s.playbooks);
    await restoreSetting('guardrails', s.guardrails);
  };

  test('schedule replaces the pending wakeup; sweep fires it as an auto outreach', async () => {
    const prior = await pinPolicy();
    const leadId = await mkLead('wk');
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    try {
      // sweepWakeups gates on automationAllowedTx('outreach') — ambient
      // autonomy/playbooks leftovers must not be able to hold the fire.
      await setSetting('agent_autonomy', { level: 'supervised' });
      await setSetting('agent_playbooks', { outreach: { enabled: true } });
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

  test('autonomy off and disabled playbooks stop automation; explanation reflects level', async () => {
    const prior = await pinPolicy();
    const priorEmail = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
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

      // an enabled email integration must exist for the channel to be
      // reachable — seed it: other files' cleanup can leave none behind,
      // or a disabled 'log' row may linger — upsert past both
      await sql`insert into control_integrations (kind, driver, enabled)
                values ('email', 'log', true)
                on conflict (kind, driver) do update set enabled = true`;
      await setSetting('agent_autonomy', { level: 'copilot' });
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
    const priorAuto = await getSetting('agent_autonomy');
    // discoveryBudgetTx reads ambient numbers: trailing-7d discovery
    // spend, queued/running discovery runs, unbacked enabled strategist
    // briefs, and the mean of the last 20 done runs (no window on that
    // one). On a shared test DB they accumulate past the $50 cap clamp,
    // so snapshot + neutralize them for the assertion and restore after.
    const prevCosts = await sql<{ id: string; cost_cents: number }[]>`
      select id, cost_cents from agent_runs where kind = 'discovery' and cost_cents <> 0
    `;
    const prevOpen = await sql<{ id: string; status: string }[]>`
      select id, status from agent_runs where kind = 'discovery' and status in ('queued', 'running')
    `;
    const prevBriefs = await sql<{ id: string }[]>`
      select id from discovery_briefs where created_by = 'strategist' and enabled
    `;
    await sql`update agent_runs set cost_cents = 0 where kind = 'discovery' and cost_cents <> 0`;
    await sql`update agent_runs set status = 'canceled'
              where kind = 'discovery' and status in ('queued', 'running')`;
    await sql`update discovery_briefs set enabled = false where created_by = 'strategist' and enabled`;
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
      await restoreSetting('agent_autonomy', priorAuto);
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

  test('insertRun still works for a lead with no settings rows', async () => {
    const leadId = await mkLead('ins');
    const id = await controlTx(sql, (tx) => insertRun(tx, { kind: 'triage', leadId }));
    expect(id).toBeTruthy();
    await sql`update agent_runs set status = 'canceled' where id = ${id}`;
  });

  test('scheduleWakeupTx re-checks the 10-minute floor against db now() inside the tx', async () => {
    const leadId = await mkLead('wk-floor');
    // Bypasses parseWakeupAt — the point: a tx that sat on the advisory (or
    // a conflicting writer) past the floor can't insert an expired wakeup.
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
    const priorAutonomy = await getSetting('agent_autonomy');
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('whatsapp', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    // quiet hours off — a blocked verdict would hide the forceDraft path.
    await setSetting('guardrails', { quietStart: '00:00', quietEnd: '00:00' });
    await setSetting('agent_autonomy', { level: 'copilot' });
    try {
      const leadId = await mkLead('unsub');
      await sql`update leads set whatsapp = ${'+5511999' + uniq} where id = ${leadId}`;
      // agent_run_id is a uuid column — a real run row also exercises that
      // the opt-out's own cancel-queued pass leaves the composed draft.
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
      await restoreSetting('agent_autonomy', priorAutonomy);
    }
  });

  test('sweepOutreach folds a due agent wakeup into the cadence run — focus survives', async () => {
    const prior = await pinPolicy();
    const leadId = await mkLead('fold');
    try {
      // sweepOutreach gates on automationAllowedTx('outreach').
      await setSetting('agent_autonomy', { level: 'supervised' });
      await setSetting('agent_playbooks', { outreach: { enabled: true } });
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
    // The sweep also fires ambient due briefs and pauses ambient
    // over-budget ones — snapshot both so finally touches only this run's
    // own effect and undoes the rest.
    const preQueued = new Set(
      (
        await sql<{ id: string }[]>`
          select id from agent_runs where kind = 'discovery' and status = 'queued'
        `
      ).map((r) => r.id),
    );
    const preEnabled = new Set(
      (
        await sql<{ id: string }[]>`
          select id from discovery_briefs where enabled
        `
      ).map((r) => r.id),
    );
    try {
      // sweepBriefs gates on automationAllowedTx('discovery').
      await setSetting('agent_autonomy', { level: 'supervised', strategistAutoApproveUsd: 0.5 });
      await setSetting('agent_playbooks', { discovery: { enabled: true } });
      await setSetting('guardrails', {});
      await sweepBriefs(sql);
      const rows = await sql<{ id: string; enabled: boolean; note: string | null }[]>`
        select id, enabled, note from discovery_briefs where id in (${strat.id}, ${staff.id})
      `;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[strat.id]!.enabled).toBe(false);
      expect(byId[strat.id]!.note).toContain('orçamento');
      expect(byId[staff.id]!.enabled).toBe(true);
      const staffRun = await sql<{ id: string }[]>`
        select id from agent_runs where kind = 'discovery' and params->>'briefId' = ${staff.id}
      `;
      expect(staffRun).toHaveLength(1);
    } finally {
      // Undo the seeded spend (a 'done' row keeps feeding spent/est reads)
      // and every discovery run this sweep queued (feeds 'open' reads) —
      // runs already queued before the test stay queued.
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
      // Re-enable ambient briefs the sweep auto-paused (ours get deleted).
      const nowEnabled = new Set(
        (
          await sql<{ id: string }[]>`
            select id from discovery_briefs where enabled
          `
        ).map((r) => r.id),
      );
      const repaused = [...preEnabled].filter((id) => !nowEnabled.has(id));
      if (repaused.length) {
        await sql`update discovery_briefs set enabled = true where id in ${sql(repaused)}`;
      }
      await sql`delete from discovery_briefs where id in (${strat.id}, ${staff.id})`;
      await unpinPolicy(priorPolicy);
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

  test('claim policy parks disabled playbooks and, at level off, automation rows only', async () => {
    const prior = await pinPolicy();
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
      await unpinPolicy(prior);
    }
  });
});
