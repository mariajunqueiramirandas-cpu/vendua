import { defineAgent, type Json, type JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { CRM_STRATEGIST_ID, REVIEW_SUBJECT } from '../../../crm/jobs.ts';
import { reviewSubjectTx, workspaceTx, type Workspace } from './context.ts';
import { available } from './index.ts';
import { buildSystemPrompt, type PromptMemory } from './prompts.ts';
import { applyCrm, EMPTY_TURN, turn, turnOf } from './shared.ts';
import { proposeBriefTool, rememberTool } from './tools-strategist.ts';

// The weekly review (ADR 0030 step 3): reads what converts and the briefs that exist, and drafts
// new discovery briefs for staff to approve. One actor, `review:weekly`.

interface Review {
  text: string;
  memory: PromptMemory;
  parked: string | null;
}

const review = (j: Json) => j as unknown as Review | null;

export const crmStrategist = defineAgent<Sql>({
  id: CRM_STRATEGIST_ID,
  subject: REVIEW_SUBJECT,
  lane: 'background',
  transport: 'crm-log',
  replies: false,
  // a tool whose provider isn't configured stays out of the model's list
  offers: (tool, s) => !(s.context.tenant as unknown as Workspace | null)?.disabled[tool],
  models: { default: 'strong', maxTokens: 3000, temperature: 0.3 },
  instructions: [
    {
      id: 'crm-strategist',
      tier: 'tenant',
      priority: 100,
      text: (ctx) => {
        const ws = ctx.tenant as unknown as Workspace | null;
        if (!ws) return '';
        return buildSystemPrompt(
          'strategist',
          ws.pitch,
          ws.instructions,
          review(ctx.subject)?.memory ?? { facts: [] },
          {
            tools: new Set(['remember', 'propose_brief'].filter((n) => !ws.disabled[n])),
            channels: ws.channels,
          },
        );
      },
    },
    {
      id: 'crm-review',
      tier: 'subject',
      priority: 90,
      text: (ctx) => review(ctx.subject)?.text ?? '',
    },
  ],
  tools: [rememberTool, proposeBriefTool],
  guards: { tool: [available] },
  budgets: { stepsPerTurn: 10, tokensPerTurn: 400_000, costPerTurnUsd: 1, tenantDaily: 'crm' },
  finish: (s) => !!review(s.context.subject)?.parked,
  toInput: (m) => {
    const p = (m.payload ?? {}) as JsonObject;
    const text =
      m.kind === 'timer.weekly'
        ? 'Revisão semanal de descoberta.'
        : `Revisão pedida pela equipe${typeof p.text === 'string' && p.text ? `: ${p.text}` : '.'}`;
    return { role: 'user', parts: [{ type: 'text', text }] };
  },
  load: {
    tenant: async ({ tx }) => (await workspaceTx(tx)) as unknown as Json,
    subject: async ({ tx, batch, state }) => {
      const t = batch.length ? turnOf(batch, null) : { ...EMPTY_TURN, ...turn(state) };
      return (await reviewSubjectTx(tx, t)) as unknown as Json;
    },
  },
  fold: { initial: { turn: EMPTY_TURN } as unknown as Json, apply: applyCrm },
  compaction: { thresholdTokens: 40_000, keepRecent: 6 },
  maxAttempts: 2,
});
