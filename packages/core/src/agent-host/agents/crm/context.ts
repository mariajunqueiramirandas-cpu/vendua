import type { Sql } from '../../../platform/db.ts';
import { controlTx } from '../../../modules/control.ts';
import {
  capCentsOf,
  DEFAULT_GUARDRAILS,
  getIntegrationTx,
  getPitch,
  getSettingTx,
  type Guardrails,
  type Pitch,
} from '../../../modules/integrations.ts';
import { segmentStats, type AgentGoal } from '../../../modules/leads.ts';
import { bookingLinkForRunner } from '../../../modules/meetings.ts';
import {
  hasMemoryTablesTx,
  leadFactsTx,
  memoryFeedForRunTx,
} from '../../../modules/agent-memory.ts';
import { SEND_CHANNELS, isSendChannel, type SendChannel } from '../../../modules/threads.ts';
import { log } from '../../../platform/log.ts';
import { pendingWakeupsTx } from '../../../crm/agenda.ts';
import { parkedReasonTx } from '../../../crm/dispatch.ts';
import {
  channelAvailabilityTx,
  instagramReadyTx,
  whatsappReadyTx,
} from '../../../crm/guardrails.ts';
import { agentSettingTx } from '../../../crm/policy.ts';
import {
  fitTranscript,
  leadCard,
  nameIsContact,
  type TranscriptMessage,
} from './context-render.ts';
import type { PromptMemory } from './prompts.ts';
import type { TurnInfo } from './shared.ts';

// What a CRM turn reads before its first model call (ADR 0030 §6's subject tier): the lead card,
// the dossier, the conversation across channels, the agenda; for discovery and the strategist the
// segments and briefs. Built from Core's rows at turn start and recorded in the log, so the turn
// can be replayed. A port of the old runner's `contextFor`.

const ctxLog = log.child({ mod: 'crm-agent' });

const CTX = {
  messages: 400,
  transcriptChars: 60_000,
  notes: 30,
  noteChars: 3_000,
  dossierChars: 20_000,
  facts: 200,
};

function withinBudget(items: string[], budget: number): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (budget - it.length - 1 < 0 && out.length) break;
    out.push(it);
    budget -= it.length + 1;
  }
  return out;
}

/** Workspace data every CRM turn reads: what Venduá sells and the staff's standing rules. */
export interface Workspace {
  timezone: string;
  pitch: Pitch;
  instructions: string;
  /** send channels connected in this install */
  channels: SendChannel[];
  /** tools whose provider isn't configured: name → why (refused if called anyway) */
  disabled: Record<string, string>;
  autoContact: { enabled: boolean; minScore: number };
}

const MONID_TOOLS = ['maps_lookup', 'instagram_profile', 'serp'];
const DISCOVERY_TOOLS = ['web_search', 'read_pages'];

export async function workspaceTx(tx: Sql): Promise<Workspace> {
  return controlTx(tx, async (c) => {
    const g: Guardrails = {
      ...DEFAULT_GUARDRAILS,
      ...(await getSettingTx<Partial<Guardrails>>(c, 'guardrails', {})),
    };
    const { instructions } = await agentSettingTx(c);
    const [wa, ig, em, memory] = [
      await whatsappReadyTx(c),
      await instagramReadyTx(c),
      await getIntegrationTx(c, 'email'),
      await hasMemoryTablesTx(c),
    ];
    // resend without its key throws at dispatch — same check sendEmail makes
    const emailReady =
      !!em &&
      (em.driver !== 'resend' ||
        !!((em.secret_ref && process.env[em.secret_ref]) ?? process.env.RESEND_API_KEY));
    const ready: Record<SendChannel, boolean> = { whatsapp: wa, instagram: ig, email: emailReady };
    const channels = SEND_CHANNELS.filter((ch) => ready[ch]);
    const disabled: Record<string, string> = {};
    if (!process.env.MONID_API_KEY)
      for (const n of MONID_TOOLS) disabled[n] = 'MONID_API_KEY não configurada';
    const { discoveryUnavailable } = await import('../../../crm/channels/discovery.ts');
    const why = await discoveryUnavailable(c, false);
    if (why) for (const n of DISCOVERY_TOOLS) disabled[n] = why;
    if (!channels.length)
      disabled.send_message = 'nenhum canal de envio (whatsapp/instagram/email) conectado';
    if (!memory)
      for (const n of ['remember', 'set_fact'])
        disabled[n] = 'tabelas de memória não migradas (0035)';
    return {
      timezone: g.timezone,
      pitch: await getPitch(c),
      instructions,
      channels,
      disabled,
      autoContact: {
        enabled: g.discoveryAutoContact && wa,
        minScore: g.discoveryContactMinScore,
      },
    };
  });
}

