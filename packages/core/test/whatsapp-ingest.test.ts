import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/crm/inbound.ts';
import { lidPnPair, resolveDmJid, whatsappRegistered } from '../src/crm/channels/whatsapp.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { scheduleTimerTx, setNextActionTx } from '../src/crm/agenda.ts';
import { CRM_AGENT_ID, LEAD_SUBJECT, requestLeadTx } from '../src/crm/dispatch.ts';
import { adoptLidMappings, composeMessageTx } from '../src/modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_WHATSAPP_HISTORY,
  phoneIsIgnored,
  validateSetting,
  whatsappHistoryOf,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { subscribeControlEvents, type ControlEvent } from '../src/modules/control-events.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';
import { call, crmBench } from './crm-harness.ts';

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

describe('settings — whatsapp_history', () => {
  test('defaults keep the original import-everything behavior', () => {
    expect(whatsappHistoryOf(null)).toEqual(DEFAULT_WHATSAPP_HISTORY);
    expect(DEFAULT_WHATSAPP_HISTORY).toEqual({ mode: 'leads', maxAgeDays: 0, leadMode: 'inbound' });
  });

  test('bad stored fields fall back field by field', () => {
    expect(whatsappHistoryOf({ mode: 'nope', maxAgeDays: -3, leadMode: 'off' })).toEqual({
      mode: 'leads',
      maxAgeDays: 0,
      leadMode: 'off',
    });
    expect(whatsappHistoryOf({ mode: 'existing', maxAgeDays: 30 })).toMatchObject({
      mode: 'existing',
      maxAgeDays: 30,
    });
  });

  test('validateSetting guards every field', () => {
    expect(() =>
      validateSetting('whatsapp_history', { mode: 'off', maxAgeDays: 90, leadMode: 'draft' }),
    ).not.toThrow();
    expect(() => validateSetting('whatsapp_history', {})).not.toThrow();
    expect(() => validateSetting('whatsapp_history', [])).toThrow();
    expect(() => validateSetting('whatsapp_history', { mode: 'all' })).toThrow();
    expect(() => validateSetting('whatsapp_history', { leadMode: 'auto' })).toThrow();
    expect(() => validateSetting('whatsapp_history', { maxAgeDays: 1.5 })).toThrow();
    expect(() => validateSetting('whatsapp_history', { maxAgeDays: 99999 })).toThrow();
    expect(() => validateSetting('whatsapp_history', { extra: 1 })).toThrow();
  });
});

