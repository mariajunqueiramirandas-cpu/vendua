import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { autoReplyScore, looksAutomated, MACHINE_WINDOW_MS } from '../src/crm/auto-reply.ts';
import { scheduleCadenceTx } from '../src/crm/agenda.ts';
import { isBareGreeting, replyDelayMs, typingHoldMs } from '../src/crm/pacing.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, validateSetting } from '../src/modules/integrations.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

// Real greetings that the agent answered as if a person had written (Nov 2026).
const DOCES_DOS_SONHOS =
  'Olá, tudo bem? como podemos te ajudar? 😍💕✨\nPra agilizar o nosso atendimento você pode navegar a vontade pelo nosso Catálogo https://wa.me/c/5522992918924';
const BRIGADERIA =
  'Olá bem vindo a Brigaderia da Vovó. Vamos adoçar seu  dia com  doces artesanais deliciosos 🍰🧁🥧 atendimento  de segunda à sábado  as 10h as 18h . Loja aberta das 11h  as 19h... Bolos  personalizados , semi espatulados com flores e outras decorações  consulta  valores  aqui mesmo  no Whatsapp  agradecemos  a preferência. 🎂🧁🍰💗';

describe('auto reply — what reads like a machine', () => {
  test("the stores' greetings score as templates", () => {
    expect(autoReplyScore(DOCES_DOS_SONHOS)).toBeGreaterThanOrEqual(2);
    expect(autoReplyScore(BRIGADERIA)).toBeGreaterThanOrEqual(2);
    expect(autoReplyScore('Olá! Seja bem-vinda à Doceria Lindinha 💕')).toBeGreaterThanOrEqual(2);
    expect(
      autoReplyScore('Estamos fora do horário de atendimento. Retornaremos assim que possível!'),
    ).toBeGreaterThanOrEqual(2);
    expect(
      autoReplyScore('Oi! Digite 1 para cardápio, 2 para encomendas, 3 para falar com atendente'),
    ).toBeGreaterThanOrEqual(2);
  });

  test("a person's short answers don't", () => {
    for (const human of [
      'Olá boa tarde',
      'Nós temos aplicativo',
      'Oi, como posso te ajudar?',
      'quem é?',
      'Pode falar',
      'A gente anota tudo no caderno mesmo kkk',
      'Sim, pelo WhatsApp mesmo',
    ])
      expect(autoReplyScore(human)).toBeLessThan(2);
  });

  test('only within seconds of our send, and only when something of ours waits', () => {
    expect(looksAutomated(BRIGADERIA, 4_000)).toBe(true);
    expect(looksAutomated(BRIGADERIA, MACHINE_WINDOW_MS)).toBe(true);
    // the same words an hour later came from a person pasting the shop's hours
    expect(looksAutomated(BRIGADERIA, MACHINE_WINDOW_MS + 1)).toBe(false);
    expect(looksAutomated(BRIGADERIA, null)).toBe(false);
    expect(looksAutomated('Olá boa tarde', 3_000)).toBe(false);
  });
});

