import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ingestInbound } from '../src/crm/inbound.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { scheduleTimerTx } from '../src/crm/agenda.ts';
import { composeMessageTx } from '../src/modules/threads.ts';
import { putSetting } from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  e164Phone,
  insertLeadTx,
  leadInsert,
  leadPatch,
  updateLead,
} from '../src/modules/leads.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

describe('lead phones are stored as E.164', () => {
  test('a typed BR number gains +55; an explicit country code and jids are kept', () => {
    expect(e164Phone('(31) 98765-4321')).toBe('+5531987654321');
    expect(e164Phone('031 98765-4321')).toBe('+5531987654321');
    expect(e164Phone('(31) 3333-4444')).toBe('+553133334444');
    expect(e164Phone('5531987654321')).toBe('+5531987654321');
    expect(e164Phone('+1 415 555 1234')).toBe('+14155551234');
    expect(e164Phone('98765-4321')).toBeNull();
    expect(e164Phone('447911123456')).toBeNull();
    expect(e164Phone('123456789012345@lid')).toBeNull();
  });

  test('staff create, CSV import and agent patches all normalize', () => {
    const ins = leadInsert({ name: 'X', whatsapp: '(31) 98765-4321', phone: '31 3333-4444' });
    expect(ins.whatsapp).toBe('+5531987654321');
    expect(ins.phone).toBe('+553133334444');
    expect(leadPatch({ whatsapp: '31987654321' }, 'agent').whatsapp).toBe('+5531987654321');
    // what can't be placed stays as typed — the send refuses it
    expect(leadInsert({ name: 'Y', whatsapp: '9876-5432' }).whatsapp).toBe('9876-5432');
    expect(leadInsert({ name: 'Z', whatsapp: '123456789012345@lid' }).whatsapp).toBe(
      '123456789012345@lid',
    );
  });

  test('an agent-set next action keeps the 10-minute floor; staff may set one due now', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(() => leadPatch({ nextActionAt: past }, 'agent')).toThrow(/10 minutes/);
    expect(leadPatch({ nextActionAt: past }, 'staff').next_action_at).toBe(past);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    expect(leadPatch({ nextActionAt: later }, 'agent').next_action_at).toBe(later);
  });
});

