import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { digestReportTx } from '../src/modules/discord/digest.ts';
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
  test('the email digest is retired: the daily summary is set in settings.discord', () => {
    expect(code(() => validateSetting('digest', { enabled: true, to: 'staff@vendua.app' }))).toBe(
      'BAD_REQUEST',
    );
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
});
