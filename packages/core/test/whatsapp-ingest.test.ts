import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { whatsappRegistered } from '../src/agent/channels/whatsapp.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun, enqueueRun, sweepOutreach } from '../src/agent/runner.ts';
import { sweepWakeups } from '../src/agent/wakeups.ts';
import { sweepOrphanInbox } from '../src/agent/inbox.ts';
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
      from: '5511988887777@s.whatsapp.net',
      body: 'mensagem antiga',
      providerMessageId: 'hist-norun-1',
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
      from: '5511977776666@s.whatsapp.net',
      body: 'resposta que o fundador digitou no aparelho',
      providerMessageId: 'hist-out-1',
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
      providerMessageId: 'hist-lm-live',
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
      providerMessageId: 'hist-lm-old',
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
      providerMessageId: 'ign-in-1',
    });
    expect(inbound).toEqual({ ignored: 'número ignorado: 5511998887766@s.whatsapp.net' });
    const echo = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511998887766@s.whatsapp.net',
      body: 'nossa resposta',
      providerMessageId: 'ign-out-1',
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
    // A delayed inboundReplyDelayMin parks the first run (run_at future —
    // unclaimable), so the delivery check sees a 'queued' row, not a race.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // unique sender + message ids — the shared test db keeps prior runs'
    // threads, and a seen providerMessageId returns early without a run
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
    // One parked run covers both messages — each message lands in the inbox
    // as its own item for the run to read at claim (never a second run).
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
    // A 'running' run drains mail between steps too — still one run, and the
    // fourth message lands as another pending item instead of a fresh run.
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
    // The lead exists BEFORE the inbound so an outreach can own its run slot
    // — parked a week out, the schedule must not hold the reply hostage.
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
    // The single active slot forces a choice — and the week-out schedule
    // must not slide forward to answer a reply (a pulled run_at would fire
    // its intent early). The parked row retires and re-anchors as mail on
    // its own deadline; the reply gets a runnable owner at the quiet
    // window.
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
    // Staff can park a reply carrying its own intent (draftOnly) — under
    // one-run-per-lead the inbound no longer earns a second row: it mails
    // to the staff run, which reads the new message when it claims.
    // origin:'staff' is what the run endpoints stamp on staff enqueues.
    const digits = `55219${Math.floor(Math.random() * 1e8)}`;
    const from = `${digits}@s.whatsapp.net`;
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Staff Draft', whatsapp: digits }),
    );
    const leadId = created.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // runAt in the future: ingest's fire-and-forget drain may claim a due
    // run mid-assertion — a parked row keeps the queue contents observable.
    await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      threadId: thread!.id,
      params: { origin: 'staff', draftOnly: true },
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
    const queued = await sql<{ params: { origin?: string } }[]>`
      select params from agent_runs where thread_id = ${thread!.id} and status = 'queued'
      order by created_at
    `;
    // Still exactly the staff run — the inbound went to its mailbox.
    expect(queued).toHaveLength(1);
    expect(queued[0]!.params.origin).toBe('staff');
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
    // Replies queued before the origin marker carry params = {} — under
    // mailbox delivery the unmarked run is simply the delivery target:
    // the message lands as an item it reads at claim, never a second run.
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
    // The legacy row is the only run — the inbound mailed to it, and a
    // follow-up message lands the same way (items accumulate for claim).
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
    // Other leads' leftover work (incl. mail the orphan sweep respawns) is
    // legitimately runnable — drain it and assert the ignored run is never
    // the pick, rather than requiring an empty queue.
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
    // Leftover due runs from earlier tests (incl. mail the orphan sweep
    // respawns) would claim before the valid one — drain them first so the
    // queue holds only what this test makes.
    for (let i = 0; i < 20; i++) {
      const stale = await claimRun(sql);
      if (!stale) break;
      await sql`update agent_runs set status = 'done', finished_at = now() where id = ${stale.id}`;
    }
    // More ignored-lead runs than the claim loop's 8-attempt budget — they
    // must be filtered in the scan, not rejected one at a time.
    for (let i = 0; i < 10; i++) {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: `Parked ${i}`, whatsapp: '5511999776600' }),
      );
      await enqueueRun(sql, { kind: 'outreach', leadId: lead.body.lead.id })!;
    }
    const valid = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Valid', whatsapp: '5511900001111' }),
    );
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId: valid.body.lead.id }))!;
    const claimed = await claimRun(sql);
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
    // A QUEUED auto outreach can never serve the mail — drainInbox only
    // runs inside an executing run, its channel pin may not match the
    // item's, and it would fire before the inbound's quiet period ends.
    // It retires with the drafts; the reply run carries the message.
    const autoRun = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: { auto: 'cadence' },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    // The cadence event that run minted is as disposable as the run —
    // tombstoned with it. A staff note and a staff instruction the dead
    // attempt already consumed are NOT: the note waits for the reply,
    // the instruction releases back to pending (deliveries-stamped).
    await sql`
      insert into agent_inbox (lead_id, kind, payload)
      values (${leadId}, 'event',
        ${sql.json({ text: 'a cadência disparou', requestedKind: 'outreach', params: { auto: 'cadence' } } as never)}),
             (${leadId}, 'event',
        ${sql.json({ text: 'nota da equipe', requestedKind: 'outreach', params: {} } as never)}),
             (${leadId}, 'event',
        ${sql.json({ text: 'retome a descoberta', requestedKind: 'discovery', params: { auto: 'discovery' } } as never)}),
             (${leadId}, 'staff',
        ${sql.json({ text: 'prioridade', requestedKind: 'outreach', params: {} } as never)}),
             (${leadId}, 'staff',
        ${sql.json({ text: 'insiste na proposta', requestedKind: 'outreach', params: {}, deliveries: 2 } as never)})
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
        consumed_at: Date | null;
        payload: { requestedKind?: string; params?: Record<string, unknown> };
      }[]
    >`
      select kind, consumed_at, payload from agent_inbox where lead_id = ${leadId}
    `;
    expect(items).toHaveLength(6);
    const pending = items.filter((i) => i.consumed_at === null);
    expect(pending).toHaveLength(5);
    // The disposable cadence event tombstoned with its run — scoped to
    // outreach intent, so the auto DISCOVERY event survives for its run…
    const tomb = items.find(
      (i) => i.kind === 'event' && i.payload.requestedKind === 'outreach' && i.payload.params?.auto,
    );
    expect(tomb!.consumed_at).not.toBeNull();
    const discovery = items.find((i) => i.payload.requestedKind === 'discovery');
    expect(discovery!.consumed_at).toBeNull();
    // …the pending 'inbound' carries the message…
    const inbound = pending.find((i) => i.kind === 'inbound');
    expect(inbound!.payload.requestedKind).toBe('reply');
    // …the staff note waits, and BOTH consumed staff mails released back
    // — event retire lifts the deliveries bound, so deliveries:2 returns
    // to pending instead of stranding on the canceled run.
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
      providerMessageId: 'wk-tomb-1',
    });
    expect('ignored' in res).toBe(false);
    // The fired wakeup's outreach retires on the reply — and its pending
    // item goes with it. Left pending, the orphan sweep would respawn the
    // dead reminder the lead just made obsolete.
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
    expect(outreach).toHaveLength(1);
    expect(outreach[0]!.status).toBe('canceled');
  });

  test('a scheduled regen run re-anchors intact when the inbound cancels it', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Regen', whatsapp: '5511955550002' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // Regen is draftOnly composition work staff already approved — the
    // fresh inbound makes its recompose MORE relevant, so it must not die
    // with the disposable autos (its superseded draft has no replacement
    // otherwise). Sliding its run_at forward would also break the delay:
    // instead the run retires and its intent re-anchors as mail on the
    // SAME schedule — the respawned run inherits the regenerate+draftOnly
    // params whole.
    const regen = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: { auto: 'regenerate', draftOnly: true },
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
        payload: {
          requestedKind?: string;
          notBefore?: string;
          params?: Record<string, unknown>;
        };
      }[]
    >`
      select payload from agent_inbox
      where lead_id = ${leadId} and kind = 'event' and consumed_at is null
    `;
    expect(anchors).toHaveLength(1);
    const a = anchors[0]!.payload;
    expect(a.requestedKind).toBe('outreach');
    expect(a.params!.auto).toBe('regenerate');
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
      kind: 'outreach',
      leadId,
      params: { auto: 'first-contact', draftOnly: true },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    // Control draft belongs to a FINISHED staff run — with one active run
    // per lead a second queued row can't be created; 'done' rows are
    // outside the index, and drafts of terminal runs are what the
    // supersede predicate scans anyway.
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
      insert into agent_runs (kind, lead_id, status, params, finished_at)
      values ('outreach', ${leadId}, 'done',
              ${sql.json({ auto: 'first-contact', draftOnly: true } as never)}, now())
      returning id
    `;
    const [regenRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, finished_at)
      values ('outreach', ${leadId}, 'done',
              ${sql.json({ auto: 'regenerate', draftOnly: true } as never)}, now())
      returning id
    `;
    // Pre-'auto' sweeps stamped params.auto='agent' — same unrecoverable mix
    // as the column value, so a live row carrying it is a possible promise:
    // never canceled, its draft never superseded.
    const [legacyRun] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, run_at)
      values ('outreach', ${leadId}, 'queued',
              ${sql.json({ auto: 'agent' } as never)}, now() + interval '1 hour')
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
    // The legacy row is a future-dated promise — not canceled by the
    // draft sweep. The reply's insert DOES retire it (a runnable owner
    // claims the slot), but the promise survives as mail re-anchored at
    // the same deadline.
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

  test("a 'requested' callback survives the inbound reply and mails unmarked", async () => {
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
    // "me chama semana que vem" — provenance 'requested': the reply run
    // re-commits its own cadence but can't wipe a lead-asked promise.
    await sql`
      update leads set next_action_at = now() + interval '2 days',
                       next_action_source = 'requested'
      where id = ${leadId}
    `;
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
    // And when the date does come due it materializes UNMARKED — a promised
    // callback outranks a later reply exactly like a staff decision. The
    // sweep's earlier start can't borrow the parked reply's slot without
    // sliding its quiet window, so the reply retires — its intent stays
    // covered by the inbound mail's own notBefore — while the overdue
    // callback mints its own run ('event' mail, unmarked params) instead
    // of waiting out the quiet period.
    await sql`
      update leads set next_action_at = now() - interval '1 hour' where id = ${leadId}
    `;
    expect(await sweepOutreach(sql)).toBeGreaterThanOrEqual(1);
    const swept = await sql<{ params: Record<string, unknown> }[]>`
      select params from agent_runs
      where lead_id = ${leadId} and kind = 'outreach' and status = 'queued'
    `;
    expect(swept).toHaveLength(1);
    expect(swept[0]!.params.auto).toBeUndefined();
    const mailed = await sql<
      {
        payload: { notBefore?: string; requestedKind?: string; params?: Record<string, unknown> };
      }[]
    >`
      select payload from agent_inbox
      where lead_id = ${leadId} and kind = 'event' and consumed_at is null
    `;
    expect(mailed).toHaveLength(1);
    expect((mailed[0]!.payload.params as Record<string, unknown>).auto).toBeUndefined();
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

  test('a staff-scheduled sweep run carries no auto marker and survives', async () => {
    await migrate(sql, MIGRATIONS);
    // 60-min quiet period parks every reply run — the kicked drain can't
    // claim it mid-assertion, so mailed items stay pending deterministically.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Staff Slot', whatsapp: '5511955550003' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // Deliberate staff scheduling materializes unmarked so a reply can't
    // cancel it; 'auto'-sourced dates are the model's own cadence — marked
    // and disposable like the cadence floor. Legacy 'agent' (the 0025
    // backfill value: self-schedule or asked callback, unrecoverably mixed)
    // takes the preserved side — unmarked, surviving.
    await sql`
      update leads set next_action_at = now() - interval '1 hour',
                       next_action_source = 'staff'
      where id = ${leadId}
    `;
    const autoLead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Auto Slot', whatsapp: '5511955550004' }),
    );
    await sql`
      update leads set next_action_at = now() - interval '1 hour',
                       next_action_source = 'auto'
      where id = ${autoLead.body.lead.id}
    `;
    const legacyLead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Legacy Slot', whatsapp: '5511955550005' }),
    );
    await sql`
      update leads set next_action_at = now() - interval '1 hour',
                       next_action_source = 'agent'
      where id = ${legacyLead.body.lead.id}
    `;
    // Materialized rows are due the instant the sweep commits — a drain
    // still in flight from an earlier ingest (ingestInbound kicks one
    // fire-and-forget) could claim a run in the gap before the park lands
    // and turn a 'canceled' assertion into 'running'. The claim's own
    // serialization point closes that: hold each lead's `claimrun:`
    // advisory across sweep+park so every same-lead claim rejects at its
    // pg_try_, then unlock — the rows stay parked 'queued' for the rest of
    // the test. sweepOutreach only tries `capfin:`, so it materializes
    // unaffected.
    const leadIds = [leadId, autoLead.body.lead.id, legacyLead.body.lead.id];
    let swept: { id: string; lead_id: string; params: Record<string, unknown> }[] = [];
    let autoSwept: { id: string; lead_id: string; params: Record<string, unknown> }[] = [];
    let legacySwept: { id: string; lead_id: string; params: Record<string, unknown> }[] = [];
    const gate = await sql.reserve();
    try {
      for (const id of leadIds) await gate`select pg_advisory_lock(hashtext(${'claimrun:' + id}))`;
      expect(await sweepOutreach(sql)).toBeGreaterThanOrEqual(3);
      // Park + fetch in one statement — no cross-statement window left
      // for a late claim to slip into after the advisory releases.
      const parked = await sql<{ id: string; lead_id: string; params: Record<string, unknown> }[]>`
        update agent_runs set run_at = now() + interval '1 hour'
        where kind = 'outreach' and status = 'queued'
          and lead_id in ${sql(leadIds)}
        returning id, lead_id, params
      `;
      swept = parked.filter((r) => r.lead_id === leadId);
      autoSwept = parked.filter((r) => r.lead_id === autoLead.body.lead.id);
      legacySwept = parked.filter((r) => r.lead_id === legacyLead.body.lead.id);
    } finally {
      await gate`select pg_advisory_unlock_all()`;
      gate.release();
    }
    expect(swept).toHaveLength(1);
    expect(swept[0]!.params.auto).toBeUndefined();
    expect(autoSwept).toHaveLength(1);
    expect(autoSwept[0]!.params.auto).toBe('auto');
    expect(legacySwept).toHaveLength(1);
    // Provenance unrecoverable → preserved: the run carries no auto marker
    // so a reply can't cancel the possible promise.
    expect(legacySwept[0]!.params.auto).toBeUndefined();
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550003@s.whatsapp.net',
      body: 'oi',
      providerMessageId: `fx10c-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${swept[0]!.id}
    `;
    expect(r!.status).not.toBe('canceled');
    // The 'auto' nudge is disposable: canceled on the lead's own inbound,
    // and the unswept date clears the same way.
    const res2 = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550004@s.whatsapp.net',
      body: 'oi',
      providerMessageId: `fx10d-${crypto.randomUUID()}`,
    });
    if ('ignored' in res2) throw new Error('unexpected ignore');
    const [ar] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${autoSwept[0]!.id}
    `;
    // The disposable 'auto' nudge retires with the drafts — a queued run
    // can never drain the mail (drainInbox only runs inside an executing
    // run) and would fire stale copy before the quiet period ends. The
    // reply run takes over and carries the item. The date itself was
    // already cleared at materialization.
    expect(ar!.status).toBe('canceled');
    const autoMail = await sql`select 1 from agent_inbox
      where lead_id = ${autoLead.body.lead.id} and kind = 'inbound' and consumed_at is null`;
    expect(autoMail).toHaveLength(1);
    const autoReply = await sql`select 1 from agent_runs
      where lead_id = ${autoLead.body.lead.id} and kind = 'reply'`;
    expect(autoReply).toHaveLength(1);
    const autoDate = await sql<{ next_action_at: Date | null }[]>`
      select next_action_at from leads where id = ${autoLead.body.lead.id}
    `;
    expect(autoDate[0]!.next_action_at).toBeNull();
    // The legacy 'agent' run survives the reply — its unmarked materialization
    // can't be canceled; and a still-pending 'agent' date isn't cleared either:
    // clearing could delete a callback the lead itself asked for.
    await sql`
      update leads set next_action_at = now() + interval '2 days',
                       next_action_source = 'agent'
      where id = ${legacyLead.body.lead.id}
    `;
    const res3 = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550005@s.whatsapp.net',
      body: 'oi',
      providerMessageId: `fx10e-${crypto.randomUUID()}`,
    });
    if ('ignored' in res3) throw new Error('unexpected ignore');
    const [lr] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${legacySwept[0]!.id}
    `;
    expect(lr!.status).not.toBe('canceled');
    const legacyDate = await sql<{ next_action_source: string | null }[]>`
      select next_action_source from leads where id = ${legacyLead.body.lead.id}
    `;
    expect(legacyDate[0]!.next_action_source).toBe('agent');
  });

  test('autonomy-off stalls only the model’s own sweep — promised work still materializes', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('agent_autonomy', ${sql.json({ level: 'off' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      const promised = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Asked Back', whatsapp: '5511955550013' }),
      );
      const promisedId = promised.body.lead.id;
      await sql`
        update leads set next_action_at = now() - interval '1 hour',
                         next_action_source = 'requested'
        where id = ${promisedId}
      `;
      const auto = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Auto Cadence', whatsapp: '5511955550014' }),
      );
      await sql`
        update leads set next_action_at = now() - interval '1 hour',
                         next_action_source = 'auto'
        where id = ${auto.body.lead.id}
      `;
      await sql`delete from agent_runs where status = 'queued'`;
      // A queued auto outreach parked under 'off' can never claim — the
      // promised date retires it so insertRun mints a runnable owner.
      const parked = (await enqueueRun(sql, {
        kind: 'outreach',
        leadId: promisedId,
        params: { auto: 'first-contact' },
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
      // The model's own due wakeup is parked by the same switch — it must
      // NOT fold its focus into the allowed promised run (that would let a
      // parked intent ride work it didn't schedule).
      await sql`
        insert into agent_wakeups (lead_id, kind, at, focus, created_by, requested, status)
        values (${promisedId}, 'outreach', now() - interval '1 minute',
                'sondagem de cadência', 'agent', false, 'pending')
      `;
      expect(await sweepOutreach(sql)).toBeGreaterThanOrEqual(1);
      const [pr] = await sql<{ status: string }[]>`
        select status from agent_runs where id = ${parked}
      `;
      expect(pr!.status).toBe('canceled');
      const [released] = await sql<{ consumed_at: Date | null }[]>`
        select consumed_at from agent_inbox
        where lead_id = ${promisedId} and kind = 'staff'
      `;
      expect(released!.consumed_at).toBeNull();
      // The lead-asked callback fires unmarked — a promise outranks the
      // workspace switch the same way a staff decision does.
      const swept = await sql<{ id: string; params: Record<string, unknown> }[]>`
        select id, params from agent_runs
        where lead_id = ${promisedId} and kind = 'outreach' and status = 'queued'
      `;
      expect(swept).toHaveLength(1);
      expect(swept[0]!.id).not.toBe(parked);
      expect(swept[0]!.params.auto).toBeUndefined();
      // The wakeup stayed pending for its own sweep's gate — no fold.
      expect(swept[0]!.params.focus).toBeUndefined();
      const [wk] = await sql<{ status: string }[]>`
        select status from agent_wakeups where lead_id = ${promisedId}
      `;
      expect(wk!.status).toBe('pending');
      // …while the model's own cadence nudge parks under autonomy 'off'.
      const skipped = await sql`
        select 1 from agent_runs where lead_id = ${auto.body.lead.id}
      `;
      expect(skipped).toHaveLength(0);
    } finally {
      await sql`delete from control_settings where key = 'agent_autonomy'`;
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
