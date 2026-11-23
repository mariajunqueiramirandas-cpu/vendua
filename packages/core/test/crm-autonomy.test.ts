import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { deliverQueued } from '../src/crm/outbox.ts';
import { prepareCrmGatewayTx } from '../src/crm/delivery-policy.ts';
import { configureCrmSignup } from '../src/crm/signup.ts';
import { enqueuePlatformWaTx } from '../src/platform-whatsapp/outbox.ts';
import { call, crmBench, OWNER_URL, say } from './crm-harness.ts';

describe.skipIf(!OWNER_URL)('autonomous sales workflow', () => {
  const b = crmBench('autonomous-sales');
  beforeAll(b.setup);
  beforeEach(() => b.mine.clear());
  afterAll(b.teardown);

  test('missing triage deliverables are visible and create a staff task; it cannot schedule a send', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    const request = await b.control('POST', '/control/v1/agent/requests', {
      kind: 'triage',
      leadId: lead.id,
    });
    expect(request.status).toBe(201);
    const { rt, adapter } = b.runtime([
      call('schedule', {
        at: new Date(Date.now() + 3_600_000).toISOString(),
        focus: 'primeiro contato',
      }),
      say('feito'),
      say('feito'),
    ]);
    await b.settle(rt);
    expect(adapter.requests[0]!.tools.map((tool) => tool.name)).not.toContain('schedule');
    expect((await b.control('GET', '/control/v1/agent/runs')).status).toBe(200);
    const [result] = await b.sql`select outcome from crm_turns where lead_id = ${lead.id}`;
    expect(result?.outcome).toBe('triage_incomplete');
    expect(
      await b.sql`select id from lead_tasks where lead_id = ${lead.id} and due_at is not null`,
    ).toHaveLength(1);
    expect((await b.mail(lead.id)).filter((m) => !m.consumed_by_turn)).toHaveLength(0);
  });

  test('a documented triage blocker completes the task without creating a draft', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    await b.runTools(
      [
        ['add_note', { body: 'Não há informações confiáveis sobre o negócio.' }],
        ['create_task', { title: 'Confirmar a identidade do negócio' }],
        [
          'record_triage_blocker',
          { reason: 'Não foi possível distinguir dois negócios com o mesmo nome.' },
        ],
      ],
      { kind: 'triage', leadId: lead.id },
    );
    const [result] = await b.sql`select outcome from crm_turns where lead_id = ${lead.id}`;
    expect(result?.outcome).toBe('triage_complete');
    expect(await b.outbound(lead.id)).toHaveLength(0);
  });

  test('a researched contact can go live and a model-supplied unobserved contact requires a draft', async () => {
    await b.settings('autopilot');
    const provenNumber = '+5585999990001';
    const otherNumber = b.phone();
    const { outcomes } = await b.runTools(
      [
        ['read_pages', { urls: ['https://ateliedocelar.example.br'] }],
        [
          'create_lead',
          {
            name: 'Ateliê com fonte',
            whatsapp: provenNumber,
            fitScore: 9,
            findings: 'Ateliê de encomendas com número publicado na página do negócio.',
          },
        ],
        [
          'create_lead',
          {
            name: `Ateliê sem fonte ${b.nonce}`,
            whatsapp: otherNumber,
            fitScore: 9,
            findings: 'Ateliê de encomendas com contato ainda sem confirmação.',
          },
        ],
      ],
      { kind: 'discovery', payload: { query: 'ateliês' } },
    );
    expect(outcomes.map((o) => o.name)).toEqual(['read_pages', 'create_lead', 'create_lead']);
    const rows = await b.sql<{ id: string; whatsapp: string; whatsapp_verified: boolean }[]>`
      select id, whatsapp, whatsapp_verified from leads where whatsapp in (${provenNumber}, ${otherNumber})`;
    const proven = rows.find((r) => r.whatsapp === provenNumber)!;
    const other = rows.find((r) => r.whatsapp === otherNumber)!;
    b.mine.add(proven.id);
    b.mine.add(other.id);
    expect(proven.whatsapp_verified).toBe(true);
    expect(other.whatsapp_verified).toBe(false);
    expect((await b.mail(proven.id))[0]?.payload.draftOnly).toBeUndefined();
    expect((await b.mail(other.id))[0]?.payload.draftOnly).toBe(true);
  });

  test('an inbound gets a reply turn, then the independent staff triage turn', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    expect(
      (await b.control('POST', '/control/v1/agent/requests', { kind: 'triage', leadId: lead.id }))
        .status,
    ).toBe(201);
    await b.inbound(lead.whatsapp!);
    const { rt } = b.runtime([
      call('send_message', { body: 'Oi! Aqui é da Venduá.' }),
      say('ok'),
      say('triagem incompleta'),
      say('triagem incompleta'),
    ]);
    await b.settle(rt);
    expect((await b.turns(lead.id)).map((t) => t.kind)).toEqual(['reply', 'triage']);
    expect((await b.mail(lead.id))[0]!.consumed_by_turn).not.toBe(
      (await b.mail(lead.id))[1]!.consumed_by_turn,
    );
  });

  test('website requests are warm, include the question, and coalesce duplicate submissions', async () => {
    await b.settings('supervised');
    const whatsapp = b.phone();
    const message = 'Posso vender bolos sem glúten?';
    const submit = () =>
      b.app.request('/site/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Loja de bolos', whatsapp, message }),
      });
    expect((await submit()).status).toBe(202);
    expect((await submit()).status).toBe(202);
    const [row] = await b.sql<{ id: string }[]>`select id from leads where whatsapp = ${whatsapp}`;
    b.mine.add(row!.id);
    expect(await b.mail(row!.id)).toHaveLength(1);
    const { rt, adapter } = b.runtime([
      call('send_message', { body: 'Oi! Aqui é da Venduá. Posso te ajudar com a loja de bolos.' }),
      say('ok'),
    ]);
    await b.settle(rt);
    expect(JSON.stringify(adapter.requests[0])).toContain(message);
    expect(JSON.stringify(adapter.requests[0])).toContain('ORIGEM: inbound');
    expect((await b.outbound(row!.id)).map((m) => m.status)).toEqual(['queued']);
  });

  test('a callback for a known phone-only lead can reach the number requested', async () => {
    await b.settings('autopilot');
    const whatsapp = b.phone();
    const lead = await b.lead({ whatsapp: null, phone: whatsapp });
    const response = await b.app.request('/site/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Loja conhecida', whatsapp }),
    });
    expect(response.status).toBe(202);
    const [row] = await b.sql`select whatsapp from leads where id = ${lead.id}`;
    expect(row?.whatsapp).toBe(whatsapp);
    await b.settle(
      b.runtime([
        call('send_message', { body: 'Oi! Estou retornando seu pedido no site.' }),
        say('ok'),
      ]).rt,
    );
    expect((await b.outbound(lead.id))[0]?.status).toBe('queued');
  });

  test('a supervised first inbound is deferred during quiet hours', async () => {
    const utc = new Date();
    const localMinutes = utc.getUTCHours() * 60 + utc.getUTCMinutes();
    const time = (offset: number) => {
      const minutes = (localMinutes + offset + 1440) % 1440;
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    };
    await b.settings('supervised', {
      quietHoursEnabled: true,
      quietStart: time(-5),
      quietEnd: time(5),
      timezone: 'UTC',
    });
    const lead = await b.lead();
    await b.inbound(lead.whatsapp!);
    const [mail] = await b.mail(lead.id);
    expect(mail!.deliver_at.getTime()).toBeGreaterThan(Date.now() + 120_000);
    const { rt, adapter } = b.runtime([say('não deveria rodar')]);
    await b.settle(rt);
    expect(adapter.requests).toHaveLength(0);
  });

  test('failed reply generation leaves a visible handoff, even after bookkeeping writes', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    await b.inbound(lead.whatsapp!);
    await b.settle(
      b.runtime([call('update_lead', { name: 'Bolos do bairro' }), say('ok'), say('ok')]).rt,
    );
    const [r] = await b.sql`select outcome from crm_turns where lead_id = ${lead.id}`;
    expect(r?.outcome).toBe('handoff');
    expect(
      (await b.sql`select agent_paused_at from leads where id = ${lead.id}`)[0]?.agent_paused_at,
    ).not.toBeNull();
    expect(
      await b.sql`select id from lead_tasks where lead_id = ${lead.id} and due_at is not null`,
    ).toHaveLength(1);
  });

  test('outbox rechecks workspace mode and supersedes a queued reply when a new inbound arrives', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    await b.inbound(lead.whatsapp!);
    await b.settle(
      b.runtime([call('send_message', { body: 'Oi! Aqui é da Venduá.' }), say('ok')]).rt,
    );
    const [queued] = await b.outbound(lead.id);
    expect(queued?.status).toBe('queued');
    await b.settings('off');
    expect((await dispatchMessage(b.appSql, queued!.id)).reason).toBe('draft');
    await b.settings('autopilot');
    await b.inbound(lead.whatsapp!, 'Pode me explicar os planos?');
    await b.settle(
      b.runtime([call('send_message', { body: 'Oi! Claro, posso te explicar.' }), say('ok')]).rt,
    );
    const pending = (await b.outbound(lead.id)).find((m) => m.status === 'queued')!;
    await b.inbound(lead.whatsapp!, 'Já encontrei, obrigada.');
    expect(await dispatchMessage(b.appSql, pending.id)).toMatchObject({
      ok: false,
      reason: 'superseded by newer contact',
    });
  });

  test('WhatsApp gateway rechecks current policy after Core has already handed off the message', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    await b.inbound(lead.whatsapp!);
    await b.settle(
      b.runtime([call('send_message', { body: 'Oi! Aqui é da Venduá.' }), say('ok')]).rt,
    );
    const [queued] = await b.outbound(lead.id);
    await b.settings('off');
    await controlTx(b.appSql, async (tx) => {
      const { id } = await enqueuePlatformWaTx(tx, {
        purpose: 'crm',
        ref: queued!.id,
        to: lead.whatsapp!,
        body: queued!.body,
        dedupeKey: b.key(),
      });
      expect(await prepareCrmGatewayTx(tx, { id, purpose: 'crm', ref: queued!.id })).toBe(
        'settled',
      );
      const [row] = await tx`select status from platform_wa_outbox where id = ${id}`;
      expect(row?.status).toBe('failed');
    });
  });

  test('a sales turn quotes the live catalog, sends a signed signup link, and refuses invented prices', async () => {
    await b.settings('autopilot');
    await upsertIntegration(b.sql, { kind: 'email', driver: 'log', enabled: true }, b.key());
    await b.sql`insert into control_settings (key, value) values ('signup', '{"enabled":true}')
      on conflict (key) do update set value = excluded.value`;
    configureCrmSignup({
      origin: 'https://admin.example.test',
      secret: 'crm-test',
      provider: { platformConfigured: true },
    });
    try {
      const lead = await b.lead();
      await b.inbound(lead.whatsapp!, 'Quanto custa? Posso começar?');
      const { rt, adapter } = b.runtime([
        call('send_message', { body: 'Fica R$ 1,00 por mês.' }),
        call('get_sales_offer'),
        call('send_signup_link', { planId: 'mirim', includePrice: true }),
        say('ok'),
      ]);
      await b.settle(rt);
      expect(JSON.stringify(adapter.requests[1])).toContain('com includePrice');
      const [queued] = await b.outbound(lead.id);
      expect(queued?.body).toContain('https://admin.example.test/admin/comecar?plano=mirim&lead=');
      const [plan] = await b.sql<
        { price_cents: number }[]
      >`select price_cents from plans where id = 'mirim'`;
      expect(queued?.body).toContain(
        (plan!.price_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      );
      await deliverQueued(b.appSql);
      expect((await b.outbound(lead.id))[0]!.status).toBe('sent');
    } finally {
      configureCrmSignup(null);
      await b.sql`delete from control_settings where key = 'signup'`;
    }
  });
});
