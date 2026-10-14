import {
  block,
  defineAgent,
  defineStatechart,
  pass,
  type ChatMessage,
  type Json,
  type JsonObject,
  type OutputGuard,
  type ToolGuard,
} from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { CRM_AGENT_ID, LEAD_SUBJECT } from '../../../crm/jobs.ts';
import { leadSubjectTx, workspaceTx, type LeadSubject, type Workspace } from './context.ts';
import { buildSystemPrompt } from './prompts.ts';
import { applyCrm, EMPTY_TURN, turn, turnOf, type TurnInfo } from './shared.ts';
import {
  addNoteTool,
  createTaskTool,
  getLeadTool,
  planTool,
  requestHumanTool,
  scheduleTool,
  setFactTool,
  setStateTool,
  updateLeadTool,
} from './tools-lead.ts';
import { draftMessageTool, sendMessageTool, unsubscribeTool } from './tools-message.ts';
import {
  instagramProfileTool,
  mapsLookupTool,
  readPagesTool,
  serpTool,
  webSearchTool,
} from './tools-research.ts';

export { CRM_AGENT_ID } from '../../../crm/jobs.ts';

// The lead agent (ADR 0030 steps 2–4): Venduá's own seller, one actor per lead under the platform
// tenant. Every touch on a lead is a turn: the lead wrote (reply), the agenda came due or the
// first contact was filed (outreach), staff asked (triage or either). It reaches the lead only
// through its message tools; its plain text is a note in the log (the crm-log transport).

const LEAD_TOOLS = [
  'get_lead',
  'update_lead',
  'set_state',
  'set_fact',
  'add_note',
  'create_task',
  'draft_message',
  'plan',
  'schedule',
  'web_search',
  'read_pages',
  'serp',
];

/** What each job may call: the old TOOL_META, per statechart state. */
export const CRM_STATES: Record<'triage' | 'reply' | 'outreach', string[]> = {
  // triage drafts the first contact; nothing leaves without staff
  triage: [...LEAD_TOOLS, 'maps_lookup', 'instagram_profile'],
  // a live conversation: no paid enrichment, and the lead may ask to leave
  reply: [...LEAD_TOOLS, 'send_message', 'request_human', 'unsubscribe'],
  outreach: [...LEAD_TOOLS, 'maps_lookup', 'instagram_profile', 'send_message', 'request_human'],
};

const workspace = (ctxTenant: Json) => ctxTenant as unknown as Workspace | null;
const leadCtx = (ctxSubject: Json) => ctxSubject as unknown as LeadSubject | null;

/** The tools a turn is offered: its state's, minus what this install can't run. */
export function offered(state: string, ws: Workspace | null): Set<string> {
  const names = CRM_STATES[state as keyof typeof CRM_STATES] ?? CRM_STATES.outreach;
  return new Set(names.filter((n) => !ws?.disabled[n]));
}

/** Refuses a tool whose provider isn't configured, if the model calls it anyway (`offers` hides it). */
export const available: ToolGuard = {
  id: 'available',
  stage: 'tool',
  run(call, { state }) {
    const why = workspace(state.context.tenant)?.disabled[call.name];
    return why ? block(`unavailable:${call.name}`, `${call.name} indisponível: ${why}`) : pass;
  },
};

/** Reply and outreach end on something the lead or staff sees; one nudge, then it may stop. */
export const mustAct: OutputGuard = {
  id: 'must_act',
  stage: 'output',
  run(_text, { state }) {
    const t = turn(state);
    if (t.acted || t.nudged || (t.kind !== 'reply' && t.kind !== 'outreach')) return pass;
    return block(
      'no_action',
      'Ação pendente: a run ainda não fez nada que a pessoa ou a equipe veja (mensagem, rascunho, tarefa, mudança de estado ou request_human). Se ela está esperando resposta, responda agora (send_message ou draft_message). Se não há o que dizer, registre o próximo passo (schedule ou create_task). Se um guardrail ou canal morto trava a resposta, request_human é a saída.',
    );
  },
};

const focusOf = (p: JsonObject) => (typeof p.focus === 'string' && p.focus ? `: ${p.focus}` : '');

/** The mailbox row as the model reads it: what started the turn. The lead's words are in the
 *  CONVERSA block of the context, fenced as data; nothing a lead wrote becomes a user turn. */
