import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { crmBench, type ToolOutcome } from './crm-harness.ts';
import { channelHealth, recordBlockedSendTx } from '../src/modules/channel-health.ts';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { insertLeadTx, segmentStats } from '../src/modules/leads.ts';
import { migrate, type Sql } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
const dataOf = <T>(o: ToolOutcome | undefined): T => (o as { data: T }).data;

describe.skipIf(!process.env.TEST_DATABASE_URL)('channel health (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);

  const seedMessages = async (channel: string, statuses: string[]) =>
    controlTx(sql, async (tx) => {
      const lead = await insertLeadTx(tx, { name: `Health ${channel} ${statuses.length}` });
      const leadId = lead.body.lead.id;
      const thread = (
        await tx<{ id: string }[]>`
          insert into lead_threads (lead_id, channel) values (${leadId}, ${channel})
          returning id
        `
      )[0]!;
      for (const status of statuses) {
        await tx`
          insert into lead_messages (thread_id, direction, author, body, status)
          values (${thread.id}, 'out', 'agent', 'msg', ${status})
        `;
      }
      return leadId;
    });

  const base = (rows: Awaited<ReturnType<typeof channelHealth>>) => {
    const wa = rows.find((r) => r.channel === 'whatsapp')!;
    const em = rows.find((r) => r.channel === 'email')!;
    return { wa, em };
  };

  test('rollup counts sends, failures, blocks and bounces per channel', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const before = base(await channelHealth(sql));

    await seedMessages('whatsapp', ['sent', 'sent', 'sent', 'sent', 'failed', 'failed']);
    const emailLead = await seedMessages('email', ['sent']);
    await controlTx(sql, async (tx) => {
      await recordBlockedSendTx(tx, emailLead, 'email', 'quiet hours');
      await recordBlockedSendTx(tx, emailLead, 'email', 'quiet hours');
      await recordBlockedSendTx(tx, emailLead, 'email', 'daily cap reached');
      await tx`update leads set email_bounced_at = now() where id = ${emailLead}`;
    });

    const { wa, em } = base(await channelHealth(sql));
    expect(wa.sent).toBe(before.wa.sent + 4);
    expect(wa.failed).toBe(before.wa.failed + 2);
    // 4 sent + 2 failed just seeded → rate crosses the 20% alert bar
    expect(wa.alert).toBe(true);
    expect(em.sent).toBe(before.em.sent + 1);
    expect(em.blocked).toBe(before.em.blocked + 3);
    expect(em.blockedByReason['quiet hours']).toBe(
      (before.em.blockedByReason['quiet hours'] ?? 0) + 2,
    );
    expect(em.bounced).toBe(before.em.bounced + 1);
    // one send, no failures → no alert from a single quiet channel
    expect(em.alert).toBe(before.em.alert);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('send_message on Runtime v3 (db)', () => {
  const b = crmBench('channel-health');
  const { sql } = b;

  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => b.mine.clear());

  /** A quiet window centered on now (guardrails tz) — deterministic regardless of when the
   *  suite runs ('00:00–23:59' would leave a one-minute hole) */
  const quietWindow = () => {
    const h =
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          hour12: false,
        }).format(new Date()),
      ) % 24;
    const hh = (n: number) => String(n).padStart(2, '0');
    return { quietStart: `${hh((h + 23) % 24)}:00`, quietEnd: `${hh((h + 1) % 24)}:59` };
  };

  /** Email goes out through the log driver, so a lead with an address can be reached by it. */
  const emailLive = () =>
    upsertIntegration(
      sql as unknown as Sql,
      { kind: 'email', driver: 'log', enabled: true },
      b.key(),
    );

  test('send_message under quiet hours writes a blocked activity', async () => {
    await emailLive();
    // autopilot: first contact isn't draft-forced, so quiet hours decide
    await b.settings('autopilot', { quietHoursEnabled: true, ...quietWindow() });
    const lead = await b.lead({ whatsapp: null, email: 'quiet@test.dev' });
    const { outcomes } = await b.runTools([['send_message', { body: 'oi' }]], {
      leadId: lead.id,
      kind: 'reply',
    });
    const out = dataOf<{ blocked: boolean; reason?: string }>(outcomes[0]);
    expect(out.blocked).toBe(true);
    expect(out.reason).toBe('quiet hours');
    const acts = await sql<{ kind: string; meta: { channel: string; reason: string } }[]>`
      select kind, meta from lead_activities where lead_id = ${lead.id} and kind = 'blocked'`;
    expect(acts.length).toBe(1);
    expect(acts[0]!.meta).toEqual({ channel: 'email', reason: 'quiet hours' });
  });

  test('send_message with draftOnly composes a draft even under quiet hours', async () => {
    await emailLive();
    await b.settings('autopilot', { quietHoursEnabled: true, ...quietWindow() });
    // drafts never leave the building, so draft-only runs skip delivery gates
    // (quiet hours/caps apply at the approval click)
    const lead = await b.lead({ whatsapp: null, email: 'quiet-draft@test.dev' });
    const { outcomes } = await b.runTools([['send_message', { body: 'oi' }]], {
      leadId: lead.id,
      kind: 'outreach',
      payload: { draftOnly: true },
    });
    expect(dataOf<{ message: { status: string } }>(outcomes[0]).message.status).toBe('draft');
    const acts = await sql<{ kind: string }[]>`
      select kind from lead_activities where lead_id = ${lead.id} and kind = 'blocked'`;
    expect(acts.length).toBe(0);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('segment CPL (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);

  test('cplCents = 30d spend ÷ leads30d, including discovery-run spend', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // prior runs' cpl-seg rows can squeeze this segment out of the top-12
    // rollup nondeterministically — drop the class (cascades) before seeding
    await sql`delete from leads where segment like 'cpl-seg-%' or segment like 'cpl-old-%'`;
    const seg = `cpl-seg-${Date.now()}`;
    const lead = await controlTx(sql, async (tx) => {
      const l = await insertLeadTx(tx, { name: 'CPL Lead', segment: seg });
      // lead-bound turn spend + a discovery turn attributed via params.segment
      await tx`
        insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status,
          started_at, cost_cents)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'crm', 'reply', 'whatsapp',
          ${l.body.lead.id}, 'done', now(), 300)
      `;
      await tx`
        insert into crm_turns (turn_id, actor_id, agent_id, kind, source, status, started_at,
          cost_cents, params)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'crm-discovery', 'discovery',
          'staff:ops', 'done', now(), 700, ${tx.json({ segment: seg } as never)})
      `;
      // A replied lead outranks every unreplied segment in the top-12
      // rollup (order: replied desc, leads desc) — a 1-lead segment
      // otherwise ties last and falls off the limit once enough test
      // segments accumulate.
      const [t] = await tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${l.body.lead.id}, 'manual') returning id
      `;
      await tx`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${t!.id}, 'in', 'lead', 'oi', 'received')
      `;
      return l;
    });
    expect(lead.body.lead.id).toBeTruthy();
    const row = (await segmentStats(sql)).find((s) => s.segment === seg)!;
    expect(row.leads).toBe(1);
    expect(row.leads30d).toBe(1);
    expect(row.costCents).toBe(1000);
    expect(row.cplCents).toBe(1000);
  });

  test('a segment with no leads in 30d reports cpl null, not 0', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await sql`delete from leads where segment like 'cpl-seg-%' or segment like 'cpl-old-%'`;
    const seg = `cpl-old-${Date.now()}`;
    await controlTx(sql, async (tx) => {
      const l = await insertLeadTx(tx, { name: 'Old Lead', segment: seg });
      await tx`update leads set created_at = now() - interval '60 days' where id = ${l.body.lead.id}`;
      // same top-12 cutoff guard as the CPL case above
      const [t] = await tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${l.body.lead.id}, 'manual') returning id
      `;
      await tx`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${t!.id}, 'in', 'lead', 'oi', 'received')
      `;
    });
    const row = (await segmentStats(sql)).find((s) => s.segment === seg)!;
    expect(row.leads30d).toBe(0);
    expect(row.cplCents).toBeNull();
  });
});
