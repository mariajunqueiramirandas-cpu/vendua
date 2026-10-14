import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { deliverQueued } from '../src/crm/outbox.ts';
import { call, crmBench, OWNER_URL, say } from './crm-harness.ts';

// golden evals: the real pipeline (inbound → turn → tools → outbox) driven by a scripted model,
// through the `log` transport: nothing leaves the box. Each behaviour here is one the bench shows
// end to end; the single-step guarantees live in crm-agent.test.ts.

describe.skipIf(!OWNER_URL)('agent evals — golden turns (db)', () => {
  const b = crmBench('evals');
  const { sql, mine, settings, lead, inbound, outbound, runTools, runtime, settle } = b;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => mine.clear());

  test('supervised: a lead who wrote first gets a live answer', async () => {
    await settings('supervised');
    const l = await lead();
    await inbound(l.whatsapp!);
    const { rt } = runtime([
      call('send_message', { body: 'Oi! Aqui é da Venduá.' }),
      say('respondido.'),
    ]);
    await settle(rt);
    // the outbox takes the oldest queued rows first, in batches: other files' leftovers may come first
    for (let i = 0; i < 10 && (await outbound(l.id))[0]?.status === 'queued'; i++)
      await deliverQueued(b.appSql);
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['sent']);
  });

  test('a new number starts in the mode the workspace picked for inbound leads', async () => {
    for (const mode of ['draft', 'auto'] as const) {
      await settings('supervised', {}, { newLeadMode: { inbound: mode } });
      const wa = b.phone();
      const res = await inbound(wa);
      expect('ignored' in res).toBe(false);
      const [row] = await sql<{ agent_mode: string }[]>`
        select agent_mode from leads where whatsapp = ${wa}`;
      expect(row!.agent_mode).toBe(mode);
    }
  });

  test('loop guard suppresses an identical repeated send — only one lands', async () => {
    await settings('autopilot');
    const l = await lead();
    const body = 'Mesmo texto, de novo.';
    const { outcomes } = await runTools(
      [
        ['send_message', { body }],
        ['send_message', { body }],
      ],
      { leadId: l.id, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({ name: 'send_message', ok: true });
    // a turn dispatches once: the repeat is refused, the first send stands
    expect(outcomes[1]).toMatchObject({ name: 'send_message', ok: true, data: { blocked: true } });
    expect((await outbound(l.id)).map((m) => m.body)).toEqual([body]);
  });

  test('style check steers but never strands — a second flawed body goes out as written', async () => {
    await settings('autopilot');
    const l = await lead();
    await inbound(l.whatsapp!);
    const { rt } = runtime([
      call('send_message', { body: 'Oi — tudo certo?' }),
      call('send_message', { body: 'Oi — tudo certo por aí?' }),
      say('feito.'),
    ]);
    await settle(rt);
    expect((await outbound(l.id)).map((m) => m.body)).toEqual(['Oi — tudo certo por aí?']);
  });
});
