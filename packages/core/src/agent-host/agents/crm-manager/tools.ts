import { randomUUID } from 'node:crypto';
import { defineTool, LeaseLostError, s, ToolError, type Json } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { HttpError, UUID_RE } from '../../../platform/http.ts';
import { log } from '../../../platform/log.ts';
import {
  AGENT_JOBS,
  agentSettingTx,
  type AgentJob,
  type AutonomyLevel,
} from '../../../crm/policy.ts';
import { label, usd } from '../../../modules/telegram/format.ts';
import {
  createProposalTx,
  guideHandoff,
  guideLead,
  rewriteDraft,
  setLeadAgentState,
  teachRule,
} from '../../../modules/telegram/manager-ops.ts';
import type { ManagerLive } from './context.ts';
import { mgr, type ManagerCtx } from './shared.ts';

// Toolset for the `crm-manager` agent (ADR 0047):
// 1) Read tools — live pipeline, leads, conversations, pending drafts/handoffs, rules, runs
// 2) Coaching tools (immediate, reversible internal guidance) — teach_rule, guide_lead,
//    rewrite_draft, answer_handoff, set_lead_agent
// 3) Proposal tools (1-tap Confirm/Cancel card in Telegram) — global autonomy/instructions,
//    deleting memory rules, approving drafts, sending direct messages to leads, paid board runs.

const tlog = log.child({ mod: 'crm-manager' });

async function safe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError || e instanceof LeaseLostError) throw e;
    if (e instanceof HttpError) throw new ToolError(e.message);
    tlog.error({ err: e }, 'crm-manager tool failed');
    const detail = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
    throw new ToolError(`erro interno ao consultar/atualizar o CRM (${detail})`);
  }
}

function who(ctx: ManagerCtx): { staffName: string; chatId: string } {
  const live = ctx.state.context.subject as unknown as ManagerLive | null;
  return {
    staffName: live?.staffName || 'equipe',
    chatId: live?.chatId || ctx.subject.id,
  };
}

function assertUuid(id: string, name: string): string {
  if (!UUID_RE.test(id))
    throw new ToolError(`${name} inválido — passe o UUID exato retornado pelas ferramentas`);
  return id;
}

// ── Read tools ───────────────────────────────────────────────────────────────

export const pipelineOverviewTool = defineTool<Record<string, never>, Sql>({
  name: 'pipeline_overview',
  description:
    'Read current sales pipeline counts by stage, today’s leads/replies/runs/spend, active discovery briefs, and agent autonomy settings.',
  effect: 'read',
  input: s.object({}),
  run: (ctx) =>
    safe(() =>
      mgr(ctx, async (tx) => {
        const [agent, stages, briefs, paused] = await Promise.all([
          agentSettingTx(tx),
          tx<{ state: string; n: number }[]>`
            select state, count(*)::int as n from leads where archived_at is null
            group by state order by n desc
          `,
          tx<
            {
              id: string;
              name: string;
              query: string;
              enabled: boolean;
              last_run_at: Date | null;
            }[]
          >`
            select id, name, query, enabled, last_run_at from discovery_briefs
            order by enabled desc, created_at desc limit 10
          `,
          tx<{ id: string; name: string; business_name: string | null }[]>`
            select id, name, business_name from leads
            where agent_paused_at is not null and archived_at is null
            order by agent_paused_at desc limit 10
          `,
        ]);
        return {
          autonomy: agent.level,
          jobs: agent.jobs,
          weeklyDiscoveryUsd: agent.weeklyDiscoveryUsd,
          stages: Object.fromEntries(stages.map((r) => [r.state, r.n])),
          pausedLeads: paused.map((l) => ({
            id: l.id,
            name: l.name,
            business: l.business_name,
          })),
          briefs: briefs.map((b) => ({
            id: b.id,
            name: b.name,
            query: b.query,
            enabled: b.enabled,
            lastRunAt: b.last_run_at?.toISOString() ?? null,
          })),
        } as unknown as Json;
      }),
    ),
});

export const searchLeadsTool = defineTool<
  {
    query?: string | undefined;
    state?: 'lead' | 'contacted' | 'invited' | 'live' | undefined;
    pausedOnly?: boolean | undefined;
    limit?: number | undefined;
  },
  Sql
