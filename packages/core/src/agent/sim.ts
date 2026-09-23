import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { leadInsert, insertLeadTx } from '../modules/leads.ts';
import { getIntegrationTx, getPitch, getSetting } from '../modules/integrations.ts';
import { enqueueRun, drain } from './runner.ts';
import { ingestInbound } from './inbound.ts';
import { providerFor, type AgentMessage, type LlmProvider } from './llm.ts';
import type { SimScenario } from './sim-scenarios.ts';
import { log } from '../platform/log.ts';

/**
 * agent/sim — the negotiation simulator. Drives a real end-to-end negotiation:
 * the vendua agent runs its actual run loop (outreach → reply → …), while a
 * second LLM plays the lead from a hidden persona. Everything rides the real
 * plumbing — ingestInbound, guardrails, dispatchMessage — on a `log` channel
 * driver, so "sent" messages never leave the building and the transcript is
 * just the lead_messages thread.
 *
 * A judge pass then scores the negotiation against the scenario's success
 * criteria and the result lands in `sim_runs` for quality tracking.
 */

const simLog = log.child({ mod: 'sim' });

export interface SimTurn {
  from: 'agent' | 'lead';
  body: string;
  at: string;
}

export interface SimResult {
  simRunId: string;
  scenario: string;
  leadId: string;
  outcome: string;
  score: number | null;
  turns: number;
  transcript: SimTurn[];
  judge: Record<string, unknown>;
}

type Terminal = { outcome: string; why: string } | null;

/** Wait until no queued/running agent run remains for the lead. ingestInbound
 *  kicks a floating drain of its own, so the reply run may already be claimed
 *  when our drain() returns — polling the row is the only honest signal. */