async function promptMemoryTx(tx: Sql, segment: string | null): Promise<PromptMemory> {
  if (!(await hasMemoryTablesTx(tx))) return { facts: [], agentNotes: [] };
  const feed = await memoryFeedForRunTx(tx, { segment });
  return {
    facts: feed.filter((r) => !r.agentWritten).map((r) => r.content),
    agentNotes: feed.filter((r) => r.agentWritten).map((r) => r.content),
  };
}

function segmentLines(stats: Awaited<ReturnType<typeof segmentStats>>): string | null {
  if (!stats.length) return null;
  return `SEGMENTOS (leads · responderam · ativos · custo):\n${stats
    .map(
      (s) =>
        `- ${s.segment}: ${s.leads} leads · ${s.replied} responderam · ${s.live} ativos · US$${(s.costCents / 100).toFixed(2)}`,
    )
    .join('\n')}`;
}

/** What the lead agent reads about its lead this turn. */
export interface LeadSubject {
  text: string;
  goal: AgentGoal;
  bookingUrl: string | null;
  /** the turn must stay silent: automation off, lead suppressed, cost cap… */
  parked: string | null;
  memory: PromptMemory;
  /** channels that can reach this lead now */
  reachable: SendChannel[];
}

export async function leadSubjectTx(tx: Sql, leadId: string, t: TurnInfo): Promise<LeadSubject> {
  return controlTx(tx, async (c) => {
    const ws = await getSettingTx<Partial<Guardrails>>(c, 'guardrails', {});
    const g: Guardrails = { ...DEFAULT_GUARDRAILS, ...ws };
    const parts: string[] = [];
    const [row] = await c<
      {
        j: { agent_goal?: AgentGoal; agent_plan?: unknown; segment?: string | null } & Record<
          string,
          unknown
        >;
      }[]
    >`select row_to_json(l) as j from leads l where l.id = ${leadId}`;
    if (!row)
      return {
        text: 'LEAD: (não encontrado — o lead foi apagado)',
        goal: 'negotiation',
        bookingUrl: null,
        parked: 'lead não encontrado',
        memory: { facts: [], agentNotes: [] },
        reachable: [],
      };
    const lead = row.j;
    let parked = await parkedReasonTx(
      c,
      t.trigger,
      t.source,
      {
        agent_mode: String(lead.agent_mode ?? 'auto'),
        archived_at: (lead.archived_at as Date | null) ?? null,
        unsubscribed_at: (lead.unsubscribed_at as Date | null) ?? null,
        agent_paused_at: (lead.agent_paused_at as Date | null) ?? null,
      },
      t.params as never,
    );
    const capCents = capCentsOf(g);
    if (!parked && capCents > 0) {
      const [row] = await c<{ spent: number }[]>`
        select coalesce(sum(cost_cents), 0)::int as spent from crm_turns where lead_id = ${leadId}`;
      if ((row?.spent ?? 0) >= capCents)
        parked = `custo acumulado atingiu o teto de US$ ${g.leadLifetimeCostCapUsd}`;
    }

    parts.push(`LEAD: ${JSON.stringify(leadCard(lead))}`);
    if (nameIsContact(lead.name))
      parts.push(
        'NOME: o cadastro ainda não tem o nome da pessoa (o campo é só o contato). Não a chame pelo número; se o nome vier na conversa, update_lead name.',
      );
    let goal: AgentGoal = lead.agent_goal === 'meeting' ? 'meeting' : 'negotiation';
    if (t.params.goal === 'meeting' || t.params.goal === 'negotiation') goal = t.params.goal;
    parts.push(`GOAL: ${goal}`);
    // Who spoke first decides whether "what do you sell?" is allowed. Only what reached the
    // wire counts — not drafts, not queued sends, not manual-thread notes.
    const [first] = await c<{ direction: 'in' | 'out' }[]>`
      select m.direction from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and t.channel <> 'manual'
        and (m.direction = 'in' or m.status in ('sending', 'sent', 'delivered'))
      order by m.created_at, m.id limit 1`;
    parts.push(
      first?.direction === 'in'
        ? 'ORIGEM: inbound — o lead nos procurou primeiro'
        : 'ORIGEM: outbound — nós abordamos primeiro (ou ainda não houve conversa)',
    );
    if (Array.isArray(lead.agent_plan) && lead.agent_plan.length)
      parts.push(`PLANO: ${JSON.stringify(lead.agent_plan)}`);
    if (await hasMemoryTablesTx(c)) {
      const facts = await leadFactsTx(c, leadId, { limit: CTX.facts, order: 'recent' });
      if (facts.length)
        parts.push(
          `FATOS (memória estruturada do lead — set_fact atualiza):\n${facts
            .map(
              (f) =>
                `- ${f.key}: ${f.value}${f.confidence < 1 ? ` (confiança ${f.confidence})` : ''}`,
            )
            .join('\n')}`,
        );
    }
    const dossier = await c<{ body: string | null }[]>`
      select body from lead_activities
      where lead_id = ${leadId} and kind = 'note'
      order by at desc limit ${CTX.notes}`;
    if (dossier.length)
      parts.push(
        `DOSSIÊ (notas e pesquisa, mais recente primeiro):\n${withinBudget(
          dossier.map((a) => `- ${(a.body ?? '').slice(0, CTX.noteChars)}`),
          CTX.dossierChars,
        ).join('\n')}`,
      );
    // What the team already has in motion and how the lead moved — so a reply never
    // contradicts an open task or re-pitches a lead the team already advanced.
    const tasks = await c<{ title: string; due_at: Date | null; created_by: string }[]>`
      select title, due_at, created_by from lead_tasks
      where lead_id = ${leadId} and done_at is null
      order by coalesce(due_at, created_at) limit 20`;
    if (tasks.length)
      parts.push(
        `TAREFAS ABERTAS DA EQUIPE:\n${tasks
          .map(
            (k) =>
              `- ${k.title}${k.due_at ? ` (até ${new Date(k.due_at).toISOString().slice(0, 10)})` : ''}${k.created_by === 'agent' ? ' [criada por você]' : ''}`,
          )
          .join('\n')}`,
      );
    const moves = await c<
      { from_state: string | null; to_state: string; actor: string; at: Date }[]
    >`
      select from_state, to_state, actor, at from lead_state_history
      where lead_id = ${leadId} order by at desc limit 10`;
    if (moves.length)
      parts.push(
        `HISTÓRICO DE ESTÁGIO (mais recente primeiro): ${moves
          .map(
            (m) =>
              `${new Date(m.at).toISOString().slice(0, 10)} ${m.from_state ?? '∅'}→${m.to_state} (${m.actor})`,
          )
          .join('; ')}`,
      );
    let bookingUrl: string | null = null;
    if (goal === 'meeting') {
      const meeting = await getSettingTx<{ bookingUrl?: string }>(c, 'meeting', {});
      try {
        bookingUrl = (await bookingLinkForRunner(c, leadId)) ?? meeting.bookingUrl ?? null;
      } catch (e) {
        ctxLog.warn({ err: e }, 'booking link mint failed — falling back to setting');
        bookingUrl = meeting.bookingUrl ?? null;
      }
      parts.push(`BOOKING_URL: ${bookingUrl ?? '(não configurado)'}`);
    }
    // Reachable-channel truth — never compose on a channel the lead can't be reached on.
    const avail = await channelAvailabilityTx(c, leadId);
    parts.push(
      `CANAIS: ${SEND_CHANNELS.map(
        (ch) => `${ch} ${avail[ch].ok ? 'ok' : `indisponível (${avail[ch].reason})`}`,
      ).join(' · ')}`,
    );
    if (isSendChannel(t.params.channel) && t.trigger !== 'message.inbound')
      parts.push(`CANAL FORÇADO: ${t.params.channel}`);
    if (t.params.draftOnly === true)
      parts.push(
        'MODO ASSISTÊNCIA: staff pediu uma sugestão — send_message compõe o rascunho, nada sai sem aprovação da equipe.',
      );
    // The conversation: the lead's whole history across channels (a lead who moved from
    // Instagram to WhatsApp is one negotiation), fitted to a large budget.
    const rows = await c<(TranscriptMessage & { subject: string | null; thread_id: string })[]>`
      select * from (
        select m.direction, m.body, m.status, m.author, m.created_at, t.channel, t.subject,
               t.id::text as thread_id
        from lead_messages m join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId}
        order by m.created_at desc, m.id desc limit ${CTX.messages}
      ) r order by created_at, direction`;
    const channels = [...new Set(rows.map((r) => r.channel).filter(Boolean))];
    const own = t.params.threadId ? rows.find((r) => r.thread_id === t.params.threadId) : undefined;
    const where = own
      ? `esta mensagem chegou no ${own.channel}${own.subject ? ` · assunto: ${own.subject}` : ''}`
      : channels.length === 1
        ? channels[0]!
        : null;
    if (rows.length)
      parts.push(
        `CONVERSA (${where ? `${where} · ` : ''}mais antiga → mais recente):\n${fitTranscript(
          rows,
          g.timezone,
          { budget: CTX.transcriptChars, tagChannel: channels.length > 1 },
        )}`,
      );
    if (t.params.focus) parts.push(`FOCUS: ${String(t.params.focus)}`);
    const wakeups = await pendingWakeupsTx(c, leadId);
    parts.push(
      `AGENDA (seus retornos agendados — use schedule para remarcar):\n${
        wakeups.length
          ? wakeups
              .map((w) => `- ${w.at}: ${w.focus}${w.requested ? ' (pedido pelo lead)' : ''}`)
              .join('\n')
          : '(nenhum)'
      }`,
    );
    return {
      text: parts.join('\n\n'),
      goal,
      bookingUrl,
      parked,
      memory: await promptMemoryTx(c, typeof lead.segment === 'string' ? lead.segment : null),
      reachable: SEND_CHANNELS.filter((ch) => avail[ch].ok),
    };
  });
}

