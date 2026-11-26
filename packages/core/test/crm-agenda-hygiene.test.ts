import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createGateway, type ModelGateway, type ScriptedOutput } from '@vendua/agent-runtime';
import { scriptedAdapter } from '@vendua/agent-runtime/testing';
import { sweepAgendaHygiene } from '../src/crm/agenda-hygiene.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
import { controlTx } from '../src/modules/control.ts';
import { updateLeadTx } from '../src/modules/leads.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

// The agenda's housekeeping: what waits for the sales agent should still make sense. Rules retire
// the certain cases for free; the model reads the follow-ups of leads who talked with us, once,
// and cancels the ones the conversation already answered. It only ever removes.

type Msg = {
  dir: 'in' | 'out';
  body: string;
  status?: string;
  agoMin: number;
  autoReply?: boolean;
};

describe.skipIf(!OWNER_URL)('agenda hygiene (db)', () => {
  const b = crmBench('agenda-hyg');
  const { sql, appSql } = b;
  beforeAll(b.setup);
  afterAll(b.teardown);
  beforeEach(() => b.mine.clear());

  /** a lead with a WhatsApp conversation written straight to the tables (no turns filed) */
  async function leadWith(name: string, msgs: Msg[], fields: Record<string, unknown> = {}) {
    const lead = await b.lead({ name, ...fields });
    const [t] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${lead.id}, 'whatsapp') returning id`;
    for (const m of msgs) {
      // two days back: these openers stay out of the shared WhatsApp cold cap other files count
      const at = new Date(Date.now() - (m.agoMin + 2 * 1440) * 60_000);
      await sql`
        insert into lead_messages (thread_id, direction, author, body, status, created_at,
          dispatch_attempted_at, received_at, auto_reply)
        values (${t!.id}, ${m.dir}, ${m.dir === 'in' ? 'lead' : 'agent'}, ${m.body},
          ${m.status ?? (m.dir === 'in' ? 'received' : 'sent')}, ${at},
          ${m.dir === 'out' ? at : null}, ${m.dir === 'in' ? at : null}, ${m.autoReply ?? false})`;
    }
    return { lead, threadId: t!.id };
  }

  async function timer(
    leadId: string,
    payload: { by: 'cadence' | 'agent' | 'staff'; requested?: boolean; focus?: string },
    kind: 'timer.followup' | 'timer.callback' = 'timer.followup',
    inDays = 3,
  ): Promise<string> {
    const out = await controlTx(appSql, (tx) =>
      requestLeadTx(tx, {
        leadId,
        kind,
        source: payload.by,
        dedupeKey: `crm:timer:${leadId}:${crypto.randomUUID()}`,
        at: new Date(Date.now() + inDays * 86_400_000),
        payload: {
          focus: payload.focus ?? 'retomar',
          requested: payload.requested ?? false,
          by: payload.by,
        },
        keepParked: true,
      }),
    );
    return out.mailboxId!;
  }

  const pending = async (leadId: string) =>
    (await b.mail(leadId))
      .filter((m) => m.kind.startsWith('timer.') && !m.consumed_by_turn)
      .map((m) => m.id);
  const timeline = async (leadId: string) =>
    (
      await sql<{ body: string }[]>`
        select body from lead_activities where lead_id = ${leadId} and kind = 'system'`
    ).map((r) => r.body);

  /** a gateway whose model answers per item, by the lead's name */
  function judge(decide: (lead: string) => 'keep' | 'cancel' | null, extra?: () => void) {
    const adapter = scriptedAdapter((req): ScriptedOutput => {
      extra?.();
      const user = req.messages.find((m) => m.role === 'user')!;
      const text = user.parts.map((p) => ('text' in p ? p.text : '')).join('');
      const { items } = JSON.parse(text) as { items: { index: number; lead: string }[] };
      const reviews = items
        .map((it) => ({ index: it.index, decision: decide(it.lead) }))
        .filter((r) => r.decision)
        .map((r) => ({ ...r, reason: r.decision === 'cancel' ? 'ela recusou' : 'segue aberta' }));
      // a side effect gets time to land before the verdict comes back
      return { text: JSON.stringify({ reviews }), ...(extra ? { delayMs: 300 } : {}) };
    });
    const gateway: ModelGateway = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    return { adapter, gateway };
  }
  const askedAbout = (adapter: ReturnType<typeof scriptedAdapter>, name: string) =>
    adapter.requests.filter((r) => JSON.stringify(r.messages).includes(name)).length;

  test('a lead that left takes the agent dates and drafts with it; staff dates and an opt-out goodbye stay', async () => {
    await b.settings('autopilot');
    const archived = await leadWith(`Arquivada ${b.nonce}`, [
      { dir: 'out', body: 'Oi!', agoMin: 600 },
    ]);
    const agentDate = await timer(archived.lead.id, { by: 'agent' });
    const staffDate = await timer(archived.lead.id, { by: 'staff' }, 'timer.callback');
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status)
      values (${archived.threadId}, 'out', 'agent', 'rascunho velho', 'draft')`;
    await sql`update leads set archived_at = now() where id = ${archived.lead.id}`;

    const gone = await leadWith(`Saiu ${b.nonce}`, [{ dir: 'out', body: 'Oi!', agoMin: 600 }]);
    await timer(gone.lead.id, { by: 'staff' }, 'timer.callback');
    await sql`
      insert into lead_messages (thread_id, direction, author, body, status, is_farewell)
      values (${gone.threadId}, 'out', 'agent', 'Tudo certo, não te chamo mais.', 'draft', true)`;
    await sql`update leads set unsubscribed_at = now() where id = ${gone.lead.id}`;

    expect(await sweepAgendaHygiene(appSql, null)).toBeGreaterThanOrEqual(3);
    expect(await pending(archived.lead.id)).toEqual([staffDate]);
    expect(await pending(archived.lead.id)).not.toContain(agentDate);
    const [draft] = await sql<{ status: string; error: string }[]>`
      select status, error from lead_messages where thread_id = ${archived.threadId} and body = 'rascunho velho'`;
    expect(draft).toEqual({ status: 'rejected', error: 'lead arquivado' });
    expect((await timeline(archived.lead.id)).join('\n')).toContain('o lead foi arquivado');

    expect(await pending(gone.lead.id)).toEqual([]);
    const [farewell] = await sql<{ status: string }[]>`
      select status from lead_messages where thread_id = ${gone.threadId} and is_farewell`;
    expect(farewell!.status).toBe('draft');
  });

  test('a sequence that ran out of touches needs no follow-up; open and never-reached leads keep theirs', async () => {
    await b.settings('autopilot');
    const silent = await leadWith(`Silêncio ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 7 * 1440 },
      { dir: 'out', body: 'Passando com uma ideia leve.', agoMin: 3 * 1440 },
    ]);
    const extra = await timer(silent.lead.id, { by: 'agent' });
    const promised = await timer(
      silent.lead.id,
      { by: 'agent', requested: true },
      'timer.callback',
    );

    const open = await leadWith(`Aberta ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 600 },
      { dir: 'in', body: 'Como funciona?', agoMin: 500 },
      { dir: 'out', body: 'O cliente monta o pedido num link.', agoMin: 490 },
    ]);
    const openFollowup = await timer(open.lead.id, { by: 'cadence' });

    // the Instagram DM that never arrived: its follow-up is the lead's only way back
    const failed = await leadWith(`Falhou ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', status: 'failed', agoMin: 120 },
    ]);
    const retry = await timer(failed.lead.id, { by: 'agent' });

    await sweepAgendaHygiene(appSql, null);
    expect(await pending(silent.lead.id)).toEqual([promised]);
    expect(await pending(silent.lead.id)).not.toContain(extra);
    expect((await timeline(silent.lead.id)).join('\n')).toContain(
      'a sequência sem resposta já acabou',
    );
    expect(await pending(open.lead.id)).toEqual([openFollowup]);
    expect(await pending(failed.lead.id)).toEqual([retry]);
  });

  test('the model cancels a follow-up the conversation already answered, keeps the rest, and judges each once', async () => {
    await b.settings('autopilot');
    const no = await leadWith(`Anota ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 600 },
      { dir: 'in', body: 'Não precisamos, já usamos o Anota AI e tá ótimo', agoMin: 500 },
      { dir: 'out', body: 'Entendi! Obrigado pelo retorno.', agoMin: 490 },
    ]);
    const noFollowup = await timer(no.lead.id, { by: 'cadence' });
    const maybe = await leadWith(`Sócio ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 600 },
      { dir: 'in', body: 'Vou ver com meu sócio e te falo', agoMin: 500 },
      { dir: 'out', body: 'Combinado!', agoMin: 490 },
    ]);
    const maybeFollowup = await timer(maybe.lead.id, { by: 'cadence' }, 'timer.followup', 4);

    const { adapter, gateway } = judge((lead) =>
      lead.startsWith('Anota') ? 'cancel' : lead.startsWith('Sócio') ? 'keep' : null,
    );
    await sweepAgendaHygiene(appSql, gateway);
    expect(await pending(no.lead.id)).toEqual([]);
    expect((await timeline(no.lead.id)).join('\n')).toContain(
      'Follow-up cancelado automaticamente: ela recusou',
    );
    expect(await pending(maybe.lead.id)).toEqual([maybeFollowup]);
    const reviews = await sql<{ mailbox_id: string; verdict: string }[]>`
      select mailbox_id, verdict from crm_agenda_reviews
      where lead_id in (${no.lead.id}, ${maybe.lead.id}) order by verdict`;
    expect(reviews.map((r) => [r.mailbox_id, r.verdict])).toEqual([
      [noFollowup, 'cancel'],
      [maybeFollowup, 'keep'],
    ]);
    // the conversation goes as data in the user turn, and the answer is the fast model's
    expect(adapter.requests[0]!.system.map((s) => s.text).join('')).not.toContain('Não precisamos');
    expect(askedAbout(adapter, `Sócio ${b.nonce}`)).toBe(1);

    // judged once: the kept follow-up isn't sent to the model again
    await sweepAgendaHygiene(appSql, gateway);
    expect(askedAbout(adapter, `Sócio ${b.nonce}`)).toBe(1);
    expect(await pending(maybe.lead.id)).toEqual([maybeFollowup]);
  });

  test('a verdict on a conversation that moved on, or a malformed answer, removes nothing', async () => {
    await b.settings('autopilot');
    const moved = await leadWith(`Mudou ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 600 },
      { dir: 'in', body: 'Agora não', agoMin: 500 },
      { dir: 'out', body: 'Tranquilo!', agoMin: 490 },
    ]);
    const movedFollowup = await timer(moved.lead.id, { by: 'cadence' });
    // she writes again while the model is still reading the old conversation
    let late: Promise<unknown> | null = null;
    const racing = judge(
      (lead) => (lead.startsWith('Mudou') ? 'cancel' : null),
      () => {
        late ??= sql`
          insert into lead_messages (thread_id, direction, author, body, status, received_at)
          values (${moved.threadId}, 'in', 'lead', 'Na verdade, quanto custa?', 'received', now())`.execute();
      },
    );
    await sweepAgendaHygiene(appSql, racing.gateway);
    await late;
    expect(await pending(moved.lead.id)).toEqual([movedFollowup]);
    expect(
      await sql`select 1 from crm_agenda_reviews where mailbox_id = ${movedFollowup}`,
    ).toHaveLength(0);

    const garbled = await leadWith(`Confusa ${b.nonce}`, [
      { dir: 'out', body: 'Oi! Sou da Venduá.', agoMin: 600 },
      { dir: 'in', body: 'Hoje tá corrido, outra hora vejo', agoMin: 500 },
      { dir: 'out', body: 'Entendo!', agoMin: 490 },
    ]);
    const garbledFollowup = await timer(garbled.lead.id, {
      by: 'agent',
      focus: 'retomar em dezembro',
    });
    const adapter = scriptedAdapter([{ text: 'não sei responder em JSON' }]);
    const broken = createGateway({
      adapters: [adapter],
      routes: { routes: async () => [{ provider: 'scripted', model: 't', zdr: true }] },
    });
    await sweepAgendaHygiene(appSql, broken);
    expect(await pending(garbled.lead.id)).toEqual([garbledFollowup]);
    expect(
      await sql`select 1 from crm_agenda_reviews where mailbox_id = ${garbledFollowup}`,
    ).toHaveLength(0);
  });

  test('with the agent off, the model is never asked', async () => {
    await b.settings('off');
    const lead = await leadWith(`Desligado ${b.nonce}`, [
      { dir: 'out', body: 'Oi!', agoMin: 600 },
      { dir: 'in', body: 'Oi, pode falar', agoMin: 500 },
      { dir: 'out', body: 'A Venduá monta sua loja online.', agoMin: 490 },
    ]);
    await timer(lead.lead.id, { by: 'cadence' });
    const { adapter, gateway } = judge(() => 'cancel');
    await sweepAgendaHygiene(appSql, gateway);
    expect(adapter.requests).toHaveLength(0);
    expect(await pending(lead.lead.id)).toHaveLength(1);
  });

  test("'contacted' needs something to have reached the lead: the agent can't claim it early, and a claim its failed DM left goes back", async () => {
    await b.settings('autopilot');
    const markedBy = (leadId: string, actor: 'agent' | 'staff') =>
      controlTx(appSql, (tx) => updateLeadTx(tx, leadId, { state: 'contacted' }, actor));
    const stateOf = async (leadId: string) =>
      (await sql<{ state: string }[]>`select state from leads where id = ${leadId}`)[0]!.state;
    const failed = {
      dir: 'out' as const,
      body: 'Oi! Sou da Venduá.',
      status: 'failed',
      agoMin: 30,
    };

    // the agent queued a DM that failed, then marked the lead contacted
    const lost = await leadWith(`Jéssica ${b.nonce}`, [failed]);
    // the tool refuses it now
    const { outcomes } = await b.runTools([['set_state', { state: 'contacted' }]], {
      leadId: lost.lead.id,
    });
    expect(JSON.stringify(outcomes[0])).toContain('Nada chegou nessa pessoa ainda');
    expect(await stateOf(lost.lead.id)).toBe('lead');
    // one left by the old tool goes back; real contact, staff's word and a send in flight stay
    await markedBy(lost.lead.id, 'agent');
    const reached = await leadWith(`Kelly ${b.nonce}`, [{ ...failed, status: 'sent' }]);
    await markedBy(reached.lead.id, 'agent');
    const byStaff = await leadWith(`Ligação ${b.nonce}`, [failed]);
    await markedBy(byStaff.lead.id, 'staff');
    const inFlight = await leadWith(`Na fila ${b.nonce}`, [{ ...failed, status: 'queued' }]);
    // a day out, so no other file's outbox pass sends it meanwhile
    await sql`update lead_messages set send_after = now() + interval '1 day'
      where thread_id = ${inFlight.threadId}`;
    await markedBy(inFlight.lead.id, 'agent');

    await sweepAgendaHygiene(appSql, null);
    expect(await stateOf(lost.lead.id)).toBe('lead');
    expect((await timeline(lost.lead.id)).join('\n')).toContain('nenhuma mensagem chegou');
    const back = await sql<{ actor: string }[]>`
      select actor from lead_state_history
      where lead_id = ${lost.lead.id} and from_state = 'contacted' and to_state = 'lead'`;
    expect(back.map((r) => r.actor)).toEqual(['system']);
    for (const kept of [reached, byStaff, inFlight])
      expect(await stateOf(kept.lead.id)).toBe('contacted');

    // and with real contact the tool lets the agent correct the stage
    const { outcomes: ok } = await b.runTools([['set_state', { state: 'lead' }]], {
      leadId: reached.lead.id,
    });
    expect(ok[0]).toMatchObject({ name: 'set_state', ok: true });
    const { outcomes: again } = await b.runTools([['set_state', { state: 'contacted' }]], {
      leadId: reached.lead.id,
    });
    expect(again[0]).toMatchObject({ name: 'set_state', ok: true });
    expect(await stateOf(reached.lead.id)).toBe('contacted');
  });
});
