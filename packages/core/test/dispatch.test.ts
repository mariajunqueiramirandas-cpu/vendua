import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { JsonObject } from '@vendua/agent-runtime';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { sweepBriefs, sweepStrategist } from '../src/crm/board.ts';
import { scheduleTimerTx } from '../src/crm/agenda.ts';
import { requestLeadTx, type LeadMailKind } from '../src/crm/dispatch.ts';
import { anchorTx } from '../src/crm/schedule-anchors.ts';
import { listRoutines, runJob } from '../src/crm/scheduler.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('dispatch + scheduler (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret' });
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
  /** the local weekday right now in the workspace timezone, 0 = Sunday */
  const localWeekday = async (tz: string) =>
    (await sql<{ d: number }[]>`select extract(dow from now() at time zone ${tz})::int as d`)[0]!.d;

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
      const file = (lead: string, kind: LeadMailKind, source: string, payload: JsonObject = {}) =>
        controlTx(sql, (tx) =>
          requestLeadTx(tx, {
            leadId: lead,
            kind,
            source,
            dedupeKey: `dsp-${nonce}-${crypto.randomUUID()}`,
            payload,
          }),
        );
      expect((await file(noChannel, 'message.inbound', 'whatsapp')).deliverAt).toBeNull();
      const deferred = await file(leadId, 'message.inbound', 'whatsapp');
      expect(deferred.deliverAt).not.toBeNull();
      // quiet ends at the top of hour h+2 — between 1 and 2 hours from now
      const wait = deferred.deliverAt!.getTime() - Date.now();
      expect(wait).toBeGreaterThan(60 * 60_000 - 5_000);
      expect(wait).toBeLessThanOrEqual(2 * 60 * 60_000);
      // the mailbox row waits for the same window
      const [row] = await sql<{ deliver_at: Date }[]>`
        select deliver_at from agent_mailbox where id = ${deferred.mailboxId}`;
      expect(row!.deliver_at.getTime()).toBe(deferred.deliverAt!.getTime());
      expect(
        (await file(leadId, 'staff.request', 'staff', { kind: 'reply' })).deliverAt,
      ).toBeNull();
      // pinned to an undeliverable channel (no whatsapp here) — nothing to wait for
      expect(
        (await file(leadId, 'message.inbound', 'whatsapp', { channel: 'whatsapp' })).deliverAt,
      ).toBeNull();
      expect(
        (await file(leadId, 'message.inbound', 'whatsapp', { channel: 'email' })).deliverAt,
      ).not.toBeNull();
      expect(
        (await file(leadId, 'timer.followup', 'agent', { draftOnly: true })).deliverAt,
      ).toBeNull();
      // copilot drafts everything — nothing to wait for
      await setSetting('agent', { level: 'copilot' });
      expect((await file(leadId, 'message.inbound', 'whatsapp')).deliverAt).toBeNull();
      // supervised drafts a first contact — it runs now; with history it waits
      await setSetting('agent', { level: 'supervised' });
      expect((await file(leadId, 'timer.followup', 'agent')).deliverAt).toBeNull();
      // outside quiet hours nothing moves
      await setSetting('guardrails', { timezone: tz, quietStart: '00:00', quietEnd: '00:00' });
      await setSetting('agent', { level: 'autopilot' });
      expect((await file(leadId, 'message.inbound', 'whatsapp')).deliverAt).toBeNull();
    } finally {
      await restore('agent', priorAgent);
      await restore('guardrails', priorGr);
      if (priorLog)
        await sql`update control_integrations set enabled = ${priorLog.enabled}
                  where kind = 'email' and driver = 'log'`;
      else await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
    }
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
    const [row] = await sql<{ agent_id: string; source: string; payload: { query?: string } }[]>`
      select a.agent_id, m.source, m.payload from agent_mailbox m
      join agent_actors a on a.id = m.actor_id where m.id = ${b.runId}
    `;
    expect(row).toMatchObject({ agent_id: 'crm-discovery', source: 'staff' });
    expect(row!.payload.query).toBe('docerias fortaleza');
    const leadId = await mkLead();
    // a board request names no lead, so only discovery and the strategist may ask for it
    const boardOutreach = await post(
      '/control/v1/agent/requests',
      { kind: 'outreach' },
      'board-out',
    );
    expect(boardOutreach.status).toBe(422);
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
    const [mail] = await sql<{ source: string; kind: string; payload: { focus?: string } }[]>`
      select source, kind, payload from agent_mailbox where id = ${o.runId}
    `;
    expect(mail).toMatchObject({ source: 'staff', kind: 'staff.request' });
    expect(mail!.payload.focus).toContain('mandar a proposta');
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
    expect(bb.runs.map((r) => r.leadId)).toEqual([leadId]);
    expect(bb.skipped).toEqual([{ leadId: offLead, code: 'LEAD_SUPPRESSED', reason: 'agent off' }]);
  });

  test('PATCH nextActionAt writes the agenda: staff date replaces the agent plan, clear cancels', async () => {
    await migrate(sql, MIGRATIONS);
    const leadId = await mkLead();
    await controlTx(sql, (tx) =>
      scheduleTimerTx(tx, {
        leadId,
        at: new Date(Date.now() + 3 * 86_400_000),
        focus: 'plano do agente',
        requested: false,
        by: 'agent',
      }),
    );
    const timers = () => sql<{ payload: { by?: string } }[]>`
      select m.payload from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.subject_id = ${leadId} and m.kind like 'timer.%' and m.consumed_by_turn is null
    `;
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const res = await patch(`/control/v1/leads/${leadId}`, { nextActionAt: at }, 'patch-set');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lead: { nextActionAt: string | null } };
    expect(Date.parse(body.lead.nextActionAt!)).toBe(Date.parse(at));
    expect((await timers()).map((p) => p.payload.by)).toEqual(['staff']);
    const cleared = await patch(`/control/v1/leads/${leadId}`, { nextActionAt: null }, 'patch-clr');
    expect(cleared.status).toBe(200);
    const after = (await cleared.json()) as { lead: { nextActionAt: string | null } };
    expect(after.lead.nextActionAt).toBeNull();
    expect(await timers()).toHaveLength(0);
  });

  test('briefs run once per daily anchor; the weekly review once per weekly anchor', async () => {
    await migrate(sql, MIGRATIONS);
    const priorAgent = await getSetting('agent');
    const enabled = await sql<{ id: string }[]>`select id from discovery_briefs where enabled`;
    let due: { id: string } | undefined;
    let done: { id: string } | undefined;
    try {
      await sql`update discovery_briefs set enabled = false where enabled`;
      const tz =
        ((await getSetting('guardrails')) as { timezone?: string } | undefined)?.timezone ??
        'America/Sao_Paulo';
      const h = await localHour(tz);
      const dow = await localWeekday(tz);
      await setSetting('agent', {
        level: 'supervised',
        schedule: { discoveryHour: h, weeklyDay: dow, weeklyHour: h },
      });
      const anchor = (await controlTx(sql, (tx) => anchorTx(tx, { hour: h }))).last;
      [due] = await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, last_run_at)
        values (${`due ${nonce}`}, 'q due', true, ${new Date(anchor.getTime() - 60_000)})
        returning id
      `;
      [done] = await sql<{ id: string }[]>`
        insert into discovery_briefs (name, query, enabled, last_run_at)
        values (${`done ${nonce}`}, 'q done', true, ${new Date(anchor.getTime() + 1_000)})
        returning id
      `;
      const briefRuns = () => sql<{ brief: string; source: string }[]>`
        select a.subject_id as brief, m.source from agent_mailbox m
        join agent_actors a on a.id = m.actor_id
        where a.agent_id = 'crm-discovery' and m.kind = 'timer.daily'
          and a.subject_id in ${sql([due!.id, done!.id])}
      `;
      await sweepBriefs(sql);
      expect([...(await briefRuns())]).toEqual([{ brief: due!.id, source: 'schedule' }]);
      // the brief ran at this anchor: a second pass files nothing new for it
      await sweepBriefs(sql);
      expect(await briefRuns()).toHaveLength(1);

      // the weekly review fires once, then waits for the next anchor
      const weekAnchor = (await controlTx(sql, (tx) => anchorTx(tx, { hour: h, weekday: dow })))
        .last;
      await sql`delete from agent_mailbox where dedupe_key = ${`crm:weekly:${weekAnchor.toISOString()}`}`;
      expect(await sweepStrategist(sql)).toBe(true);
      expect(await sweepStrategist(sql)).toBe(false);
    } finally {
      const made = [due?.id, done?.id].filter((id): id is string => !!id);
      if (made.length) await sql`delete from discovery_briefs where id in ${sql(made)}`;
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
    for (const n of ['briefs', 'weekly-review', 'discord-digest', 'pipeline-snapshot'])
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
