import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { whatsappRegistered } from '../src/agent/channels/whatsapp.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun, enqueueRun, sweepOutreach } from '../src/agent/runner.ts';
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

  test('an inbound burst coalesces onto one queued reply run', async () => {
    await migrate(sql, MIGRATIONS);
    // A delayed inboundReplyDelayMin parks the first run (run_at future —
    // unclaimable), so the coalesce check sees a 'queued' row, not a race.
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
    // One parked run covers both messages — it reads fresh thread at claim,
    // and the latest message earns its own quiet period (run_at slides).
    const queued = await sql<{ id: string; run_at: Date }[]>`
      select id, run_at from agent_runs where thread_id = ${first.threadId} and status = 'queued'
    `;
    expect(queued).toHaveLength(1);
    const slideMs = queued[0]!.run_at.getTime() - Date.now();
    expect(slideMs).toBeGreaterThan(55 * 60_000);
    expect(slideMs).toBeLessThanOrEqual(61 * 60_000);
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
    // A 'running' reply has frozen context — a new message earns a fresh run.
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
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.status === 'queued')).toHaveLength(1);
  });

  test('a staff-queued reply does not absorb a live inbound', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // Staff can park a reply carrying its own intent (draftOnly) — the
    // coalesce check must not treat it as an auto-created inbound run.
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
    // The inbound run lands alongside the staff run instead of being
    // swallowed by it — and a follow-up message coalesces onto the
    // inbound one only.
    expect(queued).toHaveLength(2);
    expect(queued.map((q) => q.params.origin)).toEqual(['staff', 'inbound']);
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'oi de novo',
      providerMessageId: `${mid}-2`,
    });
    const still =
      await sql`select id from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(still).toHaveLength(2);
  });

  test('a legacy unmarked reply does not absorb the next inbound', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    // Replies queued before the origin marker carry params = {} — they're
    // indistinguishable from a plain staff reply, so they never coalesce:
    // the message earns its own marked run instead (a bounded one-time
    // duplicate, not a permanent swallow).
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
    // The legacy row doesn't coalesce — a marked inbound run lands beside it
    const queued =
      await sql`select params from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(queued).toHaveLength(2);
    expect(queued.map((q) => (q.params as { origin?: string }).origin).sort()).toEqual([
      'inbound',
      undefined,
    ]);
    // ...and a follow-up coalesces onto the marked run only — the legacy
    // row stays parked on its own, queued count holds at 2
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from,
      body: 'e aí?',
      providerMessageId: `${mid}-2`,
    });
    const still =
      await sql`select id from agent_runs where thread_id = ${thread!.id} and status = 'queued'`;
    expect(still).toHaveLength(2);
  });

  test('claimRun skips a lead whose number is ignored', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999776655']);
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Ignored Claim', whatsapp: '5511999776655' }),
    );
    const leadId = created.body.lead.id;
    await enqueueRun(sql, { kind: 'outreach', leadId })!;
    expect(await claimRun(sql)).toBeNull();
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where lead_id = ${leadId}
    `;
    expect(r!.status).toBe('queued');
  });

  test('a parked ignored prefix cannot starve the claim queue', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999776600']);
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

  test('a fresh inbound cancels queued AUTO outreach — staff runs survive', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Replier', whatsapp: '5511955550001' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // Automation-queued runs carry params.auto; a staff-dispatched run
    // ({goal} only) is an explicit decision and must outrank the reply.
    // Future-dated so an in-flight drain can't claim them mid-assertion —
    // the cancel predicate keys on 'queued', not on run_at.
    const autoRun = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: { auto: 'cadence' },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    const staffRun = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: { goal: 'negotiation' },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
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
    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from agent_runs where id in (${autoRun}, ${staffRun})
    `;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[autoRun]).toBe('canceled');
    // ingest kicks a fire-and-forget drain that may already have claimed
    // the staff run — 'running' or 'queued', the point is never 'canceled'.
    expect(byId[staffRun]).not.toBe('canceled');
    // The cancel emits run.update per row — otherwise the Runs view keeps
    // showing the retired row as 'queued'.
    expect(events.some((e) => e.type === 'run.update' && e.ref === autoRun)).toBe(true);
  });

  test('a queued regen run survives the inbound cancel', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Regen', whatsapp: '5511955550002' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // Regen is draftOnly composition work staff already approved — the
    // fresh inbound makes its recompose MORE relevant, so it must not die
    // with the disposable autos (its superseded draft has no replacement
    // otherwise).
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
    expect(r!.status).toBe('queued');
  });

  test("the inbound cancel also retires the canceled run's unapproved drafts", async () => {
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
    const staffRun = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: { goal: 'negotiation' },
      runAt: new Date(Date.now() + 3_600_000),
    }))!;
    const [draft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'oi! vi seu negócio', 'draft', ${autoRun})
      returning id
    `;
    // Control: a staff run's draft is staff's own — never superseded.
    const [staffDraft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'draft da equipe', 'draft', ${staffRun})
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
    const [lrun] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${legacyRun!.id}
    `;
    expect(lrun!.status).toBe('queued');
    const [ld] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${legacyDraft!.id}
    `;
    expect(ld!.status).toBe('draft');
  });

  test("a 'requested' callback survives the inbound reply and sweeps unmarked", async () => {
    await migrate(sql, MIGRATIONS);
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
    // callback outranks a later reply exactly like a staff decision.
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
  });

  test('a staff-scheduled sweep run carries no auto marker and survives', async () => {
    await migrate(sql, MIGRATIONS);
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
    expect(await sweepOutreach(sql)).toBeGreaterThanOrEqual(3);
    const swept = await sql<{ id: string; params: Record<string, unknown> }[]>`
      select id, params from agent_runs
      where lead_id = ${leadId} and kind = 'outreach' and status = 'queued'
    `;
    expect(swept).toHaveLength(1);
    expect(swept[0]!.params.auto).toBeUndefined();
    const autoSwept = await sql<{ id: string; params: Record<string, unknown> }[]>`
      select id, params from agent_runs
      where lead_id = ${autoLead.body.lead.id} and kind = 'outreach' and status = 'queued'
    `;
    expect(autoSwept).toHaveLength(1);
    expect(autoSwept[0]!.params.auto).toBe('auto');
    const legacySwept = await sql<{ id: string; params: Record<string, unknown> }[]>`
      select id, params from agent_runs
      where lead_id = ${legacyLead.body.lead.id} and kind = 'outreach' and status = 'queued'
    `;
    expect(legacySwept).toHaveLength(1);
    // Provenance unrecoverable → preserved: the run carries no auto marker
    // so a reply can't cancel the possible promise.
    expect(legacySwept[0]!.params.auto).toBeUndefined();
    // Park all so the first inbound's drain can't claim them mid-assertion.
    await sql`
      update agent_runs set run_at = now() + interval '1 hour'
      where id in (${swept[0]!.id}, ${autoSwept[0]!.id}, ${legacySwept[0]!.id})
    `;
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
    expect(ar!.status).toBe('canceled');
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
