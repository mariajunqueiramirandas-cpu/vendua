import { Runtime, type ModelGateway, type ModelRequest } from '@vendua/agent-runtime';
import { crmLogTransport } from '../../agent-host/agents/crm/shared.ts';
import { hostHooks } from '../../agent-host/hooks.ts';
import { pgMemory } from '../../agent-host/store/memory.ts';
import { PgActorStore } from '../../agent-host/store/pg-store.ts';
// the registry, not crm/index.ts: the agents' modules load in the registry's order
import { currentAgents } from '../../agent-host/registry.ts';
import { controlTx } from '../../modules/control.ts';
import { getPitch, getSetting } from '../../modules/integrations.ts';
import { insertLeadTx, leadInsert } from '../../modules/leads.ts';
import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { PLATFORM_TENANT_ID } from '../../platform/tenancy.ts';
import { CRM_AGENT_ID, requestLeadTx } from '../dispatch.ts';
import { ingestInbound } from '../inbound.ts';
import { deliverQueued } from '../outbox.ts';
import type { SimScenario } from './scenarios.ts';

// The negotiation simulator: the real lead agent (Runtime v3, its tools, guardrails and the
// outbox on the `log` channel, so nothing leaves) against a model playing the lead, then a judge
// scores the transcript. Live models on both sides: it is paid, and run by hand.

const simLog = log.child({ mod: 'crm-sim' });

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

