import { defineTool, type Json, s, ToolError } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { HttpError } from '../../../platform/http.ts';
import { addActivity, createTask } from '../../../modules/activities.ts';
import { getLeadDetail, leadPatch, listLeads, updateLead } from '../../../modules/leads.ts';
import {
  hasMemoryTablesTx,
  LEAD_FACT_KEY_RE,
  upsertLeadFactTx,
} from '../../../modules/agent-memory.ts';
import { recordStaffEventTx } from '../../../modules/staff-events.ts';
import { cancelAgentWakeupsTx, parseWakeupAt, scheduleTimerTx } from '../../../crm/agenda.ts';
import { LEAD_FIELDS, NEXT_ACTION_REQUESTED } from './fields.ts';
import { crm, emitAfter, leadOf, refusals, stepKey, turn, type Ctx } from './shared.ts';

// The lead agent's tools on the CRM record of its own lead. The lead is the actor's subject: no
// tool takes a lead id from the model (the old LEAD_MISMATCH fence is gone with the argument).

export const getLeadTool = defineTool<Record<string, never>, Sql>({
  name: 'get_lead',
  description: 'Full lead profile: fields, tags, score, counters.',
  effect: 'read',
  input: s.object({}),
  run: (ctx: Ctx) =>
    refusals(async () => {
      const lead = await getLeadDetail(ctx.tx, leadOf(ctx));
      if (!lead || turn(ctx.state).kind !== 'triage') return lead as unknown as Json;
      // triage checks for duplicates on the card's own name, identity fields only (no contacts)
      const q = (lead.businessName || lead.name || '').trim().slice(0, 100);
      const { leads } = q ? await listLeads(ctx.tx, { q, limit: 6 }) : { leads: [] };
      return {
        ...lead,
        possibleDuplicates: leads
          .filter((l) => l.id !== lead.id)
          .slice(0, 5)
          .map((l) => ({
            id: l.id,
            name: l.name,
            business: l.businessName,
            city: l.city,
            state: l.state,
          })),
      } as unknown as Json;
    }),
});

const UPDATE_INPUT = s.object({
  name: s
    .string({ max: 200 })
    .describe("the person's real name once the conversation shows it")
    .optional(),
  ...LEAD_FIELDS,
  nextActionRequested: NEXT_ACTION_REQUESTED,
  archived: s
    .boolean()
    .describe(
      "true archives the lead — off the board (staff sees it under 'arquivados'), suppressed from every agent gate; the kill switch for off-ICP/dead leads",
    )
    .optional(),
  agentGoal: s
    .enum(['negotiation', 'meeting'])
    .describe(
      'switch what the agent is driving toward — flip it when the lead signals the other goal (wants a call while on negotiation, wants to close in-thread while on meeting)',
    )
    .optional(),
});

/** update_lead on a given lead: the lead agent's own, or one a discovery turn created. */
export async function updateLeadAs(
  ctx: Ctx,
  leadId: string,
  input: Record<string, unknown>,
): Promise<Json> {
  const rest: Record<string, unknown> = { ...input };
  // staff-set autonomy knobs are refused: archived:false would un-suppress
  if (rest.archived === false) delete rest.archived;
  // provenance marker, not a column — 'requested' dates survive a fresh inbound
  const requested = rest.nextActionRequested === true;
  delete rest.nextActionRequested;
  for (const k of Object.keys(rest)) if (rest[k] === undefined) delete rest[k];
  if (Object.keys(rest).length === 0)
    return {
      ignored: true,
      reason: 'agentMode, agentPaused and unarchiving are staff-managed; nothing else to update',
    };
  try {
    const res = await updateLead(
      ctx.tx,
      leadId,
      leadPatch(rest, 'agent', requested),
      stepKey(ctx, 'update_lead'),
      'agent',
    );
    emitAfter(ctx, 'lead.change', leadId);
    return res.body as unknown as Json;
  } catch (e) {
    if (e instanceof HttpError && e.code === 'CONTACT_LOCKED')
      return {
        error: `${e.message} Se o lead pediu a troca, use request_human pra equipe confirmar.`,
      };
    return refusals(() => Promise.reject(e));
  }
}

export const updateLeadTool = defineTool<Record<string, unknown>, Sql>({
  name: 'update_lead',
  description:
    'Patch lead fields (contact info, tags, deal value, next action, goal). A contact field (whatsapp/phone/email/instagram) can only be filled while empty; changing a stored one is refused (staff confirms contact changes).',
  effect: 'write',
  input: UPDATE_INPUT,
  run: (ctx: Ctx, input) => updateLeadAs(ctx, leadOf(ctx), input),
});

export const setStateTool = defineTool<{ state: string }, Sql>({
  name: 'set_state',
  description: 'Move a lead along the pipeline (writes state history).',
  effect: 'write',
  input: s.object({ state: s.enum(['lead', 'contacted', 'invited', 'live']) }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const res = await updateLead(
        ctx.tx,
        leadOf(ctx),
        leadPatch({ state: input.state }),
        stepKey(ctx, 'set_state'),
        'agent',
      );
      emitAfter(ctx, 'lead.change', leadOf(ctx));
      return res.body as unknown as Json;
    }),
});