>({
  name: 'search_leads',
  description:
    'Search CRM leads by name, business, city, segment, email, phone, or filter by pipeline stage or paused status.',
  effect: 'read',
  input: s.object({
    query: s.string({ max: 120 }).optional(),
    state: s.enum(['lead', 'contacted', 'invited', 'live']).optional(),
    pausedOnly: s.boolean().optional(),
    limit: s.int({ min: 1, max: 15 }).optional(),
  }),
  run: (ctx, input) =>
    safe(() =>
      mgr(ctx, async (tx) => {
        const q = input.query?.trim() ?? '';
        const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
        const rows = await tx<
          {
            id: string;
            name: string;
            business_name: string | null;
            city: string | null;
            segment: string | null;
            state: string;
            owner: string | null;
            agent_mode: string;
            agent_paused_at: Date | null;
            updated_at: Date;
          }[]
        >`
          select id, name, business_name, city, segment, state, owner, agent_mode, agent_paused_at, updated_at
          from leads
          where archived_at is null
            ${q ? tx`and (name ilike ${like} or coalesce(business_name, '') ilike ${like} or coalesce(city, '') ilike ${like} or coalesce(segment, '') ilike ${like} or coalesce(whatsapp, '') ilike ${like})` : tx``}
            ${input.state ? tx`and state = ${input.state}` : tx``}
            ${input.pausedOnly ? tx`and agent_paused_at is not null` : tx``}
          order by updated_at desc
          limit ${input.limit ?? 10}
        `;
        return {
          leads: rows.map((r) => ({
            id: r.id,
            name: r.name,
            business: r.business_name,
            city: r.city,
            segment: r.segment,
            state: r.state,
            owner: r.owner,
            agentMode: r.agent_mode,
            agentPaused: r.agent_paused_at !== null,
          })),
        } as unknown as Json;
      }),
    ),
});

export const getLeadDetailsTool = defineTool<{ leadId: string }, Sql>({
  name: 'get_lead_details',
  description:
    'Read one lead in full: contact channels, stage, agent pause/mode, open drafts, open handoffs/tasks, recent messages, recent notes, and recent agent runs.',
  effect: 'read',
  input: s.object({ leadId: s.string({ min: 1, max: 64 }) }),
  run: (ctx, input) =>
    safe(() => {
      const leadId = assertUuid(input.leadId, 'leadId');
      return mgr(ctx, async (tx) => {
        const [lead] = await tx<
          {
            id: string;
            name: string;
            business_name: string | null;
            city: string | null;
            segment: string | null;
            state: string;
            owner: string | null;
            whatsapp: string | null;
            instagram: string | null;
            email: string | null;
            agent_mode: string;
            agent_paused_at: Date | null;
            unsubscribed_at: Date | null;
            next_action_at: Date | null;
          }[]
        >`
          select id, name, business_name, city, segment, state, owner, whatsapp, instagram, email,
                 agent_mode, agent_paused_at, unsubscribed_at, next_action_at
          from leads where id = ${leadId}
        `;
        if (!lead) throw new ToolError('lead não encontrado');

        const [messages, tasks, notes, runs] = await Promise.all([
          tx<
            {
              id: string;
              channel: string;
              direction: string;
              author: string;
              status: string;
              body: string;
              created_at: Date;
            }[]
          >`
            select m.id, t.channel, m.direction, m.author, m.status, m.body, m.created_at
            from lead_messages m join lead_threads t on t.id = m.thread_id
            where t.lead_id = ${leadId}
            order by m.created_at desc limit 10
          `,
          tx<{ id: string; title: string; due_at: Date | null; created_by: string }[]>`
            select id, title, due_at, created_by from lead_tasks
            where lead_id = ${leadId} and done_at is null
            order by created_at desc limit 5
          `,
          tx<{ kind: string; body: string | null; created_by: string; at: Date }[]>`
            select kind, body, created_by, at from lead_activities
            where lead_id = ${leadId}
            order by at desc limit 6
          `,
          tx<
            {
              kind: string;
              status: string;
              outcome: string | null;
              cost_cents: number;
              error: string | null;
              started_at: Date;
            }[]
          >`
            select kind, status, outcome, cost_cents, error, started_at from crm_turns
            where lead_id = ${leadId}
            order by started_at desc limit 5
          `,
        ]);

        return {
          lead: {
            id: lead.id,
            name: lead.name,
            business: lead.business_name,
            city: lead.city,
            segment: lead.segment,
            state: lead.state,
            owner: lead.owner,
            channels: {
              whatsapp: Boolean(lead.whatsapp),
              instagram: lead.instagram,
              email: Boolean(lead.email),
            },
            agentMode: lead.agent_mode,
            agentPaused: lead.agent_paused_at !== null,
            unsubscribed: lead.unsubscribed_at !== null,
            nextActionAt: lead.next_action_at?.toISOString() ?? null,
          },
          recentMessages: messages.reverse().map((m) => ({
            id: m.id,
            channel: m.channel,
            direction: m.direction,
            author: m.author,
            status: m.status,
            body: m.body.slice(0, 400),
            at: m.created_at.toISOString(),
          })),
          openTasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            isHandoff: t.title.startsWith('[humano]'),
          })),
          recentNotes: notes.map((n) => ({
            kind: n.kind,
            by: n.created_by,
            body: (n.body ?? '').slice(0, 250),
            at: n.at.toISOString(),
          })),
          recentRuns: runs.map((r) => ({
            kind: r.kind,
            status: r.status,
            outcome: r.outcome,
            costUsd: usd(r.cost_cents),
            error: r.error?.slice(0, 160) ?? null,
          })),
        } as unknown as Json;
      });
    }),
});

