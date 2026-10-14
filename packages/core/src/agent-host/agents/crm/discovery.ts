import {
  block,
  defineAgent,
  defineStatechart,
  pass,
  type Json,
  type JsonObject,
  type OutputGuard,
} from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { CRM_DISCOVERY_ID, HUNT_SUBJECT } from '../../../crm/jobs.ts';
import { huntSubjectTx, workspaceTx, type Workspace } from './context.ts';
import { available, offers } from './availability.ts';
import { buildSystemPrompt, type PromptMemory } from './prompts.ts';
import { applyCrm, EMPTY_TURN, turn, turnOf } from './shared.ts';
import {
  bookDigest,
  bookTool,
  campaignPlanTool,
  createLeadTool,
  DISCOVERY_LEAD_CAP,
  discoveryAddNoteTool,
  discoveryGetLeadTool,
  discoveryUpdateLeadTool,
  searchLeadsTool,
} from './tools-discovery.ts';
import {
  instagramProfileTool,
  mapsLookupTool,
  readPagesTool,
  serpTool,
  webSearchTool,
} from './tools-research.ts';

// Discovery (ADR 0030 step 3): finds new prospects for a brief (its daily run, one actor per
// brief) or for a staff hunt (one actor each), files them as leads and, past the score gate,
// wakes each new lead's own agent for the first contact.

export const DISCOVERY_TOOLS = [
  'search_leads',
  'get_lead',
  'create_lead',
  'update_lead',
  'add_note',
  'plan',
  'book',
  'web_search',
  'read_pages',
  'maps_lookup',
  'instagram_profile',
  'serp',
];

interface Hunt {
  text: string;
  memory: PromptMemory;
  parked: string | null;
}

const workspace = (j: Json) => j as unknown as Workspace | null;
const hunt = (j: Json) => j as unknown as Hunt | null;

/** A prospect still open when the turn tries to stop goes back once: resolve it or mark it dead. */
export const bookSettled: OutputGuard = {
  id: 'book_settled',
  stage: 'output',
  run(_text, { state }) {
    const t = turn(state);
    if (t.nudged) return pass;
    const open = t.book.filter((e) => e.status === 'open' && !e.channels.whatsapp);
    if (!open.length) return pass;
    return block(
      'book_open',
      `Prospects abertos sem whatsapp: ${open
        .slice(0, 8)
        .map((e) => e.name)
        .join(
          ', ',
        )}. Resolva cada um (whatsapp no book e create_lead) ou marque dead com os movimentos gastos em tried antes de encerrar.`,
    );
  },
};

export const crmDiscovery = defineAgent<Sql>({
  id: CRM_DISCOVERY_ID,
  subject: HUNT_SUBJECT,
  lane: 'background',
  transport: 'crm-log',
  replies: false,
  offers,
  models: { default: 'strong', maxTokens: 4000, temperature: 0.3 },
  instructions: [
    {
      id: 'crm-discovery',
      tier: 'tenant',
      priority: 100,
      text: (ctx) => {
        const ws = workspace(ctx.tenant);
        if (!ws) return '';
        return buildSystemPrompt(
          'discovery',
          ws.pitch,
          ws.instructions,
          hunt(ctx.subject)?.memory ?? { facts: [] },
          {
            autoContact: ws.autoContact,
            tools: new Set(DISCOVERY_TOOLS.filter((n) => !ws.disabled[n])),
            channels: ws.channels,
          },
        );
      },
    },
    { id: 'crm-hunt', tier: 'subject', priority: 90, text: (ctx) => hunt(ctx.subject)?.text ?? '' },
  ],
  volatile: (ctx) => {
    const t = turn(ctx.state);
    const target = Math.floor(Number(t.params.target));
    const cap = Number.isFinite(target) && target > 0 ? Math.min(1000, target) : DISCOVERY_LEAD_CAP;
    return [
      `META: ${t.leadsCreated}/${cap} leads novos criados nesta run`,
      `PLANO: ${t.campaign ?? '(sem plano — comece por plan)'}`,
      `LIVRO:\n${bookDigest(t.book)}`,
      t.monidUsd > 0 ? `MONID: US$${t.monidUsd.toFixed(3)} gastos` : '',
    ]
      .filter(Boolean)
      .join('\n');
  },
  tools: [
    searchLeadsTool,
    discoveryGetLeadTool,
    createLeadTool,
    discoveryUpdateLeadTool,
    discoveryAddNoteTool,
    campaignPlanTool,
    bookTool,
    webSearchTool,
    readPagesTool,
    mapsLookupTool,
    instagramProfileTool,
    serpTool,
  ],
  statechart: defineStatechart({
    initial: 'discovery',
    states: { discovery: { tools: DISCOVERY_TOOLS } },
  }),
  guards: { tool: [available], output: [bookSettled] },
  budgets: { stepsPerTurn: 30, tokensPerTurn: 2_000_000, costPerTurnUsd: 3, tenantDaily: 'crm' },
  finish: (s) => !!hunt(s.context.subject)?.parked,
  toInput: (m) => {
    const p = (m.payload ?? {}) as JsonObject;
    const what =
      m.kind === 'timer.daily'
        ? `Rodada diária do brief ${typeof p.briefName === 'string' ? p.briefName : ''}`.trim()
        : `Caçada pedida pela equipe${typeof p.text === 'string' && p.text ? `: ${p.text}` : ''}`;
    return { role: 'user', parts: [{ type: 'text', text: `${what}. Siga a DISCOVERY QUERY.` }] };
  },
  load: {
    tenant: async ({ tx }) => (await workspaceTx(tx)) as unknown as Json,
    subject: async ({ tx, batch, state }) => {
      const t = batch.length ? turnOf(batch, null) : { ...EMPTY_TURN, ...turn(state) };
      return (await huntSubjectTx(tx, t)) as unknown as Json;
    },
  },
  fold: { initial: { turn: EMPTY_TURN } as unknown as Json, apply: applyCrm },
  compaction: { thresholdTokens: 80_000, keepRecent: 12 },
  maxAttempts: 2,
});