/** What a discovery turn reads: its query, the target and the segments that convert. */
export async function huntSubjectTx(
  tx: Sql,
  t: TurnInfo,
): Promise<{ text: string; memory: PromptMemory; parked: string | null }> {
  return controlTx(tx, async (c) => {
    const parts: string[] = [];
    const p = t.params;
    if (p.query) parts.push(`DISCOVERY QUERY: ${p.query}`);
    if (p.segment) parts.push(`SEGMENT: ${p.segment}`);
    if (p.city) parts.push(`CITY: ${p.city}`);
    if (typeof p.target === 'number' && p.target > 0)
      parts.push(`META: criar até ${Math.floor(p.target)} leads`);
    if (p.briefName) parts.push(`BRIEF: ${p.briefName}`);
    const seg = segmentLines(await segmentStats(c));
    if (seg) parts.push(seg);
    const parked = t.source.startsWith('staff') ? null : await automationParked(c, 'discovery');
    return {
      text: parts.join('\n\n') || '(sem consulta)',
      memory: await promptMemoryTx(c, p.segment ?? null),
      parked,
    };
  });
}

/** What the weekly review reads: what converts, and every brief that exists. */
export async function reviewSubjectTx(
  tx: Sql,
  t: TurnInfo,
): Promise<{ text: string; memory: PromptMemory; parked: string | null }> {
  return controlTx(tx, async (c) => {
    const parts: string[] = [];
    const seg = segmentLines(await segmentStats(c));
    if (seg) parts.push(seg);
    const briefs = await c<
      {
        name: string;
        query: string;
        segment: string | null;
        city: string | null;
        target: number | null;
        enabled: boolean;
        created_by: string;
      }[]
    >`select name, query, segment, city, target, enabled, created_by
       from discovery_briefs order by created_at desc`;
    // one full signature line per brief — name/query/segment/city are the overlap fields
    let budget = 12_000;
    const lines: string[] = [];
    let hidden = 0;
    for (const b of briefs) {
      const line = `- ${b.name} — "${b.query}"${b.segment ? ` · ${b.segment}` : ''}${b.city ? ` · ${b.city}` : ''}${b.target ? ` · ≤${b.target}` : ''} · ${b.enabled ? 'ativo' : b.created_by === 'strategist' ? 'rascunho (já proposto)' : 'pausado'}`;
      if (budget - line.length - 1 < 0) {
        hidden++;
        continue;
      }
      lines.push(line);
      budget -= line.length + 1;
    }
    parts.push(
      `BRIEFS ATUAIS (não re-proponha o que já existe):\n${lines.length ? lines.join('\n') : '(nenhum)'}${hidden ? `\n+${hidden} mais antigos além do orçamento de contexto` : ''}`,
    );
    if (t.params.text) parts.push(`PEDIDO DA EQUIPE: ${t.params.text}`);
    const parked = t.source.startsWith('staff') ? null : await automationParked(c, 'strategist');
    return { text: parts.join('\n\n'), memory: await promptMemoryTx(c, null), parked };
  });
}

async function automationParked(tx: Sql, kind: 'discovery' | 'strategist'): Promise<string | null> {
  const { automationAllowedTx } = await import('../../../crm/policy.ts');
  const v = await automationAllowedTx(tx, kind);
  return v.ok ? null : v.reason;
}