export const listPendingTool = defineTool<Record<string, never>, Sql>({
  name: 'list_pending',
  description:
    'List all open agent drafts waiting for approval and all open human handoff requests (with their UUIDs).',
  effect: 'read',
  input: s.object({}),
  run: (ctx) =>
    safe(() =>
      mgr(ctx, async (tx) => {
        const [drafts, handoffs] = await Promise.all([
          tx<
            {
              message_id: string;
              lead_id: string;
              lead_name: string;
              business_name: string | null;
              channel: string;
              body: string;
              created_at: Date;
            }[]
          >`
            select m.id as message_id, l.id as lead_id, l.name as lead_name, l.business_name,
                   t.channel, m.body, m.created_at
            from lead_messages m
            join lead_threads t on t.id = m.thread_id
            join leads l on l.id = t.lead_id
            where m.status = 'draft'
            order by m.created_at asc limit 10
          `,
          tx<
            {
              task_id: string;
              lead_id: string;
              lead_name: string;
              business_name: string | null;
              title: string;
              created_at: Date;
            }[]
          >`
            select tk.id as task_id, l.id as lead_id, l.name as lead_name, l.business_name,
                   tk.title, tk.created_at
            from lead_tasks tk join leads l on l.id = tk.lead_id
            where tk.done_at is null and tk.title like '[humano]%'
            order by tk.created_at asc limit 10
          `,
        ]);
        return {
          drafts: drafts.map((d) => ({
            messageId: d.message_id,
            leadId: d.lead_id,
            leadName: d.lead_name,
            business: d.business_name,
            channel: d.channel,
            body: d.body.slice(0, 350),
          })),
          handoffs: handoffs.map((h) => ({
            taskId: h.task_id,
            leadId: h.lead_id,
            leadName: h.lead_name,
            business: h.business_name,
            reason: h.title.replace(/^\[humano\]\s*/, ''),
          })),
        } as unknown as Json;
      }),
    ),
});

export const listRulesTool = defineTool<Record<string, never>, Sql>({
  name: 'list_rules',
  description:
    'Read the sales agent’s global instructions and its stored memory items (workspace and segment rules, with their UUIDs).',
  effect: 'read',
  input: s.object({}),
  run: (ctx) =>
    safe(() =>
      mgr(ctx, async (tx) => {
        const [agent, items] = await Promise.all([
          agentSettingTx(tx),
          tx<
            {
              id: string;
              scope: string;
              segment: string | null;
              content: string;
              pinned: boolean;
              source: string;
            }[]
          >`
            select id, scope, segment, content, pinned, source from agent_memory_items
            where scope in ('workspace', 'segment')
            order by pinned desc, updated_at desc limit 25
          `,
        ]);
        return {
          instructions: agent.instructions,
          memory: items,
        } as unknown as Json;
      }),
    ),
});

export const listRunsTool = defineTool<
  { limit?: number | undefined; onlyFailed?: boolean | undefined },
  Sql
>({
  name: 'list_runs',
  description: 'List recent sales agent runs (turns), their outcomes, errors, and USD cost.',
  effect: 'read',
  input: s.object({
    limit: s.int({ min: 1, max: 15 }).optional(),
    onlyFailed: s.boolean().optional(),
  }),
  run: (ctx, input) =>
    safe(() =>
      mgr(ctx, async (tx) => {
        const rows = await tx<
          {
            kind: string;
            status: string;
            outcome: string | null;
            lead_name: string | null;
            cost_cents: number;
            error: string | null;
            started_at: Date;
          }[]
        >`
          select r.kind, r.status, r.outcome, l.name as lead_name, r.cost_cents, r.error, r.started_at
          from crm_turns r left join leads l on l.id = r.lead_id
          ${input.onlyFailed ? tx`where r.status = 'failed'` : tx``}
          order by r.started_at desc limit ${input.limit ?? 10}
        `;
        return {
          runs: rows.map((r) => ({
            kind: r.kind,
            status: r.status,
            outcome: r.outcome,
            lead: r.lead_name,
            costUsd: usd(r.cost_cents),
            error: r.error?.slice(0, 180) ?? null,
            at: r.started_at.toISOString(),
          })),
        } as unknown as Json;
      }),
    ),
});

// ── Immediate coaching tools (reversible, internal guidance) ─────────────────

