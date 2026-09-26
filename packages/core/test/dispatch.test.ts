import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { requestAgentTx, smartStartTx } from '../src/agent/dispatch.ts';
import { claimRun, sweepBriefs, sweepStrategist } from '../src/agent/runner.ts';
import { anchorTx } from '../src/agent/schedule-anchors.ts';
import { listRoutines, runJob } from '../src/agent/scheduler.ts';
import { provenance, SOURCE_PRIORITY, TRIGGER_SOURCES } from '../src/agent/sources.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe('trigger sources — pure', () => {
  test('every source has a priority; a waiting customer outranks everything', () => {
    for (const s of TRIGGER_SOURCES) expect(typeof SOURCE_PRIORITY[s]).toBe('number');
    const min = Math.min(...Object.values(SOURCE_PRIORITY));
    expect(SOURCE_PRIORITY.inbound).toBe(min);
    expect(SOURCE_PRIORITY.callback).toBeLessThan(SOURCE_PRIORITY.followup);
    expect(SOURCE_PRIORITY.staff).toBeLessThan(SOURCE_PRIORITY.brief);
  });

  test('callbacks are promises by default, nothing else is', () => {
    expect(provenance('callback').promised).toBe(true);
    expect(provenance('followup').promised).toBe(false);
    expect(provenance('staff').promised).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('dispatch + scheduler (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  const post = (path: string, body: unknown, key: string) =>
    app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl-secret',
        'idempotency-key': `dsp-${nonce}-${key}`,
      },
      body: JSON.stringify(body),
    });
  const patch = (path: string, body: unknown, key: string) =>
    app.request(path, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl-secret',
        'idempotency-key': `dsp-${nonce}-${key}`,
      },
      body: JSON.stringify(body),
    });
  const getSetting = async (key: string) =>
    (await sql<{ value: unknown }[]>`select value from control_settings where key = ${key}`)[0]
      ?.value;
  const setSetting = (key: string, value: unknown) => sql`
    insert into control_settings (key, value) values (${key}, ${sql.json(value as never)})
    on conflict (key) do update set value = excluded.value
  `;
  const restore = async (key: string, v: unknown) => {
    if (v === undefined) await sql`delete from control_settings where key = ${key}`;
    else await setSetting(key, v);
  };
  const mkLead = async (fields: Record<string, unknown> = {}) =>
    (
      await controlTx(sql, (tx) =>
        insertLeadTx(tx, {
          name: `Dispatch ${crypto.randomUUID()}`,
          agent_mode: 'auto',
          ...fields,
        }),
      )
    ).body.lead.id;
  /** the local wall-clock hour right now in the workspace timezone */
  const localHour = async (tz: string) =>
    (await sql<{ h: number }[]>`select extract(hour from now() at time zone ${tz})::int as h`)[0]!
      .h;

  test('anchors: the latest occurrence is past, the next one is one period later, at the hour', async () => {
    await migrate(sql, MIGRATIONS);
    const now = Date.now();
    const daily = await controlTx(sql, (tx) => anchorTx(tx, { hour: 9 }));
    expect(daily.last.getTime()).toBeLessThanOrEqual(now);
    expect(daily.next.getTime()).toBeGreaterThan(now);
    expect(daily.next.getTime() - daily.last.getTime()).toBe(86_400_000);
    const weekly = await controlTx(sql, (tx) => anchorTx(tx, { hour: 8, weekday: 1 }));
    expect(weekly.last.getTime()).toBeLessThanOrEqual(now);
    expect(weekly.next.getTime()).toBeGreaterThan(now);
    expect(weekly.next.getTime() - weekly.last.getTime()).toBe(7 * 86_400_000);
    const [loc] = await sql<{ h: number; dow: number }[]>`
      select extract(hour from ${weekly.last}::timestamptz at time zone ${weekly.timezone})::int as h,
             extract(dow from ${weekly.last}::timestamptz at time zone ${weekly.timezone})::int as dow
    `;
    expect(loc).toEqual({ h: 8, dow: 1 });
  });

  test('smart start: live sends wait for the send window; drafts and staff asks run now', async () => {
    await migrate(sql, MIGRATIONS);
    const priorAgent = await getSetting('agent');
    const priorGr = await getSetting('guardrails');
    const priorLog = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations where kind = 'email' and driver = 'log'
      `
    )[0];
    try {
      const tz = 'America/Sao_Paulo';
      const h = await localHour(tz);
      const pad = (n: number) => `${String((n + 24) % 24).padStart(2, '0')}:00`;
      // quiet from an hour ago to two hours ahead — now is inside it
      await setSetting('guardrails', {
        timezone: tz,
        quietStart: pad(h - 1),
        quietEnd: pad(h + 2),
      });
      await setSetting('agent', { level: 'autopilot' });
      // a deliverable channel — without one the run can only draft, so nothing waits
      await sql`insert into control_integrations (kind, driver, enabled)
                values ('email', 'log', true)
                on conflict (kind, driver) do update set enabled = true`;
      const leadId = await mkLead({ email: `smart-${nonce}@example.com` });
      const noChannel = await mkLead();
      expect(
        await controlTx(sql, (tx) =>
          smartStartTx(tx, { kind: 'reply', leadId: noChannel }, provenance('inbound')),
        ),
      ).toBeNull();
      const start = (source: 'inbound' | 'staff' | 'followup', params = {}) =>
        controlTx(sql, (tx) =>
          smartStartTx(tx, { kind: 'reply', leadId, params }, provenance(source)),
        );
      const deferred = await start('inbound');
      expect(deferred).not.toBeNull();
      // quiet ends at the top of hour h+2 — between 1 and 2 hours from now
      const wait = deferred!.getTime() - Date.now();
      expect(wait).toBeGreaterThan(60 * 60_000 - 5_000);
      expect(wait).toBeLessThanOrEqual(2 * 60 * 60_000);
      expect(await start('staff')).toBeNull();
      // pinned to an undeliverable channel (no whatsapp here) — nothing to wait for
      expect(await start('inbound', { channel: 'whatsapp' })).toBeNull();
      expect(await start('inbound', { channel: 'email' })).not.toBeNull();
      expect(await start('followup', { draftOnly: true })).toBeNull();
      // copilot drafts everything — nothing to wait for
      await setSetting('agent', { level: 'copilot' });
      expect(await start('inbound')).toBeNull();
      // supervised drafts a first contact — it runs now; with history it waits
      await setSetting('agent', { level: 'supervised' });
      expect(await start('followup')).toBeNull();
      // outside quiet hours nothing moves
      await setSetting('guardrails', { timezone: tz, quietStart: '00:00', quietEnd: '00:00' });
      await setSetting('agent', { level: 'autopilot' });
      expect(await start('inbound')).toBeNull();
    } finally {
      await restore('agent', priorAgent);
      await restore('guardrails', priorGr);
      if (priorLog)
        await sql`update control_integrations set enabled = ${priorLog.enabled}
                  where kind = 'email' and driver = 'log'`;
      else await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
    }
  });

  test('claim order: a waiting customer beats an older discovery brief', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`delete from agent_runs where status = 'queued'`;
    const leadId = await mkLead();
    const ids = await controlTx(sql, async (tx) => {
      const brief = await requestAgentTx(tx, {
        kind: 'discovery',
        source: 'brief',
        params: { query: 'q' },
      });
      const reply = await requestAgentTx(tx, { kind: 'reply', source: 'inbound', leadId });
      return { brief: brief.runId!, reply: reply.runId! };
    });
    // the brief is older — age alone would pick it; the reply must be claimable now
    await sql`update agent_runs set created_at = now() - interval '1 hour' where id = ${ids.brief}`;
    await sql`update agent_runs set run_at = null where id = ${ids.reply}`;
    const first = await claimRun(sql);
    expect(first?.id).toBe(ids.reply);
    await sql`update agent_runs set status = 'canceled' where id in ${sql([ids.brief, ids.reply])}`;
  });

  test('POST /agent/requests: board, single lead, bulk — one endpoint', async () => {
    await migrate(sql, MIGRATIONS);
    const board = await post(
      '/control/v1/agent/requests',
      { kind: 'discovery', params: { query: 'docerias fortaleza', target: 3 } },
      'board',
    );
    expect(board.status).toBe(201);
    const b = (await board.json()) as { runId: string };
    const [row] = await sql<
      { source: string; lead_id: string | null; params: { query?: string } }[]
    >`
      select source, lead_id, params from agent_runs where id = ${b.runId}
    `;
    expect(row!.source).toBe('staff');
    expect(row!.lead_id).toBeNull();
    expect(row!.params.query).toBe('docerias fortaleza');
    const leadId = await mkLead();
    const noLeadStrategist = await post(
      '/control/v1/agent/requests',
      { kind: 'strategist', leadIds: [leadId] },
      'strat',
    );
    expect(noLeadStrategist.status).toBe(422);
    const bad = await post('/control/v1/agent/requests', { kind: 'nope' }, 'bad');
    expect(bad.status).toBe(422);
    const one = await post(
      '/control/v1/agent/requests',
      { kind: 'outreach', leadId, focus: 'mandar a proposta', channel: 'whatsapp' },
      'one',
    );
    expect(one.status).toBe(201);
    const o = (await one.json()) as { runId: string; runs: unknown[] };
    expect(o.runs).toHaveLength(1);
    const [mail] = await sql<{ source: string; payload: { text?: string; forRunId?: string } }[]>`
      select source, payload from agent_inbox where lead_id = ${leadId} and consumed_at is null
    `;
    expect(mail!.source).toBe('staff');
    expect(mail!.payload.text).toContain('mandar a proposta');
    expect(mail!.payload.forRunId).toBe(o.runId);
    const offLead = await mkLead({ agent_mode: 'off' });
    const bulk = await post(
      '/control/v1/agent/requests',
      { kind: 'outreach', leadIds: [leadId, offLead] },
      'bulk',
    );
    expect(bulk.status).toBe(201);
    const bb = (await bulk.json()) as {
      runs: { leadId: string }[];
      skipped: { leadId: string; code: string; reason: string }[];
    };
    // the live lead's ask delivers into its existing run; the off lead is reported
    expect(bb.runs.map((r) => r.leadId)).toEqual([leadId]);
    expect(bb.skipped).toEqual([{ leadId: offLead, code: 'LEAD_SUPPRESSED', reason: 'agent off' }]);
    await sql`update agent_runs set status = 'canceled' where id = ${b.runId} or lead_id = ${leadId}`;
  });

  test('PATCH nextActionAt writes the agenda: staff date replaces the agent plan, clear cancels', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead();
    await sql`
      insert into agent_wakeups (lead_id, at, focus, created_by)
      values (${leadId}, now() + interval '3 days', 'plano do agente', 'agent')
    `;
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const res = await patch(`/control/v1/leads/${leadId}`, { nextActionAt: at }, 'patch-set');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead: { nextActionAt: string | null } };
    expect(Date.parse(body.lead.nextActionAt!)).toBe(Date.parse(at));
    const pending = await sql<{ created_by: string; focus: string }[]>`
      select created_by, focus from agent_wakeups where lead_id = ${leadId} and status = 'pending'
    `;
    expect(pending.map((p) => p.created_by)).toEqual(['staff']);
    const cleared = await patch(`/control/v1/leads/${leadId}`, { nextActionAt: null }, 'patch-clr');
    expect(cleared.status).toBe(200);
    const after = (await cleared.json()) as { lead: { nextActionAt: string | null } };
    expect(after.lead.nextActionAt).toBeNull();
    const left = await sql`
      select 1 from agent_wakeups where lead_id = ${leadId} and status = 'pending'
    `;
    expect(left).toHaveLength(0);
  });

  test('briefs run once per daily anchor; the weekly review once per weekly anchor', async () => {
    await migrate(sql, MIGRATIONS);
    const priorAgent = await getSetting('agent');
    const enabled = await sql<{ id: string }[]>`select id from discovery_briefs where enabled`;
    try {
      await sql`update discovery_briefs set enabled = false where enabled`;
      await sql`delete from agent_runs where status = 'queued' and kind in ('discovery', 'strategist')`;
      const tz =
        ((await getSetting('guardrails')) as { timezone?: string } | undefined)?.timezone ??
        'America/Sao_Paulo';
      const h = await localHour(tz);
      await setSetting('agent', {
        level: 'supervised',
        schedule: { discoveryHour: h, weeklyDay: 1, weeklyHour: 8 },
      });
      const anchor = (await controlTx(sql, (tx) => anchorTx(tx, { hour: h }))).last;
      const [due] = await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, last_run_at)
        values (${`due ${nonce}`}, 'q due', true, ${new Date(anchor.getTime() - 60_000)})
        returning id
      `;
      const [done] = await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, last_run_at)
        values (${`done ${nonce}`}, 'q done', true, ${new Date(anchor.getTime() + 1_000)})
        returning id
      `;
      await sweepBriefs(sql);
      const runs = await sql<{ brief: string; source: string }[]>`
        select params->>'briefId' as brief, source from agent_runs
        where kind = 'discovery' and status = 'queued'
          and params->>'briefId' in ${sql([due!.id, done!.id])}
      `;
      expect([...runs]).toEqual([{ brief: due!.id, source: 'brief' }]);
      // the weekly review fires once, then waits for the next anchor
      await sql`delete from agent_runs where kind = 'strategist' and lead_id is null
                and created_at >= now() - interval '8 days'`;
      expect(await sweepStrategist(sql)).toBe(true);
      expect(await sweepStrategist(sql)).toBe(false);
      await sql`delete from discovery_briefs where id in ${sql([due!.id, done!.id])}`;
    } finally {
      await sql`update agent_runs set status = 'canceled'
                where status = 'queued' and kind in ('discovery', 'strategist')`;
      if (enabled.length)
        await sql`update discovery_briefs set enabled = true where id in ${sql(enabled.map((e) => e.id))}`;
      await restore('agent', priorAgent);
    }
  });

  test('scheduler: a failing job is isolated, recorded, and clears on the next success', async () => {
    await migrate(sql, MIGRATIONS);
    const name = `test-job-${nonce}`;
    let fail = true;
    const job = {
      name,
      run: async () => {
        if (fail) throw new Error('boom');
        return 3;
      },
    };
    expect(await runJob(sql, job)).toBe(false);
    let [row] = await sql<
      { last_ok: boolean; last_error: string; failing_since: Date | null; failures: string }[]
    >`select last_ok, last_error, failing_since, failures from scheduled_jobs where name = ${name}`;
    expect(row!.last_ok).toBe(false);
    expect(row!.last_error).toBe('boom');
    expect(row!.failing_since).not.toBeNull();
    fail = false;
    expect(await runJob(sql, job)).toBe(true);
    [row] =
      await sql`select last_ok, last_error, failing_since, failures from scheduled_jobs where name = ${name}`;
    expect(row!.last_ok).toBe(true);
    expect(row!.failing_since).toBeNull();
    expect(Number(row!.failures)).toBe(1);
    await sql`delete from scheduled_jobs where name = ${name}`;
    const routines = await listRoutines(sql);
    const names = routines.map((r) => r.name);
    for (const n of ['queue', 'agenda', 'briefs', 'weekly-review', 'digest', 'pipeline-snapshot'])
      expect(names).toContain(n);
    const briefs = routines.find((r) => r.name === 'briefs')!;
    expect(briefs.cadence).toMatch(/^todo dia às \d\d:00$/);
    expect(Date.parse(briefs.nextAt!)).toBeGreaterThan(Date.now());
    const res = await app.request('/control/v1/agent/routines', {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    expect(res.status).toBe(200);
  });
});
