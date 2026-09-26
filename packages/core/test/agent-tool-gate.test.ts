import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { enqueueRun, runOnce } from '../src/agent/runner.ts';
import { sendableNowTx } from '../src/agent/guardrails.ts';
import { setTestProvider } from '../src/agent/llm.ts';
import { scriptedProvider } from '../src/agent/scripted-provider.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, type Guardrails } from '../src/modules/integrations.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

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

  test('reply run: send_message appears the turn research adds a channel', async () => {
    await migrate(sql, MIGRATIONS);
    await withNeverQuiet(() =>
      withIntegration('whatsapp', 'log', async () => {
        const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Gate Grows' }));
        const leadId = lead.body.lead.id;
        const wa = phone();
        const provider = scriptedProvider([
          { toolCalls: [{ name: 'update_lead', args: { id: leadId, whatsapp: wa } }] },
          { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá!' } }] },
          { text: 'fim' },
        ]);
        setTestProvider(provider);
        try {
          await sql`delete from agent_runs where status = 'queued'`;
          const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
          expect(await runOnce(sql)).toBe(true);

          const names = (i: number) => provider.requests[i]!.tools.map((t) => t.name);
          const draftEnum = (i: number) =>
            (
              provider.requests[i]!.tools.find((t) => t.name === 'draft_message')!.parameters as {
                properties: { channel: { enum: string[] } };
              }
            ).properties.channel.enum;
          // turn 1: no channel on the lead — no send, drafts only by hand
          expect(names(0)).not.toContain('send_message');
          expect(draftEnum(0)).toEqual(['manual']);
          // turn 2: the whatsapp update_lead just wrote is live
          expect(names(1)).toContain('send_message');
          expect(draftEnum(1)).toContain('whatsapp');

          const run = (
            await sql<
              {
                status: string;
                steps: {
                  type?: string;
                  name?: string;
                  content?: string;
                  out?: { error?: string };
                }[];
              }[]
            >`
              select status, steps from agent_runs where id = ${runId}
            `
          )[0]!;
          expect(run.status).toBe('done');
          const contact = run.steps.filter((s) => s.type === 'contact').map((s) => s.content);
          expect(contact).toHaveLength(2);
          expect(contact[0]).toStartWith('ENVIO BLOQUEADO');
          expect(contact[0]).toContain("rascunho só com channel 'manual'");
          expect(contact[1]).toStartWith('CONTATO LIBERADO');
          const send = run.steps.find((s) => s.name === 'send_message')!;
          expect(send.out?.error ?? '').not.toMatch(/TOOL_DISABLED/);
        } finally {
          setTestProvider(null);
        }
      }),
    );
  });

  test('discovery with no research tool fails up front — no model call', async () => {
    await migrate(sql, MIGRATIONS);
    const monid = process.env.MONID_API_KEY;
    delete process.env.MONID_API_KEY;
    const disc = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'
    `;
    await sql`update control_integrations set enabled = false where kind = 'discovery'`;
    const provider = scriptedProvider([{ text: 'nunca chamado' }]);
    setTestProvider(provider);
    try {
      // a real LLM driver — discovery's mock pages would be fabricated prospects for it
      await withIntegration('llm', 'anthropic', async () => {
        await sql`delete from agent_runs where status = 'queued'`;
        const runId = (await enqueueRun(sql, { kind: 'discovery' }))!;
        expect(await runOnce(sql)).toBe(true);
        const run = (
          await sql<{ status: string; error: string | null }[]>`
            select status, error from agent_runs where id = ${runId}
          `
        )[0]!;
        expect(run.status).toBe('failed');
        expect(run.error).toContain('discovery sem ferramenta de pesquisa');
        expect(provider.turns).toBe(0);
      });
    } finally {
      setTestProvider(null);
      for (const d of disc) {
        await sql`update control_integrations set enabled = ${d.enabled}
          where kind = 'discovery' and driver = ${d.driver}`;
      }
      if (monid !== undefined) process.env.MONID_API_KEY = monid;
    }
  });
});