export const teachRuleTool = defineTool<{ rule: string; segment?: string | undefined }, Sql>({
  name: 'teach_rule',
  description:
    'Save a new pinned rule in the sales agent’s permanent memory (`agent_memory_items`) so every future sales turn follows it. Use optional `segment` when the rule applies only to one niche (e.g. "docerias").',
  effect: 'write',
  input: s.object({
    rule: s.string({ min: 3, max: 500 }),
    segment: s.string({ max: 120 }).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const r = await teachRule(ctx.tx, {
        content: input.rule,
        ...(input.segment ? { segment: input.segment } : {}),
        idemKey: `tg-mgr:teach:${ctx.turnId}:${randomUUID().slice(0, 12)}`,
      });
      return {
        saved: true,
        id: r.id,
        scope: r.scope,
        segment: r.segment,
        rule: r.content,
      } as unknown as Json;
    }),
});

export const guideLeadTool = defineTool<
  {
    leadId: string;
    guidance: string;
    draftOnly?: boolean | undefined;
    kind?: 'reply' | 'outreach' | 'triage' | undefined;
  },
  Sql
>({
  name: 'guide_lead',
  description:
    'Record coaching guidance on a specific lead and wake the sales agent to act on it right away (unpauses if paused). Set draftOnly=true if staff asked to review before sending.',
  effect: 'write',
  input: s.object({
    leadId: s.string({ min: 1, max: 64 }),
    guidance: s.string({ min: 2, max: 2000 }),
    draftOnly: s.boolean().optional(),
    kind: s.enum(['reply', 'outreach', 'triage']).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const leadId = assertUuid(input.leadId, 'leadId');
      const { staffName } = who(ctx);
      const r = await guideLead(ctx.tx, {
        leadId,
        guidance: input.guidance,
        by: staffName,
        idemKey: `tg-mgr:guide:${ctx.turnId}:${randomUUID().slice(0, 12)}`,
        ...(input.draftOnly !== undefined ? { draftOnly: input.draftOnly } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      });
      return {
        queued: true,
        leadId: r.leadId,
        leadName: r.leadName,
        runId: r.mailboxId,
      } as unknown as Json;
    }),
});

export const rewriteDraftTool = defineTool<{ messageId: string; guidance: string }, Sql>({
  name: 'rewrite_draft',
  description:
    'Reject an open agent draft and have the sales agent rewrite a new draft following staff’s guidance (always stays as a draft for approval).',
  effect: 'write',
  input: s.object({
    messageId: s.string({ min: 1, max: 64 }),
    guidance: s.string({ min: 2, max: 2000 }),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const messageId = assertUuid(input.messageId, 'messageId');
      const { staffName } = who(ctx);
      const r = await rewriteDraft(ctx.tx, {
        messageId,
        guidance: input.guidance,
        by: staffName,
        idemKey: `tg-mgr:rewrite:${ctx.turnId}:${randomUUID().slice(0, 12)}`,
      });
      return { rewriting: true, leadName: r.leadName, runId: r.mailboxId } as unknown as Json;
    }),
});

export const answerHandoffTool = defineTool<
  { taskId: string; guidance: string; draftOnly?: boolean | undefined },
  Sql
>({
  name: 'answer_handoff',
  description:
    'Answer an open agent handoff request: resolves the handoff, unpauses the lead, records staff’s answer, and wakes the sales agent to reply to the lead using that guidance.',
  effect: 'write',
  input: s.object({
    taskId: s.string({ min: 1, max: 64 }),
    guidance: s.string({ min: 2, max: 2000 }),
    draftOnly: s.boolean().optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const taskId = assertUuid(input.taskId, 'taskId');
      const { staffName } = who(ctx);
      const r = await guideHandoff(ctx.tx, {
        taskId,
        guidance: input.guidance,
        by: staffName,
        idemKey: `tg-mgr:handoff:${ctx.turnId}:${randomUUID().slice(0, 12)}`,
        ...(input.draftOnly !== undefined ? { draftOnly: input.draftOnly } : {}),
      });
      return { resolved: true, leadName: r.leadName, runId: r.mailboxId } as unknown as Json;
    }),
});

export const setLeadAgentTool = defineTool<
  { leadId: string; paused?: boolean | undefined; mode?: 'auto' | 'draft' | 'off' | undefined },
  Sql
>({
  name: 'set_lead_agent',
  description:
    'Pause or resume the sales agent on one lead, or switch that lead’s agent mode between auto, draft (always draft first), or off.',
  effect: 'write',
  input: s.object({
    leadId: s.string({ min: 1, max: 64 }),
    paused: s.boolean().optional(),
    mode: s.enum(['auto', 'draft', 'off']).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const leadId = assertUuid(input.leadId, 'leadId');
      if (input.paused === undefined && input.mode === undefined) {
        throw new ToolError('informe paused ou mode');
      }
      const r = await setLeadAgentState(ctx.tx, {
        leadId,
        ...(input.paused !== undefined ? { paused: input.paused } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
        idemKey: `tg-mgr:leadstate:${ctx.turnId}:${randomUUID().slice(0, 12)}`,
      });
      return r as unknown as Json;
    }),
});

// ── Confirmed proposal tools (1-tap Confirm/Cancel card in Telegram) ─────────

export const proposeAutonomyTool = defineTool<
  {
    level?: AutonomyLevel | undefined;
    reply?: boolean | undefined;
    outreach?: boolean | undefined;
    discovery?: boolean | undefined;
    strategist?: boolean | undefined;
  },
  Sql
>({
  name: 'propose_autonomy',
  description:
    'Prepare a 1-tap confirmation card to change global workspace autonomy (off/copilot/supervised/autopilot) or toggle automatic jobs (reply/outreach/discovery/strategist). Does NOT apply until staff taps Confirm.',
  effect: 'write',
  input: s.object({
    level: s.enum(['off', 'copilot', 'supervised', 'autopilot']).optional(),
    reply: s.boolean().optional(),
    outreach: s.boolean().optional(),
    discovery: s.boolean().optional(),
    strategist: s.boolean().optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const jobs: Partial<Record<AgentJob, boolean>> = {};
      for (const j of AGENT_JOBS) {
        if (typeof input[j] === 'boolean') jobs[j] = input[j];
      }
      if (!input.level && !Object.keys(jobs).length) {
        throw new ToolError(
          'informe level ou ao menos uma rotina (reply/outreach/discovery/strategist)',
        );
      }
      const lines: string[] = [];
      if (input.level) lines.push(`autonomia → ${label('autonomy', input.level)}`);
      for (const [k, v] of Object.entries(jobs)) {
        lines.push(`${label('agentJob', k)} → ${v ? 'ligado' : 'desligado'}`);
      }
      const { staffName, chatId } = who(ctx);
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'set_autonomy',
          title: 'mudar configuração do agente',
          lines,
          payload: {
            ...(input.level ? { level: input.level } : {}),
            ...(Object.keys(jobs).length ? { jobs } : {}),
          },
        }),
      );
      return { proposed: true, proposalId: p.id, lines } as unknown as Json;
    }),
});