export function crmInput(m: { kind: string; source: string; payload: Json }): ChatMessage | null {
  const p = (m.payload ?? {}) as JsonObject;
  const text = (() => {
    switch (m.kind) {
      case 'message.inbound':
        return `O lead escreveu (${String(p.channel ?? m.source)}). A mensagem está no fim da CONVERSA: responda a ela.`;
      case 'timer.followup':
        return `Follow-up da agenda${focusOf(p)}.`;
      case 'timer.callback':
        return `Retorno prometido ao lead${focusOf(p)}.`;
      case 'lead.first_contact':
        return `Primeiro contato${focusOf(p)}.`;
      case 'staff.request':
        return `Pedido da equipe (${String(p.kind ?? 'outreach')})${typeof p.text === 'string' && p.text ? `: ${p.text}` : '.'}${focusOf(p)}`;
      case 'staff.regenerate':
        return `A equipe pediu um novo rascunho${focusOf(p)}.`;
      default:
        return null;
    }
  })();
  return text ? { role: 'user', parts: [{ type: 'text', text: text.slice(0, 4000) }] } : null;
}

const toJob = (job: TurnInfo['kind']) => (s: { custom: Json }) => turn(s as never).kind === job;

const JOB_TRANSITIONS = [
  { to: 'triage', when: toJob('triage') },
  { to: 'reply', when: toJob('reply') },
  { to: 'outreach', when: toJob('outreach') },
];
const KINDS = [
  'message.inbound',
  'timer.followup',
  'timer.callback',
  'lead.first_contact',
  'staff.request',
  'staff.regenerate',
] as const;

export const crmChart = defineStatechart({
  initial: 'outreach',
  states: {
    triage: {
      tools: CRM_STATES.triage,
      hint: 'triagem: dossiê (add_note), próximo passo humano (create_task) e o rascunho do primeiro contato',
    },
    reply: { tools: CRM_STATES.reply, hint: 'responder o lead' },
    outreach: { tools: CRM_STATES.outreach, hint: 'retomar ou abrir a conversa' },
  },
  on: Object.fromEntries(KINDS.map((k) => [`mailbox:${k}`, JOB_TRANSITIONS])),
});

export const crmAgent = defineAgent<Sql>({
  id: CRM_AGENT_ID,
  subject: LEAD_SUBJECT,
  lane: 'followup',
  transport: 'crm-log',
  replies: false,
  // a tool whose provider isn't configured stays out of the model's list
  offers: (tool, s) => !workspace(s.context.tenant)?.disabled[tool],
  models: { default: 'strong', maxTokens: 4000, temperature: 0.4 },
  instructions: [
    {
      id: 'crm-seller',
      tier: 'subject',
      priority: 100,
      text: (ctx) => {
        const ws = workspace(ctx.tenant);
        const lead = leadCtx(ctx.subject);
        if (!ws || !lead) return '';
        const t = turn(ctx.state);
        return buildSystemPrompt(t.kind, ws.pitch, ws.instructions, lead.memory, {
          goal: lead.goal,
          bookingUrl: lead.bookingUrl,
          tools: offered(ctx.state.chart.state, ws),
          channels: ws.channels,
        });
      },
    },
    {
      id: 'crm-lead',
      tier: 'subject',
      priority: 90,
      text: (ctx) => leadCtx(ctx.subject)?.text ?? '',
    },
  ],
  volatile: (ctx) => {
    const t = turn(ctx.state);
    return [
      `RUN: ${t.kind} (${t.trigger}, ${t.source})`,
      t.params.draftOnly ? 'MODO: só rascunho (a equipe aprova antes de sair)' : '',
    ]
      .filter(Boolean)
      .join('\n');
  },
  tools: [
    getLeadTool,
    updateLeadTool,
    setStateTool,
    setFactTool,
    addNoteTool,
    createTaskTool,
    scheduleTool,
    planTool,
    requestHumanTool,
    draftMessageTool,
    sendMessageTool,
    unsubscribeTool,
    webSearchTool,
    readPagesTool,
    mapsLookupTool,
    instagramProfileTool,
    serpTool,
  ],
  statechart: crmChart,
  guards: { tool: [available], output: [mustAct] },
  // a lead's new message stops the turn before it sends a stale answer
  mailbox: { quiet: { minMs: 2_000, maxMs: 20_000 }, preempt: true },
  budgets: { stepsPerTurn: 14, tokensPerTurn: 800_000, costPerTurnUsd: 1, tenantDaily: 'crm' },
  // a parked lead (automation off, suppressed, cost cap) gets no model call; an opt-out ends it
  finish: (s) =>
    s.owner !== 'agent' || !!leadCtx(s.context.subject)?.parked || turn(s).closed === true,
  toInput: (m) => crmInput(m),
  load: {
    tenant: async ({ tx }) => (await workspaceTx(tx)) as unknown as Json,
    subject: async ({ tx, subject, batch, state }) => {
      // the turn's job comes from its batch: the fold hasn't seen turn.started yet
      const t = batch.length ? turnOf(batch, null) : { ...EMPTY_TURN, ...turn(state) };
      return (await leadSubjectTx(tx, subject.id, t)) as unknown as Json;
    },
  },
  fold: { initial: { turn: EMPTY_TURN } as unknown as Json, apply: applyCrm },
  compaction: { thresholdTokens: 60_000, keepRecent: 8 },
  maxAttempts: 3,
});
