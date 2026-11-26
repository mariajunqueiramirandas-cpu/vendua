import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { conversationClosedTx, retireClosedCadence, scheduleCadenceTx } from '../src/crm/agenda.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
import { deliverQueued } from '../src/crm/outbox.ts';
import { controlTx } from '../src/modules/control.ts';
import { listThreads } from '../src/modules/threads.ts';
import { call, crmBench, OWNER_URL } from './crm-harness.ts';

// Knowing when to stop: a lead who turned us down, got our goodbye and thanked us back is done.
// No answer to the thanks (the store's greeting robot fires on every message we send), and no
// automatic follow-up on a conversation that is over — including the ones booked before the
// cadence knew to stop.

const DECLINE = 'Boa tarde! Obrigada pela oportunidade mas não temos interesse no momento ❤️';
const FAREWELL =
  'Imagina, Ana, obrigado pelo retorno! Se um dia fizer sentido organizar as encomendas num link só seu, é só me chamar por aqui. Bom trabalho com os doces de fim de ano 🧡';
const THANKS = 'Muito obrigada! Pra vocês também ❤️';
const ROBOT =
  'Olá, tudo bem?!\nSou a Ana, irei te atender em alguns minutos. 🧡🫶\nNão aceitamos ligações!!';

describe.skipIf(!OWNER_URL)('the agent knows when a conversation is over (db)', () => {
  const b = crmBench('conv-end');
  const { sql, appSql } = b;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => b.mine.clear());

  /** a lead we cold-messaged on WhatsApp a few minutes ago (sent, unanswered) */
  async function contacted(name: string) {
    const lead = await b.lead({ name });
    const [t] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${lead.id}, 'whatsapp') returning id`;
    const at = new Date(Date.now() - 5 * 60_000);
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status, created_at, dispatch_attempted_at)
      values (${t!.id}, 'out', 'agent', 'Oi! Sou da Venduá, a gente monta a loja online da confeitaria.', 'sent', ${at}, ${at})`;
    return { lead, wa: lead.whatsapp!, threadId: t!.id };
  }
  const pendingFollowups = async (leadId: string) =>
    (await b.mail(leadId)).filter((m) => m.kind === 'timer.followup' && !m.consumed_by_turn);
  const closed = (leadId: string) => controlTx(appSql, (tx) => conversationClosedTx(tx, leadId));

  test('decline → goodbye (closing) → thanks → robot: one goodbye, no ping-pong, no follow-up', async () => {
    await b.settings('autopilot');
    const name = `Docelina ${b.nonce}`;
    const { lead, wa } = await contacted(name);

    // the decline: the goodbye goes out marked as closing, and the turn ends with it
    await b.inbound(wa, DECLINE);
    let run = b.runtime([
      call('send_message', { body: FAREWELL, closing: true }),
      call('send_message', { body: 'nunca deveria sair' }),
    ]);
    await b.settle(run.rt);
    expect(run.adapter.requests).toHaveLength(1);
    expect((await b.outbound(lead.id)).map((m) => m.body)).toEqual([
      expect.stringContaining('Sou da Venduá'),
      FAREWELL,
    ]);
    await deliverQueued(appSql);
    // the cadence books nothing after our goodbye
    expect(await pendingFollowups(lead.id)).toHaveLength(0);
    expect(await closed(lead.id)).toBe(true);

    // her thanks: no answer, the turn ends on end_conversation without a nudge
    await b.inbound(wa, THANKS);
    run = b.runtime([
      call('end_conversation', { reason: 'ela só agradeceu depois da nossa despedida' }),
      call('send_message', { body: 'Obrigado, Ana! Sucesso aí 🧡' }),
    ]);
    await b.settle(run.rt);
    expect(run.adapter.requests).toHaveLength(1);
    expect(await b.outbound(lead.id)).toHaveLength(2);
    const [thanks] = await sql<{ closes_conversation: boolean }[]>`
      select m.closes_conversation from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${lead.id} and m.body = ${THANKS}`;
    expect(thanks!.closes_conversation).toBe(true);
    const [thread] = await listThreads(appSql, { q: name });
    expect(thread!.needsReply).toBe(false);
    const [turn] = (await b.turns(lead.id)).slice(-1);
    expect(turn).toMatchObject({ kind: 'reply', status: 'done', acted: true });

    // the store's greeting robot: marked, nothing sent, and still no follow-up
    await b.inbound(wa, ROBOT);
    run = b.runtime([call('mark_auto_reply', { reason: 'saudação automática da loja' })]);
    await b.settle(run.rt);
    expect(await b.outbound(lead.id)).toHaveLength(2);
    expect(await pendingFollowups(lead.id)).toHaveLength(0);
  });

  test('end_conversation is refused when we never wrote: a person who wrote first gets an answer', async () => {
    await b.settings('autopilot');
    const lead = await b.lead({ name: `Inbound ${b.nonce}` });
    await b.inbound(lead.whatsapp!, 'Obrigada!');
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.subject_id = ${lead.id} and m.kind = 'message.inbound'`;
    const { outcomes } = await b.runTools([['end_conversation', { reason: 'só agradeceu' }]], {
      leadId: lead.id,
      kind: 'reply',
    });
    expect(outcomes[0]).toMatchObject({ name: 'end_conversation', ok: true });
    expect(JSON.stringify(outcomes[0])).toContain('a pessoa escreveu primeiro, responda');
  });

  test('an answered decline gets no automatic follow-up, and the ones already booked go', async () => {
    await b.settings('autopilot');
    const { lead, wa, threadId } = await contacted(`Cia do Cake ${b.nonce}`);
    await b.inbound(wa, 'Agradecemos o contato, mas não temos interesse. Deixe para uma próxima');
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.subject_id = ${lead.id} and m.kind = 'message.inbound'`;
    // before this fix: the goodbye went out unmarked and the send booked the cadence anyway
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status, dispatch_attempted_at)
      values (${threadId}, 'out', 'agent', 'Imagina, obrigado pelo retorno!', 'sent', now())`;
    await controlTx(appSql, (tx) =>
      requestLeadTx(tx, {
        leadId: lead.id,
        kind: 'timer.followup',
        source: 'cadence',
        dedupeKey: `crm:timer:${lead.id}:${crypto.randomUUID()}`,
        at: new Date(Date.now() + 3 * 86_400_000),
        payload: { focus: 'sem resposta há 3 dia(s)', requested: false, by: 'cadence' },
        keepParked: true,
      }),
    );
    expect(await pendingFollowups(lead.id)).toHaveLength(1);

    // the cadence itself no longer books on an answered decline
    expect(await closed(lead.id)).toBe(true);
    await sql`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.subject_id = ${lead.id} and m.kind = 'timer.followup'`;
    expect(await controlTx(appSql, (tx) => scheduleCadenceTx(tx, lead.id, 3))).toBe(false);

    // and the sweep retires what was booked before; a date the lead asked for stays
    await controlTx(appSql, (tx) =>
      requestLeadTx(tx, {
        leadId: lead.id,
        kind: 'timer.followup',
        source: 'cadence',
        dedupeKey: `crm:timer:${lead.id}:${crypto.randomUUID()}`,
        at: new Date(Date.now() + 3 * 86_400_000),
        payload: { focus: 'sem resposta há 3 dia(s)', requested: false, by: 'cadence' },
        keepParked: true,
      }),
    );
    expect(await retireClosedCadence(appSql)).toBeGreaterThanOrEqual(1);
    expect(await pendingFollowups(lead.id)).toHaveLength(0);
    const [row] = await sql<{ next_action_at: Date | null }[]>`
      select next_action_at from leads where id = ${lead.id}`;
    expect(row!.next_action_at).toBeNull();
    const notes = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${lead.id} and kind = 'system'`;
    expect(notes.map((n) => n.body).join('\n')).toContain('Follow-up automático cancelado');
  });

  test('a decline that goes on, or a question after it, keeps the conversation open', async () => {
    await b.settings('autopilot');
    const quiet = async (wa: string) =>
      sql`
        delete from agent_mailbox m using agent_actors a, leads l
        where a.id = m.actor_id and a.subject_id = l.id::text and l.whatsapp = ${wa}
          and m.kind = 'message.inbound'`;
    const answer = (threadId: string) =>
      sql`
        insert into lead_messages (thread_id, direction, author, body, status, dispatch_attempted_at)
        values (${threadId}, 'out', 'agent', 'Entendi!', 'sent', now())`;

    // "não temos interesse no iFood, mas…" is interest in us
    const a = await contacted(`Mas ${b.nonce}`);
    await b.inbound(a.wa, 'Não temos interesse em sair do iFood, mas queria algo pro WhatsApp');
    await quiet(a.wa);
    await answer(a.threadId);
    expect(await closed(a.lead.id)).toBe(false);

    // a question after the decline reopens it
    const q = await contacted(`Volta ${b.nonce}`);
    await b.inbound(q.wa, 'Não temos interesse no momento');
    await quiet(q.wa);
    await answer(q.threadId);
    await b.inbound(q.wa, 'Na verdade, quanto custa?');
    await quiet(q.wa);
    await answer(q.threadId);
    expect(await closed(q.lead.id)).toBe(false);

    // a decline we haven't answered yet isn't over: the agent still says goodbye
    const u = await contacted(`Sem resposta ${b.nonce}`);
    await b.inbound(u.wa, 'Não temos interesse');
    await quiet(u.wa);
    expect(await closed(u.lead.id)).toBe(false);

    // an ordinary conversation is open
    const o = await contacted(`Aberta ${b.nonce}`);
    await b.inbound(o.wa, 'Como funciona?');
    await quiet(o.wa);
    await answer(o.threadId);
    expect(await closed(o.lead.id)).toBe(false);
  });
});