/** add_note on a given lead: the lead agent's own, or one a discovery turn created. */
export async function addNoteAs(ctx: Ctx, leadId: string, body: string): Promise<Json> {
  return refusals(async () => {
    const res = await addActivity(
      ctx.tx,
      leadId,
      { kind: 'note', body, createdBy: 'agent' },
      stepKey(ctx, 'add_note'),
    );
    emitAfter(ctx, 'lead.change', leadId);
    return res.body as unknown as Json;
  });
}

export const addNoteTool = defineTool<{ body: string }, Sql>({
  name: 'add_note',
  description: 'Append a note to the lead timeline.',
  effect: 'write',
  input: s.object({ body: s.string({ min: 1, max: 4000 }) }),
  run: (ctx: Ctx, input) => addNoteAs(ctx, leadOf(ctx), input.body),
});

export const setFactTool = defineTool<
  { key: string; value: string; confidence?: number | undefined },
  Sql
>({
  name: 'set_fact',
  description:
    'Record a durable structured fact about THIS lead — snake_case key (e.g. "team_size", "decision_maker", "monthly_volume"), short value. It lands in lead memory: every later turn on this lead sees it under FATOS. Facts are for durable structured data; add_note is for prose. Same key upserts the value.',
  effect: 'write',
  input: s.object({
    key: s.string({ max: 60, pattern: LEAD_FACT_KEY_RE }).describe('snake_case, ≤60 chars'),
    value: s.string({ min: 1, max: 500 }).describe('≤500 chars'),
    confidence: s
      .number({ min: 0, max: 1 })
      .describe('how sure you are, 0..1 (default 1)')
      .optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const fact = await crm(ctx, async (tx) => {
        if (!(await hasMemoryTablesTx(tx))) return null;
        return upsertLeadFactTx(tx, leadOf(ctx), {
          key: input.key,
          value: input.value,
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          source: 'agent',
          sourceRunId: ctx.turnId,
        });
      });
      if (!fact) return { error: 'lead facts need migration 0035' };
      emitAfter(ctx, 'lead.change', leadOf(ctx));
      return { fact } as unknown as Json;
    }),
});

export const createTaskTool = defineTool<{ title: string; dueAt?: string | undefined }, Sql>({
  name: 'create_task',
  description: 'Create a follow-up task for staff or self.',
  effect: 'write',
  input: s.object({
    title: s.string({ min: 1, max: 300 }),
    dueAt: s.string({ max: 40 }).describe('ISO-8601').optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const res = await createTask(
        ctx.tx,
        leadOf(ctx),
        { title: input.title, dueAt: input.dueAt ?? null, createdBy: 'agent' },
        stepKey(ctx, 'create_task'),
      );
      emitAfter(ctx, 'lead.change', leadOf(ctx));
      return res.body as unknown as Json;
    }),
});

export const scheduleTool = defineTool<
  { at: string; focus: string; requested?: boolean | undefined },
  Sql
>({
  name: 'schedule',
  description:
    'Book your own next touch on this lead: at the given time an outreach turn wakes up with this focus. One pending agenda item per lead — scheduling again replaces it. A new message from the lead cancels it unless requested=true (the lead asked for that date).',
  effect: 'write',
  input: s.object({
    at: s.string({ max: 40 }).describe('ISO-8601 with offset, ≥10 min and ≤90 days ahead'),
    focus: s.string({ min: 1, max: 500 }).describe('what that turn must do and why (≤500 chars)'),
    requested: s.boolean().describe('true only when the lead asked for this date').optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const at = parseWakeupAt(input.at, ctx.now.getTime());
      if (typeof at === 'string') return { error: at };
      const leadId = leadOf(ctx);
      const out = await crm(ctx, async (tx) => {
        const [lead] = await tx<{ archived_at: Date | null; unsubscribed_at: Date | null }[]>`
          select archived_at, unsubscribed_at from leads where id = ${leadId}`;
        if (!lead) return { error: 'lead not found' };
        if (lead.archived_at || lead.unsubscribed_at)
          return { blocked: true, reason: 'lead suppressed' };
        const r = await scheduleTimerTx(tx, {
          leadId,
          at,
          focus: input.focus.trim(),
          requested: input.requested === true,
          by: 'agent',
          turnId: ctx.turnId,
        });
        if ('error' in r) return { error: r.error };
        return { scheduled: true, id: r.wakeup.id, at: r.wakeup.at, replaced: r.replaced };
      });
      if ('scheduled' in out) emitAfter(ctx, 'lead.change', leadId);
      return out as unknown as Json;
    }),
});

type PlanItem = {
  step: string;
  status?: 'todo' | 'done' | 'skip' | undefined;
  note?: string | undefined;
};

