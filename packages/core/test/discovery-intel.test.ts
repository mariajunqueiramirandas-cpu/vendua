import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { insertRun, sweepBriefs, sweepStrategist } from '../src/agent/runner.ts';
import { toolGate, executeTool, toolsFor, type ToolContext } from '../src/agent/tools.ts';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { DEFAULT_GUARDRAILS, DEFAULT_PITCH, validateSetting } from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert, leadPatch } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('discovery intelligence — pure', () => {
  test('guardrails: briefAutoPauseRuns defaults on, validates range', () => {
    expect(DEFAULT_GUARDRAILS.briefAutoPauseRuns).toBe(5);
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 40 })).not.toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 101 })).toThrow();
    expect(() => validateSetting('guardrails', { briefAutoPauseRuns: 2.5 })).toThrow();
  });

  test('strategist toolset: propose_brief + remember, no lead tools', () => {
    const names = toolsFor('strategist').map((t) => t.name);
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
    const p = buildSystemPrompt('strategist', DEFAULT_PITCH, '', {
      facts: ['docerias respondem melhor à noite'],
    });
    expect(p).toContain('estrategista');
    expect(p).toContain('propose_brief');
    expect(p).toContain('docerias respondem melhor à noite');
    expect(p).not.toContain('OBJETIVO DESTE LEAD');
  });
});