/** Waits until the lead's agent has nothing due, holds no lease, and the outbox is empty. */
async function settle(sql: Sql, leadId: string): Promise<boolean> {
  for (let i = 0; i < 240; i++) {
    const [p] = await sql<{ busy: boolean }[]>`
      select exists (
          select 1 from agent_mailbox m join agent_actors a on a.id = m.actor_id
          where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
            and a.subject_id = ${leadId} and m.consumed_by_turn is null
            and m.deliver_at <= now() + interval '30 seconds'
        ) or exists (
          select 1 from agent_actors a
          where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID}
            and a.subject_id = ${leadId} and a.lease_until > now()
        ) or exists (
          select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.direction = 'out' and m.status in ('queued', 'sending')
        ) as busy`;
    if (!p?.busy) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function terminalState(sql: Sql, leadId: string): Promise<Terminal> {
  const [lead] = await sql<
    { unsubscribed_at: string | null; state: string; agent_paused_at: string | null }[]
  >`select unsubscribed_at, state, agent_paused_at from leads where id = ${leadId}`;
  const [last] = await sql<{ status: string }[]>`
    select status from crm_turns where lead_id = ${leadId} order by finished_at desc limit 1`;
  if (last?.status === 'failed') return { outcome: 'run_failed', why: 'latest agent turn failed' };
  if (lead?.unsubscribed_at) return { outcome: 'optout', why: 'lead unsubscribed' };
  const [meeting] = await sql<{ status: string }[]>`
    select status from meetings where lead_id = ${leadId} and status = 'scheduled' limit 1`;
  if (meeting) return { outcome: 'booked', why: 'meeting scheduled' };
  const [thread] = await sql<{ agent_enabled: boolean }[]>`
    select agent_enabled from lead_threads where lead_id = ${leadId} limit 1`;
  // request_human pauses the thread or the lead: either way the agent stopped itself
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
): Promise<{ id: string; body: string } | null> {
  const rows = await sql<{ id: string; body: string; status: string }[]>`
    select m.id, m.body, m.status from lead_messages m
    join lead_threads t on t.id = m.thread_id
    where t.lead_id = ${leadId} and m.direction = 'out'
    order by m.created_at desc limit 5`;
  const sent = rows.find((r) => r.status === 'sent' || r.status === 'delivered');
  return sent && sent.id !== afterId ? sent : null;
}

function personaSystem(s: SimScenario): string {
  return `Você está interpretando uma pessoa real numa conversa de WhatsApp com um vendedor. Responda SÓ com a mensagem que essa pessoa mandaria — sem aspas, sem narração, sem metacomment.

${s.persona}
${s.opener ? `\nFoi VOCÊ quem puxou a conversa, mandando: "${s.opener}"\n` : ''}
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

const JUDGE_SYSTEM = `Você é juiz de qualidade de negociação por WhatsApp, com o olhar de um gerente comercial brasileiro exigente. Avalie SÓ o vendedor (o agente), nunca o lead. Responda SÓ JSON válido neste formato:
{"outcome":"booked|progress|lost|optout|handoff|stalled","score":<1-5>,"rubric":{"escuta":<1-5>,"naturalidade":<1-5>,"descoberta":<1-5>,"veracidade":<1-5>,"avanco":<1-5>},"strengths":["..."],"weaknesses":["..."],"summary":"uma frase"}
Rubrica (cite a mensagem que justifica cada nota baixa em weaknesses):
- escuta: responde o que o lead disse por último, usa as palavras dele, nunca ignora pergunta.
- naturalidade: soa como gente no celular. Tamanho espelha o do lead, uma pergunta por mensagem, sem frase de robô, sem markdown, sem travessão, sem lista de palpites.
- descoberta: entende o negócio e a dor antes de mostrar valor; não chuta o que o lead vende nem supõe quem ele é.
- veracidade: nada fora dos FATOS PERMITIDOS; honesto quando perguntam se é robô.
- avanco: leva a um próximo passo concreto no ritmo do lead, fecha quando o sinal vem, respeita o não.
score (geral) 5 = fez o melhor possível dentro do que o lead permitia; 3 = ok com chances perdidas claras; 1 = falhou no básico (genérico, insistente, interrogatório, ignorou sinal). Uma primeira resposta que interroga ou chuta sobre o lead já tira o 5.
INVENTAR fato comercial — preço, plano, prazo, cupom ou link fora dos FATOS PERMITIDOS — é weakness grave: o score não passa de 3 não importa o quão bem vendeu. O mesmo vale pra prometer o que o agente não entrega (gerar ou preparar exemplo, prévia, demo, loja de teste, "a equipe vai montar") ou benefício fora dos FATOS ("sem comissão", "vende mais"), e pra texto com "\\n" literal no meio.
Reoferecer formato que o lead recusou (link, call) ou ignorar a pergunta feita é weakness; responder à altura do tom do lead conta como strength.
Escalar mal pesa dos dois lados: request_human cedo demais num lead quente é fuga; tarde demais numa decisão comercial (desconto, exceção) é insistência errada.
Num opt-out, a despedida via unsubscribe é a última mensagem legítima — julgar qualquer coisa DEPOIS dela, não ela.`;

const request = (
  system: string,
  messages: ModelRequest['messages'],
  turnId: string,
  maxTokens: number,
): ModelRequest => ({
  tier: 'strong',
  system: [{ id: 'sim', tier: 'static', cache: true, text: system }],
  messages,
  volatile: null,
  tools: [],
  maxTokens,
  temperature: 0.7,
  meta: {
    tenantId: PLATFORM_TENANT_ID,
    agentId: 'crm-sim',
    actorId: turnId,
    turnId,
    lane: 'background',
  },
});

/** From the lead's seat the agent's messages are the user's; a lead-opened chat needs a user turn first. */
function personaMessages(transcript: SimTurn[]): ModelRequest['messages'] {
  const turns: ModelRequest['messages'] = transcript.map((t) =>
    t.from === 'agent'
      ? { role: 'user' as const, parts: [{ type: 'text' as const, text: t.body }] }
      : { role: 'assistant' as const, text: t.body, toolCalls: [] },
  );
  return transcript[0]?.from === 'lead'
    ? [
        {
          role: 'user',
          parts: [{ type: 'text', text: '(início da conversa: você manda a primeira mensagem)' }],
        },
        ...turns,
      ]
    : turns;
}

export async function runSim(
  sql: Sql,
  scenario: SimScenario,
  o: { agentGateway: ModelGateway; userGateway: ModelGateway; models: string },
): Promise<SimResult> {
  const startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;

  // the lead and its dossier land where real research puts them
  const leadId = await controlTx(sql, async (tx) => {
    const created = await insertLeadTx(
      tx,
      leadInsert({ ...scenario.lead, agentMode: 'auto', source: 'sim' }),
    );
    const id = created.body.lead.id;
    for (const note of scenario.dossier)
      await tx`
        insert into lead_activities (lead_id, kind, body, created_by)
        values (${id}, 'note', ${note}, 'agent')`;
    return id;
  });
  simLog.info({ scenario: scenario.name, leadId }, 'sim seeded');

  // the worker a Core process runs: due actors, then the outbox
  const runtime = new Runtime<Sql>({
    agents: currentAgents().filter((a) => a.def.id === CRM_AGENT_ID),
    store: new PgActorStore(sql),
    gateway: o.agentGateway,
    transports: [crmLogTransport],
    owner: `crm-sim-${process.pid}`,
    memory: pgMemory,
    hooks: hostHooks(),
  });
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      const ran = await runtime.pump('followup', { limit: 2, perTenantCap: 2 }).catch((e) => {
        simLog.warn({ err: String(e) }, 'pump failed');
        return 0;
      });
      const sent = await deliverQueued(sql, { graceMs: 0 }).catch(() => 0);
      if (!ran && !sent) await new Promise((r) => setTimeout(r, 300));
    }
  })();

  const transcript: SimTurn[] = [];
  const maxTurns = scenario.maxTurns ?? 8;
  const harvest = async (lastSeenId: string | null, tag: string): Promise<string | null> => {
    const out = await latestOutbound(sql, leadId, lastSeenId);
    if (out) {
      transcript.push({ from: 'agent', body: out.body, at: new Date().toISOString() });
      simLog.info({ out: out.body.slice(0, 80) }, tag);
    }
    return out?.id ?? lastSeenId;
  };
  const ingest = (body: string) =>
    ingestInbound(sql, {
      channel: 'whatsapp',
      from: String(scenario.lead.whatsapp),
      body,
      providerMessageId: `sim:${crypto.randomUUID()}`,
    });

  let terminal: Terminal;
  let lastSeenId: string | null = null;
  try {
    // a lead-opened scenario starts from the inbound path, as a real first message does
    if (scenario.opener) {
      transcript.push({ from: 'lead', body: scenario.opener, at: new Date().toISOString() });
      await ingest(scenario.opener);
    } else {
      await controlTx(sql, (tx) =>
        requestLeadTx(tx, {
          leadId,
          kind: 'lead.first_contact',
          source: 'first_contact',
          dedupeKey: `crm:first_contact:${leadId}`,
        }),
      );
    }
    const settled = await settle(sql, leadId);
    terminal =
      (await terminalState(sql, leadId)) ??
      (settled ? null : { outcome: 'stalled', why: 'settle timeout' });

    while (!terminal && transcript.length < maxTurns * 2) {
      const before: string | null = lastSeenId;
      lastSeenId = await harvest(lastSeenId, 'agent → lead');
      if (lastSeenId === before) {
        terminal = { outcome: 'stalled', why: 'agent produced no outbound message' };
        break;
      }
      const persona = await o.userGateway.generate(
        request(
          personaSystem(scenario),
          personaMessages(transcript),
          `${leadId}:${transcript.length}`,
          300,
        ),
      );
      tokensIn += persona.usage.inputTokens;
      tokensOut += persona.usage.outputTokens;
      const reply = persona.text.trim();
      if (!reply || /^FIM\b/.test(reply)) {
        terminal = { outcome: 'ended', why: 'persona closed the conversation' };
        break;
      }
      transcript.push({ from: 'lead', body: reply, at: new Date().toISOString() });
      simLog.info({ in: reply.slice(0, 80) }, 'lead → agent');
      await ingest(reply);
      const settled = await settle(sql, leadId);
      terminal =
        (await terminalState(sql, leadId)) ??
        (settled ? null : { outcome: 'stalled', why: 'settle timeout' });
      // a turn can go terminal on the step that sends: keep its closing message
      if (terminal) lastSeenId = await harvest(lastSeenId, 'agent → lead (final)');
    }
  } finally {
    stop = true;
    await loop;
  }
  terminal = terminal ?? { outcome: 'stalled', why: `turn cap ${maxTurns}` };
  if (!transcript.some((t) => t.from === 'agent'))
    lastSeenId = await harvest(lastSeenId, 'agent → lead (final)');
  const agentSpoke = transcript.some((t) => t.from === 'agent');

  // FATOS PERMITIDOS mirrors the prompt's quotable facts: anything else is invention
  const pitch = await getPitch(sql);
  const meeting = await getSetting<{ bookingUrl?: string }>(sql, 'meeting', {});
  const facts = [
    `OFERTA: ${pitch.offer?.trim() ? pitch.offer : '(não configurada — nada comercial é citável)'}`,
    `BOOKING_URL: ${meeting.bookingUrl ?? '(não configurado)'}`,
  ].join('\n');
  let judge: Record<string, unknown> = {
    summary: 'sem conversa — o agente não produziu nenhuma mensagem',
  };
  if (agentSpoke) {
    const res = await o.userGateway.generate(
      request(
        JUDGE_SYSTEM,
        [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: `CENÁRIO: ${scenario.name} — ${scenario.description}\nO QUE SERIA SUCESSO: ${scenario.success}\n\nFATOS PERMITIDOS (o que o agente pode citar verbatim — qualquer outro preço/link/condição é invenção):\n${facts}\n\nTRANSCRIÇÃO (vendedor = "agent", cliente = "lead"; só mensagens enviadas aparecem — o lead não vê rascunhos nem notas):\n${transcript.map((t) => `${t.from}: ${t.body}`).join('\n')}\n\nCOMO TERMINOU: ${terminal.why} — leve isso em conta (ex.: request_human depois de um "não" é a resposta certa, não insistência).`,
              },
            ],
          },
        ],
        `${leadId}:judge`,
        1500,
      ),
    );
    tokensIn += res.usage.inputTokens;
    tokensOut += res.usage.outputTokens;
    try {
      const m = /```(?:json)?\s*(\{[\s\S]*\})```|(\{[\s\S]*\})/.exec(res.text);
      judge = JSON.parse(m?.[1] ?? m?.[2] ?? '{}') as Record<string, unknown>;
    } catch {
      judge = { parse_error: res.text || 'empty' };
    }
  }
  // endings the database settles beat the judge's guess on the fuzzy ones
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

  const [simRun] = await controlTx(
    sql,
    (tx) => tx<{ id: string }[]>`
      insert into sim_runs (scenario, lead_id, outcome, score, judge, transcript, turns,
                            tokens_in, tokens_out, llm, duration_ms)
      values (${scenario.name}, ${leadId}, ${outcome}, ${score}, ${tx.json(judge as never)},
              ${tx.json(transcript as never)}, ${transcript.length}, ${tokensIn}, ${tokensOut},
              ${o.models.slice(0, 200)}, ${Date.now() - startedAt})
      returning id`,
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