describe.skipIf(!OWNER_URL)('lead agent guards (db)', () => {
  const b = crmBench('guards');
  const { sql, mine } = b;
  const uniq = crypto.randomUUID().slice(0, 8);
  const freshDigits = () => crypto.randomUUID().replace(/\D/g, '').padEnd(8, '7').slice(0, 8);
  const mkLead = async (fields: Record<string, unknown>) =>
    (await controlTx(sql, (tx) => insertLeadTx(tx, fields))).body.lead.id;
  /** A date the agent or staff books, a day out. */
  const book = (leadId: string, by: 'agent' | 'staff', requested: boolean) =>
    controlTx(sql, (tx) =>
      scheduleTimerTx(tx, {
        leadId,
        at: new Date(Date.now() + 86_400_000),
        focus: 'retomar',
        requested,
        by,
        floor: false,
      }),
    );
  /** The lead's dates still waiting for its agent. */
  const datesOf = async (leadId: string) =>
    (await b.mail(leadId)).filter((m) => !m.consumed_by_turn && m.kind.startsWith('timer.'));

  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => mine.clear());
  afterEach(async () => {
    await sql`delete from control_settings where key in ('guardrails', 'agent')`;
  });

  test('an inbound while replies are switched off parks and is answered once they are back', async () => {
    await b.settings('supervised', {}, { jobs: { reply: false } });
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `55119${freshDigits()}@s.whatsapp.net`,
      body: 'tem horário amanhã?',
      providerMessageId: `parked-${uniq}`,
    });
    if ('ignored' in res) throw new Error('unexpected ignore');
    const filed = () => sql`
      select 1 from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.subject_id = ${res.leadId} and m.kind = 'message.inbound'
        and m.payload->>'messageId' = ${res.messageId}
    `;
    // the reply job is off: nothing is filed for the message
    expect(await filed()).toHaveLength(0);
    // replies back on: what the lead wrote meanwhile is served, and never twice
    await putSetting(sql, 'agent', { level: 'supervised', jobs: { reply: true } }, b.key());
    expect(await filed()).toHaveLength(1);
    await putSetting(sql, 'agent', { level: 'supervised', jobs: { reply: true } }, b.key());
    expect(await filed()).toHaveLength(1);
  });

  test('a lead going live stops the sales agent and its own dates; staff dates stay', async () => {
    const leadId = await mkLead({ name: `live-${uniq}`, agent_mode: 'auto', state: 'invited' });
    await book(leadId, 'agent', true);
    await book(leadId, 'staff', false);
    await updateLead(sql, leadId, { state: 'live' }, `guard-live-${uniq}`, 'system');
    const [lead] = await sql<{ agent_mode: string; state: string }[]>`
      select agent_mode, state from leads where id = ${leadId}
    `;
    expect(lead).toEqual({ agent_mode: 'off', state: 'live' });
    expect((await datesOf(leadId)).map((m) => m.payload.by)).toEqual(['staff']);
  });

  test("the agent's whatsapp to a store owner's number never goes out", async () => {
    const national = `119${freshDigits()}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${`guard-${uniq}`}, 'Loja Guard') returning id
    `;
    const [u] = await sql<{ id: string }[]>`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${t!.id}, 'Dona', ${national}, 'owner') returning id
    `;
    // a membership counts once its person signed in with a WhatsApp code
    await sql`
      insert into merchant_sessions (tenant_id, user_id, secret_hash, expires_at, proof_kind, proof_subject)
      values (${t!.id}, ${u!.id}, ${`h-${uniq}`}, now() + interval '1 day', 'phone', ${national})
    `;
    const leadId = await mkLead({ name: `merchant-${uniq}`, whatsapp: `+55${national}` });
    const send = async (author: 'agent' | 'staff') => {
      const composed = await controlTx(sql, (tx) =>
        composeMessageTx(tx, {
          leadId,
          channel: 'whatsapp',
          body: 'oi',
          author,
          status: 'queued',
        }),
      );
      return dispatchMessage(sql, composed.body.message.id);
    };
    expect(await send('agent')).toEqual({ ok: false, reason: 'número de lojista' });
    // staff may still write to a customer — only the sales agent is held off
    expect((await send('staff')).reason).not.toBe('número de lojista');
  });

  test('a whatsapp number with no country code is refused at send', async () => {
    const leadId = await mkLead({ name: `noddi-${uniq}`, whatsapp: '98765-4321' });
    const composed = await controlTx(sql, (tx) =>
      composeMessageTx(tx, {
        leadId,
        channel: 'whatsapp',
        body: 'oi',
        author: 'staff',
        status: 'queued',
      }),
    );
    const out = await dispatchMessage(sql, composed.body.message.id);
    expect(out).toEqual({ ok: false, reason: 'número de whatsapp sem DDI' });
  });

  test('create_lead takes only its declared fields', async () => {
    await b.settings('supervised', {}, { newLeadMode: { discovery: 'draft' } });
    const name = `created-${uniq}`;
    const lead = {
      name,
      whatsapp: `+55119${freshDigits()}`,
      findings: 'doceria artesanal, vende pelo whatsapp, sem link próprio de pedidos',
    };
    const { outcomes } = await b.runTools(
      [
        ['create_lead', { ...lead, agentMode: 'auto', state: 'live', owner: 'quem-quiser' }],
        ['create_lead', lead],
      ],
      { kind: 'discovery', payload: { query: name } },
    );
    // staff columns are not the model's: the call is refused whole, then the plain one lands
    expect(outcomes[0]).toMatchObject({ name: 'create_lead', ok: false });
    expect(outcomes[1]).toMatchObject({ name: 'create_lead', ok: true });
    const rows = await sql<{ agent_mode: string; state: string; owner: string | null }[]>`
      select agent_mode, state, owner from leads where name = ${name}
    `;
    expect(rows).toHaveLength(1);
    const created = rows[0];
    expect(created!.state).toBe('lead');
    expect(created!.agent_mode).toBe('draft');
    expect(created!.owner).toBeNull();
  });

  test("create_lead's date is the agent's own", async () => {
    const name = `dated-${uniq}`;
    const { outcomes } = await b.runTools(
      [
        [
          'create_lead',
          {
            name,
            whatsapp: `+55119${freshDigits()}`,
            findings: 'doceria artesanal, vende pelo whatsapp, sem link próprio de pedidos',
            nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        ],
      ],
      { kind: 'discovery', payload: { query: name } },
    );
    expect(outcomes[0]).toMatchObject({ name: 'create_lead', ok: true });
    const [lead] = await sql<{ id: string }[]>`select id from leads where name = ${name}`;
    expect((await datesOf(lead!.id)).map((m) => [m.kind, m.payload.by])).toEqual([
      ['timer.followup', 'agent'],
    ]);
    const past = await b.runTools(
      [
        [
          'create_lead',
          {
            name: `past-${uniq}`,
            whatsapp: `+55119${freshDigits()}`,
            findings: 'doceria artesanal, vende pelo whatsapp, sem link próprio de pedidos',
            nextActionAt: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      ],
      { kind: 'discovery', payload: { query: `past-${uniq}` } },
    );
    expect(past.outcomes[0]).toMatchObject({
      ok: false,
      content: expect.stringContaining('10 minutes'),
    });
  });

  test('a run with no lead touches only the leads it created', async () => {
    const foreignName = `foreign-${uniq}`;
    await mkLead({ name: foreignName });
    // search_leads is how a discovery run learns a lead's ref; the run's first alias is l1
    const seen = await b.runTools(
      [
        ['search_leads', { q: foreignName }],
        ['update_lead', { lead: 'l1', city: 'Recife' }],
        ['add_note', { lead: 'l1', body: 'x' }],
        ['get_lead', { lead: 'l1' }],
      ],
      { kind: 'discovery', payload: { query: foreignName } },
    );
    expect(seen.outcomes[0]).toMatchObject({ name: 'search_leads', ok: true });
    expect(seen.outcomes[1]).toMatchObject({
      name: 'update_lead',
      ok: false,
      content: expect.stringContaining('não foi criado nem mesclado'),
    });
    expect(seen.outcomes[2]).toMatchObject({
      name: 'add_note',
      ok: false,
      content: expect.stringContaining('não foi criado nem mesclado'),
    });
    // v3: a read is open — get_lead answers for any ref the run has seen; only writes are fenced
    expect(seen.outcomes[3]).toMatchObject({ name: 'get_lead', ok: true });
    const [o] = await sql<{ city: string | null }[]>`
      select city from leads where name = ${foreignName}
    `;
    expect(o!.city).toBeNull();

    const ownName = `own-${uniq}`;
    const made = await b.runTools(
      [
        [
          'create_lead',
          {
            name: ownName,
            whatsapp: `+55119${freshDigits()}`,
            findings: 'pizzaria de bairro, pedidos só por telefone e ifood',
          },
        ],
        ['update_lead', { lead: 'l1', city: 'Recife' }],
      ],
      { kind: 'discovery', payload: { query: ownName } },
    );
    expect(made.outcomes[0]).toMatchObject({ name: 'create_lead', ok: true });
    expect(made.outcomes[1]).toMatchObject({ name: 'update_lead', ok: true });
    const [own] = await sql<
      { city: string | null }[]
    >`select city from leads where name = ${ownName}`;
    expect(own!.city).toBe('Recife');
  });

  test('a thread-bound handoff drops the dates the agent booked', async () => {
    const leadId = await mkLead({ name: `handoff-${uniq}`, agent_mode: 'auto' });
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await book(leadId, 'agent', true);
    await book(leadId, 'staff', false);
    const { outcomes } = await b.runTools(
      [['request_human', { reason: 'quer falar com alguém' }]],
      {
        leadId,
        kind: 'reply',
        payload: { threadId: thread!.id },
      },
    );
    expect(outcomes[0]).toMatchObject({ name: 'request_human', ok: true });
    // the pause holds this thread: the agent's booked dates go, staff's stay
    expect((await datesOf(leadId)).map((m) => m.payload.by)).toEqual(['staff']);
  });

  test('update_lead refuses an agent date that is already due', async () => {
    const leadId = await mkLead({ name: `floor-${uniq}` });
    const { outcomes } = await b.runTools(
      [['update_lead', { nextActionAt: new Date(Date.now() - 3_600_000).toISOString() }]],
      { leadId, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({
      name: 'update_lead',
      ok: false,
      content: expect.stringContaining('10 minutes'),
    });
    expect(await datesOf(leadId)).toHaveLength(0);
  });
});