describe('whatsapp LID → phone resolution', () => {
  const none = async () => null;

  test('lidPnPair orders the pair and strips device suffixes', () => {
    expect(lidPnPair('5511999990000:3@s.whatsapp.net', '123456789012345:3@lid')).toEqual({
      lid: '123456789012345@lid',
      pn: '5511999990000@s.whatsapp.net',
    });
    expect(lidPnPair('1@lid', '2@lid')).toBeNull();
    expect(lidPnPair('1@g.us', '5511999990000@s.whatsapp.net')).toBeNull();
  });

  test('remoteJidAlt wins without a lookup', async () => {
    const dm = await resolveDmJid('123456789012345@lid', '5511999990000@s.whatsapp.net', () => {
      throw new Error('lookup must not run');
    });
    expect(dm).toEqual({ jid: '5511999990000@s.whatsapp.net', alias: '123456789012345@lid' });
  });

  test('a LID-only DM resolves through the lookup to the real number', async () => {
    const dm = await resolveDmJid('123456789012345@lid', undefined, async (lid) =>
      lid === '123456789012345@lid' ? '5511999990000:0@s.whatsapp.net' : null,
    );
    expect(dm).toEqual({ jid: '5511999990000@s.whatsapp.net', alias: '123456789012345@lid' });
  });

  test('an unresolvable LID stays the jid; groups and PN DMs pass through', async () => {
    expect(await resolveDmJid('123456789012345@lid', undefined, none)).toEqual({
      jid: '123456789012345@lid',
    });
    expect(await resolveDmJid('1203630@g.us', undefined, none)).toBeNull();
    expect(await resolveDmJid('5511999990000@s.whatsapp.net', undefined, none)).toEqual({
      jid: '5511999990000@s.whatsapp.net',
    });
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

  const setHistory = (v: Record<string, unknown>) =>
    sql`
      insert into control_settings (key, value) values ('whatsapp_history', ${sql.json(v as never)})
      on conflict (key) do update set value = excluded.value
    `;
  const freshJid = () =>
    `55119${crypto.randomUUID().replace(/\D/g, '').slice(0, 8)}@s.whatsapp.net`;
  const leadsFor = (jid: string) => sql<{ agent_mode: string }[]>`
    select agent_mode from leads
    where regexp_replace(coalesce(whatsapp,''),'\\D','','g') = ${jid.replace(/\D/g, '')}
  `;
  type MailRow = {
    id: string;
    kind: string;
    source: string;
    payload: Record<string, unknown>;
    consumed_by_turn: string | null;
  };
  /** The lead's agenda and inbox: its `crm` actor's mailbox, oldest first, consumed rows included. */
  const mailOf = (leadId: string) => sql<MailRow[]>`
    select m.id, m.kind, m.source, m.payload, m.consumed_by_turn
    from agent_mailbox m join agent_actors a on a.id = m.actor_id
    where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
      and a.subject_kind = ${LEAD_SUBJECT} and a.subject_id = ${leadId}
    order by m.created_at
  `;
  /** Mail no turn has taken yet. */
  const waitingOf = async (leadId: string) =>
    (await mailOf(leadId)).filter((m) => m.consumed_by_turn === null);
  /** A finished turn took the lead's pending mail of this kind. */
  const consumeKind = (leadId: string, kind: string, turn: string) => sql`
    update agent_mailbox m set consumed_by_turn = ${turn}
    from agent_actors a
    where a.id = m.actor_id and a.subject_id = ${leadId} and m.kind = ${kind}
      and m.consumed_by_turn is null
  `;

  afterEach(async () => {
    await sql`delete from control_settings where key in ('guardrails', 'whatsapp_history')`;
  });

  test("whatsapp_history 'off' drops the import; live messages still land", async () => {
    await migrate(sql, MIGRATIONS);
    await setHistory({ mode: 'off' });
    const jid = freshJid();
    const hist = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: jid,
      body: 'conversa antiga',
      providerMessageId: `wh-off-1-${pmRun}`,
      historical: true,
    });
    expect(hist).toEqual({ ignored: 'histórico do whatsapp desligado' });
    expect(await leadsFor(jid)).toHaveLength(0);
    const live = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: jid,
      body: 'oi, agora ao vivo',
      providerMessageId: `wh-off-2-${pmRun}`,
    });
    expect('ignored' in live).toBe(false);
  });

  test("whatsapp_history 'existing' attaches to known leads only", async () => {
    await migrate(sql, MIGRATIONS);
    await setHistory({ mode: 'existing' });
    const unknown = freshJid();
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: unknown,
      body: 'contato desconhecido',
      providerMessageId: `wh-ex-1-${pmRun}`,
      historical: true,
    });
    expect(res).toEqual({ ignored: 'histórico de contato sem lead' });
    expect(await leadsFor(unknown)).toHaveLength(0);

    const known = freshJid();
    const live = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: known,
      body: 'oi',
      providerMessageId: `wh-ex-2-${pmRun}`,
    });
    if ('ignored' in live) throw new Error('unexpected ignore');
    const hist = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: known,
      body: 'mensagem da semana passada',
      providerMessageId: `wh-ex-3-${pmRun}`,
      historical: true,
    });
    if ('ignored' in hist) throw new Error('known lead should take history');
    expect(hist.leadId).toBe(live.leadId);
    expect(hist.leadCreated).toBe(false);
  });

  test('whatsapp_history maxAgeDays skips old messages, keeps recent ones', async () => {
    await migrate(sql, MIGRATIONS);
    await setHistory({ maxAgeDays: 30 });
    const jid = freshJid();
    const old = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: jid,
      body: 'de dois meses atrás',
      providerMessageId: `wh-age-1-${pmRun}`,
      historical: true,
      sentAt: new Date(Date.now() - 60 * 86_400_000),
    });
    expect(old).toEqual({ ignored: 'histórico com mais de 30 dias' });
    expect(await leadsFor(jid)).toHaveLength(0);
    const recent = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: jid,
      body: 'de ontem',
      providerMessageId: `wh-age-2-${pmRun}`,
      historical: true,
      sentAt: new Date(Date.now() - 86_400_000),
    });
    expect('ignored' in recent).toBe(false);
  });

  test('whatsapp_history leadMode sets the agent mode of history-minted leads', async () => {
    await migrate(sql, MIGRATIONS);
    await setHistory({ leadMode: 'off' });
    const jid = freshJid();
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from: jid,
      body: 'amigo antigo',
      providerMessageId: `wh-lm-1-${pmRun}`,
      historical: true,
    });
    expect((await leadsFor(jid))[0]?.agent_mode).toBe('off');
    // a live message minting a lead still follows agent.newLeadMode
    const live = freshJid();
    await ingestInbound(sql, {
      channel: 'whatsapp',
      from: live,
      body: 'oi',
      providerMessageId: `wh-lm-2-${pmRun}`,
    });
    expect((await leadsFor(live))[0]?.agent_mode).not.toBe('off');
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
    expect(await mailOf(res.leadId)).toHaveLength(0);
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
    expect(await mailOf(res.leadId)).toHaveLength(0);
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

  test('adoptLidMappings re-keys a LID lead onto the phone jid, never onto a taken number', async () => {
    await migrate(sql, MIGRATIONS);
    const rnd = () => crypto.randomUUID().replace(/\D/g, '').padEnd(12, '7').slice(0, 12);
    const lid = `9${rnd()}00`;
    const pn = `55119${rnd().slice(0, 8)}`;
    const first = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${lid}@lid`,
      body: 'oi, vim pelo lid',
      providerMessageId: `lid-rekey-1-${pmRun}`,
      historical: true,
    });
    if ('ignored' in first) throw new Error('unexpected ignore');
    const [lidRow] = await sql<{ whatsapp: string }[]>`
      select whatsapp from leads where id = ${first.leadId}
    `;
    expect(lidRow!.whatsapp).toBe(`${lid}@lid`);
    const ids = await adoptLidMappings(sql, [
      { lid: `${lid}:2@lid`, pn: `${pn}:2@s.whatsapp.net` },
    ]);
    expect(ids).toEqual([first.leadId]);
    const [row] = await sql<{ whatsapp: string }[]>`
      select whatsapp from leads where id = ${first.leadId}
    `;
    expect(row!.whatsapp).toBe(`+${pn}`);
    // later PN-addressed messages converge on the same lead
    const again = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${pn}@s.whatsapp.net`,
      body: 'agora pelo número',
      providerMessageId: `lid-rekey-2-${pmRun}`,
      historical: true,
    });
    if ('ignored' in again) throw new Error('unexpected ignore');
    expect(again.leadId).toBe(first.leadId);

    // a second LID lead whose number is already owned stays put
    const lid2 = `8${rnd()}00`;
    const dup = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${lid2}@lid`,
      body: 'outro lid',
      providerMessageId: `lid-rekey-3-${pmRun}`,
      historical: true,
    });
    if ('ignored' in dup) throw new Error('unexpected ignore');
    expect(
      await adoptLidMappings(sql, [{ lid: `${lid2}@lid`, pn: `${pn}@s.whatsapp.net` }]),
    ).toEqual([]);
  });

  test('a phone-jid inbound stores the lead number as +E.164, not the jid', async () => {
    await migrate(sql, MIGRATIONS);
    const pn = `55119${crypto.randomUUID().replace(/\D/g, '').slice(0, 8)}`;
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${pn}@s.whatsapp.net`,
      body: 'oi',
      providerMessageId: `pn-store-1-${pmRun}`,
      historical: true,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [row] = await sql<{ whatsapp: string; name: string }[]>`
      select whatsapp, name from leads where id = ${res.leadId}
    `;
    expect(row).toEqual({ whatsapp: `+${pn}`, name: `+${pn}` });
  });

  test('a burst from a new number mints one lead, not one per message', async () => {
    await migrate(sql, MIGRATIONS);
    const jid = freshJid();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        ingestInbound(sql, {
          channel: 'whatsapp',
          from: jid,
          body: `oi ${i}`,
          providerMessageId: `burst-new-${i}-${pmRun}`,
        }),
      ),
    );
    const ids = new Set(results.map((r) => ('ignored' in r ? null : r.leadId)));
    expect(ids.size).toBe(1);
    expect(await leadsFor(jid)).toHaveLength(1);
    expect(results.filter((r) => !('ignored' in r) && r.leadCreated)).toHaveLength(1);
  });

  test('a BR mobile matches its lead across the 9th digit, both ways', async () => {
    await migrate(sql, MIGRATIONS);
    const sub = `8${crypto.randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const withNine = `55219${sub}`;
    const typed = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: `Nono ${pmRun}`, whatsapp: `+55 21 ${sub}` }),
    ).then((r) => r.body.lead.id);
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `${withNine}@s.whatsapp.net`,
      body: 'oi',
      providerMessageId: `nono-1-${pmRun}`,
      historical: true,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    expect(res.leadId).toBe(typed);
    expect(res.leadCreated).toBe(false);

    // a lead in the 9 form, a burst in both forms: one lock, one lead
    const sub2 = `9${crypto.randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const burst = await Promise.all(
      [`55319${sub2}`, `5531${sub2}`, `55319${sub2}`, `5531${sub2}`].map((n, i) =>
        ingestInbound(sql, {
          channel: 'whatsapp',
          from: `${n}@s.whatsapp.net`,
          body: `oi ${i}`,
          providerMessageId: `nono-burst-${i}-${pmRun}`,
          historical: true,
        }),
      ),
    );
    const ids = new Set(burst.map((r) => ('ignored' in r ? null : r.leadId)));
    expect(ids.size).toBe(1);
    expect(ids.has(null)).toBe(false);
  });

  test('a 9 + landline-looking number is not matched to that landline', async () => {
    await migrate(sql, MIGRATIONS);
    const sub = `3${crypto.randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const landline = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: `Fixo ${pmRun}`, phone: `+55 41 ${sub}` }),
    ).then((r) => r.body.lead.id);
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `55419${sub}@s.whatsapp.net`,
      body: 'oi',
      providerMessageId: `nono-fixo-${pmRun}`,
      historical: true,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    expect(res.leadId).not.toBe(landline);
  });

  test('whatsappRegistered degrades to null with no live socket', async () => {
    // No baileys socket runs in tests — the probe must answer "can't tell",
    // never crash and never a false negative that would un-verify a number.
    expect(await whatsappRegistered('5511999990000')).toBeNull();
  });

  test('a fresh inbound retires the queued auto outreach — the reply takes over', async () => {
    // 60-min quiet period on the reply: the inbound's mail is what this test reads
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Replier', whatsapp: '5511955550001', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    // the agent's cadence and its first contact wait; a staff date and a lead's callback are promises
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${leadId}`,
      }),
    );
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, leadId, new Date(Date.now() + 4 * 86_400_000), 'staff'),
    );
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, leadId, new Date(Date.now() + 3 * 86_400_000), 'requested'),
    );
    await controlTx(sql, (tx) =>
      scheduleTimerTx(tx, {
        leadId,
        at: new Date(Date.now() + 2 * 86_400_000),
        focus: 'retomar a conversa',
        requested: false,
        by: 'agent',
      }),
    );
    expect((await waitingOf(leadId)).map((m) => m.kind).sort()).toEqual([
      'lead.first_contact',
      'timer.callback',
      'timer.callback',
      'timer.followup',
    ]);

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
    // the agent's own cadence and its first contact go; the staff date and the lead's callback stay
    const waiting = await waitingOf(leadId);
    expect(waiting.map((m) => m.kind).sort()).toEqual([
      'message.inbound',
      'timer.callback',
      'timer.callback',
    ]);
    expect(
      waiting
        .filter((m) => m.kind === 'timer.callback')
        .map((m) => m.payload.by)
        .sort(),
    ).toEqual(['agent', 'staff']);
    expect(waiting.find((m) => m.kind === 'message.inbound')!.payload.messageId).toBe(
      res.messageId,
    );
    expect(events.some((e) => e.type === 'run.update' && e.ref === leadId)).toBe(true);
  });

  test("the inbound still retires the auto run's unapproved drafts", async () => {
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Drafter', whatsapp: '5511955550011', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // a first contact the turn took: its "first contact" draft answers nothing once the lead writes
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${leadId}`,
      }),
    );
    const autoTurn = crypto.randomUUID();
    await consumeKind(leadId, 'lead.first_contact', autoTurn);
    // a staff request the turn took: its draft is staff's own, never superseded
    const staffTurn = crypto.randomUUID();
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind: 'staff.request',
        source: 'staff',
        dedupeKey: `crm:test:ask:${leadId}`,
        payload: { kind: 'reply' },
      }),
    );
    await consumeKind(leadId, 'staff.request', staffTurn);
    const [draft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'oi! vi seu negócio', 'draft', ${autoTurn})
      returning id
    `;
    const [staffDraft] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
      values (${thread!.id}, 'out', 'agent', 'draft da equipe', 'draft', ${staffTurn})
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
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Done Drafter', whatsapp: '5511955550013', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // turns that already took their mail: a first contact, a staff regeneration and a promised callback
    const firstTurn = crypto.randomUUID();
    const regenTurn = crypto.randomUUID();
    const callbackTurn = crypto.randomUUID();
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${leadId}`,
      }),
    );
    await consumeKind(leadId, 'lead.first_contact', firstTurn);
    await controlTx(sql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind: 'staff.regenerate',
        source: 'staff',
        dedupeKey: `crm:test:regen:${leadId}`,
        payload: { draftOnly: true },
      }),
    );
    await consumeKind(leadId, 'staff.regenerate', regenTurn);
    await controlTx(sql, (tx) =>
      scheduleTimerTx(tx, {
        leadId,
        at: new Date(Date.now() + 2 * 86_400_000),
        focus: 'me chama terça',
        requested: true,
        by: 'agent',
      }),
    );
    await consumeKind(leadId, 'timer.callback', callbackTurn);
    // the callback the lead asked for next is still waiting
    await controlTx(sql, (tx) =>
      scheduleTimerTx(tx, {
        leadId,
        at: new Date(Date.now() + 3 * 86_400_000),
        focus: 'me chama na semana que vem',
        requested: true,
        by: 'agent',
      }),
    );
    const insertDraft = async (body: string, turn: string) =>
      (
        await sql<{ id: string }[]>`
          insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
          values (${thread!.id}, 'out', 'agent', ${body}, 'draft', ${turn})
          returning id
        `
      )[0]!.id;
    const firstDraft = await insertDraft('oi! vi seu negócio', firstTurn);
    const regenDraft = await insertDraft('rascunho novo', regenTurn);
    const callbackDraft = await insertDraft('te chamo terça!', callbackTurn);

    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550013@s.whatsapp.net',
      body: 'olá, pode me chamar',
      providerMessageId: `fx10g-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [d] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${firstDraft}
    `;
    expect(d!.status).toBe('rejected');
    expect(d!.error).toBe('lead respondeu');
    // drafts of a regeneration and of a promise survive, as their mail does
    const [rd] = await sql<
      { status: string }[]
    >`select status from lead_messages where id = ${regenDraft}`;
    expect(rd!.status).toBe('draft');
    const [cd] = await sql<
      { status: string }[]
    >`select status from lead_messages where id = ${callbackDraft}`;
    expect(cd!.status).toBe('draft');
    const pendingCallbacks = (await waitingOf(leadId)).filter((m) => m.kind === 'timer.callback');
    expect(pendingCallbacks).toHaveLength(1);
    expect(pendingCallbacks[0]!.payload.requested).toBe(true);
  });

  test('a requested callback survives the inbound reply and fires as a promise', async () => {
    // 60-min quiet period on the reply: it is filed, not answered, within this test
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ inboundReplyDelayMin: 60 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Promised', whatsapp: '5511955550012', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    // "me chama semana que vem" — a requested callback: the reply retires the agent's own
    // follow-ups but can't wipe a lead-asked promise
    const at = new Date(Date.now() + 2 * 86_400_000);
    await controlTx(sql, (tx) => setNextActionTx(tx, leadId, at, 'requested'));
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: '5511955550012@s.whatsapp.net',
      body: 'ah, e também queria saber do frete',
      providerMessageId: `fx10f-${crypto.randomUUID()}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const [l] = await sql<{ next_action_source: string | null; next_action_at: Date | null }[]>`
      select next_action_source, next_action_at from leads where id = ${leadId}
    `;
    expect(l!.next_action_source).toBe('requested');
    expect(Math.abs(l!.next_action_at!.getTime() - at.getTime())).toBeLessThan(1000);
    // the promise is a callback the preset never parks; the reply waits beside it
    const waiting = await waitingOf(leadId);
    expect(waiting.map((m) => m.kind).sort()).toEqual(['message.inbound', 'timer.callback']);
    expect(waiting.find((m) => m.kind === 'timer.callback')!.payload.requested).toBe(true);
    expect(waiting.find((m) => m.kind === 'message.inbound')!.payload.messageId).toBe(
      res.messageId,
    );
  });

  test('staff and requested dates fire as promises that survive a reply; the agent plan retires', async () => {
    const mk = async (name: string, wa: string, who: 'staff' | 'agent' | 'requested') => {
      const l = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name, whatsapp: wa, agent_mode: 'auto' }),
      );
      await controlTx(sql, (tx) =>
        setNextActionTx(tx, l.body.lead.id, new Date(Date.now() + 2 * 86_400_000), who),
      );
      return l.body.lead.id;
    };
    const staffLead = await mk('Staff Slot', '5511955550003', 'staff');
    const autoLead = await mk('Auto Slot', '5511955550004', 'agent');
    const askedLead = await mk('Asked Slot', '5511955550005', 'requested');
    const reply = async (wa: string, tag: string) => {
      const r = await ingestInbound(sql, {
        channel: 'whatsapp',
        from: `${wa}@s.whatsapp.net`,
        body: 'oi',
        providerMessageId: `${tag}-${crypto.randomUUID()}`,
      });
      if ('ignored' in r) throw new Error('unexpected ignore');
    };
    const source = async (leadId: string) =>
      (
        await sql<{ next_action_source: string | null }[]>`
          select next_action_source from leads where id = ${leadId}
        `
      )[0]!.next_action_source;

    await reply('5511955550003', 'fx10c');
    expect(await source(staffLead)).toBe('staff');
    await reply('5511955550005', 'fx10e');
    expect(await source(askedLead)).toBe('requested');
    // the agent's own plan is disposable: the lead's reply retires it, and the reply waits in the mailbox
    await reply('5511955550004', 'fx10d');
    expect(await source(autoLead)).toBeNull();
    expect((await waitingOf(autoLead)).map((m) => m.kind)).toEqual(['message.inbound']);
    // a pending agent date retires on inbound; a requested one stays
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, autoLead, new Date(Date.now() + 2 * 86_400_000), 'agent'),
    );
    await controlTx(sql, (tx) =>
      setNextActionTx(tx, askedLead, new Date(Date.now() + 2 * 86_400_000), 'requested'),
    );
    await reply('5511955550004', 'fx10g');
    await reply('5511955550005', 'fx10h');
    expect(await source(autoLead)).toBeNull();
    expect(await source(askedLead)).toBe('requested');
    const staffTimers = (await waitingOf(staffLead)).filter((m) => m.kind.startsWith('timer.'));
    expect(staffTimers.map((m) => m.payload.by)).toEqual(['staff']);
  });

  test('preset off files no automated first contact; dates still land on the agenda', async () => {
    await sql`
      insert into control_settings (key, value) values ('agent', ${sql.json({ level: 'off' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      const promised = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Asked Back', whatsapp: '5511955550013', agent_mode: 'auto' }),
      );
      const promisedId = promised.body.lead.id;
      const auto = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Auto Cadence', whatsapp: '5511955550014', agent_mode: 'auto' }),
      );
      const autoId = auto.body.lead.id;
      // an automated first contact is never filed under 'off'
      const first = await controlTx(sql, (tx) =>
        requestLeadTx(tx, {
          leadId: promisedId,
          kind: 'lead.first_contact',
          source: 'first_contact',
          dedupeKey: `crm:first_contact:${promisedId}`,
        }),
      );
      expect(first.mailboxId).toBeNull();
      expect(first.parked).toBe('autonomia do agente desligada');
      // a lead-asked callback is a promise: it is filed under 'off' and waits for its date
      const due = new Date(Date.now() - 3_600_000);
      await controlTx(sql, (tx) => setNextActionTx(tx, promisedId, due, 'requested'));
      await controlTx(sql, (tx) => setNextActionTx(tx, autoId, due, 'agent'));
      expect((await waitingOf(promisedId)).map((m) => m.kind)).toEqual(['timer.callback']);
      // the agent's own date is kept too: its turn runs silent under 'off' (crm-agent.test.ts)
      expect((await waitingOf(autoId)).map((m) => m.kind)).toEqual(['timer.followup']);
    } finally {
      await sql`delete from control_settings where key = 'agent'`;
    }
  });

  describe('the cost cap at inbound (db)', () => {
    const b = crmBench('ingest-cap');
    beforeAll(b.setup);
    afterAll(b.teardown);
    beforeEach(() => b.mine.clear());

    test('a capped inbound flags the lead and emits lead.change', async () => {
      await b.settings('autopilot', { leadLifetimeCostCapUsd: 0.01 });
      const l = await b.lead();
      // 5¢ of prior spend against a 1¢ cap
      await b.sql`
        insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status, started_at, cost_cents)
        values (gen_random_uuid(), gen_random_uuid(), 'crm', 'reply', 'whatsapp', ${l.id}, 'done', now(), 5)`;
      const events: ControlEvent[] = [];
      const unsub = subscribeControlEvents((e) => events.push(e));
      try {
        const res = await b.inbound(l.whatsapp!, 'oi, ainda quero');
        expect('ignored' in res).toBe(false);
        const { rt, adapter } = b.runtime([call('send_message', { body: 'não deveria' })]);
        await b.settle(rt);
        // the capped turn makes no model call; its row says why, and the team hears once
        expect(adapter.requests).toHaveLength(0);
        const [t] = (await b.turns(l.id)).slice(-1);
        expect(t!.error).toContain('custo');
        const flags = await b.sql`
          select 1 from lead_activities
          where lead_id = ${l.id} and kind = 'system' and meta->>'type' = 'cost-cap'`;
        expect(flags).toHaveLength(1);
        const tasks = await b.sql`
          select 1 from lead_tasks where lead_id = ${l.id} and title like '%custo do agente%'`;
        expect(tasks).toHaveLength(1);
        const staffEvents = await b.sql`
          select 1 from staff_events where kind = 'agent.cost_cap' and data->>'leadId' = ${l.id}`;
        expect(staffEvents).toHaveLength(1);
        // the flag's task commits with the turn's end: this lead's Tasks view refreshes
        expect(events.some((e) => e.type === 'lead.change' && e.ref === l.id)).toBe(true);
      } finally {
        unsub();
      }
    });
  });
});