// DB-backed tests opt in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('discovery intelligence (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const uniq = Date.now().toString(36);
  // phones/whatsapps dedupe — keep them unique across suite re-runs
  const wa = `wa.me/55${String(Date.now()).slice(-9)}`;

  test('toolGate — unconfigured providers are reported, mock LLM keeps mock discovery', async () => {
    // first DB touch in this file on a fresh CI database — migrate before anything
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
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
    const upsert = (kind: string, driver: string, secretRef: string) => sql`
      insert into control_integrations (kind, driver, enabled, secret_ref)
      values (${kind}, ${driver}, true, ${secretRef})
      on conflict (kind, driver) do update
        set enabled = true, secret_ref = excluded.secret_ref, updated_at = now()
    `;
    try {
      await sql`update control_integrations set enabled = false where kind = 'discovery'`;
      const real = await toolGate(sql, { simulated: false });
      for (const n of ['instagram_profile', 'maps_lookup', 'read_pages', 'serp', 'web_search'])
        expect(real.disabled.has(n)).toBe(true);
      // memory tables are migrated in the test db
      expect(real.disabled.has('remember')).toBe(false);
      const sim = await toolGate(sql, { simulated: true });
      expect(sim.disabled.has('web_search')).toBe(false);
      expect(sim.disabled.has('serp')).toBe(true);

      await upsert('discovery', 'tinyfish', ref);
      expect((await toolGate(sql, { simulated: true })).disabled.get('web_search')).toContain(ref);
      process.env[ref] = 'k';
      process.env.MONID_API_KEY = 'k';
      const research = await toolGate(sql, { simulated: false });
      for (const n of ['instagram_profile', 'maps_lookup', 'read_pages', 'serp', 'web_search'])
        expect(research.disabled.has(n)).toBe(false);

      // the newest enabled email row is THE provider: a resend without its key can't send
      await upsert('email', 'resend', emRef);
      const noKey = await toolGate(sql, { simulated: false });
      expect(noKey.channels).not.toContain('email');
      process.env[emRef] = 'k';
      const withKey = await toolGate(sql, { simulated: false });
      expect(withKey.channels).toContain('email');
      expect(withKey.disabled.has('send_message')).toBe(false);
    } finally {
      // rows this test created go; rows that were there get their state back
      for (const [kind, driver] of [
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

  const mkCtx = (runKind: ToolContext['runKind']): ToolContext => ({
    sql,
    // unique runId per suite run — claimControl keys are deterministic (runId:step:name:callId), a re-run would replay stale responses
    runId: `test-${uniq}`,
    runKind,
    leadId: null,
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

  // a finished discovery run for the brief; lead = it produced a lead
  const doneRun = (briefId: string, lead: boolean) =>
    controlTx(sql, async (tx) => {
      const id = await insertRun(tx, {
        source: 'staff',
        kind: 'discovery',
        params: { briefId, query: 'q' },
      });
      await tx`
        update agent_runs set
          status = 'done',
          finished_at = now(),
          steps = ${tx.json(
            lead
              ? [{ type: 'tool', name: 'create_lead', out: { lead: { id: 'x' } } }]
              : [{ type: 'tool', name: 'create_lead', out: { duplicate: true } }],
          )}
        where id = ${id}
      `;
      return id;
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

  test('C1: dead brief pauses at the threshold, live brief keeps running', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));

    const dead = await mkBrief(`dead-${uniq}`);
    const live = await mkBrief(`live-${uniq}`);
    for (let i = 0; i < 5; i++) await doneRun(dead, false);
    for (let i = 0; i < 4; i++) await doneRun(live, false);
    await doneRun(live, true);

    // a dev worker's 15s sweep can interleave mid-test — converge by re-sweeping instead of asserting on one invocation
    for (let i = 0; i < 12; i++) {
      await sweepBriefs(sql);
      if (!(await briefRow(dead)).enabled) break;
      await sql`
        update agent_runs set status = 'done', finished_at = now(), steps = '[]'
        where kind = 'discovery' and status = 'queued' and params->>'briefId' = ${dead}
      `;
    }

    const d = await briefRow(dead);
    expect(d.enabled).toBe(false);
    expect(d.note).toContain('auto-pausada');

    const l = await briefRow(live);
    expect(l.enabled).toBe(true);
    expect(l.note).toBeNull();
    // last_run_at stamps at enqueue — stays even if the ambient worker already claimed the run
    const liveRow = (
      await sql<{ last_run_at: string | null }[]>`
        select last_run_at from discovery_briefs where id = ${live}
      `
    )[0]!;
    expect(liveRow.last_run_at).not.toBeNull();

    // revival (rearmed_at) restarts the streak window — the next sweep fires a run instead of instantly re-pausing
    await sql`
      update discovery_briefs set enabled = true, note = null, rearmed_at = now()
      where id = ${dead}
    `;
    await sweepBriefs(sql);
    const revived = await briefRow(dead);
    expect(revived.enabled).toBe(true);
    expect(
      (
        await sql<{ last_run_at: string | null }[]>`
          select last_run_at from discovery_briefs where id = ${dead}
        `
      )[0]!.last_run_at,
    ).not.toBeNull();
  });

  test('C1: runs queued before a re-arm do not eat the fresh streak', async () => {
    const stale = await mkBrief(`stale-${uniq}`);
    // the bound is created_at (enqueue), not finished_at — these runs were queued before the rearm but finish after it
    await controlTx(sql, async (tx) => {
      for (let i = 0; i < 5; i++) {
        const id = await insertRun(tx, {
          source: 'staff',
          kind: 'discovery',
          params: { briefId: stale, query: 'q' },
        });
        await tx`
          update agent_runs set
            status = 'done',
            created_at = now() - interval '1 hour',
            finished_at = now(),
            steps = '[]'
          where id = ${id}
        `;
      }
      // rearm lands between created_at and finished_at — the timeline the bug needs
      await tx`
        update discovery_briefs set rearmed_at = now() - interval '30 minutes',
          enabled = true
        where id = ${stale}
      `;
    });

    await sweepBriefs(sql);
    expect((await briefRow(stale)).enabled).toBe(true);
    expect(
      (
        await sql<{ last_run_at: string | null }[]>`
          select last_run_at from discovery_briefs where id = ${stale}
        `
      )[0]!.last_run_at,
    ).not.toBeNull();
  });

  test('C1: under the threshold the brief still fires', async () => {
    const fresh = await mkBrief(`fresh-${uniq}`);
    for (let i = 0; i < 3; i++) await doneRun(fresh, false);
    await sweepBriefs(sql);
    const f = await briefRow(fresh);
    expect(f.enabled).toBe(true);
    expect(
      (
        await sql<{ last_run_at: string | null }[]>`
          select last_run_at from discovery_briefs where id = ${fresh}
        `
      )[0]!.last_run_at,
    ).not.toBeNull();
  });

  test('C1: briefAutoPauseRuns=0 never pauses', async () => {
    const off = await mkBrief(`off-${uniq}`);
    for (let i = 0; i < 6; i++) await doneRun(off, false);
    await controlTx(
      sql,
      (tx) =>
        tx`
          insert into control_settings (key, value) values ('guardrails', ${tx.json({
            briefAutoPauseRuns: 0,
          })})
          on conflict (key) do update set value = control_settings.value || excluded.value
        `,
    );
    await sweepBriefs(sql);
    expect((await briefRow(off)).enabled).toBe(true);
    expect(
      (
        await sql<{ last_run_at: string | null }[]>`
          select last_run_at from discovery_briefs where id = ${off}
        `
      )[0]!.last_run_at,
    ).not.toBeNull();
    await controlTx(
      sql,
      (tx) =>
        tx`update control_settings
           set value = value - 'briefAutoPauseRuns'
           where key = 'guardrails'`,
    );
  });

  test('C2: sweepStrategist fires once per week', async () => {
    // age out leftover strategist rows so suite re-runs stay idempotent (any row counts as "fired this week")
    await sql`
      update agent_runs set created_at = now() - interval '8 days'
      where kind = 'strategist'
    `;
    const first = await sweepStrategist(sql);
    expect(first).toBe(true);
    const second = await sweepStrategist(sql);
    expect(second).toBe(false);
    const queued = await sql<{ kind: string; source: string }[]>`
      select kind, source from agent_runs where kind = 'strategist' and status = 'queued'
    `;
    expect(queued.length).toBe(1);
    expect(queued[0]!.source).toBe('weekly');
    await sql`update agent_runs set status = 'canceled' where kind = 'strategist' and status = 'queued'`;
  });

  test('C2: propose_brief writes a disabled strategist draft and dedupes', async () => {
    const c = mkCtx('strategist');
    const name = `prop-${uniq}`;
    const out = (await executeTool(c, 'pb1', 'propose_brief', {
      name,
      // queries dedupe too — keep it unique across suite re-runs
      query: `docerias ${uniq} com whatsapp em fortaleza`,
      segment: 'doceria',
      city: 'Fortaleza',
      target: 5,
      reason: 'docerias respondem e faltam briefs na cidade',
    })) as { proposed: boolean; brief: { id: string } };
    expect(out.proposed).toBe(true);
    const row = (
      await sql<{ enabled: boolean; created_by: string; note: string }[]>`
        select enabled, created_by, note from discovery_briefs where id = ${out.brief.id}
      `
    )[0]!;
    expect(row.enabled).toBe(false); // never self-enables
    expect(row.created_by).toBe('strategist');
    expect(row.note).toContain('docerias respondem');

    const dup = (await executeTool(c, 'pb2', 'propose_brief', {
      name: name.toUpperCase(),
      query: 'qualquer outra',
      reason: 'x',
    })) as { proposed: boolean; duplicate: boolean };
    expect(dup.proposed).toBe(false);
    expect(dup.duplicate).toBe(true);

    // staff approve on the note, so a blank reason can't land
    const blank = (await executeTool(c, 'pb4', 'propose_brief', {
      name: `blank-${uniq}`,
      query: `blank q ${uniq}`,
      reason: '   ',
    })) as { error?: string };
    expect(blank.error).toContain('reason');

    const denied = (await executeTool(mkCtx('discovery'), 'pb3', 'propose_brief', {
      name: 'sneaky',
      query: 'q',
      reason: 'r',
    })) as { error?: string };
    expect(denied.error).toContain('not available');
  });

  test('C3: create_lead persists intent_score + merges fill gaps only', async () => {
    const c = mkCtx('discovery');
    const name = `Intent ${uniq}`;
    const created = (await executeTool(c, 'c1', 'create_lead', {
      name,
      findings: 'doceria com whatsapp ativo vendendo sem link próprio de pedidos',
      whatsapp: wa,
      fitScore: 8,
      fitReason: 'doceria artesanal',
      intentScore: 9,
      intentReason: 'reviews recentes pedindo cardápio; vaga aberta',
    })) as { lead: { id: string } };
    const row = (
      await sql<{ intent_score: number; intent_reason: string }[]>`
        select intent_score, intent_reason from leads where id = ${created.lead.id}
      `
    )[0]!;
    expect(row.intent_score).toBe(9);
    expect(row.intent_reason).toContain('reviews recentes');

    // the merge only fills still-empty columns — a dup's score can't overwrite the scored card
    const empty = `Empty Intent ${uniq}`;
    const blank = (
      await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: empty, city: 'Fortaleza', agent_mode: 'auto' }),
      )
    ).body.lead;
    const dup = (await executeTool(c, 'c2', 'create_lead', {
      name: empty,
      city: 'Fortaleza',
      findings: 'mesma doceria encontrada de novo com sinal de intenção novo',
      website: `https://x-${uniq}.test`,
      intentScore: 4,
      intentReason: 'whatsapp ativo sem link',
    })) as { duplicate: boolean; merged: string[] };
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
    const c = mkCtx('discovery');
    // the autocontact gate needs a live whatsapp driver — log driver counts
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('whatsapp', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
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
      executeTool(c, `cd-${whatsapp.slice(-4)}`, 'create_lead', {
        name,
        city: 'Fortaleza',
        findings: 'mesma doceria encontrada de novo',
        whatsapp,
        website: `https://site-${whatsapp.slice(-4)}.test`,
      }) as Promise<{ duplicate: boolean; merged: string[]; contactRun?: string }>;

    const cappedWa = `55119${String(Date.now()).slice(-7)}01`;
    const openWa = `55119${String(Date.now()).slice(-7)}02`;
    const capped = await seedDup(`Capped Merge ${uniq}`, cappedWa);
    const open = await seedDup(`Open Merge ${uniq}`, openWa);
    try {
      // spend over the cap → insertRun must refuse the first contact; 'auto' with no run behind it would leave the lead undriven
      await sql`
        insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
        values ('outreach', ${capped.id}, 'done', 50, now())
      `;
      await controlTx(
        sql,
        (tx) => tx`
          insert into control_settings (key, value) values ('guardrails', ${tx.json({ leadLifetimeCostCapUsd: 0.01 } as never)})
          on conflict (key) do update set value = excluded.value
        `,
      );

      const refused = await createDup(`Capped Merge ${uniq}`, cappedWa);
      expect(refused.duplicate).toBe(true);
      // the merge still lands — only the automation flag is refused
      expect(refused.merged).toContain('website');
      expect(refused.merged).not.toContain('agent_mode');
      expect(refused.contactRun).toBeUndefined();
      const cappedLead = (
        await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${capped.id}`
      )[0]!;
      expect(cappedLead.agent_mode).toBe('draft');
      const parked = await sql<{ n: number }[]>`
        select count(*)::int n from agent_runs where lead_id = ${capped.id} and status = 'queued'
      `;
      expect(parked[0]!.n).toBe(0);

      // a lead under the cap still promotes — run admitted, mode follows
      const admitted = await createDup(`Open Merge ${uniq}`, openWa);
      expect(admitted.duplicate).toBe(true);
      expect(admitted.merged).toContain('agent_mode');
      expect(admitted.contactRun).toBeTruthy();
      const openLead = (
        await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${open.id}`
      )[0]!;
      expect(openLead.agent_mode).toBe('auto');

      // fresh path, same invariant: 'auto' lands only with the run behind it (a new lead can't hit the cap,
      // but the ordering guards any refusal source)
      const freshWa = `55119${String(Date.now()).slice(-7)}03`;
      const fresh = (await executeTool(c, `cf-${freshWa.slice(-4)}`, 'create_lead', {
        name: `Fresh Auto ${uniq}`,
        city: 'Fortaleza',
        findings: 'doceria nova com whatsapp verificado',
        whatsapp: freshWa,
        fitScore: 9,
      })) as { lead: { id: string; agentMode?: string }; contactRun?: string };
      expect(fresh.contactRun).toBeTruthy();
      expect(fresh.lead.agentMode).toBe('auto');
      const freshLead = (
        await sql<
          { agent_mode: string }[]
        >`select agent_mode from leads where id = ${fresh.lead.id}`
      )[0]!;
      expect(freshLead.agent_mode).toBe('auto');

      // one active run per lead — a busy lead's first-contact intent rides the mailbox 'event' item into the owning run
      const busyWa = `55119${String(Date.now()).slice(-7)}05`;
      const busy = await seedDup(`Busy Merge ${uniq}`, busyWa);
      const owner = (
        await sql<{ id: string }[]>`
          insert into agent_runs (kind, lead_id, status)
          values ('reply', ${busy.id}, 'queued') returning id
        `
      )[0]!;
      const busyRes = await createDup(`Busy Merge ${uniq}`, busyWa);
      expect(busyRes.duplicate).toBe(true);
      expect(busyRes.contactRun).toBe(owner.id);
      const mail = await sql<{ n: number }[]>`
        select count(*)::int n from agent_inbox
        where lead_id = ${busy.id} and kind = 'event' and consumed_at is null
          and payload->>'requestedKind' = 'outreach'
          and source = 'first_contact'
      `;
      expect(mail[0]!.n).toBe(1);
    } finally {
      await controlTx(
        sql,
        (tx) => tx`
          insert into control_settings (key, value) values ('guardrails', '{}')
          on conflict (key) do update set value = excluded.value
        `,
      );
    }
  });
});