export const planTool = defineTool<{ items: PlanItem[] }, Sql>({
  name: 'plan',
  description:
    "The negotiation checklist for THIS lead — write it once you understand the business (methodology stages tailored to them, ending at the lead's GOAL), then send it back marking items done as they complete — it persists on the lead across turns and is your memory between messages. Items merge by step: a step you omit is kept — mark dead ends 'skip' instead of dropping them; on steps you do send, fields you omit keep their stored values (≤12 items).",
  effect: 'write',
  input: s.object({
    items: s
      .array(
        s.object({
          step: s.string({ min: 1, max: 200 }).describe('what must happen'),
          status: s.enum(['todo', 'done', 'skip']).optional(),
          note: s.string({ max: 200 }).describe('evidence/outcome, one line').optional(),
        }),
        { min: 1, max: 12 },
      )
      .describe('the full checklist, current state'),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const norm = (it: unknown) => {
        if (typeof it !== 'object' || it === null) return null;
        const o = it as Record<string, unknown>;
        const step = String(o.step ?? '')
          .trim()
          .slice(0, 200);
        if (!step) return null;
        const status =
          o.status === 'todo' || o.status === 'done' || o.status === 'skip' ? o.status : null;
        const note =
          typeof o.note === 'string'
            ? o.note.trim()
              ? o.note.trim().slice(0, 200)
              : null
            : undefined;
        return { step, status, note };
      };
      const steps = input.items.map(norm).filter((x) => x !== null);
      if (!steps.length)
        throw new ToolError('every item needs a step: a blank plan changes nothing');
      const next = await crm(ctx, async (tx) => {
        const [cur] = await tx<{ agent_plan: unknown }[]>`
          select agent_plan from leads where id = ${leadId} for update`;
        const prev = Array.isArray(cur?.agent_plan) ? cur.agent_plan : [];
        // patch-merge: omitted status/note keep their stored value; 'skip' rides the tail
        const merged: { step: string; status: string; note: string | null }[] = [];
        const index = new Map<string, number>();
        for (const it of prev) {
          const p = norm(it);
          if (!p || index.has(p.step.toLowerCase())) continue;
          index.set(p.step.toLowerCase(), merged.length);
          merged.push({ step: p.step, status: p.status ?? 'todo', note: p.note ?? null });
        }
        for (const p of steps) {
          const i = index.get(p.step.toLowerCase());
          if (i === undefined) {
            index.set(p.step.toLowerCase(), merged.length);
            merged.push({ step: p.step, status: p.status ?? 'todo', note: p.note ?? null });
          } else {
            const was = merged[i]!;
            merged[i] = {
              step: p.step,
              status: p.status ?? was.status,
              note: p.note === undefined ? was.note : p.note,
            };
          }
        }
        const plan = merged
          .filter((x) => x.status !== 'skip')
          .concat(merged.filter((x) => x.status === 'skip'))
          .slice(0, 12);
        await tx`update leads set agent_plan = ${tx.json(plan)}, updated_at = now() where id = ${leadId}`;
        return plan;
      });
      emitAfter(ctx, 'lead.change', leadId);
      return { stored: true, plan: next } as unknown as Json;
    }),
});

export const requestHumanTool = defineTool<{ reason: string }, Sql>({
  name: 'request_human',
  description:
    'Pause the agent on this conversation and hand the lead to staff (creates a task). A human takes over mid-conversation, so reason is the handoff they read first.',
  effect: 'write',
  input: s.object({
    reason: s
      .string({ min: 1, max: 500 })
      .describe(
        'the handoff: what the lead wants, what you already said or tried, what the human must decide',
      ),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const threadId = turn(ctx.state).params.threadId ?? null;
      await crm(ctx, async (tx) => {
        const [lead] = await tx<{ name: string; business_name: string | null }[]>`
          select name, business_name from leads where id = ${leadId}`;
        if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
        let thread: { id: string; channel: string } | null = null;
        if (threadId) {
          // the pause holds this thread only: a date the agent booked would wake a turn that
          // writes on another channel mid-handoff — staff owns the next touch
          await cancelAgentWakeupsTx(tx, leadId);
          const [row] = await tx<{ id: string; channel: string }[]>`
            update lead_threads set agent_enabled = false
            where id = ${threadId} and lead_id = ${leadId}
            returning id, channel`;
          thread = row ?? null;
        }
        if (!thread)
          // no thread of its own: a lead-wide pause, lifted by staff
          await tx`
            update leads set agent_paused_at = now(), updated_at = now()
            where id = ${leadId} and agent_paused_at is null`;
        const [task] = await tx<{ id: string }[]>`
          insert into lead_tasks (lead_id, title, due_at, created_by)
          values (${leadId}, ${`[humano] ${input.reason.slice(0, 200)}`}, null, 'agent')
          returning id`;
        await tx`
          insert into lead_activities (lead_id, kind, body, created_by)
          values (${leadId}, 'system', ${`Handoff para humano — ${input.reason}`}, 'agent')`;
        await recordStaffEventTx(tx, 'handoff.requested', {
          taskId: task!.id,
          leadId,
          leadName: lead.name,
          business: lead.business_name,
          channel: thread?.channel ?? null,
          threadId: thread?.id ?? null,
          reason: input.reason,
        });
      });
      emitAfter(ctx, 'lead.change', leadId);
      return { handedOff: true };
    }),
});
