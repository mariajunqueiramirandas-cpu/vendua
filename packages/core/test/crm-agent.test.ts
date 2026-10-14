import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { scheduleTimerTx } from '../src/crm/agenda.ts';
import { requestBoardTx, requestLeadTx } from '../src/crm/dispatch.ts';
import { adoptLegacy } from '../src/crm/legacy.ts';
import { deliverQueued } from '../src/crm/outbox.ts';
import { controlTx } from '../src/modules/control.ts';
import { upsertIntegration } from '../src/modules/integrations.ts';
import { approveMessage, composeMessageTx } from '../src/modules/threads.ts';
import { PLATFORM_TENANT_ID, TenantResolver } from '../src/platform/tenancy.ts';
import { call, crmBench, OWNER_URL, say } from './crm-harness.ts';

// The CRM's agents on Agent Runtime v3 (ADR 0030 steps 2–4): a scripted model drives the real
// runtime, Postgres store and host hooks under Venduá's platform tenant. Leads are reached only
// through tools; the projection (crm_turns), the agenda (timer mail), parking, the cost cap and the
// cutover from the old runner are what these pin.

describe.skipIf(!OWNER_URL)('CRM agents on Runtime v3 (db)', () => {
  const b = crmBench('crm-v3');
  const { sql, appSql, nonce, key, mine, settings, lead, runtime, settle } = b;
  const { turns, outbound, mail, inbound, control } = b;
  const PHONE = b.phone;
  beforeEach(() => mine.clear());
  beforeAll(b.setup);
  afterAll(b.teardown);

  test('the platform tenant is no store: no slug, no host, no listing', async () => {
    const resolver = new TenantResolver(appSql, 0, 'vendua.test');
    expect(await resolver.resolveBySlug('_platform')).toBeNull();
    const [row] = await sql`select status from tenants where id = ${PLATFORM_TENANT_ID}`;
    expect(row?.status).toBe('platform');
    for (const path of ['/control/v1/customers', '/control/v1/storefronts']) {
      const res = await control('GET', path);
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain(PLATFORM_TENANT_ID);
    }
  });

  test('the bench: a scripted turn reports each call, refusals included', async () => {
    await settings('autopilot');
    const l = await lead();
    const { outcomes } = await b.runTools(
      [
        ['update_lead', { email: 'dona@doceria.com.br' }],
        ['send_message', { body: 'oi' }],
        ['maps_lookup', { query: 'doceria' }],
      ],
      { leadId: l.id, kind: 'triage' },
    );
    expect(outcomes.map((o) => o.name)).toEqual(['update_lead', 'send_message', 'maps_lookup']);
    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(outcomes[1]!.blocked).toStartWith('state_gate:');
    expect(outcomes[2]!.blocked).toMatch(/^(state_gate|available):/);
    const [row] = await sql`select email from leads where id = ${l.id}`;
    expect(row!.email).toBe('dona@doceria.com.br');
  });

  test('inbound → reply turn → send_message queues; the outbox delivers it once', async () => {
    await settings('autopilot');
    const l = await lead();
    const res = await inbound(l.whatsapp!);
    expect('ignored' in res).toBe(false);
    const filed = await mail(l.id);
    expect(filed.map((m) => [m.kind, m.source])).toEqual([['message.inbound', 'whatsapp']]);
    // the lead's words are data in the context, never a user turn
    expect(JSON.stringify(filed[0]!.payload)).not.toContain('quero saber');

    const { rt, adapter } = runtime([
      call('send_message', { body: 'Oi! Te explico rapidinho como funciona.' }),
      say('respondi o lead'),
    ]);
    await settle(rt);
    const sent = await outbound(l.id);
    expect(sent.map((m) => m.status)).toEqual(['queued']);
    const tools = adapter.requests[0]!.tools.map((t) => t.name);
    expect(tools).toContain('send_message');
    expect(tools).not.toContain('reply');
    expect(tools).not.toContain('maps_lookup');
    const first = adapter.requests[0]!.messages[0]!;
    expect(first.role === 'user' && JSON.stringify(first.parts)).not.toContain('quero saber');

    await deliverQueued(appSql);
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['sent']);
    await deliverQueued(appSql);
    expect(await outbound(l.id)).toHaveLength(1);

    const [t] = await turns(l.id);
    expect(t).toMatchObject({ kind: 'reply', status: 'done', acted: true, source: 'inbound' });
    expect(sent[0]!.agent_run_id).not.toBeNull();
    // the send booked the cadence follow-up on the lead's agenda
    const agenda = (await mail(l.id)).filter((m) => m.kind === 'timer.followup');
    expect(agenda).toHaveLength(1);
  });

  test('supervised: a first contact becomes a draft for staff', async () => {
    await settings('supervised');
    const l = await lead();
    const res = await control('POST', '/control/v1/agent/requests', {
      kind: 'outreach',
      leadId: l.id,
      focus: 'primeiro contato',
    });
    expect(res.status).toBe(201);
    const { rt, adapter } = runtime([
      call('send_message', { body: 'Oi, tudo bem? Sou da Venduá.' }),
      say('ok'),
    ]);
    await settle(rt);
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['draft']);
    // outreach may research, but a lookup with no provider configured is never offered
    const tools = adapter.requests[0]!.tools.map((t) => t.name);
    expect(tools).toContain('schedule');
    expect(tools).not.toContain('maps_lookup');
  });

  test('a turn that would end without acting is nudged once, then acts', async () => {
    await settings('autopilot');
    const l = await lead();
    await inbound(l.whatsapp!);
    const { rt, adapter } = runtime([
      say('Vou pensar no que responder.'),
      call('draft_message', { body: 'Oi! Me conta o que você vende?' }),
      say('rascunho pronto'),
    ]);
    await settle(rt);
    expect(adapter.requests).toHaveLength(3);
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('Ação pendente');
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['draft']);
    expect((await turns(l.id))[0]).toMatchObject({ acted: true, status: 'done' });
  });

  test('a robotic message goes back once; the rewrite goes out', async () => {
    await settings('autopilot');
    const l = await lead();
    await inbound(l.whatsapp!);
    const { rt } = runtime([
      call('send_message', {
        body: '**Olá!** Somos a Venduá — a plataforma completa:\n- cardápio\n- pedidos',
      }),
      call('send_message', { body: 'Oi! A Venduá monta seu cardápio online. Quer ver?' }),
      say('ok'),
    ]);
    await settle(rt);
    const sent = await outbound(l.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('Quer ver?');
  });

  test('unsubscribe opts the lead out and drops what waited for its agent', async () => {
    await settings('autopilot');
    const l = await lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 3 * 86_400_000),
        focus: 'retomar',
        requested: false,
        by: 'agent',
      }),
    );
    await inbound(l.whatsapp!, 'para de me mandar mensagem');
    const { rt, adapter } = runtime([
      call('unsubscribe', { reason: 'pediu', reply: 'Tudo certo, não te chamo mais.' }),
      call('send_message', { body: 'nunca deveria sair' }),
    ]);
    await settle(rt);
    // the opt-out ends the turn: no model call after it
    expect(adapter.requests).toHaveLength(1);
    const [row] = await sql`select unsubscribed_at from leads where id = ${l.id}`;
    expect(row!.unsubscribed_at).not.toBeNull();
    expect((await mail(l.id)).filter((m) => !m.consumed_by_turn)).toHaveLength(0);
    expect((await outbound(l.id)).map((m) => m.body)).toEqual(['Tudo certo, não te chamo mais.']);
  });

  test('a paused agent files nothing; resuming answers what the lead wrote meanwhile', async () => {
    await settings('autopilot');
    const l = await lead({ agent_paused_at: new Date() });
    await inbound(l.whatsapp!);
    expect(await mail(l.id)).toHaveLength(0);
    const res = await control('PATCH', `/control/v1/leads/${l.id}`, { agentPaused: false });
    expect(res.status).toBe(200);
    const filed = await mail(l.id);
    expect(filed.map((m) => m.kind)).toEqual(['message.inbound']);
    // the same message is never served twice
    await control('PATCH', `/control/v1/leads/${l.id}`, { agentPaused: true });
    await control('PATCH', `/control/v1/leads/${l.id}`, { agentPaused: false });
    expect(await mail(l.id)).toHaveLength(1);
  });

  test("the lead's reply retires the agent's own follow-up and its unsent outreach draft", async () => {
    await settings('supervised');
    const l = await lead();
    await controlTx(appSql, (tx) =>
      requestLeadTx(tx, {
        leadId: l.id,
        kind: 'lead.first_contact',
        source: 'first_contact',
        dedupeKey: `crm:first_contact:${l.id}`,
      }),
    );
    const { rt } = runtime([call('draft_message', { body: 'Oi! Sou da Venduá.' }), say('ok')]);
    await settle(rt);
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['draft']);
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 2 * 86_400_000),
        focus: 'follow-up',
        requested: false,
        by: 'agent',
      }),
    );
    await inbound(l.whatsapp!);
    expect((await outbound(l.id)).map((m) => m.status)).toEqual(['rejected']);
    const pending = (await mail(l.id)).filter((m) => !m.consumed_by_turn).map((m) => m.kind);
    expect(pending).toEqual(['message.inbound']);
  });

  test('approving a stale agent draft files one regeneration instead of sending it', async () => {
    await settings('supervised', { staleDraftDays: 7 });
    const l = await lead();
    const composed = await controlTx(appSql, (tx) =>
      composeMessageTx(tx, {
        leadId: l.id,
        channel: 'whatsapp',
        body: 'rascunho velho',
        author: 'agent',
        status: 'draft',
      }),
    );
    const msgId = composed.body.message.id;
    await sql`update lead_messages set created_at = now() - interval '9 days' where id = ${msgId}`;
    const k = key();
    const res = await approveMessage(appSql, msgId, 'staff', k);
    expect(res.body.stale).toBe(true);
    // a retried click replays; the superseded draft can't be approved again
    expect((await approveMessage(appSql, msgId, 'staff', k)).body.stale).toBe(true);
    await expect(approveMessage(appSql, msgId, 'staff', key())).rejects.toThrow('not found');
    const regen = (await mail(l.id)).filter((m) => m.kind === 'staff.regenerate');
    expect(regen).toHaveLength(1);
    expect(regen[0]!.payload).toMatchObject({ draftOnly: true, src: msgId });
  });

  test('a lead over its cost cap gets no model call, and the team hears once', async () => {
    await settings('autopilot', { leadLifetimeCostCapUsd: 1 });
    const l = await lead();
    await sql`
      insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status, started_at, cost_cents)
      values (gen_random_uuid(), gen_random_uuid(), 'crm', 'reply', 'whatsapp', ${l.id}, 'done', now(), 150)`;
    await inbound(l.whatsapp!);
    const { rt, adapter } = runtime([call('send_message', { body: 'não deveria' })]);
    await settle(rt);
    expect(adapter.requests).toHaveLength(0);
    const [t] = (await turns(l.id)).slice(-1);
    expect(t!.error).toContain('custo');
    const tasks =
      await sql`select title from lead_tasks where lead_id = ${l.id} and title like '[humano]%'`;
    expect(tasks).toHaveLength(1);
    const events = await sql`
      select 1 from staff_events where kind = 'agent.cost_cap' and data->>'leadId' = ${l.id}`;
    expect(events).toHaveLength(1);
  });

  test('a turn that keeps failing is a failed run for the team, with a task when a lead waits', async () => {
    await settings('autopilot');
    const l = await lead();
    await inbound(l.whatsapp!);
    const { rt } = runtime(() => ({ error: { status: 400, message: 'bad request' } }));
    // the store claims on the database clock: bring each retry's backoff forward
    for (let i = 0; i < 6; i++) {
      await settle(rt);
      await sql`
        update agent_actors set next_wake_at = now()
        where subject_id = ${l.id} and next_wake_at is not null`;
    }
    const [t] = await turns(l.id);
    expect(t).toMatchObject({ status: 'failed', kind: 'reply' });
    const ev = await sql`
      select data from staff_events where kind = 'agent.run_failed' and data->>'leadId' = ${l.id}`;
    expect(ev).toHaveLength(1);
    const turned = await sql`
      select 1 from staff_events where kind = 'agent.turn_failed' and data->>'actorId' in (
        select id::text from agent_actors where subject_id = ${l.id})`;
    expect(turned).toHaveLength(0);
    const tasks =
      await sql`select title from lead_tasks where lead_id = ${l.id} and title like '[humano]%'`;
    expect(tasks).toHaveLength(1);
  });

  /** discovery parks without a research tool: the mock provider stands in for the real one */
  async function withMockDiscovery(fn: () => Promise<void>) {
    const prior = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'`;
    await upsertIntegration(appSql, { kind: 'discovery', driver: 'mock', enabled: true }, key());
    try {
      await fn();
    } finally {
      await sql`delete from control_integrations where kind = 'discovery'`;
      for (const d of prior)
        await upsertIntegration(
          appSql,
          { kind: 'discovery', driver: d.driver, enabled: d.enabled },
          key(),
        );
    }
  }

  test('discovery files a researched lead and wakes its agent for the first contact', () =>
    withMockDiscovery(async () => {
      await settings('autopilot');
      const hunt = crypto.randomUUID();
      mine.add(hunt);
      const wa = PHONE();
      await controlTx(appSql, (tx) =>
        requestBoardTx(tx, {
          agent: 'crm-discovery',
          subject: { kind: 'hunt', id: hunt },
          kind: 'staff.request',
          source: 'staff',
          dedupeKey: `crm:staff:${hunt}`,
          payload: { kind: 'discovery', query: 'doceria campinas', target: 2 },
        }),
      );
      const { rt, adapter } = runtime([
        call('create_lead', { name: 'Sem pesquisa', whatsapp: wa, findings: 'curto' }),
        call('create_lead', {
          name: `Doce Lar ${nonce}`,
          city: 'Campinas',
          whatsapp: `https://wa.me/${wa.replace(/\D/g, '')}`,
          findings: 'Doceria artesanal, vende pelo WhatsApp sem link de pedido próprio.',
          fitScore: 9,
          intentScore: 8,
        }),
        call('update_lead', { lead: 'l99', segment: 'doces' }),
        say('feito'),
      ]);
      await settle(rt, ['background']);
      const contents = adapter.requests.map((r) => JSON.stringify(r.messages.at(-1)));
      expect(contents[1]).toContain('FINDINGS_REQUIRED');
      const [created] = await sql<{ id: string; whatsapp: string; tags: string[] }[]>`
      select id, whatsapp, tags from leads where name = ${`Doce Lar ${nonce}`}`;
      expect(created!.whatsapp.replace(/\D/g, '')).toBe(wa.replace(/\D/g, ''));
      expect(created!.tags).toContain('descoberto');
      // the model reads refs, never lead ids
      expect(contents[2]).not.toContain(created!.id);
      expect((await mail(created!.id)).map((m) => m.kind)).toEqual(['lead.first_contact']);
      const [t] =
        await sql`select leads_created, kind from crm_turns where params->>'query' = 'doceria campinas' order by finished_at desc limit 1`;
      expect(t).toMatchObject({ leads_created: 1, kind: 'discovery' });
    }));

  test('the strategist drafts a disabled brief', async () => {
    await settings('autopilot');
    mine.add('weekly');
    await controlTx(appSql, (tx) =>
      requestBoardTx(tx, {
        agent: 'crm-strategist',
        subject: { kind: 'review', id: 'weekly' },
        kind: 'staff.request',
        source: 'staff',
        dedupeKey: `crm:staff:${crypto.randomUUID()}`,
        payload: { kind: 'strategist' },
      }),
    );
    const name = `docerias ${nonce}`;
    const { rt } = runtime([
      call('propose_brief', {
        name,
        query: `doceria artesanal ${nonce}`,
        reason: 'segmento responde',
      }),
      say('ok'),
    ]);
    await settle(rt, ['background']);
    const [b] = await sql`select enabled, created_by from discovery_briefs where name = ${name}`;
    expect(b).toMatchObject({ enabled: false, created_by: 'strategist' });
  });

  test('the activity list shows waiting work and finished turns; waiting work cancels', async () => {
    await settings('autopilot');
    const l = await lead();
    const req = await control('POST', '/control/v1/agent/requests', {
      kind: 'triage',
      leadId: l.id,
    });
    const { runId } = (await req.json()) as { runId: string };
    const list = (await (
      await control('GET', `/control/v1/agent/runs?lead_id=${l.id}`)
    ).json()) as { runs: { id: string; status: string; kind: string }[] };
    expect(list.runs).toEqual([
      expect.objectContaining({ id: runId, status: 'queued', kind: 'triage' }),
    ]);
    const cancel = await control('POST', `/control/v1/agent/runs/${runId}/cancel`);
    expect(((await cancel.json()) as { status: string }).status).toBe('canceled');
    expect(await mail(l.id)).toHaveLength(0);

    await inbound(l.whatsapp!);
    const { rt } = runtime([call('draft_message', { body: 'Oi! Tudo bem?' }), say('ok')]);
    await settle(rt);
    const after = (await (
      await control('GET', `/control/v1/agent/runs?lead_id=${l.id}`)
    ).json()) as { runs: { id: string; status: string }[] };
    expect(after.runs.map((r) => r.status)).toEqual(['done']);
    const detail = (await (
      await control('GET', `/control/v1/agent/runs/${after.runs[0]!.id}`)
    ).json()) as {
      run: { steps: { type: string; name?: string }[] };
    };
    expect(detail.run.steps.map((s) => s.type)).toEqual(['inbox', 'model', 'tool', 'model']);
  });

  test("the cutover adopts the old runner's pending work once", async () => {
    await settings('autopilot');
    const l = await lead();
    const [w] = await sql<{ id: string }[]>`
      insert into agent_wakeups (lead_id, kind, at, focus, status, created_by, requested)
      values (${l.id}, 'outreach', now() + interval '2 days', 'retomar', 'pending', 'agent', false)
      returning id`;
    const [r] = await sql<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, status, params, source)
      values ('outreach', ${l.id}, 'queued', ${sql.json({ focus: 'staff pediu' } as never)}, 'staff')
      returning id`;
    expect(await adoptLegacy(appSql)).toBeGreaterThanOrEqual(2);
    expect(await adoptLegacy(appSql)).toBe(0);
    const kinds = (await mail(l.id)).map((m) => m.kind).sort();
    expect(kinds).toEqual(['staff.request', 'timer.followup']);
    const [wr] = await sql`select status from agent_wakeups where id = ${w!.id}`;
    const [rr] = await sql`select status from agent_runs where id = ${r!.id}`;
    expect([wr!.status, rr!.status]).toEqual(['canceled', 'canceled']);
    const [nl] = await sql`select next_action_at from leads where id = ${l.id}`;
    expect(nl!.next_action_at).not.toBeNull();
  });
  test("a fired date stops being the lead's next action", async () => {
    await settings('autopilot');
    const l = await lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 60 * 60_000),
        focus: 'retomar',
        requested: true,
        by: 'agent',
      }),
    );
    const [before] = await sql`select next_action_at from leads where id = ${l.id}`;
    expect(before!.next_action_at).not.toBeNull();
    await sql`
      update agent_mailbox set deliver_at = now() - interval '1 minute'
      where actor_id in (select id from agent_actors where subject_id = ${l.id})`;
    await sql`update agent_actors set next_wake_at = now() where subject_id = ${l.id}`;
    const { rt } = runtime([call('create_task', { title: 'ligar amanhã' }), say('ok')]);
    await settle(rt);
    expect((await turns(l.id)).map((t) => t.source)).toEqual(['callback']);
    const [after] = await sql`select next_action_at from leads where id = ${l.id}`;
    expect(after!.next_action_at).toBeNull();
  });

  test('a follow-up due while its job was off runs silent, and comes back with the job', async () => {
    await settings('autopilot');
    const l = await lead();
    await controlTx(appSql, (tx) =>
      scheduleTimerTx(tx, {
        leadId: l.id,
        at: new Date(Date.now() + 60 * 60_000),
        focus: 'retomar a conversa do cardápio',
        requested: false,
        by: 'agent',
      }),
    );
    await settings('autopilot', {}, { jobs: { outreach: false } });
    await sql`
      update agent_mailbox set deliver_at = now() - interval '1 minute'
      where actor_id in (select id from agent_actors where subject_id = ${l.id})`;
    await sql`update agent_actors set next_wake_at = now() where subject_id = ${l.id}`;
    const { rt, adapter } = runtime([say('não deveria')]);
    await settle(rt);
    expect(adapter.requests).toHaveLength(0);
    expect((await turns(l.id))[0]).toMatchObject({ source: 'followup', steps: 0 });
    expect((await mail(l.id)).filter((m) => !m.consumed_by_turn)).toHaveLength(0);

    const res = await control('PUT', '/control/v1/settings/agent', {
      value: { level: 'autopilot', jobs: { outreach: true } },
    });
    expect(res.status).toBe(200);
    const back = (await mail(l.id)).filter((m) => !m.consumed_by_turn);
    expect(back.map((m) => [m.kind, m.payload.focus])).toEqual([
      ['timer.followup', 'retomar a conversa do cardápio'],
    ]);
  });

  test('a hunt with no research tool costs no model call', async () => {
    await settings('autopilot');
    const prior = await sql<{ driver: string; enabled: boolean }[]>`
      select driver, enabled from control_integrations where kind = 'discovery'`;
    await sql`update control_integrations set enabled = false where kind = 'discovery'`;
    const monid = process.env.MONID_API_KEY;
    delete process.env.MONID_API_KEY;
    try {
      const { requests } = await b.runTools([['web_search', { query: 'doceria' }]], {
        kind: 'discovery',
        payload: { query: `sem pesquisa ${nonce}` },
      });
      expect(requests).toBe(0);
      const [t] = await sql<{ error: string | null }[]>`
        select error from crm_turns where params->>'query' = ${`sem pesquisa ${nonce}`}`;
      expect(t!.error).toContain('sem ferramenta de pesquisa');
    } finally {
      for (const d of prior)
        await sql`update control_integrations set enabled = ${d.enabled}
          where kind = 'discovery' and driver = ${d.driver}`;
      if (monid !== undefined) process.env.MONID_API_KEY = monid;
    }
  });
});
