import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { checkSendAllowedTx, sendWindowOpenAtTx } from '../src/agent/guardrails.ts';
import { explainAutonomyTx } from '../src/agent/policy.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  validateSetting,
  type Guardrails,
} from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { blockedPhonesTx } from '../src/modules/staff.ts';
import { migrate } from '../src/platform/db.ts';

describe('guardrails — quiet hours switch + unanswered cap', () => {
  test('quietHoursEnabled must be a boolean; the cap accepts 0 (off)', () => {
    expect(() => validateSetting('guardrails', { quietHoursEnabled: false })).not.toThrow();
    expect(() => validateSetting('guardrails', { quietHoursEnabled: 'no' })).toThrow();
    expect(() => validateSetting('guardrails', { maxOutboundPerLeadPerDay: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { maxOutboundPerLeadPerDay: -1 })).toThrow();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('send limits (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const phone = () => `55219${crypto.randomUUID().replace(/\D/g, '').slice(0, 8)}`;
  // quiet all day except the minute boundary: 00:00–23:59
  const alwaysQuiet: Guardrails = { ...DEFAULT_GUARDRAILS, quietStart: '00:00', quietEnd: '23:59' };
  const neverQuiet: Guardrails = { ...DEFAULT_GUARDRAILS, quietHoursEnabled: false };

  const made: string[] = [];
  afterEach(async () => {
    await sql`delete from control_settings where key in ('guardrails', 'staff')`;
    // lead create queues a first-contact run — don't leave it for later files' runners
    await sql`update agent_runs set status = 'canceled'
      where status = 'queued' and lead_id = any(${made}::uuid[])`;
    await sql`update leads set archived_at = now() where id = any(${made}::uuid[])`;
    // channel-health reads a workspace-wide failure rate — seeded sends would dilute it
    await sql`delete from lead_messages where thread_id in (
      select id from lead_threads where lead_id = any(${made}::uuid[]))`;
  });

  // an auto-mode lead who already wrote, so the draft gate doesn't decide first
  const mkLead = async (whatsapp = phone()) => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Limits', whatsapp }));
    const id = lead.body.lead.id as string;
    made.push(id);
    await sql`update leads set agent_mode = 'auto' where id = ${id}`;
    const [t] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${id}, 'whatsapp') returning id`;
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${t!.id}, 'in', 'lead', 'oi', 'received', now() - interval '3 hours')`;
    return { id, thread: t!.id };
  };
  const agentSends = (thread: string, n: number, ago: string) =>
    sql`insert into lead_messages (thread_id, direction, author, body, status, created_at)
      select ${thread}, 'out', 'agent', 'msg', 'sent', now() - ${ago}::interval
      from generate_series(1, ${n})`;
  const check = (g: Guardrails, leadId: string) =>
    controlTx(sql, (tx) => checkSendAllowedTx(tx, g, leadId, 'whatsapp'));

  test('quiet hours off lets a send through and opens the window at once', async () => {
    const { id } = await mkLead();
    expect(await check(alwaysQuiet, id)).toMatchObject({ ok: false, reason: 'quiet hours' });
    expect(await check({ ...alwaysQuiet, quietHoursEnabled: false }, id)).toMatchObject({
      ok: true,
    });
    const at = new Date();
    const open = await controlTx(sql, (tx) =>
      sendWindowOpenAtTx(tx, { ...alwaysQuiet, quietHoursEnabled: false }, at),
    );
    expect(open.getTime()).toBe(at.getTime());
  });

  test('only sends after the lead’s last message count toward the cap', async () => {
    const { id, thread } = await mkLead();
    const g = { ...neverQuiet, maxOutboundPerLeadPerDay: 3 };
    await agentSends(thread, 5, '4 hours'); // before the lead answered — negotiation, free
    expect(await check(g, id)).toMatchObject({ ok: true });
    await agentSends(thread, 3, '1 hour'); // three unanswered since
    expect(await check(g, id)).toMatchObject({ ok: false, reason: 'unanswered cap reached' });
    expect(await check({ ...g, maxOutboundPerLeadPerDay: 0 }, id)).toMatchObject({ ok: true });
    await sql`insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread}, 'in', 'lead', 'e o preço?', 'received')`;
    expect(await check(g, id)).toMatchObject({ ok: true });
  });

  test('team whatsapps block the lead like the retired ignore list did', async () => {
    const wa = phone();
    const { id } = await mkLead(wa);
    await sql`
      insert into control_settings (key, value)
      values ('staff', ${sql.json({ members: [{ name: 'Ana', email: '', whatsapp: `+${wa}` }] } as never)})
    `;
    expect(await controlTx(sql, blockedPhonesTx)).toContain(`+${wa}`);
    const why = await controlTx(sql, (tx) => explainAutonomyTx(tx, id));
    expect(why?.reasons.map((r) => r.code)).toContain('ignored_phone');
  });
});
