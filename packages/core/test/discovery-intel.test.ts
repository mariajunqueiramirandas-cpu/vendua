import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { sweepBriefs, sweepStrategist } from '../src/crm/board.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
import { anchorTx } from '../src/crm/schedule-anchors.ts';
import { workspaceTx } from '../src/agent-host/agents/crm/context.ts';
import { buildSystemPrompt } from '../src/agent-host/agents/crm/prompts.ts';
import { crmStrategist } from '../src/agent-host/agents/crm/strategist.ts';
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_PITCH,
  upsertIntegration,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert, leadPatch } from '../src/modules/leads.ts';
import type { Sql } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';
import { crmBench, OWNER_URL, type ToolOutcome } from './crm-harness.ts';

/** The mock discovery provider on for a describe's runs (a discovery run parks with no research
 *  provider); the returned restore puts the prior discovery rows back as they were. */
async function mockDiscovery(db: Sql, key: () => string) {
  const prior = await db<{ driver: string; enabled: boolean }[]>`
    select driver, enabled from control_integrations where kind = 'discovery'`;
  await upsertIntegration(db, { kind: 'discovery', driver: 'mock', enabled: true }, key());
  return async () => {
    if (!prior.some((p) => p.driver === 'mock'))
      await db`delete from control_integrations where kind = 'discovery' and driver = 'mock'`;
    for (const p of prior)
      await db`update control_integrations set enabled = ${p.enabled}
        where kind = 'discovery' and driver = ${p.driver}`;
  };
}

const dataOf = <T>(o: ToolOutcome | undefined): T => (o as { data: T }).data;

describe('discovery intelligence — pure', () => {
  test('agent.newLeadMode validates origin and mode', () => {
    const ok = (m: unknown) => () =>
      validateSetting('agent', { level: 'supervised', newLeadMode: m });
    expect(ok({ inbound: 'draft', discovery: 'auto' })).not.toThrow();
    expect(ok({ inbound: 'off' })).toThrow();
    expect(ok({ staff: 'auto' })).toThrow();
    expect(ok('auto')).toThrow();
  });

  test('guardrails: briefAutoPauseRuns defaults on, validates range', () => {
    expect(DEFAULT_GUARDRAILS.briefAutoPauseRuns).toBe(5);
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 40 })).not.toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 101 })).toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 2.5 })).toThrow();
  });

  test('strategist toolset: propose_brief + remember, no lead tools', () => {
    const names = crmStrategist.def.tools.map((t) => t.name);
    expect(names).toContain('propose_brief');
    expect(names).toContain('remember');
    // lead mutation stays out of a board run — proposing is the strategist's whole job
    for (const t of ['create_lead', 'update_lead', 'send_message', 'draft_message']) {
      expect(names).not.toContain(t);
    }
  });

  test('intentScore maps through leadInsert/leadPatch, validates 0–10', () => {
    const ins = leadInsert({ name: 'Ana', intentScore: 7, intentReason: 'vagas abertas' });
    expect(ins.intent_score).toBe(7);
    expect(ins.intent_reason).toBe('vagas abertas');
    const patch = leadPatch({ intentScore: 0 });
    expect(patch.intent_score).toBe(0);
    expect(() => leadInsert({ name: 'Ana', intentScore: 11 })).toThrow();
    expect(() => leadPatch({ intentScore: 1.5 })).toThrow();
    expect(() => leadPatch({ intentScore: 'alto' })).toThrow();
  });

  test('strategist prompt has its own section and skips the lead GOAL block', () => {
    const p = buildSystemPrompt(
      'strategist',
      DEFAULT_PITCH,
      '',
      { facts: ['docerias respondem melhor à noite'] },
      { tools: new Set(['propose_brief', 'remember']), channels: [] },
    );
    expect(p).toContain('estrategista');
    expect(p).toContain('propose_brief');
    expect(p).toContain('docerias respondem melhor à noite');
    expect(p).not.toContain('OBJETIVO DESTE LEAD');
  });
});