async function settle(sql: Sql, leadId: string): Promise<boolean> {
  for (let i = 0; i < 90; i++) {
    await drain(sql);
    const [p] = await sql<{ n: string }[]>`
      select count(*)::text as n from agent_runs
      where lead_id = ${leadId} and status in ('queued', 'running')`;
    if (Number(p?.n ?? 0) === 0) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function terminalState(sql: Sql, leadId: string): Promise<Terminal> {
  const [lead] = await sql<
    { unsubscribed_at: string | null; state: string; agent_paused_at: string | null }[]
  >`select unsubscribed_at, state, agent_paused_at from leads where id = ${leadId}`;
  const [failed] = await sql<{ status: string }[]>`
    select status from agent_runs where lead_id = ${leadId}
    order by created_at desc limit 1`;
  if (failed?.status === 'failed') return { outcome: 'run_failed', why: 'latest agent run failed' };
  if (lead?.unsubscribed_at) return { outcome: 'optout', why: 'lead unsubscribed' };
  const [meeting] = await sql<{ status: string }[]>`
    select status from meetings where lead_id = ${leadId} and status = 'scheduled' limit 1`;
  if (meeting) return { outcome: 'booked', why: 'meeting scheduled' };
  const [thread] = await sql<{ agent_enabled: boolean }[]>`
    select agent_enabled from lead_threads where lead_id = ${leadId} limit 1`;
  // request_human either pauses the current thread (bound run) or sets the
  // lead-wide handoff flag (unbound run) — both mean the agent stopped itself.
  if (lead?.agent_paused_at || (thread && !thread.agent_enabled))
    return { outcome: 'handoff', why: 'request_human' };
  if (lead?.state === 'live' || lead?.state === 'invited')
    return { outcome: 'progress', why: `state ${lead.state}` };
  return null;
}

async function latestOutbound(
  sql: Sql,
  leadId: string,
  afterId: string | null,
): Promise<{ id: string; body: string; status: string } | null> {
  const rows = await sql<{ id: string; body: string; status: string }[]>`
    select m.id, m.body, m.status from lead_messages m
    join lead_threads t on t.id = m.thread_id
    where t.lead_id = ${leadId} and m.direction = 'out'
    order by m.created_at desc limit 5`;
  const sent = rows.find((r) => r.status === 'sent' || r.status === 'delivered');
  return sent && sent.id !== afterId ? sent : null;
}

function personaMessages(transcript: SimTurn[]): AgentMessage[] {
  // From the lead's seat: the agent's messages arrive as 'user'.
  return transcript.map((t) => ({
    role: t.from === 'agent' ? 'user' : 'assistant',
    content: t.body,
  }));
}

function personaSystem(s: SimScenario): string {
  return `Você está interpretando uma pessoa real numa conversa de WhatsApp com um vendedor. Responda SÓ com a mensagem que essa pessoa mandaria — sem aspas, sem narração, sem metacomment.

${s.persona}

SITUAÇÃO OCULTA (o vendedor NÃO sabe disso; só revele se ele descobrir ou perguntar na lata):
${s.hidden}

Regras de interpretação:
- WhatsApp real: 1-3 linhas, linguagem falada, pode errar, pode mandar duas mensagens curtas. Nunca texto de e-mail.
- Reaja ao que ele escreveu — não recite seu personagem. Se ele for genérico ou insistente sem te ouvir, esfrie.
- Se ele te ganhar, demonstre interesse de verdade e faça a próxima pergunta natural.
- Consistência: você lembra do que VOCÊ disse antes — não mude de opinião, não aceite o que recusou, a menos que o vendedor tenha te ganho de verdade.
- Se ele repetir formato que você já recusou (link, call), ignorar sua pergunta ou insistir depois de um "não", esfrie e encurte — é assim que pessoa real reage.
- Nunca quebre o personagem, nunca admita ser IA, nunca revele a SITUAÇÃO OCULTA sem ele descobrir.
- Quando a conversa chegar a um fim natural (você aceitou, marcou, recusou de vez, ou pararia de responder na vida real), responda APENAS: FIM`;
}

const JUDGE_SYSTEM = `Você é juiz de qualidade de negociação por WhatsApp. Avalie SÓ o vendedor (o agente), nunca o lead. Responda SÓ JSON válido neste formato:
{"outcome":"booked|progress|lost|optout|handoff|stalled","score":<1-5>,"strengths":["..."],"weaknesses":["..."],"summary":"uma frase"}
score 5 = fez o melhor possível dentro do que o lead permitia; 3 = ok com chances perdidas claras; 1 = falhou no básico (genérico, insistente, ignorou sinal).
INVENTAR fato comercial — preço, plano, prazo, cupom ou link fora dos FATOS PERMITIDOS — é weakness grave: o score não passa de 3 não importa o quão bem vendeu.
Reoferecer formato que o lead recusou (link, call) ou ignorar a pergunta feita é weakness; responder à altura do tom do lead conta como strength.
Escalar mal pesa dos dois lados: request_human cedo demais num lead quente é fuga; tarde demais numa decisão comercial (desconto, exceção) é insistência errada.
Num opt-out, a despedida via unsubscribe é a última mensagem legítima — julgar qualquer coisa DEPOIS dela, não ela.`;

export async function runSim(
  sql: Sql,
  scenario: SimScenario,
  opts: { llm?: LlmProvider } = {},
): Promise<SimResult> {
  const startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;

  // Seed: the lead + its dossier land exactly where real research puts them.
  const leadId = await controlTx(sql, async (tx) => {
    const created = await insertLeadTx(
      tx,
      leadInsert({ ...scenario.lead, agentMode: 'auto', source: 'sim' }),
    );
    const id = created.body.lead.id;
    for (const note of scenario.dossier) {
      await tx`
        insert into lead_activities (lead_id, kind, body, created_by)
        values (${id}, 'note', ${note}, 'agent')`;
    }
    return id;
  });
  simLog.info({ scenario: scenario.name, leadId }, 'sim seeded');

  const llm = opts.llm ?? providerFor(await controlTx(sql, (tx) => getIntegrationTx(tx, 'llm')));

  const transcript: SimTurn[] = [];
  const maxTurns = scenario.maxTurns ?? 8;

  // Turn 0: the agent makes first contact.
  await enqueueRun(sql, { kind: 'outreach', leadId });
  const firstSettled = await settle(sql, leadId);

  let lastSeenId: string | null = null;
  let terminal =
    (await terminalState(sql, leadId)) ??
    (firstSettled ? null : { outcome: 'stalled', why: 'settle timeout — run still active' });

  while (!terminal && transcript.length < maxTurns * 2) {
    const out = await latestOutbound(sql, leadId, lastSeenId);
    if (!out) {
      terminal = { outcome: 'stalled', why: 'agent produced no outbound message' };
      break;
    }
    lastSeenId = out.id;
    transcript.push({ from: 'agent', body: out.body, at: new Date().toISOString() });
    simLog.info({ out: out.body.slice(0, 80) }, 'agent → lead');

    const persona = await llm.chat({
      system: personaSystem(scenario),
      messages: personaMessages(transcript),
      tools: [],
    });
    tokensIn += persona.tokensIn;
    tokensOut += persona.tokensOut;
    const reply = (persona.text ?? '').trim();
    if (!reply || /^FIM\b/.test(reply)) {
      terminal = terminal ?? { outcome: 'ended', why: 'persona closed the conversation' };
      break;
    }
    transcript.push({ from: 'lead', body: reply, at: new Date().toISOString() });
    simLog.info({ in: reply.slice(0, 80) }, 'lead → agent');

    await ingestInbound(sql, {
      channel: 'whatsapp',
      from: String(scenario.lead.whatsapp),
      body: reply,
      providerMessageId: `sim:${crypto.randomUUID()}`,
    });
    const settled = await settle(sql, leadId);
    terminal =
      (await terminalState(sql, leadId)) ??
      (settled ? null : { outcome: 'stalled', why: 'settle timeout — run still active' });
    if (terminal) {
      // A run can go terminal on the same step that sends (send_message +
      // set_state together) — harvest that closing message before ending, or
      // the judge scores a transcript missing the agent's last word.
      const out = await latestOutbound(sql, leadId, lastSeenId);
      if (out) {
        lastSeenId = out.id;
        transcript.push({ from: 'agent', body: out.body, at: new Date().toISOString() });
        simLog.info({ out: out.body.slice(0, 80) }, 'agent → lead (final)');
      }
    }
  }
  terminal = terminal ?? { outcome: 'stalled', why: `turn cap ${maxTurns}` };
  // A run that went terminal before the loop (e.g. failed after its send)
  // still left a message on the wire — harvest it so the record isn't empty.
  if (!transcript.length) {
    const out = await latestOutbound(sql, leadId, lastSeenId);
    if (out) {
      lastSeenId = out.id;
      transcript.push({ from: 'agent', body: out.body, at: new Date().toISOString() });
      simLog.info({ out: out.body.slice(0, 80) }, 'agent → lead (final)');
    }
  }

  // Judge: score the agent's side of the transcript against the scenario.
  // FATOS PERMITIDOS mirrors exactly what the agent's prompt claims is
  // quotable — the judge calls fabrication when a price/link strays from it.
  const pitch = await getPitch(sql);
  const meeting = await getSetting<{ bookingUrl?: string }>(sql, 'meeting', {});
  const facts = [
    `OFERTA: ${pitch.offer?.trim() ? pitch.offer : '(não configurada — nada comercial é citável)'}`,
    `BOOKING_URL: ${meeting.bookingUrl ?? '(não configurado)'}`,
  ].join('\n');
  // Judge: score the agent's side of the transcript against the scenario.
  // An empty transcript has nothing to score — don't let the judge invent a
  // review for a conversation that never happened (observed: it praised an
  // opt-out that was actually a stalled no-send).
  let judgeRes: Awaited<ReturnType<LlmProvider['chat']>> = {
    text: null,
    toolCalls: [],
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  if (transcript.length) {
    judgeRes = await llm.chat({
      system: JUDGE_SYSTEM,
      tools: [],
      messages: [
        {
          role: 'user',
          content: `CENÁRIO: ${scenario.name} — ${scenario.description}\nO QUE SERIA SUCESSO: ${scenario.success}\n\nFATOS PERMITIDOS (o que o agente pode citar verbatim — qualquer outro preço/link/condição é invenção):\n${facts}\n\nTRANSCRIÇÃO (vendedor = "agent", cliente = "lead"; só mensagens enviadas aparecem — o lead não vê rascunhos nem notas):\n${transcript.map((t) => `${t.from}: ${t.body}`).join('\n')}\n\nCOMO TERMINOU: ${terminal.why} — leve isso em conta (ex.: request_human depois de um "não" é a resposta certa, não insistência).`,
        },
      ],
    });
  }
  tokensIn += judgeRes.tokensIn;
  tokensOut += judgeRes.tokensOut;
  let judge: Record<string, unknown> = {};
  if (!transcript.length) {
    judge = { summary: 'sem conversa — o agente não produziu nenhuma mensagem' };
  } else {
    try {
      const m = /```(?:json)?\s*(\{[\s\S]*\})```|(\{[\s\S]*\})/.exec(judgeRes.text ?? '');
      judge = JSON.parse(m?.[1] ?? m?.[2] ?? '{}') as Record<string, unknown>;
    } catch {
      judge = { parse_error: judgeRes.text ?? 'empty' };
    }
  }
  // Deterministic endings (db facts) beat the judge's guess; the judge only
  // refines the fuzzy ones (stalled/ended/progress).
  const PINNED = new Set(['optout', 'run_failed', 'booked', 'handoff']);
  const JUDGED = new Set(['booked', 'progress', 'lost', 'optout', 'handoff', 'stalled']);
  const outcome = PINNED.has(terminal.outcome)
    ? terminal.outcome
    : typeof judge.outcome === 'string' && JUDGED.has(judge.outcome)
      ? judge.outcome
      : terminal.outcome;
  const score =
    typeof judge.score === 'number' &&
    Number.isInteger(judge.score) &&
    judge.score >= 1 &&
    judge.score <= 5
      ? judge.score
      : null;

  const simRun = await controlTx(
    sql,
    async (tx) =>
      (
        await tx<{ id: string }[]>`
    insert into sim_runs (scenario, lead_id, outcome, score, judge, transcript, turns, tokens_in, tokens_out, llm, duration_ms)
    values (${scenario.name}, ${leadId}, ${outcome}, ${score}, ${tx.json(judge as never)},
            ${tx.json(transcript as never)}, ${transcript.length}, ${tokensIn}, ${tokensOut},
            ${llm.name}, ${Date.now() - startedAt})
    returning id`
      )[0],
  );

  simLog.info({ outcome, score, simRunId: simRun!.id }, 'sim done');
  return {
    simRunId: simRun!.id,
    scenario: scenario.name,
    leadId,
    outcome,
    score,
    turns: transcript.length,
    transcript,
    judge,
  };
}
