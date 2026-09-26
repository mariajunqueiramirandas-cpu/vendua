import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { whatsappRegistered } from '../src/agent/channels/whatsapp.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun, enqueueRun } from '../src/agent/runner.ts';
import { setNextActionTx, sweepWakeups } from '../src/agent/wakeups.ts';
import { sweepOrphanInbox } from '../src/agent/dispatch.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  phoneIsIgnored,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { subscribeControlEvents, type ControlEvent } from '../src/modules/control-events.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// provider-message ids dedupe globally on the shared test DB — a per-run
// suffix keeps every test re-runnable
const pmRun = crypto.randomUUID().slice(0, 8);

describe('guardrails — ignoredPhones', () => {
  test('defaults to an empty list', () => {
    expect(DEFAULT_GUARDRAILS.ignoredPhones).toEqual([]);
  });

  test('validateSetting accepts a list of numbers', () => {
    expect(() =>
      validateSetting('guardrails', { ignoredPhones: ['+55 11 99999-0000', '5511987654321'] }),
    ).not.toThrow();
    expect(() => validateSetting('guardrails', { ignoredPhones: [] })).not.toThrow();
  });

  test('validateSetting rejects malformed entries', () => {
    expect(() => validateSetting('guardrails', { ignoredPhones: '5511999990000' })).toThrow();
    expect(() => validateSetting('guardrails', { ignoredPhones: [123] })).toThrow();
    // <6 digits is noise, not a number
    expect(() => validateSetting('guardrails', { ignoredPhones: ['123'] })).toThrow();
    expect(() =>
      validateSetting('guardrails', { ignoredPhones: Array(101).fill('5511998887766') }),
    ).toThrow();
  });

  test('phoneIsIgnored matches on digits only, any candidate', () => {
    const list = ['+55 11 99999-0000'];
    expect(phoneIsIgnored(list, '5511999990000')).toBe(true);
    expect(phoneIsIgnored(list, '5511999990000@s.whatsapp.net')).toBe(true);
    expect(phoneIsIgnored(list, '5511999990001')).toBe(false);
    expect(phoneIsIgnored(list, null, undefined, '')).toBe(false);
    expect(phoneIsIgnored([], '5511999990000')).toBe(false);
    // the alias leg matches too (LID ↔ PN pairs)
    expect(phoneIsIgnored(list, 'not-a-number', '5511999990000')).toBe(true);
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('whatsapp history + ignore list (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');

  const setIgnored = (phones: string[]) =>
    sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ ignoredPhones: phones } as never)})
      on conflict (key) do update set value = excluded.value
    `;

  afterEach(async () => {
    await sql`delete from control_settings where key = 'guardrails'`;
    await sql`update agent_runs set status = 'canceled' where status = 'queued'`;
  });

  test('history ingest records the message but queues no reply run', async () => {
    await migrate(sql, MIGRATIONS);
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      // fresh number per run — the shared DB keeps the lead and its old runs
      from: `55119${crypto.randomUUID().replace(/\D/g, '').slice(0, 8)}@s.whatsapp.net`,
      body: 'mensagem antiga',
      providerMessageId: `hist-norun-1-${pmRun}`,
      historical: true,
      sentAt: new Date('2024-01-01T10:00:00Z'),
    });
    expect('ignored' in res).toBe(false);
    if ('ignored' in res) return;
    const runs = await sql`select 1 from agent_runs where lead_id = ${res.leadId}`;
    expect(runs).toHaveLength(0);
    const msgs = await sql<{ direction: string; author: string; status: string; ts: string }[]>`
      select direction, author, status, created_at::text as ts
      from lead_messages where thread_id = ${res.threadId}
    `;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'in', author: 'lead', status: 'received' });
    expect(msgs[0]!.ts.startsWith('2024-01-01')).toBe(true);
  });

  test('fromMe history echoes land as outbound staff records', async () => {
    await migrate(sql, MIGRATIONS);
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      // Fresh number per run — shared DB keeps the lead + its old runs.
      from: `55119${crypto.randomUUID().replace(/\D/g, '').slice(0, 8)}@s.whatsapp.net`,
      body: 'resposta que o fundador digitou no aparelho',
      providerMessageId: `hist-out-1-${pmRun}`,
      direction: 'out',
      historical: true,
      sentAt: new Date('2024-01-02T15:00:00Z'),
    });
    expect('ignored' in res).toBe(false);
    if ('ignored' in res) return;
    const msgs = await sql<{ direction: string; author: string; status: string }[]>`
      select direction, author, status from lead_messages where thread_id = ${res.threadId}
    `;
    expect(msgs[0]).toMatchObject({ direction: 'out', author: 'staff', status: 'sent' });
    const runs = await sql`select 1 from agent_runs where lead_id = ${res.leadId}`;
    expect(runs).toHaveLength(0);
  });

  test('an older history message never walks last_message_at backwards', async () => {
    await migrate(sql, MIGRATIONS);
    const live = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511966665555@s.whatsapp.net',
      body: 'ao vivo',
      providerMessageId: `hist-lm-live-${pmRun}`,
    });
    if ('ignored' in live) throw new Error('unexpected ignore');
    const before = (
      await sql<
        { t: Date }[]
      >`select last_message_at as t from lead_threads where id = ${live.threadId}`
    )[0]!.t;
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511966665555@s.whatsapp.net',
      body: 'histórico de ontem',
      providerMessageId: `hist-lm-old-${pmRun}`,
      historical: true,
      sentAt: new Date('2020-01-01T00:00:00Z'),
    });
    const after = (
      await sql<
        { t: Date }[]
      >`select last_message_at as t from lead_threads where id = ${live.threadId}`
    )[0]!.t;
    expect(after >= before).toBe(true);
  });

  test('an ignored number never mints a lead — in either direction', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['+55 11 99888-7766']);
    const inbound = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511998887766@s.whatsapp.net',
      body: 'oi',
      providerMessageId: `ign-in-1-${pmRun}`,
    });
    expect(inbound).toEqual({ ignored: 'número ignorado: 5511998887766@s.whatsapp.net' });
    const echo = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511998887766@s.whatsapp.net',
      body: 'nossa resposta',
      providerMessageId: `ign-out-1-${pmRun}`,
      direction: 'out',
      historical: true,
    });
    expect('ignored' in echo).toBe(true);
    const leads = await sql`
      select 1 from leads
      where regexp_replace(coalesce(whatsapp,''),'\\D','','g') = '5511998887766'
    `;
    expect(leads).toHaveLength(0);
  });

  test('an inbound burst mails every message into one queued reply run', async () => {
    await migrate(sql, MIGRATIONS);
    // inboundReplyDelayMin parks the first run (unclaimable) — the delivery
    // check sees a 'queued' row, not a race
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // unique sender + message ids — a seen providerMessageId returns early without a run
    const from = `5511${Math.floor(Math.random() * 1e10)}@s.whatsapp.net`;
    const mid = crypto.randomUUID();
    const first = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi',
      providerMessageId: `${mid}-1`,
    });
    if ('ignored' in first) throw new Error('unexpected ignore');
    const second = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'e aí?',
      providerMessageId: `${mid}-2`,
    });
    if ('ignored' in second) throw new Error('unexpected ignore');
    expect(second.threadId).toBe(first.threadId);
    // one parked run covers both messages — each lands as its own inbox item
    // for the run to read at claim (never a second run)
    const queued = await sql<{ id: string; run_at: Date }[]>`
      select id, run_at from agent_runs where thread_id = ${first.threadId} and status = 'queued'
    `;
    expect(queued).toHaveLength(1);
    const slideMs = queued[0]!.run_at.getTime() - Date.now();
    expect(slideMs).toBeGreaterThan(55 * 60_000);
    expect(slideMs).toBeLessThanOrEqual(61 * 60_000);
    const items = await sql<{ kind: string }[]>`
      select kind from agent_inbox where lead_id = ${first.leadId} and consumed_at is null
    `;
    expect(items.map((i) => i.kind)).toEqual(['inbound', 'inbound']);
    // An already-overdue run never slides further — it fires on the next tick
    await sql`update agent_runs set run_at = now() - interval '1 minute' where id = ${queued[0]!.id}`;
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'ainda aí?',
      providerMessageId: `${mid}-2b`,
    });
    const overdue = (
      await sql<{ run_at: Date }[]>`
        select run_at from agent_runs where id = ${queued[0]!.id}
      `
    )[0]!;
    expect(overdue.run_at.getTime()).toBeLessThan(Date.now());
    // a 'running' run drains mail between steps too — the fourth message lands
    // as another pending item instead of a fresh run
    await sql`update agent_runs set status = 'running', claim_token = 'x' where id = ${queued[0]!.id}`;
    const third = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'tá aí?',
      providerMessageId: `${mid}-3`,
    });
    if ('ignored' in third) throw new Error('unexpected ignore');
    const all = await sql<{ status: string }[]>`
      select status from agent_runs where thread_id = ${first.threadId}
    `;
    expect(all).toHaveLength(1);
    const pending =
      await sql`select 1 from agent_inbox where lead_id = ${first.leadId} and consumed_at is null`;
    expect(pending).toHaveLength(4);
  });

  test('a far-future parked run re-anchors at its deadline for delivered mail', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // the lead exists BEFORE the inbound so an outreach owns its run slot —
    // parked a week out, the schedule must not hold the reply hostage
    const phone = `5511${Math.floor(Math.random() * 1e10)}`;
    const mid = crypto.randomUUID();
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Scheduled Lead', whatsapp: phone, agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const parked = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      runAt: new Date(Date.now() + 7 * 86_400_000),
    }))!;
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${phone}@s.whatsapp.net`,
      body: 'oi, tem horário amanhã?',
      providerMessageId: `${mid}-1`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    // one active slot forces a choice: the parked outreach retires and
    // re-anchors as mail on its own deadline (sliding run_at forward would
    // fire its intent early); the reply gets a runnable owner at the quiet window
    const pending = await sql<
      { kind: string; payload: { requestedKind?: string; notBefore?: string } }[]
    >`
      select kind, payload from agent_inbox
      where lead_id = ${leadId} and consumed_at is null
    `;
    expect(pending).toHaveLength(2);
    const anchor = pending.find((i) => i.kind === 'event');
    expect(anchor!.payload.requestedKind).toBe('outreach');
    expect(Date.parse(anchor!.payload.notBefore!) - Date.now()).toBeGreaterThan(6 * 86_400_000);
    const parkedRun = (
      await sql<{ status: string }[]>`
        select status from agent_runs where id = ${parked}
      `
    )[0]!;
    expect(parkedRun.status).toBe('canceled');
    const reply = await sql<{ kind: string; run_at: Date }[]>`
      select kind, run_at from agent_runs where lead_id = ${leadId} and status = 'queued'
    `;
    expect(reply).toHaveLength(1);
    expect(reply[0]!.kind).toBe('reply');
    const slideMs = reply[0]!.run_at.getTime() - Date.now();
    expect(slideMs).toBeGreaterThan(0);
    expect(slideMs).toBeLessThanOrEqual(61 * 60_000);
  });

  test('a staff-queued reply absorbs the inbound as mail — one run serves both', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // a staff-parked reply carries its own intent (draftOnly) — under
    // one-run-per-lead the inbound mails to it instead of earning a second row
    // (origin:'staff' is what the run endpoints stamp on staff enqueues)
    const digits = `55219${Math.floor(Math.random() * 1e8)}`;
    const from = `${digits}@s.whatsapp.net`;
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Staff Draft', whatsapp: digits }),
    );
    const leadId = created.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // future runAt keeps the queue contents observable — ingest's
    // fire-and-forget drain could claim a due run mid-assertion
    await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      threadId: thread!.id,
      params: { draftOnly: true },
      runAt: new Date(Date.now() + 3_600_000),
    });
    const mid = crypto.randomUUID();
    const first = await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi',
      providerMessageId: `${mid}-1`,
    });
    if ('ignored' in first) throw new Error('unexpected ignore');
    const queued = await sql<{ source: string }[]>`
      select source from agent_runs where thread_id = ${thread!.id} and status = 'queued'
      order by created_at
    `;
    // Still exactly the staff run — the inbound went to its mailbox.
    expect(queued).toHaveLength(1);
    expect(queued[0]!.source).toBe('staff');
    const mailed = await sql<{ kind: string }[]>`
      select kind from agent_inbox where lead_id = ${leadId} and consumed_at is null
    `;
    expect(mailed.map((i) => i.kind)).toEqual(['inbound']);
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi de novo',
      providerMessageId: `${mid}-2`,
    });
    const still =
      await sql`select id from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(still).toHaveLength(1);
    const more =
      await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`;
    expect(more).toHaveLength(2);
  });

  test('a legacy unmarked reply absorbs the next inbound as mail', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // replies queued before the origin marker carry params = {} — the
    // unmarked run is still the delivery target the message mails to
    const digits = `55218${Math.floor(Math.random() * 1e8)}`;
    const from = `${digits}@s.whatsapp.net`;
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Legacy Parked', whatsapp: digits }),
    );
    const leadId = created.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // Future-dated like the staff case above — the drain race is the same.
    await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      threadId: thread!.id,
      runAt: new Date(Date.now() + 3_600_000),
    });
    const mid = crypto.randomUUID();
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi',
      providerMessageId: `${mid}-1`,
    });
    // the legacy row is the only run — the inbound mailed to it, and a
    // follow-up lands the same way (items accumulate for claim)
    const queued =
      await sql`select params from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(queued).toHaveLength(1);
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'e aí?',
      providerMessageId: `${mid}-2`,
    });
    const still =
      await sql`select id from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(still).toHaveLength(1);
    const pending =
      await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`;
    expect(pending).toHaveLength(2);
  });

  test('claimRun skips a lead whose number is ignored', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999776655']);
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Ignored Claim', whatsapp: '5511999776655' }),
    );
    const leadId = created.body.lead.id;
    const ignored = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    // drain other leads' legitimately-runnable leftovers (incl. respawned
    // mail) and assert the ignored run is never the pick
    for (let i = 0; i < 20; i++) {
      const claimed = await claimRun(sql);
      if (!claimed) break;
      expect(claimed.id).not.toBe(ignored);
      await sql`update agent_runs set status = 'done', finished_at = now() where id = ${claimed.id}`;
    }
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${ignored}
    `;
    expect(r!.status).toBe('queued');
  });

  test('a parked ignored prefix cannot starve the claim queue', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999776600']);
    // drain leftover due runs (incl. respawned mail) so the queue holds only what this test makes
    for (let i = 0; i < 20; i++) {
      const stale = await claimRun(sql);
      if (!stale) break;
      await sql`update agent_runs set status = 'done', finished_at = now() where id = ${stale.id}`;
    }
    // more ignored-lead runs than the claim loop's 8-attempt budget — they
    // must be filtered in the scan, not rejected one at a time
    const parked: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: `Parked ${i}`, whatsapp: '5511999776600' }),
      );
      parked.push((await enqueueRun(sql, { kind: 'outreach', leadId: lead.body.lead.id }))!);
    }
    const valid = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Valid', whatsapp: '5511900001111' }),
    );
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId: valid.body.lead.id }))!;
    // a background drain kicked by an earlier test can spawn a higher-priority stray
    // (claim order is priority first) — finish strays, but an ignored run must never claim
    let claimed = await claimRun(sql);
    for (let i = 0; i < 10 && claimed && claimed.id !== runId; i++) {
      expect(parked).not.toContain(claimed.id);
      await sql`update agent_runs set status = 'done', finished_at = now() where id = ${claimed.id}`;
      claimed = await claimRun(sql);
    }
    expect(claimed?.id).toBe(runId);
  });

  test('dispatchMessage fails a queued send to an ignored number', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999665544']);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Ignored Send', whatsapp: '5511999665544' }),
    );
    const composed = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: lead.body.lead.id,
        channel: 'whatsapp',
        body: 'nunca sai',
        author: 'staff',
        status: 'queued',
      }),
    );
    const out = await dispatchMessage(sql, composed.body.message.id);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('número ignorado');
    const [m] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${composed.body.message.id}
    `;
    expect(m!.status).toBe('failed');
    expect(m!.error).toBe('número ignorado');
  });

  test('dispatchMessage also blocks when the ignored digits sit in lead.phone', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511955554444']);
    // whatsapp differs from phone — the send would reach `whatsapp` while the
    // ignored `phone` marks this lead as staff/founder.
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, {
        name: 'Phone Only',
        whatsapp: '5511900002222',
        phone: '5511955554444',
      }),
    );
    const composed = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId: lead.body.lead.id,
        channel: 'whatsapp',
        body: 'nunca sai',
        author: 'staff',
        status: 'queued',
      }),
    );
    const out = await dispatchMessage(sql, composed.body.message.id);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('número ignorado');
  });

  test('whatsappRegistered degrades to null with no live socket', async () => {
    // No baileys socket runs in tests — the probe must answer "can't tell",
    // never crash and never a false negative that would un-verify a number.
    expect(await whatsappRegistered('5511999990000')).toBeNull();
  });

  test('a fresh inbound retires the queued auto outreach — the reply takes over', async () => {
    await migrate(sql, MIGRATIONS);
    // 60-min quiet period parks the reply run — deterministic assertions.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Replier', whatsapp: '5511955550001' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // a queued auto outreach can't serve the mail (drainInbox only runs
    // inside an executing run) — it retires; the reply run carries the message
    const autoRun = (await enqueueRun(sql, {
      source: 'followup',
      kind: 'outreach',
      leadId,
      params: {},
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    // the cadence event tombstones with its run — the staff note waits for
    // the reply, the consumed staff instruction releases back (deliveries-stamped)
    await sql`
      insert into agent_inbox (lead_id, kind, payload, source)
      values (${leadId}, 'event',
        ${sql.json({ text: 'a cadência disparou', requestedKind: 'outreach', params: {} } as never)}, 'followup'),
             (${leadId}, 'event',
        ${sql.json({ text: 'nota da equipe', requestedKind: 'outreach', params: {} } as never)}, 'staff'),
             (${leadId}, 'event',
        ${sql.json({ text: 'retome a descoberta', requestedKind: 'discovery', params: {} } as never)}, 'brief'),
             (${leadId}, 'staff',
        ${sql.json({ text: 'prioridade', requestedKind: 'outreach', params: {} } as never)}, 'staff'),
             (${leadId}, 'staff',
        ${sql.json({ text: 'insiste na proposta', requestedKind: 'outreach', params: {}, deliveries: 2 } as never)}, 'staff')
    `;
    await sql`
      update agent_inbox set consumed_by_run = ${autoRun}, consumed_at = now()
      where lead_id = ${leadId} and kind = 'staff'
    `;
    const events: ControlEvent[] = [];
    const unsub = subscribeControlEvents((e) => events.push(e));
    let res;
    try {
      res = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: '5511955550001@s.whatsapp.net',
        body: 'oi, quero saber mais',
        providerMessageId: `fx10-${crypto.randomUUID()}`,
      });
    } finally {
      unsub();
    }
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${autoRun}
    `;
    expect(r!.status).toBe('canceled');
    const items = await sql<
      {
        kind: string;
        source: string;
        consumed_at: Date | null;
        payload: { requestedKind?: string; params?: Record<string, unknown> };
      }[]
    >`
      select kind, source, consumed_at, payload from agent_inbox where lead_id = ${leadId}
    `;
    expect(items).toHaveLength(6);
    const pending = items.filter((i) => i.consumed_at === null);
    expect(pending).toHaveLength(5);
    // The disposable cadence event tombstoned with its run — scoped to
    // outreach intent, so the auto DISCOVERY event survives for its run…
    const tomb = items.find(
      (i) => i.payload.requestedKind === 'outreach' && i.source === 'followup',
    );
    expect(tomb!.consumed_at).not.toBeNull();
    const discovery = items.find((i) => i.payload.requestedKind === 'discovery');
    expect(discovery!.consumed_at).toBeNull();
    // …the pending 'inbound' carries the message…
    const inbound = pending.find((i) => i.kind === 'inbound');
    expect(inbound!.payload.requestedKind).toBe('reply');
    // …both consumed staff mails release back — the retire lifts the
    // deliveries bound instead of stranding them on the canceled run
    expect(pending.filter((i) => i.kind === 'staff')).toHaveLength(2);
    // The reply run exists to serve it, parked at the quiet period.
    const reply = await sql<{ kind: string; status: string }[]>`
      select kind, status from agent_runs where lead_id = ${leadId} and kind = 'reply'
    `;
    expect(reply).toHaveLength(1);
    expect(reply[0]!.status).toBe('queued');
    // Retiring the queued outreach emits run.update on it — otherwise the
    // Runs view keeps showing it as live.
    expect(events.some((e) => e.type === 'run.update' && e.ref === autoRun)).toBe(true);
  });

  test('a fired wakeup’s pending mail tombstones with its canceled run on inbound', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Fired Wakeup', whatsapp: '5511955550063' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // Ambient pending wakeups from earlier runs would fire in the same
    // sweep and inflate the count.
    await sql`delete from agent_wakeups where status = 'pending'`;
    // A due automation wakeup: the sweep fires it — an 'outreach' run with
    // auto='wakeup' and a pending 'wakeup' item carrying the same intent.
    await sql`
      insert into agent_wakeups (lead_id, kind, at, focus, created_by, requested, status)
      values (${leadId}, 'outreach', now() - interval '1 minute',
              'lembra da prova', 'agent', false, 'pending')
    `;
    expect(await sweepWakeups(sql)).toBe(1);
    const mail = await sql<{ id: string; consumed_at: string | null }[]>`
      select id, consumed_at from agent_inbox
      where lead_id = ${leadId} and kind = 'wakeup'
    `;
    expect(mail).toHaveLength(1);
    expect(mail[0]!.consumed_at).toBeNull();
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550063@s.whatsapp.net',
      body: 'oi, pode deixar',
      providerMessageId: `wk-tomb-${crypto.randomUUID()}`,
    });
    expect('ignored' in res).toBe(false);
    // the fired wakeup's pending item tombstones with it — else the orphan
    // sweep would respawn the now-obsolete reminder
    const [tomb] = await sql<{ consumed_at: string | null }[]>`
      select consumed_at from agent_inbox where id = ${mail[0]!.id}
    `;
    expect(tomb!.consumed_at).not.toBeNull();
    // The reply run still owns the lead — retire it so the sweep's scope
    // is just the tombstoned mail: nothing may respawn.
    await sql`
      update agent_runs set status = 'done'
      where lead_id = ${leadId} and kind = 'reply' and status in ('queued', 'running')
    `;
    await sweepOrphanInbox(sql);
    const outreach = await sql<{ status: string }[]>`
      select status from agent_runs
      where lead_id = ${leadId} and kind = 'outreach'
    `;
    // 'running' is also fine — an ambient drain pass may claim the run in
    // the gap; either way nothing respawned for the tombstoned mail
    expect(outreach).toHaveLength(1);
    expect(outreach[0]!.status).not.toBe('queued');
  });

  test('a scheduled regen run re-anchors intact when the inbound cancels it', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Regen', whatsapp: '5511955550002' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // regen is staff-approved draftOnly work the inbound makes MORE relevant
    // — it must not die with the disposable autos: the run retires and
    // re-anchors as mail on the SAME schedule (sliding run_at would break the delay)
    const regen = (await enqueueRun(sql, {
      source: 'regenerate',
      kind: 'outreach',
      leadId,
      params: { draftOnly: true },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550002@s.whatsapp.net',
      body: 'oi',
      providerMessageId: `fx10b-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${regen}
    `;
    expect(r!.status).toBe('canceled');
    const anchors = await sql<
      {
        source: string;
        payload: {
          requestedKind?: string;
          notBefore?: string;
          params?: Record<string, unknown>;
        };
      }[]
    >`
      select source, payload from agent_inbox
      where lead_id = ${leadId} and kind = 'event' and consumed_at is null
    `;
    expect(anchors).toHaveLength(1);
    const a = anchors[0]!.payload;
    expect(a.requestedKind).toBe('outreach');
    expect(anchors[0]!.source).toBe('regenerate');
    expect(a.params!.draftOnly).toBe(true);
    expect(Date.parse(a.notBefore!) - Date.now()).toBeGreaterThan(50 * 60_000);
  });

  test("the inbound still retires the auto run's unapproved drafts", async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Drafter', whatsapp: '5511955550011' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // A draftOnly auto parked far ahead + the draft it already committed —
    // "first contact" copy that now answers nothing.
    const autoRun = (await enqueueRun(sql, {
      source: 'first_contact',
      kind: 'outreach',
      leadId,
      params: { draftOnly: true },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    // control: a FINISHED staff run's draft — 'done' rows sit outside the
    // one-active-run index, and terminal-run drafts are what the supersede scans
    const [staffRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, finished_at)
      values ('outreach', ${leadId}, 'done', ${sql.json({ goal: 'negotiation' } as never)}, now())
      returning id
    `;
    const [draft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'oi! vi seu negócio', 'draft', ${autoRun})
      returning id
    `;
    // Control: a staff run's draft is staff's own — never superseded.
    const [staffDraft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'draft da equipe', 'draft', ${staffRun!.id})
      returning id
    `;
    const events: ControlEvent[] = [];
    const unsub = subscribeControlEvents((e) => events.push(e));
    try {
      const res = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: '5511955550011@s.whatsapp.net',
        body: 'oi, me conta mais',
        providerMessageId: `fx10e-${crypto.randomUUID()}`,
      });
      if ('ignored' in res) throw new Error('unexpected ignore');
    } finally {
      unsub();
    }
    const [d] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${draft!.id}
    `;
    expect(d!.status).toBe('rejected');
    expect(d!.error).toBe('lead respondeu');
    const [s] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${staffDraft!.id}
    `;
    expect(s!.status).toBe('draft');
    expect(events.some((e) => e.type === 'draft.change' && e.ref === thread!.id)).toBe(true);
  });

  test('a done auto run leaves no approvable draft after an inbound', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Done Drafter', whatsapp: '5511955550013' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // A FINISHED draftOnly run: nothing to cancel, but its unapproved
    // "first contact" draft answers nothing after the lead replies.
    const [doneRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, finished_at, source)
      values ('outreach', ${leadId}, 'done',
              ${sql.json({ draftOnly: true } as never)}, now(), 'first_contact')
      returning id
    `;
    const [regenRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, finished_at, source)
      values ('outreach', ${leadId}, 'done',
              ${sql.json({ draftOnly: true } as never)}, now(), 'regenerate')
      returning id
    `;
    // a promised callback (the 0044 backfill maps legacy 'agent' here): never
    // canceled or superseded by an inbound
    const [legacyRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, run_at, source, promised, priority)
      values ('outreach', ${leadId}, 'queued',
              ${sql.json({} as never)}, now() + interval '1 hour', 'callback', true, 1)
      returning id
    `;
    const [legacyDraft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'te chamo terça!', 'draft', ${legacyRun!.id})
      returning id
    `;
    const [draft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'oi! vi seu negócio', 'draft', ${doneRun!.id})
      returning id
    `;
    // Regen-authored drafts survive exactly like the regen run does — its
    // recompose reads current state, so the inbound makes it more right.
    const [regenDraft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'rascunho novo', 'draft', ${regenRun!.id})
      returning id
    `;
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550013@s.whatsapp.net',
      body: 'olá, pode me chamar',
      providerMessageId: `fx10g-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [d] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${draft!.id}
    `;
    expect(d!.status).toBe('rejected');
    expect(d!.error).toBe('lead respondeu');
    const [rd] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${regenDraft!.id}
    `;
    expect(rd!.status).toBe('draft');
    // the reply's insert retires the legacy row (a runnable owner claims the
    // slot), but the promise survives as mail re-anchored at the same deadline
    const [lrun] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${legacyRun!.id}
    `;
    expect(lrun!.status).toBe('canceled');
    const [lanchor] = await sql<{ payload: { requestedKind?: string; notBefore?: string } }[]>`
      select payload from agent_inbox
      where lead_id = ${leadId} and kind = 'event' and consumed_at is null
        and payload->>'requestedKind' = 'outreach'
    `;
    expect(Date.parse(lanchor!.payload.notBefore!) - Date.now()).toBeGreaterThan(50 * 60_000);
    const [ld] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${legacyDraft!.id}
    `;
    expect(ld!.status).toBe('draft');
  });

  test('a requested callback survives the inbound reply and fires as a promise', async () => {
    await migrate(sql, MIGRATIONS);
    // inboundReplyDelayMin parks the reply run (run_at future — the kicked
    // drain can't claim it) so the sweep's delivery target is deterministic.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Promised', whatsapp: '5511955550012' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // "me chama semana que vem" — a requested callback: the reply retires the
    // agent's own follow-ups but can't wipe a lead-asked promise.
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, leadId, new Date(Date.now() + 2 * 86_400_000), 'requested'),
    );
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550012@s.whatsapp.net',
      body: 'ah, e também queria saber do frete',
      providerMessageId: `fx10f-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [l] = await sql<{ next_action_source: string | null }[]>`
      select next_action_source from leads where id = ${leadId}
    `;
    expect(l!.next_action_source).toBe('requested');
    // the due callback outranks the parked reply: the reply retires — its intent
    // covered by the inbound mail's notBefore — while the callback mints its own run
    await sql`
      update agent_wakeups set at = now() - interval '1 hour'
      where lead_id = ${leadId} and status = 'pending' and requested
    `;
    expect(await sweepWakeups(sql)).toBeGreaterThanOrEqual(1);
    const swept = await sql<{ source: string; promised: boolean; priority: number }[]>`
      select source, promised, priority from agent_runs
      where lead_id = ${leadId} and kind = 'outreach' and status = 'queued'
    `;
    expect([...swept]).toEqual([{ source: 'callback', promised: true, priority: 1 }]);
    const mailed = await sql<{ source: string; promised: boolean }[]>`
      select source, promised from agent_inbox
      where lead_id = ${leadId} and kind = 'wakeup' and consumed_at is null
    `;
    expect([...mailed]).toEqual([{ source: 'callback', promised: true }]);
    // The inbound mail still holds the reply intent at its quiet stamp —
    // the orphan sweep respawns it there.
    const [inb] = await sql<{ payload: { notBefore?: string; requestedKind?: string } }[]>`
      select payload from agent_inbox
      where lead_id = ${leadId} and kind = 'inbound' and consumed_at is null
    `;
    expect(inb!.payload.requestedKind).toBe('reply');
    expect(Date.parse(inb!.payload.notBefore!) - Date.now()).toBeGreaterThan(50 * 60_000);
    const [date] = await sql<{ next_action_at: Date | null }[]>`
      select next_action_at from leads where id = ${leadId}
    `;
    expect(date!.next_action_at).toBeNull();
  });

  test('staff and requested dates fire as promises that survive a reply; the agent plan retires', async () => {
    await migrate(sql, MIGRATIONS);
    // 60-min quiet period parks every reply run — the kicked drain can't
    // claim it mid-assertion, so mailed items stay pending deterministically.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const mk = async (name: string, wa: string, who: 'staff' | 'agent' | 'requested') => {
      const l = await controlTx(sql, (tx) => insertLeadTx(tx, { name, whatsapp: wa }));
      await controlTx(sql, (tx) =>
        setNextActionTx(tx, l.body.lead.id, new Date(Date.now() - 3_600_000), who),
      );
      return l.body.lead.id;
    };
    await sql`delete from agent_runs where status = 'queued'`;
    const staffLead = await mk('Staff Slot', '5511955550003', 'staff');
    const autoLead = await mk('Auto Slot', '5511955550004', 'agent');
    const askedLead = await mk('Asked Slot', '5511955550005', 'requested');
    // an in-flight drain could claim a materialized run in the sweep→park
    // gap: hold each lead's `claimrun:` advisory so same-lead claims reject
    // at pg_try_ — the rows stay parked 'queued' (the sweep only tries `capfin:`)
    const leadIds = [staffLead, autoLead, askedLead];
    type Row = { id: string; lead_id: string; source: string; promised: boolean };
    let parked: Row[] = [];
    const gate = await sql.reserve();
    try {
      for (const id of leadIds) await gate`select pg_advisory_lock(hashtext(${'claimrun:' + id}))`;
      expect(await sweepWakeups(sql)).toBeGreaterThanOrEqual(3);
      // Park + fetch in one statement — no cross-statement window left
      // for a late claim to slip into after the advisory releases.
      parked = await sql<Row[]>`
        update agent_runs set run_at = now() + interval '1 hour'
        where kind = 'outreach' and status = 'queued' and lead_id in ${sql(leadIds)}
        returning id, lead_id, source, promised
      `;
    } finally {
      await gate`select pg_advisory_unlock_all()`;
      gate.release();
    }
    const of = (id: string) => parked.filter((r) => r.lead_id === id);
    expect(of(staffLead)).toEqual([
      expect.objectContaining({ source: 'callback', promised: true }),
    ]);
    expect(of(askedLead)).toEqual([
      expect.objectContaining({ source: 'callback', promised: true }),
    ]);
    expect(of(autoLead)).toEqual([
      expect.objectContaining({ source: 'followup', promised: false }),
    ]);
    const reply = async (wa: string, tag: string) => {
      const r = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: `${wa}@s.whatsapp.net`,
        body: 'oi',
        providerMessageId: `${tag}-${crypto.randomUUID()}`,
      });
      if ('ignored' in r) throw new Error('unexpected ignore');
    };
    const status = async (id: string) =>
      (await sql<{ status: string }[]>`select status from agent_runs where id = ${id}`)[0]!.status;
    await reply('5511955550003', 'fx10c');
    expect(await status(of(staffLead)[0]!.id)).not.toBe('canceled');
    await reply('5511955550005', 'fx10e');
    expect(await status(of(askedLead)[0]!.id)).not.toBe('canceled');
    // the agent's own nudge is disposable: canceled on the lead's inbound; the
    // reply run carries the item
    await reply('5511955550004', 'fx10d');
    expect(await status(of(autoLead)[0]!.id)).toBe('canceled');
    const autoMail = await sql`select 1 from agent_inbox
      where lead_id = ${autoLead} and kind = 'inbound' and consumed_at is null`;
    expect(autoMail).toHaveLength(1);
    const autoReply =
      await sql`select 1 from agent_runs where lead_id = ${autoLead} and kind = 'reply'`;
    expect(autoReply).toHaveLength(1);
    // a pending agent date retires on inbound; a requested one stays
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, autoLead, new Date(Date.now() + 2 * 86_400_000), 'agent'),
    );
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, askedLead, new Date(Date.now() + 2 * 86_400_000), 'requested'),
    );
    await reply('5511955550004', 'fx10g');
    await reply('5511955550005', 'fx10h');
    const dates = await sql<{ id: string; next_action_source: string | null }[]>`
      select id, next_action_source from leads where id in ${sql([autoLead, askedLead])}
    `;
    const src = Object.fromEntries(dates.map((d) => [d.id, d.next_action_source]));
    expect(src[autoLead]).toBeNull();
    expect(src[askedLead]).toBe('requested');
  });

  test('preset off stalls only the agent’s own plans — promised work still materializes', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('agent', ${sql.json({ level: 'off' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      const promised = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Asked Back', whatsapp: '5511955550013' }),
      );
      const promisedId = promised.body.lead.id;
      const auto = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Auto Cadence', whatsapp: '5511955550014' }),
      );
      await sql`delete from agent_runs where status = 'queued'`;
      // A queued automated outreach parked under 'off' can never claim — the
      // promised callback retires it so insertRun mints a runnable owner.
      const parked = (await enqueueRun(sql, {
        source: 'first_contact',
        kind: 'outreach',
        leadId: promisedId,
        params: {},
        runAt: new Date(Date.now() + 3_600_000),
      }))!;
      // Mail the parked run already consumed — even at the deliveries
      // bound — releases with it: a retire carries no failure signal.
      await sql`
        insert into agent_inbox (lead_id, kind, payload, consumed_by_run, consumed_at)
        values (${promisedId}, 'staff',
          ${sql.json({ text: 'liga amanhã', requestedKind: 'outreach', params: {}, deliveries: 2 } as never)},
          ${parked}, now())
      `;
      const due = new Date(Date.now() - 3_600_000);
      await controlTx(sql, (tx) => setNextActionTx(tx, promisedId, due, 'requested'));
      await controlTx(sql, (tx) => setNextActionTx(tx, auto.body.lead.id, due, 'agent'));
      // the agent's own due plan on the promised lead parks under the same switch
      await sql`
        insert into agent_wakeups (lead_id, kind, at, focus, created_by, requested, status)
        values (${promisedId}, 'outreach', now() - interval '1 minute',
                'sondagem de cadência', 'agent', false, 'pending')
      `;
      expect(await sweepWakeups(sql)).toBeGreaterThanOrEqual(1);
      const [pr] = await sql<{ status: string }[]>`
        select status from agent_runs where id = ${parked}
      `;
      expect(pr!.status).toBe('canceled');
      const [released] = await sql<{ consumed_at: Date | null }[]>`
        select consumed_at from agent_inbox
        where lead_id = ${promisedId} and kind = 'staff'
      `;
      expect(released!.consumed_at).toBeNull();
      // The lead-asked callback fires — a promise outranks the preset the same
      // way a staff decision does.
      const swept = await sql<{ id: string; source: string; params: Record<string, unknown> }[]>`
        select id, source, params from agent_runs
        where lead_id = ${promisedId} and kind = 'outreach' and status = 'queued'
      `;
      expect(swept).toHaveLength(1);
      expect(swept[0]!.id).not.toBe(parked);
      expect(swept[0]!.source).toBe('callback');
      expect(String(swept[0]!.params.focus)).not.toContain('sondagem');
      const [wk] = await sql<{ status: string }[]>`
        select status from agent_wakeups where lead_id = ${promisedId} and not requested
      `;
      expect(wk!.status).toBe('pending');
      // …while the agent's own follow-up parks under 'off'.
      const skipped = await sql`
        select 1 from agent_runs where lead_id = ${auto.body.lead.id}
      `;
      expect(skipped).toHaveLength(0);
    } finally {
      await sql`delete from control_settings where key = 'agent'`;
    }
  });

  test('a capped inbound flags the lead and emits lead.change', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ leadLifetimeCostCapUsd: 0.01 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // whatsapp matches the inbound sender so the message lands on this card,
    // not a freshly-created lead.
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Capped Inbound', whatsapp: '5511944440001' }),
    );
    const leadId = lead.body.lead.id;
    // 5¢ of prior terminal spend — the cap refuses the reply run and writes
    // a fresh flag + [humano] task inside the gate tx.
    await sql`insert into agent_runs (kind, lead_id, status, cost_cents)
      values ('outreach', ${leadId}, 'done', 5)`;
    const events: ControlEvent[] = [];
    const unsub = subscribeControlEvents((e) => events.push(e));
    try {
      const res = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: '5511944440001@s.whatsapp.net',
        body: 'oi, ainda quero',
        providerMessageId: `cap-inbound-${crypto.randomUUID()}`,
      });
      if ('ignored' in res) throw new Error('unexpected ignore');
      // reply refused — no new run for this lead beyond the seeded one
      const queued = await sql`select 1 from agent_runs
        where lead_id = ${leadId} and status = 'queued'`;
      expect(queued).toHaveLength(0);
      const flags = await sql`select 1 from lead_activities
        where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'`;
      expect(flags).toHaveLength(1);
      const tasks = await sql`select 1 from lead_tasks
        where lead_id = ${leadId} and title like '%custo do agente%'`;
      expect(tasks).toHaveLength(1);
      // the flag's task committed inside the gate tx — lead.change must
      // refresh Tasks views (the message-path emit predates the flag)
      expect(events.some((e) => e.type === 'lead.change' && e.ref === undefined)).toBe(true);
    } finally {
      unsub();
    }
  });
});