describe('pacing — when a person would answer', () => {
  const at = (v: number) => () => v;
  test('a lead who took over 10 minutes waits 4–9 minutes', () => {
    expect(replyDelayMs(11 * 60_000, false, at(0))).toBe(4 * 60_000);
    expect(replyDelayMs(3 * 3_600_000, false, at(1))).toBe(9 * 60_000);
    expect(replyDelayMs(11 * 60_000, true, at(0))).toBe(4 * 60_000);
  });

  test('a lead in the conversation, or who wrote first, gets it within a minute', () => {
    expect(replyDelayMs(2 * 60_000, false, at(0))).toBe(0);
    expect(replyDelayMs(10 * 60_000, false, at(1))).toBe(60_000);
    expect(replyDelayMs(null, false, at(0.5))).toBe(30_000);
  });

  test('a bare greeting waits for what comes after it', () => {
    expect(replyDelayMs(60_000, true, at(0))).toBe(40_000);
    expect(replyDelayMs(null, true, at(1))).toBe(60_000);
    for (const g of ['Olá boa tarde', 'oiii', 'Oi, tudo bem?', 'Bom dia! 😊', 'e aí, beleza?'])
      expect(isBareGreeting(g)).toBe(true);
    for (const m of ['Nós temos aplicativo', 'oi, quanto custa?', 'sim', 'Olá, quem fala?', ''])
      expect(isBareGreeting(m)).toBe(false);
  });

  test('a new message holds a waiting answer 20–40 s', () => {
    expect(typingHoldMs(at(0))).toBe(20_000);
    expect(typingHoldMs(at(1))).toBe(40_000);
  });

  test('pacing is on by default and the setting takes a boolean', () => {
    expect(DEFAULT_GUARDRAILS.humanReplyPacing).toBe(true);
    expect(() => validateSetting('guardrails', { humanReplyPacing: false })).not.toThrow();
    expect(() => validateSetting('guardrails', { humanReplyPacing: 'yes' })).toThrow();
  });
});