export const proposeInstructionsTool = defineTool<{ instructions: string; summary: string }, Sql>({
  name: 'propose_instructions',
  description:
    'Prepare a 1-tap confirmation card to update global `settings.agent.instructions` (full updated text). Read `list_rules` first so you preserve existing instructions unless staff asked to replace them.',
  effect: 'write',
  input: s.object({
    instructions: s.string({ min: 1, max: 8000 }),
    summary: s.string({ min: 3, max: 200 }).describe('short 1-line summary of what changed'),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const { staffName, chatId } = who(ctx);
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'update_instructions',
          title: 'atualizar instruções globais do agente',
          lines: [input.summary, `tamanho final: ${input.instructions.length} caracteres`],
          payload: { instructions: input.instructions },
        }),
      );
      return { proposed: true, proposalId: p.id } as unknown as Json;
    }),
});

export const proposeDeleteRuleTool = defineTool<{ memoryId: string; preview: string }, Sql>({
  name: 'propose_delete_rule',
  description:
    'Prepare a 1-tap confirmation card to delete a rule from the agent’s memory (`agent_memory_items`). Call `list_rules` first to get the exact memoryId.',
  effect: 'write',
  input: s.object({
    memoryId: s.string({ min: 1, max: 64 }),
    preview: s.string({ min: 1, max: 200 }),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const memoryId = assertUuid(input.memoryId, 'memoryId');
      const { staffName, chatId } = who(ctx);
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'delete_rule',
          title: 'apagar regra da memória',
          lines: [input.preview],
          payload: { memoryId },
        }),
      );
      return { proposed: true, proposalId: p.id } as unknown as Json;
    }),
});

export const proposeApproveDraftTool = defineTool<
  { messageId: string; leadName: string; excerpt: string },
  Sql
>({
  name: 'propose_approve_draft',
  description:
    'Prepare a 1-tap confirmation card to approve and send an open agent draft out to a lead.',
  effect: 'write',
  input: s.object({
    messageId: s.string({ min: 1, max: 64 }),
    leadName: s.string({ min: 1, max: 120 }),
    excerpt: s.string({ min: 1, max: 300 }),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const messageId = assertUuid(input.messageId, 'messageId');
      const { staffName, chatId } = who(ctx);
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'approve_draft',
          title: `aprovar e enviar rascunho para ${input.leadName}`,
          lines: [input.excerpt],
          payload: { messageId },
        }),
      );
      return { proposed: true, proposalId: p.id } as unknown as Json;
    }),
});

