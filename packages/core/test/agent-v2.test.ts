import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
// the harness loads the app (and the agent registry) before crm/index.ts, which needs it loaded first
import { crmBench, OWNER_URL, say, type ToolOutcome } from './crm-harness.ts';
import { CRM_STATES, crmAgent } from '../src/agent-host/agents/crm/index.ts';
import { crmStrategist } from '../src/agent-host/agents/crm/strategist.ts';
import { sweepBriefs } from '../src/crm/board.ts';
import {
  parseWakeupAt,
  retireWakeupsOnInboundTx,
  scheduleTimerTx,
  setNextActionTx,
} from '../src/crm/agenda.ts';
import { parkedReasonTx } from '../src/crm/dispatch.ts';
import {
  automationAllowedTx,
  DEFAULT_INSTRUCTIONS,
  discoveryBudgetTx,
  draftDecision,
  explainAutonomyTx,
  type JobKind,
  normalizeAgent,
} from '../src/crm/policy.ts';
import { controlTx } from '../src/modules/control.ts';
import { validateSetting } from '../src/modules/integrations.ts';

describe('agent v2 — pure', () => {
  test('toolsets: triage never sees send_message; strategist sees no lead tools', () => {
    expect(CRM_STATES.triage).not.toContain('send_message');
    expect(CRM_STATES.reply).toContain('schedule');
    expect(crmStrategist.def.tools.map((t) => t.name).sort()).toEqual([
      'propose_brief',
      'remember',
    ]);
  });

  test('the agent setting normalizes to safe defaults; job defs stay in code', () => {
    const d = normalizeAgent(undefined);
    expect(d).toEqual({
      level: 'supervised',
      jobs: { reply: true, outreach: true, discovery: true, strategist: true },
      instructions: DEFAULT_INSTRUCTIONS,
      weeklyDiscoveryUsd: 0,
      schedule: { discoveryHour: 9, weeklyDay: 1, weeklyHour: 8 },
      newLeadMode: { inbound: 'auto', discovery: 'auto' },
    });
    expect(
      normalizeAgent({ newLeadMode: { inbound: 'draft', discovery: 'yolo' } }).newLeadMode,
    ).toEqual({ inbound: 'draft', discovery: 'auto' });
    expect(
      normalizeAgent({ schedule: { discoveryHour: 25, weeklyDay: 3, weeklyHour: 1.5 } }).schedule,
    ).toEqual({ discoveryHour: 9, weeklyDay: 3, weeklyHour: 8 });
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
    expect(crmAgent.def.budgets?.stepsPerTurn).toBe(14);
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
    expect(() =>
      validateSetting('agent', { level: 'off', schedule: { discoveryHour: 7, weeklyDay: 5 } }),
    ).not.toThrow();
    expect(() => validateSetting('agent', { level: 'off', schedule: { weeklyDay: 7 } })).toThrow();
    expect(() => validateSetting('agent', { level: 'off', schedule: { hour: 7 } })).toThrow();
  });
});

