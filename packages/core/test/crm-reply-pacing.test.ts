import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { unansweredTouchesTx } from '../src/crm/guardrails.ts';
import { isBareGreeting, replyDelayMs, typingHoldMs } from '../src/crm/pacing.ts';
import { renderTranscript } from '../src/agent-host/agents/crm/context-render.ts';
import { controlTx } from '../src/modules/control.ts';
import { DEFAULT_GUARDRAILS, validateSetting } from '../src/modules/integrations.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

// A store's WhatsApp greeting the agent answered as if a person had written (Nov 2026).
const BRIGADERIA =
  'Olá bem vindo a Brigaderia da Vovó. Vamos adoçar seu dia com doces artesanais deliciosos 🍰 atendimento de segunda à sábado as 10h as 18h. Agradecemos a preferência. 💗';

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

describe("transcript — what the agent sees of a store's robot", () => {
  const ours = {
    direction: 'out' as const,
    body: 'Oi! Sou da Venduá, a gente faz a loja online de vocês.',
    status: 'sent',
    author: 'agent',
    created_at: '2026-11-25T15:58:00Z',
  };
  test('an answer seconds after our message says so; a later one does not', () => {
    const t = renderTranscript(
      [
        ours,
        {
          direction: 'in',
          body: BRIGADERIA,
          status: 'received',
          author: 'lead',
          created_at: '2026-11-25T15:58:04Z',
        },
      ],
      'America/Sao_Paulo',
    ).split('\n');
    expect(t[1]).toContain('LEAD (chegou 4 s depois da nossa mensagem):');
    const later = renderTranscript(
      [
        ours,
        {
          direction: 'in',
          body: 'Olá, boa tarde',
          status: 'received',
          author: 'lead',
          created_at: '2026-11-25T16:17:00Z',
        },
      ],
      'America/Sao_Paulo',
    );
    expect(later).not.toContain('depois da nossa mensagem');
  });

  test('a message the agent marked reads as the robot, not the lead', () => {
    const t = renderTranscript(
      [
        ours,
        {
          direction: 'in',
          body: BRIGADERIA,
          status: 'received',
          author: 'lead',
          created_at: '2026-11-25T16:05:00Z',
          auto_reply: true,
        },
      ],
      'UTC',
    );
    expect(t).toContain('ROBÔ DO LEAD');
  });
});

describe.skipIf(!OWNER_URL)('pacing and mark_auto_reply (db)', () => {
  const b = crmBench('reply-pacing');
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
      values (${t!.id}, 'out', 'agent', 'Oi! Sou da Venduá, a gente faz loja online pra confeitaria.', 'sent', ${at}, ${at})`;
    return { lead, wa: lead.whatsapp!, threadId: t!.id };
  }
  const inboundRows = (leadId: string) =>
    b.mail(leadId).then((rows) => rows.filter((m) => m.kind === 'message.inbound'));

  test('a slow answer waits 4–9 min; a burst joins the waiting answer', async () => {
    await b.settings('autopilot', { humanReplyPacing: true });
    const { lead, wa } = await contacted(25 * 60_000);
    const t0 = Date.now();
    await b.inbound(wa, 'Olá boa tarde');
    const [first] = await inboundRows(lead.id);
    const wait = first!.deliver_at.getTime() - t0;
    expect(wait).toBeGreaterThanOrEqual(4 * 60_000 - 2_000);
    expect(wait).toBeLessThanOrEqual(9 * 60_000 + 2_000);
    await b.inbound(wa, 'Nós temos aplicativo');
    const rows = await inboundRows(lead.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.deliver_at.getTime()).toBe(rows[0]!.deliver_at.getTime());
    expect(rows[0]!.deliver_at.getTime()).toBe(first!.deliver_at.getTime());
  });

  test('a fast answer comes within a minute, a bare greeting waits for more', async () => {
    await b.settings('autopilot', { humanReplyPacing: true });
    const { lead, wa } = await contacted(2 * 60_000);
    const t0 = Date.now();
    await b.inbound(wa, 'Sim, pelo WhatsApp mesmo');
    const [row] = await inboundRows(lead.id);
    expect(row!.deliver_at.getTime() - t0).toBeLessThanOrEqual(61_000);

    const other = await contacted(60_000);
    const t1 = Date.now();
    await b.inbound(other.wa, 'Oi, boa tarde!');
    const [greet] = await inboundRows(other.lead.id);
    const wait = greet!.deliver_at.getTime() - t1;
    expect(wait).toBeGreaterThanOrEqual(39_000);
    expect(wait).toBeLessThanOrEqual(61_000);
    // what they type next holds the answer until they stop
    await b.inbound(other.wa, 'Nós temos aplicativo');
    const both = await inboundRows(other.lead.id);
    expect(both[0]!.deliver_at.getTime()).toBe(both[1]!.deliver_at.getTime());
    expect(both[1]!.deliver_at.getTime()).toBeGreaterThanOrEqual(greet!.deliver_at.getTime());
  });

  test('mark_auto_reply: the robot is marked, nothing is sent, the follow-up comes back', async () => {
    await b.settings('autopilot');
    const { lead, wa, threadId } = await contacted(4_000);
    await b.inbound(wa, BRIGADERIA);
    // the greeting counts as an answer until the agent says otherwise
    const before = await controlTx(b.appSql, (tx) => unansweredTouchesTx(tx, lead.id));
    expect(before.total).toBe(0);
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
    // the turn closed on the marking: the send never ran
    expect(outcomes.map((o) => o.name)).toEqual(['mark_auto_reply']);
    const [msg] = await sql<{ auto_reply: boolean }[]>`
      select auto_reply from lead_messages where thread_id = ${threadId} and direction = 'in'`;
    expect(msg!.auto_reply).toBe(true);
    expect(await b.outbound(lead.id)).toHaveLength(1);
    const after = await controlTx(b.appSql, (tx) => unansweredTouchesTx(tx, lead.id));
    expect(after.total).toBe(1);
    const pending = await b.mail(lead.id);
    expect(pending.some((m) => m.kind === 'timer.followup' && !m.consumed_by_turn)).toBe(true);
  });

  test('mark_auto_reply refuses when the lead wrote first', async () => {
    await b.settings('autopilot');
    const lead = await b.lead();
    b.mine.add(lead.id);
    await b.inbound(lead.whatsapp!, 'Olá! Bem-vindo à nossa loja');
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.subject_id = ${lead.id} and m.kind = 'message.inbound'`;
    const { outcomes } = await b.runTools([['mark_auto_reply', {}]], {
      leadId: lead.id,
      kind: 'reply',
    });
    expect(outcomes[0]).toMatchObject({ name: 'mark_auto_reply' });
    expect(String((outcomes[0] as { content: string }).content)).toContain(
      'quem escreveu primeiro',
    );
  });
});