export const proposeDirectMessageTool = defineTool<
  {
    leadId: string;
    leadName: string;
    body: string;
    channel?: 'whatsapp' | 'instagram' | 'email' | undefined;
  },
  Sql
>({
  name: 'propose_direct_message',
  description:
    'Prepare a 1-tap confirmation card to send a direct verbatim human message to a lead (pauses the agent on that lead). Never sends until staff taps Confirm.',
  effect: 'write',
  input: s.object({
    leadId: s.string({ min: 1, max: 64 }),
    leadName: s.string({ min: 1, max: 120 }),
    body: s.string({ min: 1, max: 3000 }),
    channel: s.enum(['whatsapp', 'instagram', 'email']).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const leadId = assertUuid(input.leadId, 'leadId');
      const { staffName, chatId } = who(ctx);
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'direct_message',
          title: `enviar mensagem direta para ${input.leadName}`,
          lines: [
            ...(input.channel ? [`canal: ${label('channel', input.channel)}`] : []),
            `texto: "${input.body.slice(0, 260)}"`,
            'o agente fica pausado neste lead após o envio',
          ],
          payload: {
            leadId,
            body: input.body,
            ...(input.channel ? { channel: input.channel } : {}),
          },
        }),
      );
      return { proposed: true, proposalId: p.id } as unknown as Json;
    }),
});

export const proposeBoardRunTool = defineTool<
  {
    kind: 'strategist' | 'discovery';
    query?: string | undefined;
    segment?: string | undefined;
    city?: string | undefined;
    target?: number | undefined;
  },
  Sql
>({
  name: 'propose_board_run',
  description:
    'Prepare a 1-tap confirmation card to launch a Strategist pipeline review or a Discovery prospect hunt (requires query for discovery).',
  effect: 'write',
  input: s.object({
    kind: s.enum(['strategist', 'discovery']),
    query: s.string({ max: 300 }).optional(),
    segment: s.string({ max: 120 }).optional(),
    city: s.string({ max: 120 }).optional(),
    target: s.int({ min: 1, max: 30 }).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      if (input.kind === 'discovery' && !input.query?.trim()) {
        throw new ToolError('descoberta precisa de uma busca (query)');
      }
      const { staffName, chatId } = who(ctx);
      const lines =
        input.kind === 'discovery'
          ? [
              `busca: ${input.query!.trim()}`,
              ...(input.city ? [`cidade: ${input.city}`] : []),
              ...(input.segment ? [`segmento: ${input.segment}`] : []),
              ...(input.target ? [`meta: ${input.target} leads`] : []),
            ]
          : ['analisa funil, taxas de resposta, memória e propõe melhorias de prospecção'];
      const p = await mgr(ctx, (tx) =>
        createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'board_run',
          title:
            input.kind === 'discovery'
              ? 'rodar busca de novos leads (descoberta)'
              : 'rodar revisão do estrategista agora',
          lines,
          payload: {
            kind: input.kind,
            ...(input.query ? { query: input.query.trim() } : {}),
            ...(input.segment ? { segment: input.segment.trim() } : {}),
            ...(input.city ? { city: input.city.trim() } : {}),
            ...(input.target ? { target: input.target } : {}),
          },
        }),
      );
      return { proposed: true, proposalId: p.id } as unknown as Json;
    }),
});

export const listCampaignsTool = defineTool<
  { status?: 'open' | 'active' | 'paused' | 'won' | 'stopped' | 'exhausted' | undefined },
  Sql
>({
  name: 'list_campaigns',
  description:
    'List autonomous sales campaigns (active, paused, won, stopped, or exhausted) with goal progress, USD spent/budget, hunts launched, enrolled leads, active WIP, replies, and playbook summary.',
  effect: 'read',
  input: s.object({
    status: s.enum(['open', 'active', 'paused', 'won', 'stopped', 'exhausted']).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const { listCampaigns } = await import('../../../crm/campaigns.ts');
      const campaigns = await listCampaigns(ctx.tx, {
        ...(input.status ? { status: input.status } : {}),
        limit: 10,
      });
      return {
        campaigns: campaigns.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          goal: `${c.goalProgress}/${c.goalTarget} ${label('campaignGoal', c.goalKind)}`,
          spentUsd: usd(c.spentCents),
          budgetUsd: usd(c.budgetCents),
          hunts: c.huntsLaunched,
          leads: c.leadsEnrolled,
          wip: c.wip ?? null,
          focusSegment: c.focusSegment,
          focusCity: c.focusCity,
          stopReason: c.stopReason,
          playbook: c.playbook.slice(0, 400),
          nextTickAt: c.nextTickAt,
          expiresAt: c.expiresAt,
        })),
      } as unknown as Json;
    }),
});