describe.skipIf(!OWNER_URL)('agent v2 (db)', () => {
  const b = crmBench('agent-v2');
  const { sql, appSql } = b;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => b.mine.clear());

  const dataOf = (o: ToolOutcome) => ('data' in o ? (o.data as Record<string, unknown>) : null);
  /** the lead's agenda: timer rows not yet consumed by a turn, oldest first */
  const agenda = async (leadId: string) =>
    (await b.mail(leadId)).filter((m) => m.kind.startsWith('timer.') && !m.consumed_by_turn);

  test('parking: only automation of a switched-off job (or preset off) parks', async () => {
    const open = {
      agent_mode: 'auto',
      archived_at: null,
      unsubscribed_at: null,
      agent_paused_at: null,
    };
    const parked = (kind: string, source: string, payload: Record<string, string> = {}) =>
      controlTx(appSql, (tx) => parkedReasonTx(tx, kind, source, open, payload));
    await b.settings('supervised', {}, { jobs: { discovery: false } });
    // a switched-off job parks its automation: a brief's daily run…
    expect(await parked('timer.daily', 'schedule')).not.toBeNull();
    // …but a staff ask and a reply to the lead still run
    expect(await parked('staff.request', 'staff', { kind: 'discovery' })).toBeNull();
    expect(await parked('message.inbound', 'whatsapp')).toBeNull();
    await b.settings('off');
    expect(await parked('message.inbound', 'whatsapp')).not.toBeNull();
    expect(await parked('timer.followup', 'cadence')).not.toBeNull();
    // a promise the lead asked for is never parked by the preset
    expect(await parked('timer.callback', 'agent')).toBeNull();
  });

  test('schedule replaces the pending wakeup; the due one fires as an outreach turn', async () => {
    await b.settings('supervised');
    const l = await b.lead();
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    const first = await b.runTools([['schedule', { at: soon, focus: 'perguntar sobre o teste' }]], {
      leadId: l.id,
      kind: 'reply',
    });
    expect(dataOf(first.outcomes[0]!)).toMatchObject({ scheduled: true });
    const firstId = String(dataOf(first.outcomes[0]!)!.id);
    const second = await b.runTools([['schedule', { at: soon, focus: 'segunda tentativa' }]], {
      leadId: l.id,
      kind: 'reply',
    });
    const secondId = String(dataOf(second.outcomes[0]!)!.id);
    expect(dataOf(second.outcomes[0]!)).toMatchObject({ scheduled: true, replaced: firstId });
    expect((await agenda(l.id)).map((m) => m.id)).toEqual([secondId]);

    // a schedule issued in another lead's run books on that lead: this one's agenda is untouched
    const other = await b.lead();
    const elsewhere = await b.runTools([['schedule', { at: soon, focus: 'x' }]], {
      leadId: other.id,
      kind: 'reply',
    });
    expect(dataOf(elsewhere.outcomes[0]!)).toMatchObject({ scheduled: true });
    expect((await agenda(l.id)).map((m) => m.id)).toEqual([secondId]);
    expect(await agenda(other.id)).toHaveLength(1);

    // the due date fires as a turn of its own, with the focus the agent booked
    await sql`update agent_mailbox set deliver_at = now() - interval '1 minute' where id = ${secondId}`;
    await sql`update agent_actors set next_wake_at = now() - interval '1 minute' where id = ${second.actorId}`;
    const { rt } = b.runtime(() => say('ok'));
    await b.settle(rt);
    const [fired] = await sql<{ consumed_by_turn: string | null; payload: { focus: string } }[]>`
      select consumed_by_turn, payload from agent_mailbox where id = ${secondId}`;
    expect(fired!.consumed_by_turn).not.toBeNull();
    expect(fired!.payload.focus).toBe('segunda tentativa');
    expect((await b.turns(l.id)).at(-1)).toMatchObject({
      kind: 'outreach',
      status: 'done',
      source: 'followup',
    });
  });

  test('inbound retires agent wakeups but keeps lead-requested ones', async () => {
    const l = await b.lead();
    const at = new Date(Date.now() + 86_400_000);
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, { leadId: l.id, at, focus: 'cadência', requested: false, by: 'agent' }),
    );
    const kept = await b.lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: kept.id,
        at,
        focus: 'me chama terça',
        requested: true,
        by: 'agent',
      }),
    );
    expect(await controlTx(appSql, (tx) => retireWakeupsOnInboundTx(tx, l.id))).toBe(1);
    expect(await controlTx(appSql, (tx) => retireWakeupsOnInboundTx(tx, kept.id))).toBe(0);
  });

  test('an autonomous reschedule keeps the lead-requested callback; a new promise supersedes it', async () => {
    const l = await b.lead();
    const day = 86_400_000;
    const book = (focus: string, ahead: number, requested: boolean) =>
      controlTx(appSql, (tx) =>
        scheduleTimerTx(tx, {
          leadId: l.id,
          at: new Date(Date.now() + ahead),
          focus,
          requested,
          by: 'agent',
        }),
      );
    // The lead asked for a callback — a promise, not the agent's plan.
    await book('me chama terça', 2 * day, true);
    // a reminder replaces only autonomous rows — canceling the promise would kill the requested callback
    await book('cadência', day, false);
    const pending = await agenda(l.id);
    expect(pending).toHaveLength(2);
    expect(pending.filter((p) => p.payload.requested === true).map((p) => p.payload.focus)).toEqual(
      ['me chama terça'],
    );
    // a second promise supersedes the first — the autonomous row stays
    await book('melhor sexta', 3 * day, true);
    expect((await agenda(l.id)).map((p) => String(p.payload.focus)).sort()).toEqual([
      'cadência',
      'melhor sexta',
    ]);
  });

  test('preset off and a switched-off job stop automation; explanation reflects level', async () => {
    const priorEmail = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations where kind = 'email' and driver = 'log'
      `
    )[0];
    const l = await b.lead({ whatsapp: null });
    const verdict = (kind: JobKind) => controlTx(appSql, (tx) => automationAllowedTx(tx, kind));
    await b.settings('off');
    expect((await verdict('outreach')).ok).toBe(false);
    const ex = await controlTx(appSql, (tx) => explainAutonomyTx(tx, l.id));
    expect(ex!.canRun).toBe(false);
    expect(ex!.reasons[0]!.code).toBe('workspace_off');

    await b.settings('autopilot', {}, { jobs: { outreach: false } });
    expect((await verdict('outreach')).ok).toBe(false);
    expect((await verdict('reply')).ok).toBe(true);

    // a callback the lead asked for is a promise: it fires with the job off
    const promised = await b.lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: promised.id,
        at: new Date(Date.now() - 60_000),
        focus: 'me chama hoje',
        requested: true,
        by: 'agent',
        floor: false,
      }),
    );
    const promisedRun = b.runtime(() => say('ok'));
    await b.settle(promisedRun.rt);
    expect((await b.turns(promised.id)).at(-1)).toMatchObject({ kind: 'outreach', status: 'done' });
    expect(await agenda(promised.id)).toHaveLength(0);

    try {
      await sql`insert into control_integrations (kind, driver, enabled)
                values ('email', 'log', true)
                on conflict (kind, driver) do update set enabled = true`;
      await b.settings('copilot');
      const cold = await b.lead({ whatsapp: null });
      const cp = await controlTx(appSql, (tx) => explainAutonomyTx(tx, cold.id));
      expect(cp!.sendMode).toBe('blocked'); // no channel on this lead
      await sql`update leads set email = ${`pol-${b.nonce}@example.com`} where id = ${cold.id}`;
      const cp2 = await controlTx(appSql, (tx) => explainAutonomyTx(tx, cold.id));
      expect(cp2!.sendMode).toBe('draft');
      expect(cp2!.reasons[0]!.code).toBe('workspace_copilot');
    } finally {
      if (priorEmail) {
        await sql`
          update control_integrations set enabled = ${priorEmail.enabled}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
    }
  });

  test('strategist auto-approve activates a proposal within the weekly budget', async () => {
    await b.settings('supervised', {}, { weeklyDiscoveryUsd: 50 });
    // the budget window is global: other files' discovery spend and waiting hunts would fill it
    const aged = await sql<{ turn_id: string }[]>`
      update crm_turns set finished_at = finished_at - interval '8 days'
      where kind = 'discovery' and finished_at > now() - interval '7 days' returning turn_id`;
    const held = await sql<{ id: string }[]>`
      update agent_mailbox m set consumed_by_turn = gen_random_uuid() from agent_actors a
      where a.id = m.actor_id and a.agent_id = 'crm-discovery' and m.consumed_by_turn is null
      returning m.id`;
    try {
      const { outcomes } = await b.runTools(
        [
          [
            'propose_brief',
            { name: `auto-${b.nonce}`, query: `auto q ${b.nonce}`, reason: 'teste' },
          ],
        ],
        { kind: 'strategist' },
      );
      const out = dataOf(outcomes[0]!) as {
        proposed: boolean;
        enabled: boolean;
        brief: { id: string };
      };
      expect(out.enabled).toBe(true);
      await sql`update discovery_briefs set enabled = false where id = ${out.brief.id}`;
    } finally {
      await sql`
        update crm_turns set finished_at = finished_at + interval '8 days'
        where turn_id = any(${aged.map((r) => r.turn_id)})`;
      await sql`
        update agent_mailbox set consumed_by_turn = null where id = any(${held.map((r) => r.id)})`;
    }
  });

  test('the discovery unit estimate ignores zero-cost done runs', async () => {
    // zero-cost finishes carry no price signal — averaging them in deflates the unit price
    const prevCosts = await sql<{ turn_id: string; cost_cents: number }[]>`
      select turn_id, cost_cents from crm_turns where kind = 'discovery' and cost_cents <> 0
    `;
    const seeded: string[] = [];
    const seed = async (cost: number) => {
      const [row] = await sql<{ turn_id: string }[]>`
        insert into crm_turns (turn_id, actor_id, agent_id, kind, source, status, started_at, finished_at, cost_cents)
        values (gen_random_uuid(), gen_random_uuid(), 'crm-discovery', 'discovery', 'schedule', 'done', now(), now(), ${cost})
        returning turn_id`;
      seeded.push(row!.turn_id);
    };
    try {
      await sql`update crm_turns set cost_cents = 0 where kind = 'discovery' and cost_cents <> 0`;
      // All-zero sample → the 50¢ floor stands instead of 0.
      expect((await controlTx(appSql, (tx) => discoveryBudgetTx(tx))).est).toBe(50);
      // A real price still feeds the mean; zeros beside it are skipped.
      await seed(200);
      await seed(0);
      expect((await controlTx(appSql, (tx) => discoveryBudgetTx(tx))).est).toBe(200);
    } finally {
      for (const r of prevCosts) {
        await sql`update crm_turns set cost_cents = ${r.cost_cents} where turn_id = ${r.turn_id}`;
      }
      for (const id of seeded) await sql`delete from crm_turns where turn_id = ${id}`;
    }
  });

  test('scheduleTimerTx re-checks the 10-minute floor against db now() inside the tx', async () => {
    const l = await b.lead();
    // a tx delayed past the floor can't insert an expired wakeup
    const expired = await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 5 * 60_000),
        focus: 'x',
        requested: false,
        by: 'agent',
      }),
    );
    expect('error' in expired && expired.error).toContain('10 minutes');
    const ok = await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 3_600_000),
        focus: 'x',
        requested: false,
        by: 'agent',
      }),
    );
    expect('error' in ok).toBe(false);
  });

  test('copilot keeps the opt-out but drafts the unsubscribe farewell', async () => {
    await b.settings('copilot');
    const l = await b.lead();
    const { outcomes } = await b.runTools(
      [['unsubscribe', { reason: 'pediu para sair', reply: 'tudo bem, não te incomodo mais' }]],
      { leadId: l.id, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({
      name: 'unsubscribe',
      ok: true,
      data: { unsubscribed: true, farewellSent: false, farewellDrafted: true },
    });
    const [msg] = await sql<{ status: string; is_farewell: boolean; author: string }[]>`
      select m.status, m.is_farewell, m.author from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${l.id} and m.direction = 'out'
    `;
    expect(msg).toMatchObject({ status: 'draft', is_farewell: true });
    const [lead] = await sql<{ unsubscribed_at: string | null }[]>`
      select unsubscribed_at from leads where id = ${l.id}
    `;
    expect(lead!.unsubscribed_at).toBeTruthy();
  });

  test('the agenda: a staff date replaces the agent plan, mirrors next_action_at, fires as a promise', async () => {
    await b.settings('supervised');
    const l = await b.lead();
    // the agent's own plan, then a staff date over it
    await controlTx(appSql, (tx) =>
      setNextActionTx(tx, l.id, new Date(Date.now() + 86_400_000), 'agent'),
    );
    const staffAt = new Date(Date.now() - 60_000);
    await controlTx(appSql, (tx) => setNextActionTx(tx, l.id, staffAt, 'staff'));
    const pending = await agenda(l.id);
    expect(pending.map((p) => [p.kind, p.payload.by, p.payload.requested])).toEqual([
      ['timer.callback', 'staff', false],
    ]);
    const [mirror] = await sql<{ next_action_at: Date; next_action_source: string }[]>`
      select next_action_at, next_action_source from leads where id = ${l.id}
    `;
    expect(mirror!.next_action_source).toBe('staff');
    expect(Math.abs(mirror!.next_action_at.getTime() - staffAt.getTime())).toBeLessThan(1000);
    const { rt } = b.runtime(() => say('ok'));
    await b.settle(rt);
    const [turn] = (await b.turns(l.id)).slice(-1);
    expect(turn).toMatchObject({ kind: 'outreach', source: 'callback', status: 'done' });
    // fired → nothing pending → the mirror clears
    const [after] = await sql<{ next_action_at: Date | null }[]>`
      select next_action_at from leads where id = ${l.id}
    `;
    expect(after!.next_action_at).toBeNull();
  });

  test('sweepBriefs disables an over-budget strategist brief; a staff brief still fires', async () => {
    const strat = (
      await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, created_by, last_run_at)
        values (${`sw-cap-${b.nonce}`}, 'q', true, 'strategist', now() - interval '2 days')
        returning id
      `
    )[0]!;
    const staff = (
      await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, created_by, last_run_at)
        values (${`sw-staff-${b.nonce}`}, 'q', true, 'staff', now() - interval '2 days')
        returning id
      `
    )[0]!;
    // 60c spent in the rolling window vs a $0.50 cap — over regardless of
    // ambient spend on the shared test DB.
    const [spend] = await sql<{ turn_id: string }[]>`
      insert into crm_turns (turn_id, actor_id, agent_id, kind, source, status, started_at, finished_at, cost_cents)
      values (gen_random_uuid(), gen_random_uuid(), 'crm-discovery', 'discovery', 'staff:test', 'done', now(), now(), 60)
      returning turn_id`;
    // the sweep touches ambient briefs too — snapshot so finally restores only the rest
    const ambient = await sql<{ id: string; last_run_at: Date | null }[]>`
      select id, last_run_at from discovery_briefs where enabled and id not in ${sql([strat.id, staff.id])}
    `;
    try {
      // sweepBriefs gates on automationAllowedTx('discovery').
      await b.settings('supervised', {}, { weeklyDiscoveryUsd: 0.5 });
      await sweepBriefs(sql);
      const rows = await sql<{ id: string; enabled: boolean; note: string | null }[]>`
        select id, enabled, note from discovery_briefs where id in (${strat.id}, ${staff.id})
      `;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[strat.id]!.enabled).toBe(false);
      expect(byId[strat.id]!.note).toContain('orçamento');
      expect(byId[staff.id]!.enabled).toBe(true);
      const [staffRun] = await sql<
        { kind: string; source: string; payload: Record<string, unknown> }[]
      >`
        select m.kind, m.source, m.payload from agent_mailbox m
        join agent_actors a on a.id = m.actor_id
        where a.agent_id = 'crm-discovery' and a.subject_id = ${staff.id}
      `;
      expect(staffRun).toMatchObject({ kind: 'timer.daily', source: 'schedule' });
      // a brief run is automation: switching discovery off after it queued must park it
      await b.settings('supervised', {}, { jobs: { discovery: false } });
      const parkedNow = await controlTx(appSql, (tx) =>
        parkedReasonTx(tx, staffRun!.kind, staffRun!.source, null, staffRun!.payload as never),
      );
      expect(parkedNow).not.toBeNull();
    } finally {
      await sql`delete from crm_turns where turn_id = ${spend!.turn_id}`;
      for (const a of ambient) {
        await sql`
          update discovery_briefs set enabled = true, last_run_at = ${a.last_run_at}
          where id = ${a.id}`;
      }
      await sql`delete from discovery_briefs where id in (${strat.id}, ${staff.id})`;
    }
  });

  test('staff-triggered runs ignore the job switches', async () => {
    await b.settings(
      'supervised',
      {},
      {
        jobs: { reply: false, outreach: false, discovery: false, strategist: false },
      },
    );
    const l = await b.lead();
    const res = await b.control('POST', '/control/v1/agent/requests', {
      kind: 'outreach',
      leadId: l.id,
    });
    expect(res.status).toBe(201);
    const filed = (await b.mail(l.id)).filter((m) => !m.consumed_by_turn);
    expect(filed.map((m) => [m.kind, m.source])).toEqual([['staff.request', 'staff']]);
    const cfg = await b.control('GET', '/control/v1/agent/config');
    expect(((await cfg.json()) as { jobs: Record<string, boolean> }).jobs.outreach).toBe(false);
  });

  test('GET /agent/wakeups takes leadId or lead_id and validates limit', async () => {
    const l = await b.lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 3_600_000),
        focus: 'x',
        requested: false,
        by: 'agent',
      }),
    );
    for (const q of ['limit=abc', 'limit=Infinity', 'limit=2.5']) {
      const res = await b.control('GET', `/control/v1/agent/wakeups?${q}`);
      expect(res.status).toBe(400);
    }
    const camel = await b.control('GET', `/control/v1/agent/wakeups?leadId=${l.id}&limit=999`);
    expect(camel.status).toBe(200);
    const snake = await b.control('GET', `/control/v1/agent/wakeups?lead_id=${l.id}&limit=1`);
    expect(snake.status).toBe(200);
    const body = (await snake.json()) as { wakeups: { leadId: string }[] };
    expect(body.wakeups).toHaveLength(1);
    expect(body.wakeups.every((w) => w.leadId === l.id)).toBe(true);
  });
});
