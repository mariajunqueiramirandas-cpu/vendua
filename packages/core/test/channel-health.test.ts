import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { channelHealth, recordBlockedSendTx } from '../src/modules/channel-health.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx, segmentStats } from '../src/modules/leads.ts';
import { executeTool, type ToolContext } from '../src/agent/tools.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
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

  test('send_message under quiet hours writes a blocked activity', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const ctx = (leadId: string): ToolContext => ({
      sql,
      runId: '00000000-0000-4000-8000-000000000001',
      runKind: 'reply',
      leadId,
      threadId: null,
      step: 0,
      claimToken: null,
      pageCache: new Map(),
      briefName: null,
      leadCap: 20,
      channelOverride: null,
      book: new Map(),
      plan: null,
      monid: null,
      seenContacts: new Set(),
      pageReads: 0,
      draftOnly: false,
    });
    // quiet window centered on now (guardrails tz) — deterministic regardless
    // of when the suite runs ('00:00–23:59' would leave a one-minute hole)
    const h =
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          hour12: false,
        }).format(new Date()),
      ) % 24;
    const hh = (n: number) => String(n).padStart(2, '0');
    const quietStart = `${hh((h + 23) % 24)}:00`;
    const quietEnd = `${hh((h + 1) % 24)}:59`;
    const prev = await controlTx(sql, async (tx) => {
      const cur = (
        await tx<{ value: unknown }[]>`select value from control_settings where key = 'guardrails'`
      )[0]?.value;
      await tx`
        insert into control_integrations (kind, driver, enabled)
        values ('email', 'log', true)
        on conflict (kind, driver) do update set enabled = true
      `;
      await tx`
        insert into control_settings (key, value)
        values ('guardrails',
                ${tx.json({ quietStart, quietEnd, firstContactDraftOnly: false } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      return cur ?? null;
    });
    try {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Quiet Lead', email: 'quiet@test.dev', agent_mode: 'auto' }),
      );
      const leadId = lead.body.lead.id;
      const out = (await executeTool(ctx(leadId), `qh-${leadId}`, 'send_message', {
        leadId,
        body: 'oi',
      })) as { blocked: boolean; reason?: string };
      expect(out.blocked).toBe(true);
      expect(out.reason).toBe('quiet hours');
      const acts = await controlTx(
        sql,
        (tx) =>
          tx<{ kind: string; meta: { channel: string; reason: string } }[]>`
            select kind, meta from lead_activities where lead_id = ${leadId} and kind = 'blocked'
          `,
      );
      expect(acts.length).toBe(1);
      expect(acts[0]!.meta).toEqual({ channel: 'email', reason: 'quiet hours' });
    } finally {
      await controlTx(sql, async (tx) => {
        if (prev === null) await tx`delete from control_settings where key = 'guardrails'`;
        else
          await tx`update control_settings set value = ${tx.json(prev as never)} where key = 'guardrails'`;
      });
    }
  });

  test('send_message with draftOnly composes a draft even under quiet hours', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // drafts never leave the building, so draft-only runs skip delivery gates
    // (quiet hours/caps apply at the approval click)
    const ctx = (leadId: string): ToolContext => ({
      sql,
      runId: '00000000-0000-4000-8000-000000000002',
      runKind: 'outreach',
      leadId,
      threadId: null,
      step: 0,
      claimToken: null,
      pageCache: new Map(),
      briefName: null,
      leadCap: 20,
      channelOverride: null,
      book: new Map(),
      plan: null,
      monid: null,
      seenContacts: new Set(),
      pageReads: 0,
      draftOnly: true,
    });
    const h =
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          hour12: false,
        }).format(new Date()),
      ) % 24;
    const hh = (n: number) => String(n).padStart(2, '0');
    const prev = await controlTx(sql, async (tx) => {
      const cur = (
        await tx<{ value: unknown }[]>`select value from control_settings where key = 'guardrails'`
      )[0]?.value;
      await tx`
        insert into control_integrations (kind, driver, enabled)
        values ('email', 'log', true)
        on conflict (kind, driver) do update set enabled = true
      `;
      await tx`
        insert into control_settings (key, value)
        values ('guardrails',
                ${tx.json({ quietStart: `${hh((h + 23) % 24)}:00`, quietEnd: `${hh((h + 1) % 24)}:59`, firstContactDraftOnly: false } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      return cur ?? null;
    });
    try {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Quiet Draft Lead', email: 'quiet-draft@test.dev' }),
      );
      const leadId = lead.body.lead.id;
      const out = (await executeTool(ctx(leadId), `qhd-${leadId}`, 'send_message', {
        leadId,
        body: 'oi',
      })) as { message: { status: string } };
      expect(out.message.status).toBe('draft');
      const acts = await controlTx(
        sql,
        (tx) =>
          tx<{ kind: string }[]>`
            select kind from lead_activities where lead_id = ${leadId} and kind = 'blocked'
          `,
      );
      expect(acts.length).toBe(0);
    } finally {
      await controlTx(sql, async (tx) => {
        if (prev === null) await tx`delete from control_settings where key = 'guardrails'`;
        else
          await tx`update control_settings set value = ${tx.json(prev as never)} where key = 'guardrails'`;
      });
    }
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
      // lead-bound run spend + a discovery run attributed via params.segment
      await tx`
        insert into agent_runs (kind, lead_id, status, cost_cents)
        values ('reply', ${l.body.lead.id}, 'done', 300)
      `;
      await tx`
        insert into agent_runs (kind, params, status, cost_cents)
        values ('discovery', ${tx.json({ segment: seg } as never)}, 'done', 700)
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