export const manageCampaignTool = defineTool<
  {
    campaignId: string;
    action: 'pause' | 'resume' | 'stop' | 'guide' | 'bump_budget';
    guidance?: string | undefined;
    addBudgetUsd?: number | undefined;
    reason?: string | undefined;
  },
  Sql
>({
  name: 'manage_campaign',
  description:
    'Control an existing autonomous campaign right away: pause, resume, stop, send tactical steering guidance (`guide`), or add USD budget (`bump_budget`). Pass the exact campaignId UUID from HOJE AGORA or `list_campaigns`.',
  effect: 'write',
  input: s.object({
    campaignId: s.string({ min: 1, max: 64 }),
    action: s.enum(['pause', 'resume', 'stop', 'guide', 'bump_budget']),
    guidance: s.string({ min: 2, max: 1500 }).optional(),
    addBudgetUsd: s.number({ min: 1, max: 200 }).optional(),
    reason: s.string({ max: 300 }).optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const campaignId = assertUuid(input.campaignId, 'campaignId');
      const { staffName } = who(ctx);
      const idemKey = `tg-mgr:camp:${input.action}:${ctx.turnId}:${randomUUID().slice(0, 12)}`;
      const { bumpCampaignBudget, guideCampaign, pauseCampaign, resumeCampaign, stopCampaign } =
        await import('../../../crm/campaigns.ts');

      if (input.action === 'pause') {
        const r = await pauseCampaign(ctx.tx, {
          campaignId,
          reason: input.reason ?? null,
          by: staffName,
          idemKey,
        });
        return { ok: true, status: r.campaign.status, title: r.campaign.title } as unknown as Json;
      }
      if (input.action === 'resume') {
        const r = await resumeCampaign(ctx.tx, {
          campaignId,
          by: staffName,
          ...(input.addBudgetUsd ? { extraBudgetUsd: input.addBudgetUsd } : {}),
          idemKey,
        });
        return {
          ok: true,
          status: r.campaign.status,
          title: r.campaign.title,
          budgetUsd: usd(r.campaign.budget_cents),
        } as unknown as Json;
      }
      if (input.action === 'stop') {
        const r = await stopCampaign(ctx.tx, {
          campaignId,
          reason: input.reason ?? null,
          by: staffName,
          idemKey,
        });
        return { ok: true, status: r.campaign.status, title: r.campaign.title } as unknown as Json;
      }
      if (input.action === 'bump_budget') {
        const addUsd = input.addBudgetUsd ?? 10;
        const r = await bumpCampaignBudget(ctx.tx, {
          campaignId,
          addUsd,
          by: staffName,
          idemKey,
        });
        return {
          ok: true,
          status: r.campaign.status,
          resumed: r.resumed,
          title: r.campaign.title,
          budgetUsd: usd(r.campaign.budget_cents),
        } as unknown as Json;
      }
      if (!input.guidance?.trim()) {
        throw new ToolError('informe guidance para orientar a campanha');
      }
      const r = await guideCampaign(ctx.tx, {
        campaignId,
        guidance: input.guidance,
        by: staffName,
        idemKey,
      });
      return {
        ok: true,
        guided: true,
        status: r.campaign.status,
        title: r.campaign.title,
      } as unknown as Json;
    }),
});

export const proposeStartCampaignTool = defineTool<
  {
    title: string;
    objective: string;
    goalKind?: 'signup' | 'meeting' | 'reply' | undefined;
    goalTarget?: number | undefined;
    goalScope?: 'any' | 'campaign_only' | undefined;
    budgetUsd?: number | undefined;
    maxDays?: number | undefined;
    maxHuntsPerDay?: number | undefined;
    targetWip?: number | undefined;
    focusSegment?: string | undefined;
    focusCity?: string | undefined;
    allowExistingLeads?: boolean | undefined;
    enableAutopilot?: boolean | undefined;
  },
  Sql
