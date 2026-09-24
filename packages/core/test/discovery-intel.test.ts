import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { insertRun, sweepBriefs, sweepStrategist } from '../src/agent/runner.ts';
import { executeTool, toolsFor, type ToolContext } from '../src/agent/tools.ts';
import { buildSystemPrompt } from '../src/agent/prompts.ts';
import { DEFAULT_GUARDRAILS, DEFAULT_PITCH, validateSetting } from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, leadInsert, leadPatch } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// ------- pure (no DB) -------------------------------------------------------

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
    // proposing is its whole job — lead mutation stays out of a board run
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
    const p = buildSystemPrompt('strategist', DEFAULT_PITCH, {
      facts: ['docerias respondem melhor à noite'],
    });
    expect(p).toContain('estrategista');
    expect(p).toContain('propose_brief');
    expect(p).toContain('docerias respondem melhor à noite');
    expect(p).not.toContain('OBJETIVO DESTE LEAD');
  });
});

// ------- DB-backed ----------------------------------------------------------
// Opt-in via TEST_DATABASE_URL (CI has no Postgres).

describe.skipIf(!process.env.TEST_DATABASE_URL)('discovery intelligence (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const uniq = Date.now().toString(36);
  // shared phones/whatsapps dedupe across suite re-runs — keep them unique
  const wa = `wa.me/55${String(Date.now()).slice(-9)}`;

  const mkCtx = (runKind: ToolContext['runKind']): ToolContext => ({
    sql,
    // claimControl keys are deterministic (runId:step:name:callId) — a
    // unique runId per suite run, or a re-run replays the stored response
    // and the assertions see stale rows instead of this run's writes
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

  /** A finished discovery run for the brief — `lead` = it produced one. */
  const doneRun = (briefId: string, lead: boolean) =>
    controlTx(sql, async (tx) => {
      const id = await insertRun(tx, {
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

    // A dev environment's own worker (`bun run dev` starts the 15s sweep
    // chain) can interleave between arrange and act: it may fire a queued
    // run for the brief mid-test, which makes `not exists queued` skip it
    // that sweep. Converge instead of asserting on one invocation — each
    // iteration either pauses the brief or turns its queued run into a
    // dead-finished journal row, so the streak always lands.
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
    // the live brief fired — last_run_at is stamped at enqueue and stays
    // even if the ambient worker already claimed the run
    const liveRow = (
      await sql<{ last_run_at: string | null }[]>`
        select last_run_at from discovery_briefs where id = ${live}
      `
    )[0]!;
    expect(liveRow.last_run_at).not.toBeNull();

    // revival restarts the streak window (rearmed_at): staff flips the
    // dead brief back on and the next sweep fires a fresh run instead of
    // instantly re-pausing on the pre-revival zero-yield history
    await sql`
      update discovery_briefs set enabled = true, note = null, rearmed_at = now()
      where id = ${dead}
    `;
    await sweepBriefs(sql);
    const revived = await briefRow(dead);
    expect(revived.enabled).toBe(true);
    // fired, not re-paused — last_run_at stamps at enqueue (queued rows can
    // already be claimed by the ambient worker when we read)
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
    // The boundary is created_at (enqueue = the params the run carries), not
    // finished_at: these 5 runs were queued BEFORE the edit but finish
    // AFTER it — under a finished_at bound they'd instantly re-pause.
    await controlTx(sql, async (tx) => {
      for (let i = 0; i < 5; i++) {
        const id = await insertRun(tx, {
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
      // rearmed strictly after the runs' created_at but strictly before
      // their finished_at — the timeline the bug needs to reproduce
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
    // restore defaults for the other tests
    await controlTx(
      sql,
      (tx) =>
        tx`update control_settings
           set value = value - 'briefAutoPauseRuns'
           where key = 'guardrails'`,
    );
  });

  test('C2: sweepStrategist fires once per week', async () => {
    // any strategist row (even canceled) counts as "fired this week" — age
    // leftovers from previous suite runs out of the window for idempotence
    await sql`
      update agent_runs set created_at = now() - interval '8 days'
      where kind = 'strategist'
    `;
    const first = await sweepStrategist(sql);
    expect(first).toBe(true);
    const second = await sweepStrategist(sql);
    expect(second).toBe(false);
    const queued = await sql<{ kind: string; params: { auto: string } }[]>`
      select kind, params from agent_runs where kind = 'strategist' and status = 'queued'
    `;
    expect(queued.length).toBe(1);
    expect(queued[0]!.params.auto).toBe('weekly');
    await sql`update agent_runs set status = 'canceled' where kind = 'strategist' and status = 'queued'`;
  });

  test('C2: propose_brief writes a disabled strategist draft and dedupes', async () => {
    const c = mkCtx('strategist');
    const name = `prop-${uniq}`;
    const out = (await executeTool(c, 'pb1', 'propose_brief', {
      name,
      // query dedupes too — keep it unique across suite re-runs
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

    // same name or query → skip, not a second row
    const dup = (await executeTool(c, 'pb2', 'propose_brief', {
      name: name.toUpperCase(),
      query: 'qualquer outra',
      reason: 'x',
    })) as { proposed: boolean; duplicate: boolean };
    expect(dup.proposed).toBe(false);
    expect(dup.duplicate).toBe(true);

    // a blank rationale can't land — staff approve on the note, so the tool
    // requires the reason it stores there
    const blank = (await executeTool(c, 'pb4', 'propose_brief', {
      name: `blank-${uniq}`,
      query: `blank q ${uniq}`,
      reason: '   ',
    })) as { error?: string };
    expect(blank.error).toContain('reason');

    // toolset enforcement: a discovery run can't call it
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

    // a dup with a DIFFERENT intent score doesn't overwrite the scored card —
    // the merge only fills still-empty columns
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
    // The autocontact gate needs a live whatsapp driver — log driver counts.
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
      // Spend already over the tiny cap → insertRun must refuse the merge's
      // first contact; 'auto' with no run behind it would leave the lead
      // driven by nothing (raising the cap later never recreates it).
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
      // the merge itself still lands — only the automation flag is refused
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

      // A lead under the cap still promotes — run admitted, mode follows.
      const admitted = await createDup(`Open Merge ${uniq}`, openWa);
      expect(admitted.duplicate).toBe(true);
      expect(admitted.merged).toContain('agent_mode');
      expect(admitted.contactRun).toBeTruthy();
      const openLead = (
        await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${open.id}`
      )[0]!;
      expect(openLead.agent_mode).toBe('auto');
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
