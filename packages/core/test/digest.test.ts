import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { digestReportTx, digestText, sweepDigest } from '../src/modules/digest.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('validateSetting digest', () => {
  test('accepts the digest shape', () => {
    expect(
      validateSetting('digest', { enabled: true, to: 'staff@vendua.app', hour: 8 }),
    ).toBeUndefined();
    expect(validateSetting('digest', {})).toBeUndefined();
    expect(validateSetting('digest', { to: '' })).toBeUndefined();
  });

  test('rejects bad shapes', () => {
    expect(code(() => validateSetting('digest', 'x'))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', []))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { enabled: 'yes' }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { hour: 24 }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { hour: -1 }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { hour: 8.5 }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { to: 'not-an-email' }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { to: ' pad@x.com ' }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { enabled: true }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('digest', { enabled: true, to: '' }))).toBe('BAD_REQUEST');
  });
});

describe('digestText', () => {
  test('renders the rollup as pt-BR lines', () => {
    const { subject, body } = digestText({
      date: '2026-09-22',
      newLeads: 4,
      repliesIn: 2,
      meetingsBooked: 1,
      meetingsNext24h: 1,
      agentRuns: 9,
      costCents: 12345,
      pendingDrafts: 3,
      openTasks: 7,
    });
    expect(subject).toContain('2026-09-22');
    expect(body).toContain('leads novos: 4');
    expect(body).toContain('respostas recebidas: 2');
    expect(body).toContain('calls marcadas: 1');
    expect(body).toContain('custo R$ 123,45');
    expect(body).toContain('rascunhos aguardando aprovação: 3');
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('digest (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);

  test('digestReportTx counts the 24h window', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Digest Lead' }));
    const leadId = lead.body.lead.id;
    const report = await controlTx(sql, async (tx) => {
      await tx`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'email')
      `;
      const thread = (
        await tx<{ id: string }[]>`
          select id from lead_threads where lead_id = ${leadId} and channel = 'email'
        `
      )[0]!;
      await tx`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${thread.id}, 'in', 'lead', 'oi', 'received')
      `;
      await tx`
        insert into meetings (lead_id, starts_at, ends_at, source)
        values (${leadId}, now() + interval '6 hours', now() + interval '7 hours', 'agent')
      `;
      await tx`
        insert into agent_runs (kind, lead_id, status, cost_cents, tokens_in, tokens_out)
        values ('reply', ${leadId}, 'done', 150, 10, 10)
      `;
      return digestReportTx(tx, 'hoje');
    });
    expect(report.date).toBe('hoje');
    expect(report.newLeads).toBeGreaterThanOrEqual(1);
    expect(report.repliesIn).toBeGreaterThanOrEqual(1);
    expect(report.meetingsBooked).toBeGreaterThanOrEqual(1);
    expect(report.meetingsNext24h).toBeGreaterThanOrEqual(1);
    expect(report.agentRuns).toBeGreaterThanOrEqual(1);
    expect(report.costCents).toBeGreaterThanOrEqual(150);
  });

  test('sweepDigest claims once, sends via the log driver, then no-ops', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await controlTx(sql, async (tx) => {
      await tx`delete from control_settings where key in ('digest_state')`;
      await tx`
        insert into control_settings (key, value) values
          ('digest', ${tx.json({ enabled: true, to: 'staff@vendua.app', hour: 0 } as never)}),
          ('guardrails', ${tx.json({ timezone: 'America/Sao_Paulo' } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      await tx`
        insert into control_integrations (kind, driver, enabled)
        values ('email', 'log', true)
        on conflict (kind, driver) do update set enabled = true
      `;
    });
    expect(await sweepDigest(sql)).toBe(true);
    // the day is claimed — a second tick in the same minute can't resend
    expect(await sweepDigest(sql)).toBe(false);
    const state = await controlTx(
      sql,
      (tx) =>
        tx<{ value: { status: string } }[]>`
          select value from control_settings where key = 'digest_state'
        `,
    );
    expect(state[0]!.value.status).toBe('sent');
  });

  test('disabled config never claims', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await controlTx(sql, async (tx) => {
      await tx`delete from control_settings where key in ('digest_state', 'digest')`;
    });
    expect(await sweepDigest(sql)).toBe(false);
    const rows = await controlTx(
      sql,
      (tx) => tx`select 1 from control_settings where key = 'digest_state'`,
    );
    expect(rows.length).toBe(0);
  });
});