describe.skipIf(!OWNER_URL)('auto reply and pacing (db)', () => {
  const b = crmBench('auto-reply');
  const { sql } = b;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => b.mine.clear());

  /** a lead we wrote to on WhatsApp `agoMs` ago (sent, not answered) */
  async function contacted(agoMs: number) {
    const lead = await b.lead();
    b.mine.add(lead.id);
    const [t] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${lead.id}, 'whatsapp') returning id`;
    const at = new Date(Date.now() - agoMs);
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status, created_at, dispatch_attempted_at)
      values (${t!.id}, 'out', 'agent', 'Oi! Sou da Venduá. Hoje os pedidos chegam pelo WhatsApp?', 'sent', ${at}, ${at})`;
    return { lead, threadId: t!.id };
  }
  const inboundRows = (leadId: string) =>
    b.mail(leadId).then((rows) => rows.filter((m) => m.kind === 'message.inbound'));
  const flags = (threadId: string) =>
    sql<{ body: string; auto_reply: boolean }[]>`
      select body, auto_reply from lead_messages
      where thread_id = ${threadId} and direction = 'in' order by created_at`;

  test('a greeting seconds after our send is context: no turn, follow-up kept, team not told', async () => {
    await b.settings('autopilot');
    const { lead, threadId } = await contacted(3_000);
    await controlTx(b.appSql, (tx) => scheduleCadenceTx(tx, lead.id, 3));
    const res = await b.inbound(lead.whatsapp!, BRIGADERIA);
    expect(res).toMatchObject({ autoReply: true });
    expect([...(await flags(threadId))]).toEqual([{ body: BRIGADERIA, auto_reply: true }]);
    expect(await inboundRows(lead.id)).toEqual([]);
    const pending = await b.mail(lead.id);
    expect(pending.filter((m) => m.kind === 'timer.followup' && !m.consumed_by_turn)).toHaveLength(
      1,
    );
    const told = await sql`
      select 1 from staff_events where kind = 'lead.replied' and data->>'leadId' = ${lead.id}`;
    expect(told).toHaveLength(0);

    // the person writes later: that one is answered, and it retires the follow-up
    await sql`update lead_messages set received_at = received_at - interval '9 minutes'
      where thread_id = ${threadId}`;
    const human = await b.inbound(lead.whatsapp!, 'Olá boa tarde, pode falar');
    expect('autoReply' in human && human.autoReply).toBeFalsy();
    expect(await inboundRows(lead.id)).toHaveLength(1);
    const left = await b.mail(lead.id);
    expect(left.filter((m) => m.kind === 'timer.followup' && !m.consumed_by_turn)).toHaveLength(0);
  });

  test('the same words long after our send came from a person', async () => {
    await b.settings('autopilot');
    const { lead, threadId } = await contacted(30 * 60_000);
    const res = await b.inbound(lead.whatsapp!, DOCES_DOS_SONHOS);
    expect('autoReply' in res && res.autoReply).toBeFalsy();
    expect((await flags(threadId))[0]?.auto_reply).toBe(false);
    expect(await inboundRows(lead.id)).toHaveLength(1);
  });

  test('a slow answer waits 4–9 min; a burst joins the waiting answer', async () => {
    await b.settings('autopilot', { humanReplyPacing: true });
    const { lead } = await contacted(25 * 60_000);
    const t0 = Date.now();
    await b.inbound(lead.whatsapp!, 'Olá boa tarde');
    const [first] = await inboundRows(lead.id);
    const wait = first!.deliver_at.getTime() - t0;
    expect(wait).toBeGreaterThanOrEqual(4 * 60_000 - 2_000);
    expect(wait).toBeLessThanOrEqual(9 * 60_000 + 2_000);
    await b.inbound(lead.whatsapp!, 'Nós temos aplicativo');
    const rows = await inboundRows(lead.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.deliver_at.getTime()).toBe(rows[0]!.deliver_at.getTime());
    expect(rows[0]!.deliver_at.getTime()).toBe(first!.deliver_at.getTime());
  });

  test('a fast answer comes within a minute, a bare greeting waits for more', async () => {
    await b.settings('autopilot', { humanReplyPacing: true });
    const { lead } = await contacted(2 * 60_000);
    const t0 = Date.now();
    await b.inbound(lead.whatsapp!, 'Sim, pelo WhatsApp mesmo');
    const [row] = await inboundRows(lead.id);
    expect(row!.deliver_at.getTime() - t0).toBeLessThanOrEqual(61_000);

    const other = await contacted(60_000);
    const t1 = Date.now();
    await b.inbound(other.lead.whatsapp!, 'Oi, boa tarde!');
    const [greet] = await inboundRows(other.lead.id);
    const wait = greet!.deliver_at.getTime() - t1;
    expect(wait).toBeGreaterThanOrEqual(39_000);
    expect(wait).toBeLessThanOrEqual(61_000);
    // what they type next holds the answer until they stop
    await b.inbound(other.lead.whatsapp!, 'Nós temos aplicativo');
    const both = await inboundRows(other.lead.id);
    expect(both[0]!.deliver_at.getTime()).toBe(both[1]!.deliver_at.getTime());
    expect(both[1]!.deliver_at.getTime()).toBeGreaterThanOrEqual(greet!.deliver_at.getTime());
  });

  test('mark_auto_reply: a greeting the detector missed is marked, the turn sends nothing', async () => {
    await b.settings('autopilot');
    const { lead, threadId } = await contacted(4_000);
    // reads like a person to the detector: one weak marker
    await b.inbound(lead.whatsapp!, 'Olá! Em que posso te ajudar hoje?');
    expect((await flags(threadId))[0]?.auto_reply).toBe(false);
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.subject_id = ${lead.id} and m.kind = 'message.inbound'`;
    const { outcomes } = await b.runTools(
      [
        ['mark_auto_reply', { reason: 'saudação do WhatsApp Business' }],
        ['send_message', { body: 'Oi, tudo bem sim!' }],
      ],
      { leadId: lead.id, kind: 'reply' },
    );
    expect(outcomes[0]).toMatchObject({ name: 'mark_auto_reply', ok: true });
    // the turn closed on the marking: the second call never ran
    expect(outcomes.map((o) => o.name)).toEqual(['mark_auto_reply']);
    expect((await flags(threadId))[0]?.auto_reply).toBe(true);
    expect((await b.outbound(lead.id)).map((m) => m.body)).toHaveLength(1);
    const pending = await b.mail(lead.id);
    expect(pending.some((m) => m.kind === 'timer.followup' && !m.consumed_by_turn)).toBe(true);
  });
});