// DB-backed tests opt in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!OWNER_URL)('discovery intelligence (db)', () => {
  const b = crmBench('discovery-intel');
  const { sql } = b;
  const uniq = Date.now().toString(36);
  // phones/whatsapps dedupe — keep them unique across suite re-runs
  const wa = `wa.me/55${String(Date.now()).slice(-9)}`;

  let restoreDiscovery = async () => {};
  beforeAll(async () => {
    await b.setup();
    restoreDiscovery = await mockDiscovery(sql as unknown as Sql, b.key);
  });
  afterAll(async () => {
    await restoreDiscovery();
    await b.teardown();
  });
  beforeEach(() => b.mine.clear());

  test('workspace tools — unconfigured providers are reported, a mock discovery driver stays available', async () => {
    const monid = process.env.MONID_API_KEY;
    delete process.env.MONID_API_KEY;
    const ref = `VENDUA_TEST_TF_${uniq}`;
    const emRef = `VENDUA_TEST_RESEND_${uniq}`;
    // other files leave integration rows behind — snapshot the ones this test touches
    const prior = await sql<
      { kind: string; driver: string; enabled: boolean; secret_ref: string | null }[]
    >`
      select kind, driver, enabled, secret_ref from control_integrations
      where kind = 'discovery' or (kind = 'email' and driver = 'resend')
    `;
    const upsert = (kind: string, driver: string, secretRef: string | null) => sql`
      insert into control_integrations (kind, driver, enabled, secret_ref)
      values (${kind}, ${driver}, true, ${secretRef})
      on conflict (kind, driver) do update
        set enabled = true, secret_ref = excluded.secret_ref, updated_at = now()
    `;
    try {
      await sql`update control_integrations set enabled = false where kind = 'discovery'`;
      const real = await workspaceTx(sql);
      for (const n of ['instagram_profile', 'maps_lookup', 'read_pages', 'serp', 'web_search'])
        expect(real.disabled[n]).toBeDefined();
      // memory tables are migrated in the test db
      expect(real.disabled.remember).toBeUndefined();

      // a mock discovery driver is a working provider: its web tools are offered
      await upsert('discovery', 'mock', null);
      const mock = await workspaceTx(sql);
      expect(mock.disabled.web_search).toBeUndefined();
      expect(mock.disabled.serp).toBeDefined();

      await upsert('discovery', 'tinyfish', ref);
      expect((await workspaceTx(sql)).disabled.web_search).toContain(ref);
      process.env[ref] = 'k';
      process.env.MONID_API_KEY = 'k';
      const research = await workspaceTx(sql);
      for (const n of ['instagram_profile', 'maps_lookup', 'read_pages', 'serp', 'web_search'])
        expect(research.disabled[n]).toBeUndefined();

      // the newest enabled email row is THE provider: a resend without its key can't send
      await upsert('email', 'resend', emRef);
      const noKey = await workspaceTx(sql);
      expect(noKey.channels).not.toContain('email');
      process.env[emRef] = 'k';
      const withKey = await workspaceTx(sql);
      expect(withKey.channels).toContain('email');
      expect(withKey.disabled.send_message).toBeUndefined();
    } finally {
      // rows this test created go; rows that were there get their state back
      for (const [kind, driver] of [
        ['discovery', 'mock'],
        ['discovery', 'tinyfish'],
        ['email', 'resend'],
      ] as const) {
        if (!prior.some((r) => r.kind === kind && r.driver === driver)) {
          await sql`delete from control_integrations where kind = ${kind} and driver = ${driver}`;
        }
      }
      for (const r of prior) {
        await sql`
          update control_integrations set enabled = ${r.enabled}, secret_ref = ${r.secret_ref}
          where kind = ${r.kind} and driver = ${r.driver}
        `;
      }
      delete process.env[ref];
      delete process.env[emRef];
      if (monid === undefined) delete process.env.MONID_API_KEY;
      else process.env.MONID_API_KEY = monid;
    }
  });

  const mkBrief = async (name: string) =>
    (
      await controlTx(
        sql,
        (tx) =>
          tx<{ id: string }[]>`
            insert into discovery_briefs (name, query, enabled)
            values (${name}, 'q ' || ${name}, true)
            returning id
          `,
      )
    )[0]!.id;

  const briefRow = (id: string) =>
    sql<{ enabled: boolean; note: string | null }[]>`
      select enabled, note from discovery_briefs where id = ${id}
    `.then((r) => r[0]!);

  const lastRun = (id: string) =>
    sql<{ last_run_at: string | null }[]>`
      select last_run_at from discovery_briefs where id = ${id}
    `.then((r) => r[0]!.last_run_at);

  /** A finished discovery turn of a brief, started `ageSec` seconds ago; it filed `leads` leads. */
  const seedTurn = (briefId: string, leads: number, ageSec = 0) =>
    controlTx(
      sql,
      (tx) => tx`
        insert into crm_turns (turn_id, actor_id, agent_id, kind, source, brief_id, status,
          started_at, leads_created, params)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'crm-discovery', 'discovery',
          'schedule', ${briefId}, 'done', now() - make_interval(secs => ${ageSec}), ${leads},
          ${tx.json({ briefId } as never)})`,
    );

  // A sweep takes a bounded batch of due briefs: sweep until the test's briefs have been seen.
  const sweepUntil = async (done: () => Promise<boolean>) => {
    for (let i = 0; i < 12 && !(await done()); i++) await sweepBriefs(sql);
  };

  test('C1: dead brief pauses at the threshold, live brief keeps running', async () => {
    await b.settings('supervised');
    const dead = await mkBrief(`dead-${uniq}`);
    const live = await mkBrief(`live-${uniq}`);
    for (let i = 0; i < 5; i++) await seedTurn(dead, 0);
    for (let i = 0; i < 4; i++) await seedTurn(live, 0);
    await seedTurn(live, 1);

    await sweepUntil(async () => !(await briefRow(dead)).enabled && (await lastRun(live)) !== null);

    const d = await briefRow(dead);
    expect(d.enabled).toBe(false);
    expect(d.note).toContain('auto-pausada');

    const l = await briefRow(live);
    expect(l.enabled).toBe(true);
    expect(l.note).toBeNull();
    // last_run_at stamps at enqueue — stays even if the ambient worker already claimed the run
    expect(await lastRun(live)).not.toBeNull();

    // revival (rearmed_at) restarts the streak window — the next sweep fires a run instead of instantly re-pausing
    await sql`
      update discovery_briefs set enabled = true, note = null, rearmed_at = now()
      where id = ${dead}
    `;
    await sweepUntil(async () => (await lastRun(dead)) !== null);
    const revived = await briefRow(dead);
    expect(revived.enabled).toBe(true);
    expect(await lastRun(dead)).not.toBeNull();
  });

  test('C1: turns started before a re-arm do not eat the fresh streak', async () => {
    await b.settings('supervised');
    const stale = await mkBrief(`stale-${uniq}`);
    // the bound is started_at (the turn's start), not finished_at — these turns began before the
    // rearm but finished after it
    for (let i = 0; i < 5; i++) await seedTurn(stale, 0, 3600);
    // rearm lands between started_at and finished_at — the timeline the bug needs
    await sql`
      update discovery_briefs set rearmed_at = now() - interval '30 minutes', enabled = true
      where id = ${stale}
    `;

    await sweepUntil(async () => (await lastRun(stale)) !== null);
    expect((await briefRow(stale)).enabled).toBe(true);
    expect(await lastRun(stale)).not.toBeNull();
  });

  test('C1: under the threshold the brief still fires', async () => {
    await b.settings('supervised');
    const fresh = await mkBrief(`fresh-${uniq}`);
    for (let i = 0; i < 3; i++) await seedTurn(fresh, 0);
    await sweepUntil(async () => (await lastRun(fresh)) !== null);
    const f = await briefRow(fresh);
    expect(f.enabled).toBe(true);
    expect(await lastRun(fresh)).not.toBeNull();
  });

  test('C1: briefAutoPauseRuns=0 never pauses', async () => {
    await b.settings('supervised', { briefAutoPauseRuns: 0 });
    const off = await mkBrief(`off-${uniq}`);
    for (let i = 0; i < 6; i++) await seedTurn(off, 0);
    await sweepUntil(async () => (await lastRun(off)) !== null);
    expect((await briefRow(off)).enabled).toBe(true);
    expect(await lastRun(off)).not.toBeNull();
  });

  /** The workspace-time weekly slot `daysAgo` days back: its weekday and this hour. */
  const slotAgo = async (daysAgo: number) => {
    const [t] = await sql<{ dow: number; h: number }[]>`
      select extract(dow from now() at time zone 'America/Sao_Paulo')::int as dow,
             extract(hour from now() at time zone 'America/Sao_Paulo')::int as h`;
    return { weeklyDay: (t!.dow - daysAgo + 7) % 7, weeklyHour: t!.h };
  };
  /** The weekly review's mailbox row for the slot a schedule names. */
  const weeklyKey = async (slot: { weeklyDay: number; weeklyHour: number }) => {
    const anchor = await controlTx(sql, (tx) =>
      anchorTx(tx, { hour: slot.weeklyHour, weekday: slot.weeklyDay }),
    );
    return `crm:weekly:${anchor.last.toISOString()}`;
  };
  const weeklyRows = async (key: string) => [
    ...(await sql<{ kind: string; source: string }[]>`
        select kind, source from agent_mailbox
        where tenant_id = ${PLATFORM_TENANT_ID} and dedupe_key = ${key}`),
  ];

  test('C2: sweepStrategist fires once per week', async () => {
    const slot = await slotAgo(0);
    await b.settings('supervised', {}, { schedule: slot });
    const key = await weeklyKey(slot);
    await sql`delete from agent_mailbox where tenant_id = ${PLATFORM_TENANT_ID} and dedupe_key = ${key}`;
    try {
      expect(await sweepStrategist(sql)).toBe(true);
      expect(await sweepStrategist(sql)).toBe(false);
      expect(await weeklyRows(key)).toEqual([{ kind: 'timer.weekly', source: 'schedule' }]);
    } finally {
      await sql`delete from agent_mailbox where tenant_id = ${PLATFORM_TENANT_ID} and dedupe_key = ${key}`;
    }
  });

  test('C2: a weekly review missed by a whole day is not owed', async () => {
    const slot = await slotAgo(2);
    await b.settings('supervised', {}, { schedule: slot });
    const key = await weeklyKey(slot);
    expect(await sweepStrategist(sql)).toBe(false);
    expect(await weeklyRows(key)).toEqual([]);
  });

  test('C2: propose_brief writes a disabled strategist draft and dedupes', async () => {
    // the weekly budget is 0 here: a proposal is a draft, never auto-enabled
    await b.settings('supervised');
    const name = `prop-${uniq}`;
    const { outcomes } = await b.runTools(
      [
        [
          'propose_brief',
          {
            name,
            // queries dedupe too — keep it unique across suite re-runs
            query: `docerias ${uniq} com whatsapp em fortaleza`,
            segment: 'doceria',
            city: 'Fortaleza',
            target: 5,
            reason: 'docerias respondem e faltam briefs na cidade',
          },
        ],
        // a name that differs only in case is a duplicate
        ['propose_brief', { name: name.toUpperCase(), query: 'qualquer outra', reason: 'x' }],
        // staff approve on the note, so a blank reason can't land
        ['propose_brief', { name: `blank-${uniq}`, query: `blank q ${uniq}`, reason: '   ' }],
      ],
      { kind: 'strategist' },
    );
    const out = dataOf<{ proposed: boolean; brief: { id: string } }>(outcomes[0]);
    expect(out.proposed).toBe(true);
    const row = (
      await sql<{ enabled: boolean; created_by: string; note: string }[]>`
        select enabled, created_by, note from discovery_briefs where id = ${out.brief.id}
      `
    )[0]!;
    expect(row.enabled).toBe(false); // never self-enables
    expect(row.created_by).toBe('strategist');
    expect(row.note).toContain('docerias respondem');

    const dup = dataOf<{ proposed: boolean; duplicate: boolean }>(outcomes[1]);
    expect(dup.proposed).toBe(false);
    expect(dup.duplicate).toBe(true);

    expect(outcomes[2]).toMatchObject({ name: 'propose_brief', ok: false });
    expect((outcomes[2] as { content: string }).content).toContain('reason');

    const denied = await b.runTools(
      [['propose_brief', { name: 'sneaky', query: 'q', reason: 'r' }]],
      { kind: 'discovery' },
    );
    expect(denied.outcomes[0]!.blocked).toStartWith('state_gate:');
  });

  test('create_lead starts the lead in the workspace mode for discovered leads', async () => {
    const modes: string[] = [];
    for (const mode of ['draft', 'auto'] as const) {
      await b.settings('supervised', {}, { newLeadMode: { discovery: mode } });
      // low fit: autocontact stays out of it, so the mode is the setting's alone
      const { outcomes } = await b.runTools(
        [
          [
            'create_lead',
            {
              name: `Modo ${mode} ${uniq}`,
              email: `modo-${mode}-${uniq}@example.com`,
              findings: 'doceria de bairro, vende por encomenda',
              fitScore: 3,
              fitReason: 'porte pequeno',
            },
          ],
        ],
        { kind: 'discovery' },
      );
      const id = dataOf<{ leadId: string }>(outcomes[0]).leadId;
      modes.push(
        (await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${id}`)[0]!
          .agent_mode,
      );
    }
    expect(modes).toEqual(['draft', 'auto']);
  });

  test('C3: create_lead persists intent_score + merges fill gaps only', async () => {
    const name = `Intent ${uniq}`;
    // the merge only fills still-empty columns — a dup's score can't overwrite the scored card
    const empty = `Empty Intent ${uniq}`;
    const blank = (
      await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: empty, city: 'Fortaleza', agent_mode: 'auto' }),
      )
    ).body.lead;
    const { outcomes } = await b.runTools(
      [
        [
          'create_lead',
          {
            name,
            findings: 'doceria com whatsapp ativo vendendo sem link próprio de pedidos',
            whatsapp: wa,
            fitScore: 8,
            fitReason: 'doceria artesanal',
            intentScore: 9,
            intentReason: 'reviews recentes pedindo cardápio; vaga aberta',
          },
        ],
        [
          'create_lead',
          {
            name: empty,
            city: 'Fortaleza',
            findings: 'mesma doceria encontrada de novo com sinal de intenção novo',
            website: `https://x-${uniq}.test`,
            intentScore: 4,
            intentReason: 'whatsapp ativo sem link',
          },
        ],
      ],
      { kind: 'discovery' },
    );
    const created = dataOf<{ leadId: string }>(outcomes[0]);
    const row = (
      await sql<{ intent_score: number; intent_reason: string }[]>`
        select intent_score, intent_reason from leads where id = ${created.leadId}
      `
    )[0]!;
    expect(row.intent_score).toBe(9);
    expect(row.intent_reason).toContain('reviews recentes');

    const dup = dataOf<{ duplicate: boolean; merged: string[] }>(outcomes[1]);
    expect(dup.duplicate).toBe(true);
    expect(dup.merged).toContain('intent_score');
    expect(dup.merged).toContain('intent_reason');
    const filled = (
      await sql<{ intent_score: number }[]>`
        select intent_score from leads where id = ${blank.id}
      `
    )[0]!;
    expect(filled.intent_score).toBe(4);
  });

  test('C4: dup-merge promotes agent_mode only when the outreach run is admitted', async () => {
    // the autocontact gate needs a live whatsapp driver — the bench's log driver counts
    const seedDup = async (name: string, whatsapp: string) =>
      (
        await controlTx(sql, (tx) =>
          insertLeadTx(tx, {
            name,
            city: 'Fortaleza',
            whatsapp,
            whatsapp_verified: true,
            fit_score: 9,
            agent_mode: 'draft',
          }),
        )
      ).body.lead;
    const createDup = (name: string, whatsapp: string) =>
      b
        .runTools(
          [
            [
              'create_lead',
              {
                name,
                city: 'Fortaleza',
                findings: 'mesma doceria encontrada de novo',
                whatsapp,
                website: `https://site-${whatsapp.slice(-4)}.test`,
              },
            ],
          ],
          { kind: 'discovery' },
        )
        .then((r) =>
          dataOf<{
            duplicate: boolean;
            merged: string[];
            firstContactQueued?: boolean;
            lead?: { agentMode?: string };
          }>(r.outcomes[0]),
        );
    const agentMode = async (id: string) =>
      (await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${id}`)[0]!
        .agent_mode;
    const firstContacts = async (id: string) =>
      (await b.mail(id)).filter(
        (m) =>
          m.kind === 'lead.first_contact' &&
          m.source === 'first_contact' &&
          m.consumed_by_turn === null,
      );

    const cappedWa = `55119${String(Date.now()).slice(-7)}01`;
    const openWa = `55119${String(Date.now()).slice(-7)}02`;
    const capped = await seedDup(`Capped Merge ${uniq}`, cappedWa);
    const open = await seedDup(`Open Merge ${uniq}`, openWa);

    // the outreach job is off → insertion of the first contact is refused, so the merge keeps
    // its contacts but the automation flag stays where it was
    await b.settings('supervised', {}, { jobs: { outreach: false } });
    const refused = await createDup(`Capped Merge ${uniq}`, cappedWa);
    expect(refused.duplicate).toBe(true);
    // the merge still lands — only the automation flag is refused
    expect(refused.merged).toContain('website');
    expect(refused.merged).not.toContain('agent_mode');
    expect(refused.firstContactQueued).toBeUndefined();
    expect(await agentMode(capped.id)).toBe('draft');
    expect(await firstContacts(capped.id)).toHaveLength(0);

    // a lead under the job's switch still promotes — first contact admitted, mode follows
    await b.settings('supervised', {}, { jobs: { outreach: true } });
    const admitted = await createDup(`Open Merge ${uniq}`, openWa);
    expect(admitted.duplicate).toBe(true);
    expect(admitted.merged).toContain('agent_mode');
    expect(admitted.firstContactQueued).toBe(true);
    expect(await agentMode(open.id)).toBe('auto');
    expect(await firstContacts(open.id)).toHaveLength(1);

    // fresh path, same invariant: 'auto' lands only with the first contact filed behind it
    const freshWa = `55119${String(Date.now()).slice(-7)}03`;
    const fresh = await b.runTools(
      [
        [
          'create_lead',
          {
            name: `Fresh Auto ${uniq}`,
            city: 'Fortaleza',
            findings: 'doceria nova com whatsapp verificado',
            whatsapp: freshWa,
            fitScore: 9,
          },
        ],
      ],
      { kind: 'discovery' },
    );
    const freshOut = dataOf<{
      leadId: string;
      firstContactQueued?: boolean;
      lead: { agentMode?: string };
    }>(fresh.outcomes[0]);
    expect(freshOut.firstContactQueued).toBe(true);
    expect(freshOut.lead.agentMode).toBe('auto');
    expect(await agentMode(freshOut.leadId)).toBe('auto');

    // one busy lead: a reply already waits in its mailbox, and the first contact files behind it
    const busyWa = `55119${String(Date.now()).slice(-7)}05`;
    const busy = await seedDup(`Busy Merge ${uniq}`, busyWa);
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId: busy.id,
        kind: 'message.inbound',
        source: 'whatsapp',
        dedupeKey: `crm:test:busy-inbound:${uniq}`,
      }),
    );
    const busyRes = await createDup(`Busy Merge ${uniq}`, busyWa);
    expect(busyRes.duplicate).toBe(true);
    expect(busyRes.firstContactQueued).toBe(true);
    expect(await firstContacts(busy.id)).toHaveLength(1);
  });
});
