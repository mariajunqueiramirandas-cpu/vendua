import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { ingestInbound } from '../src/agent/inbound.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun, enqueueRun } from '../src/agent/runner.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  phoneIsIgnored,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
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

  test('claimRun skips a lead whose number is ignored', async () => {
    await migrate(sql, MIGRATIONS);
    await setIgnored(['5511999776655']);
    const created = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Ignored Claim', whatsapp: '5511999776655' }),
    );
    const leadId = created.body.lead.id;
    await enqueueRun(sql, { kind: 'outreach', leadId });
    expect(await claimRun(sql)).toBeNull();
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where lead_id = ${leadId}
    `;
    expect(r!.status).toBe('queued');
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
});
