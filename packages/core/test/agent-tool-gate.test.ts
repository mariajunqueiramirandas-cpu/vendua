import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { sendableNowTx } from '../src/crm/guardrails.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, type Guardrails } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';
import { crmBench } from './crm-harness.ts';

// The live half of the tool gate: what a lead can be reached on, re-asked every turn.
describe.skipIf(!process.env.TEST_DATABASE_URL)('tool gate (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');
  const neverQuiet: Guardrails = { ...DEFAULT_GUARDRAILS, quietStart: '00:00', quietEnd: '00:00' };
  const phone = () => `55119${String(Date.now()).slice(-8)}`;

  /** enable an integration row for the test's duration, restoring what was there */
  const withIntegration = async <T>(
    kind: string,
    driver: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const prior = (
      await sql<{ enabled: boolean }[]>`
        select enabled from control_integrations where kind = ${kind} and driver = ${driver}
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled) values (${kind}, ${driver}, true)
      on conflict (kind, driver) do update set enabled = true, updated_at = now()
    `;
    try {
      return await fn();
    } finally {
      if (prior) {
        await sql`update control_integrations set enabled = ${prior.enabled}
          where kind = ${kind} and driver = ${driver}`;
      } else {
        await sql`delete from control_integrations where kind = ${kind} and driver = ${driver}`;
      }
    }
  };

  const withNeverQuiet = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prior = (
      await sql<{ value: unknown }[]>`select value from control_settings where key = 'guardrails'`
    )[0];
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ quietStart: '00:00', quietEnd: '00:00' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      return await fn();
    } finally {
      if (prior) {
        await sql`update control_settings set value = ${sql.json(prior.value as never)}
          where key = 'guardrails'`;
      } else {
        await sql`delete from control_settings where key = 'guardrails'`;
      }
    }
  };

  const b = crmBench('tool-gate');
  beforeAll(b.setup);
  afterAll(b.teardown);

  test('sendableNowTx asks what send_message/draft_message would', async () => {
    await migrate(sql, MIGRATIONS);
    await withIntegration('whatsapp', 'log', async () => {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Gate Reach', whatsapp: phone() }),
      );
      const leadId = lead.body.lead.id;
      const reach = (channels: ('whatsapp' | 'email')[]) =>
        controlTx(sql, (tx) =>
          sendableNowTx(tx, neverQuiet, leadId, { channels, draftOnly: false, override: null }),
        );

      const open = await reach(['whatsapp']);
      expect(open.send).toEqual(['whatsapp']);
      expect(open.draft).toEqual(['whatsapp', 'manual']);
      expect(open.why).toBeNull();

      // integration not live in the install → only the manual draft remains
      const off = await reach([]);
      expect(off.send).toEqual([]);
      expect(off.draft).toEqual(['manual']);
      expect(off.why).toBe('no reachable channel');

      // reachable, but the guardrail verdict refuses a live send
      await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
      const refused = await reach(['whatsapp']);
      expect(refused.send).toEqual([]);
      expect(refused.draft).toEqual(['whatsapp', 'manual']);
      expect(refused.why).toBe('agent off for lead');

      // a lead-wide pause blocks drafts too — nothing is offered
      await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
      const paused = await reach(['whatsapp']);
      expect(paused.send).toEqual([]);
      expect(paused.draft).toEqual([]);
    });
  });

  // v3: send_message is offered on every reply turn while a send channel is connected, so the
  // gate moved into the call: a send to a lead with no channel comes back blocked, not unoffered.
  test('reply run: send_message appears the turn research adds a channel', async () => {
    await withIntegration('whatsapp', 'log', async () => {
      // autopilot, so a live send goes out rather than being held as a first-contact draft
      await b.settings('autopilot', { quietStart: '00:00', quietEnd: '00:00' });
      const lead = await b.lead({ name: 'Gate Grows', whatsapp: null });
      const wa = b.phone();
      // turn 1: no channel on the lead — the send is refused, nothing queues
      const first = await b.runTools([['send_message', { body: 'olá!' }]], {
        leadId: lead.id,
        kind: 'reply',
      });
      expect(first.outcomes[0]).toMatchObject({
        name: 'send_message',
        ok: true,
        data: { blocked: true },
      });
      expect(await b.outbound(lead.id)).toHaveLength(0);

      // turn 2: the whatsapp the lead just gave is live, so the same send goes out
      const second = await b.runTools(
        [
          ['update_lead', { whatsapp: wa }],
          ['send_message', { body: 'olá!' }],
        ],
        { leadId: lead.id, kind: 'reply' },
      );
      expect(second.outcomes[1]).toMatchObject({
        name: 'send_message',
        ok: true,
        data: { channel: 'whatsapp', draftFallback: false },
      });
      expect((await b.outbound(lead.id)).map((m) => m.status)).toEqual(['queued']);
    });
  });

  test('discovery with no research tool parks up front — no model call', async () => {
    const monid = process.env.MONID_API_KEY;
    delete process.env.MONID_API_KEY;
    const disc = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'
    `;
    await sql`update control_integrations set enabled = false where kind = 'discovery'`;
    try {
      // a real LLM driver — discovery's mock pages would be fabricated prospects for it
      await withIntegration('llm', 'anthropic', async () => {
        const query = `sem pesquisa ${crypto.randomUUID()}`;
        const { outcomes, requests } = await b.runTools([['web_search', { query: 'doceria' }]], {
          kind: 'discovery',
          payload: { query },
        });
        expect(requests).toBe(0);
        expect(outcomes).toHaveLength(0);
        const [t] = await sql<{ error: string | null }[]>`
          select error from crm_turns where params->>'query' = ${query}`;
        expect(t!.error).toContain('discovery sem ferramenta de pesquisa');
      });
    } finally {
      for (const d of disc) {
        await sql`update control_integrations set enabled = ${d.enabled}
          where kind = 'discovery' and driver = ${d.driver}`;
      }
      if (monid !== undefined) process.env.MONID_API_KEY = monid;
    }
  });
});
