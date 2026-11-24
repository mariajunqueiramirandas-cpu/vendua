import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { approveMessage, composeMessageTx } from '../src/modules/threads.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
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
        call('send_signup_link', {
          planId: 'mirim',
          includePrice: true,
          intro: 'Boa! Pra começar com o cardápio online, o Mirim resolve super bem.',
          outro: 'Se travar em algum passo, pode me chamar aqui.',
        }),
        say('ok'),
      ]);
      await b.settle(rt);
      expect(JSON.stringify(adapter.requests[1])).toContain('com includePrice');
      const [queued] = await b.outbound(lead.id);
      expect(queued?.body).toContain('Boa! Pra começar com o cardápio online');
      expect(queued?.body).toContain('https://admin.example.test/admin/comecar?plano=mirim&lead=');
      expect(queued?.body).toContain('Se travar em algum passo, pode me chamar aqui.');
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

  test('signup reopening affects the link without conflating a quote and plan availability', async () => {
    await b.settings('autopilot');
    await upsertIntegration(b.sql, { kind: 'email', driver: 'log', enabled: true }, b.key());
    const setSignup = (enabled: boolean) => b.sql`
      insert into control_settings (key, value) values ('signup', ${b.sql.json({ enabled })})
      on conflict (key) do update set value = excluded.value`;
    configureCrmSignup({
      origin: 'https://admin.example.test',
      secret: 'crm-test',
      provider: { platformConfigured: true },
    });
    try {
      const lead = await b.lead();
      await setSignup(false);
      const closed = await b.runTools(
        [
          ['send_signup_link', { planId: 'mirim' }],
          ['send_signup_link', { planId: 'mirim', includePrice: true, includeLink: false }],
        ],
        { leadId: lead.id, kind: 'reply' },
      );
      expect(closed.outcomes[0]).toMatchObject({ data: { code: 'signup_closed' } });
      const [quote] = await b.outbound(lead.id);
      expect(quote?.body).toContain('taxa da Venduá por pedido');
      expect(quote?.body).not.toContain('https://');

      await setSignup(true);
      const open = await b.runTools(
        [
          ['send_signup_link', { planId: 'unknown-plan' }],
          ['send_signup_link', { planId: 'mirim' }],
        ],
        { leadId: lead.id, kind: 'reply' },
      );
      expect(open.outcomes[0]).toMatchObject({ data: { code: 'plan_unavailable' } });
      const messages = await b.outbound(lead.id);
      expect(messages).toHaveLength(2);
      expect(messages[1]?.body).toContain(
        'https://admin.example.test/admin/comecar?plano=mirim&lead=',
      );
    } finally {
      configureCrmSignup(null);
      await b.sql`delete from control_settings where key = 'signup'`;
    }
  });

  test('a template expression cannot leak through a draft or a repeated send attempt', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    const { outcomes } = await b.runTools(
      [
        ['send_message', { body: 'O plano é o Mirim, {{p:mirim}}.' }],
        ['send_message', { body: 'A loja da {{empresa:nome}} pode receber pedidos.' }],
        ['draft_message', { subject: 'Cadastro de [nome]', body: 'Consigo ajudar pelo cadastro.' }],
        ['send_message', { body: 'Quer ajuda para criar a loja?' }],
      ],
      { leadId: lead.id, kind: 'reply' },
    );
    for (const outcome of outcomes.slice(0, 3))
      expect(outcome).toMatchObject({ data: { code: 'unresolved_template' } });
    expect(await b.outbound(lead.id)).toMatchObject([{ body: 'Quer ajuda para criar a loja?' }]);
  });

  test('a note with a placeholder goes back to the model instead of the timeline', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    const { outcomes } = await b.runTools(
      [
        ['add_note', { body: 'Cadastro no plano Mirim, {{p:mirim}}, com 14 dias de teste.' }],
        ['add_note', { body: 'Cadastro no plano Mirim, com 14 dias de teste.' }],
      ],
      { leadId: lead.id, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({
      ok: false,
      content: expect.stringContaining('placeholder'),
    });
    expect(outcomes[1]).toMatchObject({ ok: true });
    const notes = await b.sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${lead.id} and kind = 'note'`;
    expect(notes.map((n) => n.body)).toEqual(['Cadastro no plano Mirim, com 14 dias de teste.']);
  });

  test('a cadence turn can finish with a reason and send nothing', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    await controlTx(b.appSql, (tx) =>
      requestLeadTx(tx, {
        leadId: lead.id,
        kind: 'timer.followup',
        source: 'agenda',
        dedupeKey: b.key(),
        payload: { focus: 'cadência sem resposta' },
      }),
    );
    const { rt, adapter } = b.runtime([
      call('add_note', { body: 'Sem informação nova para retomar. Cadência encerrada.' }),
      say('ok'),
    ]);
    await b.settle(rt);
    expect(adapter.requests).toHaveLength(2);
    expect(await b.outbound(lead.id)).toHaveLength(0);
    const [result] = await b.sql`select outcome from crm_turns where lead_id = ${lead.id}`;
    expect(result?.outcome).toBe('followup_skipped');
  });

  test('pending agent messages from older versions are checked before approval and delivery', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    const write = (status: 'draft' | 'queued') =>
      controlTx(b.appSql, (tx) =>
        composeMessageTx(tx, {
          leadId: lead.id,
          channel: 'whatsapp',
          body: 'O preço está em {{p:mirim}}.',
          author: 'agent',
          status,
        }),
      );
    const draft = await write('draft');
    const queued = await write('queued');
    await expect(
      approveMessage(b.appSql, draft.body.message.id, 'staff', b.key()),
    ).rejects.toMatchObject({
      code: 'DRAFT_TEMPLATE_UNRESOLVED',
    });
    expect(await dispatchMessage(b.appSql, queued.body.message.id)).toMatchObject({
      ok: false,
      reason: 'unresolved template',
    });
    expect((await b.outbound(lead.id)).map((message) => message.status)).toEqual([
      'draft',
      'failed',
    ]);
  });

  test('send_message allows natural catalog-verified plan comparison after get_sales_offer and still refuses invented prices', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    const plans = await b.sql<{ id: string; price_cents: number }[]>`
      select id, price_cents from plans where id in ('mirim', 'bandeira')`;
    const fmt = (cents: number) =>
      (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const mirim = fmt(plans.find((p) => p.id === 'mirim')!.price_cents);
    const bandeira = fmt(plans.find((p) => p.id === 'bandeira')!.price_cents);
    const { outcomes } = await b.runTools(
      [
        ['get_sales_offer', {}],
        ['send_message', { body: 'O Mirim fica R$ 19,90 por mês.' }],
        [
          'send_message',
          {
            body: `O Mirim fica ${mirim}/mês pra loja e painel, e o Bandeira fica ${bandeira}/mês com a Duá atendendo no WhatsApp e fidelidade. Nos dois a taxa da Venduá por pedido é 0% e tem 14 dias de teste grátis confirmados no cadastro.`,
          },
        ],
      ],
      { leadId: lead.id, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({ name: 'get_sales_offer', ok: true });
    expect(JSON.stringify(outcomes[1])).toContain('Preço não confere');
    expect(outcomes[2]).toMatchObject({ name: 'send_message', ok: true });
    const [queued] = await b.outbound(lead.id);
    expect(queued?.body).toContain(mirim);
    expect(queued?.body).toContain(bandeira);
  });

  test('outbound first reply injects MOMENTO stage-2 guidance into context', async () => {
    await b.settings('autopilot');
    const lead = await b.lead({ name: 'Doce Brisa' });
    const opener = await controlTx(b.appSql, (tx) =>
      composeMessageTx(tx, {
        leadId: lead.id,
        channel: 'whatsapp',
        body: 'Oi Bia! Vi as tortas sob encomenda da Doce Brisa — você já trabalha com link próprio pro pessoal pedir no WhatsApp?',
        author: 'agent',
        status: 'queued',
      }),
    );
    expect((await dispatchMessage(b.appSql, opener.body.message.id)).ok).toBe(true);
    await b.inbound(lead.whatsapp!, 'Sim');
    const { rt, adapter } = b.runtime([
      call('send_message', {
        body: 'Boa! Com a Venduá você monta um link seu com sabores, preços e encomendas marcadas. Hoje você passa o cardápio por foto ou PDF no WhatsApp?',
      }),
      say('ok'),
    ]);
    await b.settle(rt);
    const promptSent = JSON.stringify(adapter.requests[0]);
    expect(promptSent).toContain('ORIGEM: outbound');
    expect(promptSent).toContain('MOMENTO: primeira resposta do lead à nossa abordagem fria');
  });
});