>({
  name: 'propose_start_campaign',
  description:
    'Prepare a 1-tap confirmation card to launch Autonomous Campaign Mode (`crm-campaign`): keeps discovering leads, messaging, following up, and pivoting niches/angles within hard budget/time/channel guardrails until the goal (default: 1 verified signup) is reached. Does NOT start until staff taps Confirm.',
  effect: 'write',
  input: s.object({
    title: s.string({ min: 3, max: 160 }).describe('short title, e.g. "Conseguir 1 cadastro"'),
    objective: s
      .string({ min: 5, max: 2000 })
      .describe('full mission brief capturing everything staff asked for'),
    goalKind: s.enum(['signup', 'meeting', 'reply']).optional(),
    goalTarget: s.int({ min: 1, max: 100 }).optional(),
    goalScope: s.enum(['any', 'campaign_only']).optional(),
    budgetUsd: s.number({ min: 1, max: 1000 }).optional(),
    maxDays: s.int({ min: 1, max: 60 }).optional(),
    maxHuntsPerDay: s.int({ min: 1, max: 12 }).optional(),
    targetWip: s.int({ min: 3, max: 80 }).optional(),
    focusSegment: s.string({ max: 120 }).optional(),
    focusCity: s.string({ max: 120 }).optional(),
    allowExistingLeads: s.boolean().optional(),
    enableAutopilot: s
      .boolean()
      .describe('set true to also switch global workspace autonomy to autopilot on confirm')
      .optional(),
  }),
  run: (ctx, input) =>
    safe(async () => {
      const {
        DEFAULT_CAMPAIGN_BUDGET_USD,
        DEFAULT_CAMPAIGN_MAX_DAYS,
        DEFAULT_CAMPAIGN_MAX_HUNTS_PER_DAY,
        DEFAULT_CAMPAIGN_TARGET_WIP,
        goalKindLabel,
        preflightCampaignTx,
      } = await import('../../../crm/campaigns.ts');
      const goalKind = input.goalKind ?? 'signup';
      const goalTarget = input.goalTarget ?? 1;
      const budgetUsd = input.budgetUsd ?? DEFAULT_CAMPAIGN_BUDGET_USD;
      const maxDays = input.maxDays ?? DEFAULT_CAMPAIGN_MAX_DAYS;
      const maxHuntsPerDay = input.maxHuntsPerDay ?? DEFAULT_CAMPAIGN_MAX_HUNTS_PER_DAY;
      const targetWip = input.targetWip ?? DEFAULT_CAMPAIGN_TARGET_WIP;
      const allowExistingLeads = input.allowExistingLeads !== false;

      const { staffName, chatId } = who(ctx);
      const out = await mgr(ctx, async (tx) => {
        const preflight = await preflightCampaignTx(tx, goalKind);
        const lines: string[] = [
          `meta: ${goalTarget} ${goalKindLabel(goalKind, goalTarget)} (para automaticamente ao bater)`,
          `teto: US$ ${budgetUsd.toFixed(2)} · prazo: ${maxDays} dias · até ${maxHuntsPerDay} buscas/dia (WIP alvo ${targetWip})`,
        ];
        if (input.focusSegment || input.focusCity) {
          lines.push(`foco: ${[input.focusSegment, input.focusCity].filter(Boolean).join(' · ')}`);
        }
        lines.push(
          allowExistingLeads
            ? 'escopo: busca novos leads + ativa leads intocados do CRM'
            : 'escopo: somente novos leads descobertos',
        );
        if (input.enableAutopilot && preflight.autonomyLevel !== 'autopilot') {
          lines.push('também liga piloto automático (envia sem precisar aprovar rascunho)');
        }
        const relevantWarnings = preflight.warnings.filter(
          (w) => !(input.enableAutopilot && w.startsWith('autonomia')),
        );
        for (const w of relevantWarnings.slice(0, 2)) {
          lines.push(`⚠️ ${w}`);
        }

        const p = await createProposalTx(tx, {
          chatId,
          turnId: ctx.turnId,
          staffName,
          kind: 'start_campaign',
          title: `iniciar modo campanha: ${input.title.trim()}`,
          lines,
          payload: {
            title: input.title.trim(),
            objective: input.objective.trim(),
            goalKind,
            goalTarget,
            ...(input.goalScope ? { goalScope: input.goalScope } : {}),
            budgetUsd,
            maxDays,
            maxHuntsPerDay,
            targetWip,
            ...(input.focusSegment ? { focusSegment: input.focusSegment.trim() } : {}),
            ...(input.focusCity ? { focusCity: input.focusCity.trim() } : {}),
            allowExistingLeads,
            ...(input.enableAutopilot ? { enableAutopilot: true } : {}),
          },
        });
        return { proposed: true, proposalId: p.id, lines, preflight };
      });
      return out as unknown as Json;
    }),
});

export const MANAGER_TOOLS = [
  pipelineOverviewTool,
  searchLeadsTool,
  getLeadDetailsTool,
  listPendingTool,
  listRulesTool,
  listRunsTool,
  listCampaignsTool,
  teachRuleTool,
  guideLeadTool,
  rewriteDraftTool,
  answerHandoffTool,
  setLeadAgentTool,
  manageCampaignTool,
  proposeAutonomyTool,
  proposeInstructionsTool,
  proposeDeleteRuleTool,
  proposeApproveDraftTool,
  proposeDirectMessageTool,
  proposeBoardRunTool,
  proposeStartCampaignTool,
];
