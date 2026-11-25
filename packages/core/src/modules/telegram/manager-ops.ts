import { randomUUID } from 'node:crypto';
import type { JsonObject } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { mediaProviders, type MediaProviders } from '../../vendedor/media.ts';
import {
  CRM_DISCOVERY_ID,
  CRM_STRATEGIST_ID,
  HUNT_SUBJECT,
  REVIEW_ID,
  REVIEW_SUBJECT,
  requestBoardTx,
  requestLeadTx,
} from '../../crm/dispatch.ts';
import {
  AGENT_INSTRUCTIONS_MAX,
  AGENT_JOBS,
  AUTONOMY_LEVELS,
  agentSettingTx,
  type AgentJob,
  type AutonomyLevel,
} from '../../crm/policy.ts';
import { deleteMemoryItem, rememberTx } from '../agent-memory.ts';
import { claimControl, controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { putSetting, validateSetting } from '../integrations.ts';
import { updateLeadTx } from '../leads.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import {
  approveMessage,
  composeMessageTx,
  isSendChannel,
  rejectMessage,
  type Channel,
} from '../threads.ts';
import { telegramContext } from './config.ts';
import {
  actionButton,
  b,
  esc,
  fitMessage,
  label,
  row,
  toReplyMarkup,
  type InlineButton,
  type TelegramMessage,
} from './format.ts';
import { TelegramError, telegramClient, type TelegramFetch } from './rest.ts';

// Shared sales-agent management operations for Telegram DM (ADR 0047): used by BOTH deterministic
// card replies / buttons / slash commands AND the conversational `crm-manager` Agent Runtime v3
// actor so every path enforces the exact same CRM invariants, idempotency, and audit trail.

const mlog = log.child({ mod: 'telegram-manager' });

const PROMPT_TTL_MS = 30 * 60_000;
const PROPOSAL_TTL_MS = 30 * 60_000;
const OUTBOX_MAX_ATTEMPTS = 6;

// Test hook so unit/integration tests swap Telegram's network for afterCommit outbox delivery too.
let outboxFetchOverride: TelegramFetch | undefined;
export function setTelegramOutboxFetch(fn: TelegramFetch | undefined): void {
  outboxFetchOverride = fn;
}

// ── 1. Sales-agent coaching & control mutations ──────────────────────────────

/** Resolves a handoff, unpauses the lead, records staff's answer, and wakes the sales agent to reply. */
export async function guideHandoff(
  sql: Sql,
  input: { taskId: string; guidance: string; by: string; idemKey: string; draftOnly?: boolean },
): Promise<{
  leadId: string;
  leadName: string;
  taskId: string;
  mailboxId: string | null;
  replayed: boolean;
}> {
  const guidance = input.guidance.trim().slice(0, 2000);
  if (!guidance) throw new HttpError(422, 'BAD_REQUEST', 'orientação vazia');
  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [task] = await tx<{ id: string; lead_id: string; done_at: Date | null; title: string }[]>`
      select id, lead_id, done_at, title from lead_tasks where id = ${input.taskId} for update
    `;
    if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', 'essa tarefa não existe mais');
    const [lead] = await tx<{ id: string; name: string }[]>`
      select id, name from leads where id = ${task.lead_id}
    `;
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'esse lead não existe mais');

    // mark handoff done if still open
    if (!task.done_at) {
      await tx`update lead_tasks set done_at = now() where id = ${task.id}`;
      await recordStaffEventTx(tx, 'handoff.resolved', {
        taskId: task.id,
        leadId: lead.id,
        by: input.by,
      });
    }
    // unpause the lead and re-enable any paused threads so the agent can reply
    await updateLeadTx(tx, lead.id, { agent_paused_at: null }, 'staff');
    await tx`update lead_threads set agent_enabled = true where lead_id = ${lead.id} and not agent_enabled`;

    // latest thread so the agent responds in the right channel
    const [thread] = await tx<{ id: string; channel: string }[]>`
      select id, channel from lead_threads where lead_id = ${lead.id}
      order by last_message_at desc nulls last, created_at desc limit 1
    `;

    await tx`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${lead.id}, 'note', ${`[orientação de ${input.by} no Telegram] ${guidance}`},
              ${tx.json({ source: 'telegram', taskId: task.id } as never)}, 'staff')
    `;

    const d = await requestLeadTx(tx, {
      leadId: lead.id,
      kind: 'staff.request',
      source: `staff:${input.by}`.slice(0, 120),
      dedupeKey: `tg:handoff:${task.id}:${input.idemKey}`,
      payload: {
        kind: 'reply',
        focus: `Resposta da equipe (${input.by}) ao pedido de ajuda "${task.title}": ${guidance}`,
        by: input.by,
        ...(thread ? { threadId: thread.id, channel: thread.channel } : {}),
        ...(input.draftOnly ? { draftOnly: true } : {}),
      } as JsonObject,
    });
    return {
      status: 200,
      body: { leadId: lead.id, leadName: lead.name, taskId: task.id, mailboxId: d.mailboxId },
    };
  });
  if (!res.replayed) {
    emitControlEvent('lead.change', res.body.leadId);
    if (res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  }
  return { ...res.body, replayed: res.replayed };
}

/** Sends a staff-authored message directly to a lead (on a handoff or from the manager), keeping agent paused. */
export async function directReplyToLead(
  sql: Sql,
  input: {
    leadId?: string;
    taskId?: string;
    channel?: Channel;
    body: string;
    by: string;
    idemKey: string;
  },
): Promise<{
  leadId: string;
  leadName: string;
  channel: Channel;
  messageId: string;
  taskId: string | null;
  replayed: boolean;
}> {
  const body = input.body.trim().slice(0, 4000);
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'mensagem vazia');

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    let leadId = input.leadId ?? null;
    let taskId: string | null = input.taskId ?? null;
    if (taskId) {
      const [task] = await tx<{ id: string; lead_id: string; done_at: Date | null }[]>`
        select id, lead_id, done_at from lead_tasks where id = ${taskId} for update
      `;
      if (!task) throw new HttpError(404, 'TASK_NOT_FOUND', 'essa tarefa não existe mais');
      leadId = task.lead_id;
      if (!task.done_at) {
        await tx`update lead_tasks set done_at = now() where id = ${task.id}`;
        await recordStaffEventTx(tx, 'handoff.resolved', {
          taskId: task.id,
          leadId,
          by: input.by,
        });
      }
    }
    if (!leadId) throw new HttpError(422, 'BAD_REQUEST', 'leadId ou taskId obrigatório');
    const [lead] = await tx<
      {
        id: string;
        name: string;
        whatsapp: string | null;
        phone: string | null;
        email: string | null;
        instagram: string | null;
      }[]
    >`
      select id, name, whatsapp, phone, email, instagram from leads where id = ${leadId}
    `;
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'esse lead não existe mais');

    // pick requested channel, or the most recent active thread, or best available contact
    let ch: Channel | null = input.channel ?? null;
    if (!ch) {
      const [th] = await tx<{ channel: string }[]>`
        select channel from lead_threads where lead_id = ${leadId}
        order by last_message_at desc nulls last, created_at desc limit 1
      `;
      if (th && isSendChannel(th.channel)) ch = th.channel;
    }
    if (!ch) {
      if (lead.whatsapp || lead.phone) ch = 'whatsapp';
      else if (lead.instagram) ch = 'instagram';
      else if (lead.email) ch = 'email';
    }
    if (!ch || !isSendChannel(ch)) {
      throw new HttpError(422, 'NO_CHANNEL', 'esse lead não tem WhatsApp, Instagram nem email');
    }

    // pause agent on this lead since a human is taking over directly
    await updateLeadTx(tx, leadId, { agent_paused_at: new Date().toISOString() }, 'staff');
    const composed = await composeMessageTx(tx, {
      leadId,
      channel: ch,
      body,
      author: 'staff',
      status: 'queued',
    });
    return {
      status: 200,
      body: {
        leadId,
        leadName: lead.name,
        channel: ch,
        messageId: composed.body.message.id,
        threadId: composed.body.thread.id,
        taskId,
      },
    };
  });

  if (!res.replayed) {
    emitControlEvent('lead.change', res.body.leadId);
    emitControlEvent('thread.message', res.body.threadId);
    const { dispatchMessage } = await import('../../crm/send.ts');
    void dispatchMessage(sql, res.body.messageId).catch((e) =>
      mlog.error({ err: e, message: res.body.messageId }, 'telegram direct staff send failed'),
    );
  }
  return {
    leadId: res.body.leadId,
    leadName: res.body.leadName,
    channel: res.body.channel,
    messageId: res.body.messageId,
    taskId: res.body.taskId,
    replayed: res.replayed,
  };
}

/** Rejects an open draft and asks the sales agent to write a new draft with staff's guidance. */
export async function rewriteDraft(
  sql: Sql,
  input: { messageId: string; guidance: string; by: string; idemKey: string },
): Promise<{
  leadId: string;
  leadName: string;
  threadId: string;
  mailboxId: string | null;
  replayed: boolean;
}> {
  const guidance = input.guidance.trim().slice(0, 2000);
  if (!guidance) throw new HttpError(422, 'BAD_REQUEST', 'instrução de ajuste vazia');

  // reject the old draft via the standard CRM path first (handles idempotency + draft.resolved)
  const rej = await rejectMessage(sql, input.messageId, `${input.idemKey}:rej`, input.by);
  const old = rej.body.message;

  const res = await claimControl(sql, `${input.idemKey}:regen`, async (tx) => {
    const [row] = await tx<{ lead_id: string; lead_name: string; channel: string }[]>`
      select t.lead_id, l.name as lead_name, t.channel
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${old.threadId}
    `;
    if (!row) throw new HttpError(404, 'LEAD_NOT_FOUND', 'esse lead não existe mais');

    await tx`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${row.lead_id}, 'note', ${`[ajuste no rascunho por ${input.by}] ${guidance}`},
              ${tx.json({ source: 'telegram', messageId: old.id } as never)}, 'staff')
    `;

    const focus = `A equipe (${input.by}) pediu para reescrever o rascunho com esta instrução: ${guidance}\nRascunho anterior: ${old.body.slice(0, 600)}`;
    const d = await requestLeadTx(tx, {
      leadId: row.lead_id,
      kind: 'staff.regenerate',
      source: `staff:${input.by}`.slice(0, 120),
      dedupeKey: `tg:rewrite:${old.id}:${input.idemKey}`,
      payload: {
        draftOnly: true,
        src: old.id,
        threadId: old.threadId,
        channel: row.channel,
        focus,
        by: input.by,
      } as JsonObject,
    });
    return {
      status: 200,
      body: {
        leadId: row.lead_id,
        leadName: row.lead_name,
        threadId: old.threadId,
        mailboxId: d.mailboxId,
      },
    };
  });
  if (!res.replayed) {
    emitControlEvent('lead.change', res.body.leadId);
    if (res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  }
  return { ...res.body, replayed: res.replayed };
}

/** Sends direct coaching/guidance to the sales agent on a lead and wakes it to act. */
export async function guideLead(
  sql: Sql,
  input: {
    leadId: string;
    guidance: string;
    by: string;
    idemKey: string;
    draftOnly?: boolean;
    kind?: 'reply' | 'outreach' | 'triage';
  },
): Promise<{ leadId: string; leadName: string; mailboxId: string | null; replayed: boolean }> {
  const guidance = input.guidance.trim().slice(0, 2000);
  if (!guidance) throw new HttpError(422, 'BAD_REQUEST', 'orientação vazia');

  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const [lead] = await tx<
      {
        id: string;
        name: string;
        archived_at: Date | null;
        unsubscribed_at: Date | null;
        agent_paused_at: Date | null;
      }[]
    >`
      select id, name, archived_at, unsubscribed_at, agent_paused_at from leads where id = ${input.leadId}
    `;
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'esse lead não existe mais');
    if (lead.archived_at) throw new HttpError(422, 'LEAD_ARCHIVED', 'esse lead está arquivado');
    if (lead.unsubscribed_at)
      throw new HttpError(422, 'LEAD_UNSUBSCRIBED', 'esse lead pediu para sair');

    // if staff explicitly guides the agent on a paused lead, unpause so the turn isn't parked
    if (lead.agent_paused_at) await updateLeadTx(tx, lead.id, { agent_paused_at: null }, 'staff');

    const [thread] = await tx<{ id: string; channel: string }[]>`
      select id, channel from lead_threads where lead_id = ${lead.id}
      order by last_message_at desc nulls last, created_at desc limit 1
    `;
    const jobKind = input.kind ?? (thread ? 'reply' : 'outreach');

    await tx`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${lead.id}, 'note', ${`[orientação de ${input.by} no Telegram] ${guidance}`},
              ${tx.json({ source: 'telegram' } as never)}, 'staff')
    `;

    const d = await requestLeadTx(tx, {
      leadId: lead.id,
      kind: 'staff.request',
      source: `staff:${input.by}`.slice(0, 120),
      dedupeKey: `tg:guide:${lead.id}:${input.idemKey}`,
      payload: {
        kind: jobKind,
        focus: guidance,
        by: input.by,
        ...(thread ? { threadId: thread.id, channel: thread.channel } : {}),
        ...(input.draftOnly ? { draftOnly: true } : {}),
      } as JsonObject,
    });
    return { status: 200, body: { leadId: lead.id, leadName: lead.name, mailboxId: d.mailboxId } };
  });
  if (!res.replayed) {
    emitControlEvent('lead.change', res.body.leadId);
    if (res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  }
  return { ...res.body, replayed: res.replayed };
}

/** Pauses/resumes the agent or switches auto/draft/off mode on a single lead. */
export async function setLeadAgentState(
  sql: Sql,
  input: {
    leadId: string;
    paused?: boolean;
    mode?: 'auto' | 'draft' | 'off';
    idemKey: string;
  },
): Promise<{
  leadId: string;
  leadName: string;
  agentPaused: boolean;
  agentMode: string;
  replayed: boolean;
}> {
  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const patch: Record<string, unknown> = {};
    if (input.paused !== undefined)
      patch.agent_paused_at = input.paused ? new Date().toISOString() : null;
    if (input.mode !== undefined) patch.agent_mode = input.mode;
    const updated = await updateLeadTx(tx, input.leadId, patch, 'staff');
    if (input.paused === false) {
      await tx`update lead_threads set agent_enabled = true where lead_id = ${input.leadId} and not agent_enabled`;
    }
    return {
      status: 200,
      body: {
        leadId: updated.id,
        leadName: updated.name,
        agentPaused: updated.agentPausedAt !== null,
        agentMode: updated.agentMode,
      },
    };
  });
  if (!res.replayed) emitControlEvent('lead.change', res.body.leadId);
  return { ...res.body, replayed: res.replayed };
}

/** Saves a pinned staff rule into `agent_memory_items` so every future sales-agent turn reads it. */
export async function teachRule(
  sql: Sql,
  input: { content: string; segment?: string | null; idemKey: string },
): Promise<{
  id: string;
  scope: 'workspace' | 'segment';
  segment: string | null;
  content: string;
  replayed: boolean;
}> {
  const content = input.content.trim().slice(0, 500);
  if (!content) throw new HttpError(422, 'BAD_REQUEST', 'regra vazia');
  const segment = input.segment?.trim().toLowerCase().slice(0, 120) || null;
  const scope: 'workspace' | 'segment' = segment ? 'segment' : 'workspace';
  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const { item } = await rememberTx(tx, { scope, segment, content, source: 'staff' });
    await tx`update agent_memory_items set pinned = true, updated_at = now() where id = ${item.id}`;
    return { status: 200, body: { id: item.id, scope, segment, content: item.content } };
  });
  return { ...res.body, replayed: res.replayed };
}

/** Updates global `settings.agent` (autonomy preset, job switches, or global instructions). */
export async function updateAgentConfig(
  sql: Sql,
  input: {
    level?: AutonomyLevel;
    jobs?: Partial<Record<AgentJob, boolean>>;
    instructions?: string;
    idemKey: string;
  },
): Promise<{
  level: AutonomyLevel;
  jobs: Record<AgentJob, boolean>;
  instructions: string;
  replayed: boolean;
}> {
  const cur = await controlTx(sql, agentSettingTx);
  const next = {
    ...cur,
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.jobs ? { jobs: { ...cur.jobs, ...input.jobs } } : {}),
    ...(input.instructions !== undefined
      ? { instructions: input.instructions.trim().slice(0, AGENT_INSTRUCTIONS_MAX) }
      : {}),
  };
  validateSetting('agent', next);
  const res = await putSetting(sql, 'agent', next, input.idemKey);
  return {
    level: next.level,
    jobs: next.jobs,
    instructions: next.instructions,
    replayed: res.replayed,
  };
}

/** Wakes the weekly strategist or launches a one-off discovery hunt. */
export async function triggerBoardRun(
  sql: Sql,
  input: {
    kind: 'strategist' | 'discovery';
    query?: string;
    segment?: string;
    city?: string;
    target?: number;
    by: string;
    idemKey: string;
  },
): Promise<{ mailboxId: string | null; kind: 'strategist' | 'discovery'; replayed: boolean }> {
  if (input.kind === 'discovery' && !input.query?.trim()) {
    throw new HttpError(422, 'BAD_REQUEST', 'descoberta precisa de uma busca (query)');
  }
  const res = await claimControl(sql, input.idemKey, async (tx) => {
    const d = await requestBoardTx(tx, {
      agent: input.kind === 'discovery' ? CRM_DISCOVERY_ID : CRM_STRATEGIST_ID,
      subject:
        input.kind === 'discovery'
          ? { kind: HUNT_SUBJECT, id: randomUUID() }
          : { kind: REVIEW_SUBJECT, id: REVIEW_ID },
      kind: 'staff.request',
      source: `staff:${input.by}`.slice(0, 120),
      dedupeKey: `tg:board:${input.kind}:${input.idemKey}`,
      payload:
        input.kind === 'discovery'
          ? ({
              kind: 'discovery',
              query: input.query!.trim().slice(0, 300),
              ...(input.segment ? { segment: input.segment.trim().slice(0, 120) } : {}),
              ...(input.city ? { city: input.city.trim().slice(0, 120) } : {}),
              ...(input.target ? { target: Math.min(Math.max(1, input.target), 30) } : {}),
              by: input.by,
            } as JsonObject)
          : ({ kind: 'strategist', by: input.by } as JsonObject),
    });
    return { status: 200, body: { mailboxId: d.mailboxId, kind: input.kind } };
  });
  if (!res.replayed && res.body.mailboxId) emitControlEvent('run.update', res.body.mailboxId);
  return { ...res.body, replayed: res.replayed };
}

// ── 2. ForceReply prompts & native swipe-reply lookup ────────────────────────

export type PromptKind =
  | 'draft_rewrite'
  | 'handoff_guide'
  | 'handoff_direct'
  | 'lead_guide'
  | 'teach_rule'
  | 'campaign_guide';

export interface SavedPrompt {
  chatId: string;
  messageId: string;
  kind: PromptKind;
  targetId: string | null;
  meta: Record<string, unknown>;
}

export async function savePrompt(
  sql: Sql,
  p: Omit<SavedPrompt, 'meta'> & { meta?: Record<string, unknown> },
): Promise<void> {
  const expiresAt = new Date(Date.now() + PROMPT_TTL_MS).toISOString();
  await controlTx(
    sql,
    (tx) => tx`
      insert into telegram_prompts (chat_id, message_id, kind, target_id, meta, expires_at)
      values (${p.chatId}, ${p.messageId}, ${p.kind}, ${p.targetId}, ${tx.json((p.meta ?? {}) as never)}, ${expiresAt})
      on conflict (chat_id, message_id) do update
        set kind = excluded.kind, target_id = excluded.target_id, meta = excluded.meta, expires_at = excluded.expires_at
    `,
  );
}

/** Consumes a matching prompt if the user replied to it and it has not expired. */
export async function consumePrompt(
  sql: Sql,
  chatId: string,
  replyToMessageId: string,
): Promise<SavedPrompt | null> {
  return controlTx(sql, async (tx) => {
    const [row] = await tx<
      {
        chat_id: string;
        message_id: string;
        kind: PromptKind;
        target_id: string | null;
        meta: Record<string, unknown>;
      }[]
    >`
      delete from telegram_prompts
      where chat_id = ${chatId} and message_id = ${replyToMessageId} and expires_at > now()
      returning chat_id, message_id, kind, target_id, meta
    `;
    if (!row) return null;
    return {
      chatId: row.chat_id,
      messageId: row.message_id,
      kind: row.kind,
      targetId: row.target_id,
      meta: row.meta ?? {},
    };
  });
}

export type RepliedCardTarget =
  | { kind: 'draft'; messageId: string; leadId: string | null }
  | { kind: 'handoff'; taskId: string; leadId: string | null }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'lead'; leadId: string };

/** Resolves a native swipe-reply against any delivered event card in `staff_event_messages`. */
export async function lookupRepliedCard(
  sql: Sql,
  chatId: string,
  replyToMessageId: string,
): Promise<RepliedCardTarget | null> {
  return controlTx(sql, async (tx) => {
    const [hit] = await tx<
      { anchor: string | null; kind: string; data: Record<string, unknown> }[]
    >`
      select m.anchor, e.kind, e.data
      from staff_event_messages m
      join staff_events e on e.id = m.event_id
      where m.chat_id = ${chatId} and m.message_id = ${replyToMessageId}
      order by m.event_id desc limit 1
    `;
    if (!hit) return null;
    const d = hit.data ?? {};
    const leadId = typeof d.leadId === 'string' ? d.leadId : null;
    if (hit.anchor?.startsWith('draft:')) {
      return { kind: 'draft', messageId: hit.anchor.slice('draft:'.length), leadId };
    }
    if (hit.anchor?.startsWith('handoff:')) {
      return { kind: 'handoff', taskId: hit.anchor.slice('handoff:'.length), leadId };
    }
    if (hit.anchor?.startsWith('campaign:')) {
      return { kind: 'campaign', campaignId: hit.anchor.slice('campaign:'.length) };
    }
    if (leadId) return { kind: 'lead', leadId };
    return null;
  });
}

// ── 3. Durable 1-tap Confirm/Cancel proposals (`telegram_proposals`) ─────────

export type ProposalKind =
  | 'set_autonomy'
  | 'update_instructions'
  | 'delete_rule'
  | 'approve_draft'
  | 'direct_message'
  | 'board_run'
  | 'start_campaign';

export interface ProposalRow {
  id: string;
  chat_id: string;
  turn_id: string | null;
  staff_name: string;
  kind: ProposalKind;
  title: string;
  lines: string[];
  payload: Record<string, unknown>;
  status: 'proposed' | 'applied' | 'cancelled' | 'expired' | 'failed';
  result: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  expires_at: Date;
}

export async function createProposalTx(
  tx: Sql,
  input: {
    chatId: string;
    turnId: string;
    staffName: string;
    kind: ProposalKind;
    title: string;
    lines: string[];
    payload: Record<string, unknown>;
  },
): Promise<{ id: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();
  const [p] = await tx<{ id: string }[]>`
    insert into telegram_proposals (chat_id, turn_id, staff_name, kind, title, lines, payload, expires_at)
    values (${input.chatId}, ${input.turnId}, ${input.staffName.slice(0, 120)}, ${input.kind},
            ${input.title.slice(0, 200)}, ${tx.json(input.lines.slice(0, 8) as never)},
            ${tx.json(input.payload as never)}, ${expiresAt})
    returning id
  `;
  return { id: p!.id, expiresAt };
}

export function renderProposalBlock(
  p: Pick<ProposalRow, 'title' | 'lines' | 'status' | 'result' | 'decided_by'>,
): string {
  const head =
    p.status === 'applied'
      ? `✅ ${b(esc(p.title))}`
      : p.status === 'cancelled'
        ? `✕ ${b(esc(p.title))}`
        : p.status === 'expired'
          ? `⏳ ${b(esc(p.title))}`
          : p.status === 'failed'
            ? `⚠️ ${b(esc(p.title))}`
            : `📋 ${b(esc(p.title))}`;
  const detail = (p.lines ?? []).map((l) => `• ${esc(l)}`);
  const footer =
    p.status === 'applied'
      ? `aplicado${p.decided_by ? ` por ${esc(p.decided_by)}` : ''}${p.result ? ` — ${esc(p.result)}` : ''}`
      : p.status === 'cancelled'
        ? `cancelado${p.decided_by ? ` por ${esc(p.decided_by)}` : ''}`
        : p.status === 'expired'
          ? 'proposta expirada — peça de novo se ainda quiser'
          : p.status === 'failed'
            ? `não aplicado: ${esc(p.result ?? 'erro')}`
            : null;
  return [head, ...detail, ...(footer ? [footer] : [])].join('\n');
}

export function proposalButtons(proposalId: string): InlineButton[][] {
  return row(
    actionButton('✅ confirmar', `p:y:${proposalId}`, 'success'),
    actionButton('✕ cancelar', `p:n:${proposalId}`, 'danger'),
  );
}

/** Confirms or cancels a proposal created by the AI sales manager. Idempotent by callbackId. */
export async function decideProposal(
  sql: Sql,
  input: { proposalId: string; confirm: boolean; by: string; idemKey: string },
): Promise<{ proposal: ProposalRow; toast: string; syncedAnchor?: string }> {
  const load = () =>
    controlTx(
      sql,
      (tx) => tx<ProposalRow[]>`select * from telegram_proposals where id = ${input.proposalId}`,
    ).then((r) => r[0] ?? null);

  const cur = await load();
  if (!cur) throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'essa proposta não existe mais');
  if (cur.status !== 'proposed') {
    return {
      proposal: cur,
      toast: cur.status === 'applied' ? 'já foi aplicada' : 'já foi encerrada',
    };
  }
  if (new Date(cur.expires_at).getTime() <= Date.now()) {
    await controlTx(
      sql,
      (tx) => tx`
        update telegram_proposals set status = 'expired', decided_at = now()
        where id = ${cur.id} and status = 'proposed'
      `,
    );
    return { proposal: (await load())!, toast: 'proposta expirada — peça de novo' };
  }

  if (!input.confirm) {
    await controlTx(
      sql,
      (tx) => tx`
        update telegram_proposals
        set status = 'cancelled', decided_by = ${input.by.slice(0, 120)}, decided_at = now()
        where id = ${cur.id} and status = 'proposed'
      `,
    );
    return { proposal: (await load())!, toast: '✕ cancelado' };
  }

  // Execute the proposed mutation via the exact same CRM helpers
  const p = cur.payload ?? {};
  let resultText = 'feito';
  let syncedAnchor: string | undefined;
  try {
    if (cur.kind === 'set_autonomy') {
      const level = AUTONOMY_LEVELS.includes(p.level as AutonomyLevel)
        ? (p.level as AutonomyLevel)
        : undefined;
      const jobs =
        p.jobs && typeof p.jobs === 'object'
          ? (Object.fromEntries(
              Object.entries(p.jobs as Record<string, unknown>).filter(
                ([k, v]) => (AGENT_JOBS as readonly string[]).includes(k) && typeof v === 'boolean',
              ),
            ) as Partial<Record<AgentJob, boolean>>)
          : undefined;
      const u = await updateAgentConfig(sql, {
        ...(level ? { level } : {}),
        ...(jobs && Object.keys(jobs).length ? { jobs } : {}),
        idemKey: `${input.idemKey}:autonomy`,
      });
      resultText = `autonomia: ${label('autonomy', u.level)}`;
    } else if (cur.kind === 'update_instructions') {
      const instructions = String(p.instructions ?? '');
      await updateAgentConfig(sql, { instructions, idemKey: `${input.idemKey}:instr` });
      resultText = 'instruções globais atualizadas';
    } else if (cur.kind === 'delete_rule') {
      const memoryId = String(p.memoryId ?? '');
      await deleteMemoryItem(sql, memoryId, `${input.idemKey}:delrule`);
      resultText = 'regra removida da memória';
    } else if (cur.kind === 'approve_draft') {
      const messageId = String(p.messageId ?? '');
      const ap = await approveMessage(sql, messageId, input.by, `${input.idemKey}:approve`);
      if (ap.status !== 200) {
        const err = (ap.body as unknown as { error?: { message?: string } }).error?.message;
        throw new HttpError(422, 'APPROVE_REFUSED', err ?? 'o CRM recusou a aprovação');
      }
      const { dispatchMessage } = await import('../../crm/send.ts');
      void dispatchMessage(sql, ap.body.message.id).catch((e) =>
        mlog.error({ err: e, message: messageId }, 'proposal-approved send failed'),
      );
      syncedAnchor = `draft:${messageId}`;
      resultText = 'rascunho aprovado e enviando';
    } else if (cur.kind === 'direct_message') {
      const sent = await directReplyToLead(sql, {
        leadId: String(p.leadId ?? ''),
        ...(typeof p.channel === 'string' && isSendChannel(p.channel)
          ? { channel: p.channel }
          : {}),
        body: String(p.body ?? ''),
        by: input.by,
        idemKey: `${input.idemKey}:dm`,
      });
      resultText = `enviada via ${label('channel', sent.channel)} para ${sent.leadName}`;
    } else if (cur.kind === 'board_run') {
      const kind = p.kind === 'discovery' ? 'discovery' : 'strategist';
      await triggerBoardRun(sql, {
        kind,
        ...(typeof p.query === 'string' ? { query: p.query } : {}),
        ...(typeof p.segment === 'string' ? { segment: p.segment } : {}),
        ...(typeof p.city === 'string' ? { city: p.city } : {}),
        ...(typeof p.target === 'number' ? { target: p.target } : {}),
        by: input.by,
        idemKey: `${input.idemKey}:board`,
      });
      resultText =
        kind === 'discovery' ? 'descoberta iniciada' : 'revisão do estrategista iniciada';
    } else if (cur.kind === 'start_campaign') {
      const { startCampaign } = await import('../../crm/campaigns.ts');
      const created = await startCampaign(sql, {
        title: String(p.title ?? 'Campanha autônoma'),
        objective: String(p.objective ?? cur.title),
        ...(p.goalKind === 'signup' || p.goalKind === 'meeting' || p.goalKind === 'reply'
          ? { goalKind: p.goalKind }
          : {}),
        ...(typeof p.goalTarget === 'number' ? { goalTarget: p.goalTarget } : {}),
        ...(p.goalScope === 'any' || p.goalScope === 'campaign_only'
          ? { goalScope: p.goalScope }
          : {}),
        ...(typeof p.budgetUsd === 'number' ? { budgetUsd: p.budgetUsd } : {}),
        ...(typeof p.maxDays === 'number' ? { maxDays: p.maxDays } : {}),
        ...(typeof p.maxHuntsPerDay === 'number' ? { maxHuntsPerDay: p.maxHuntsPerDay } : {}),
        ...(typeof p.targetWip === 'number' ? { targetWip: p.targetWip } : {}),
        ...(typeof p.focusSegment === 'string' ? { focusSegment: p.focusSegment } : {}),
        ...(typeof p.focusCity === 'string' ? { focusCity: p.focusCity } : {}),
        ...(typeof p.allowExistingLeads === 'boolean'
          ? { allowExistingLeads: p.allowExistingLeads }
          : {}),
        ...(p.enableAutopilot === true ? { enableAutopilot: true } : {}),
        by: input.by,
        chatId: cur.chat_id,
        idemKey: `${input.idemKey}:campaign`,
      });
      resultText = `campanha "${created.campaign.title}" iniciada`;
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    await controlTx(
      sql,
      (tx) => tx`
        update telegram_proposals
        set status = 'failed', result = ${why.slice(0, 400)}, decided_by = ${input.by.slice(0, 120)}, decided_at = now()
        where id = ${cur.id} and status = 'proposed'
      `,
    );
    return { proposal: (await load())!, toast: `⚠️ ${why.slice(0, 160)}` };
  }

  await controlTx(
    sql,
    (tx) => tx`
      update telegram_proposals
      set status = 'applied', result = ${resultText.slice(0, 400)}, decided_by = ${input.by.slice(0, 120)}, decided_at = now()
      where id = ${cur.id} and status = 'proposed'
    `,
  );
  return {
    proposal: (await load())!,
    toast: `✅ ${resultText}`,
    ...(syncedAnchor ? { syncedAnchor } : {}),
  };
}

// ── 4. Durable DM outbox (`telegram_dm_outbox`) ──────────────────────────────

interface OutboxRow {
  id: string;
  chat_id: string;
  text: string;
  buttons: InlineButton[][];
  reply_to_message_id: string | null;
  attempts: number;
  speak: string | null;
}

/** A voice note before the row's text, when it has one to say (ADR 0048). Best effort: no voice,
 *  or a failed upload, leaves the text alone; only a rate limit retries the row. */
async function sendVoiceFirst(
  sql: Sql,
  client: ReturnType<typeof telegramClient>,
  r: OutboxRow,
  media: MediaProviders | null,
): Promise<void> {
  if (!r.speak) return;
  try {
    const s = media ? await media.speak(r.speak, { format: 'ogg' }).catch(() => null) : null;
    if (s) {
      const form = new FormData();
      form.append('chat_id', r.chat_id);
      form.append('voice', new Blob([s.bytes], { type: 'audio/ogg' }), 'resposta.ogg');
      form.append('duration', String(s.seconds));
      await client.callForm('sendVoice', form);
    }
  } catch (e) {
    if (e instanceof TelegramError && e.rateLimited) throw e;
    mlog.warn({ err: e instanceof Error ? e.message : String(e) }, 'telegram voice reply failed');
  }
  await controlTx(sql, (tx) => tx`update telegram_dm_outbox set speak = null where id = ${r.id}`);
}

export async function deliverDmOutbox(
  sql: Sql,
  opts: { fetch?: TelegramFetch; limit?: number; media?: MediaProviders | null } = {},
): Promise<{ n: number; retryInMs?: number }> {
  const ctx = await telegramContext(sql);
  if (!ctx.app.ok) return { n: 0 };
  const client = telegramClient(ctx.app.app.token, opts.fetch ?? outboxFetchOverride);
  const rows = await controlTx(
    sql,
    (tx) => tx<OutboxRow[]>`
      update telegram_dm_outbox
      set lease_until = now() + interval '2 minutes', attempts = attempts + 1
      where id in (
        select id from telegram_dm_outbox
        where state = 'pending' and next_attempt_at <= now()
          and (lease_until is null or lease_until < now())
        order by created_at asc
        limit ${opts.limit ?? 15}
        for update skip locked
      )
      returning id, chat_id, text, buttons, reply_to_message_id, attempts, speak
    `,
  );
  const media =
    opts.media !== undefined ? opts.media : rows.some((r) => r.speak) ? mediaProviders(sql) : null;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const msg: TelegramMessage = fitMessage({
      text: r.text,
      ...(Array.isArray(r.buttons) && r.buttons.length ? { buttons: r.buttons } : {}),
    });
    try {
      await sendVoiceFirst(sql, client, r, media);
      await client.call<{ message_id: number }>('sendMessage', {
        chat_id: r.chat_id,
        text: msg.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(msg.buttons?.length ? { reply_markup: toReplyMarkup(msg.buttons) } : {}),
        ...(r.reply_to_message_id
          ? {
              reply_parameters: {
                message_id: Number(r.reply_to_message_id),
                allow_sending_without_reply: true,
              },
            }
          : {}),
      });
      await controlTx(
        sql,
        (tx) => tx`
          update telegram_dm_outbox
          set state = 'sent', delivered_at = now(), lease_until = null, last_error = null
          where id = ${r.id}
        `,
      );
      n++;
    } catch (e) {
      if (e instanceof TelegramError && e.rateLimited) {
        const wait = e.retryAfterMs ?? 5_000;
        const left = rows.slice(i).map((x) => x.id);
        await controlTx(
          sql,
          (tx) => tx`
            update telegram_dm_outbox
            set lease_until = null, attempts = greatest(attempts - 1, 0),
                next_attempt_at = greatest(next_attempt_at, now() + make_interval(secs => ${wait / 1000}))
            where id in ${tx(left)} and state = 'pending'
          `,
        );
        return { n, retryInMs: wait };
      }
      const err = e instanceof Error ? e.message : String(e);
      const transient = !(e instanceof TelegramError) || e.transient;
      const fail = !transient || r.attempts >= OUTBOX_MAX_ATTEMPTS;
      await controlTx(
        sql,
        (tx) => tx`
          update telegram_dm_outbox
          set state = ${fail ? 'failed' : 'pending'},
              lease_until = null,
              last_error = ${err.slice(0, 500)},
              next_attempt_at = now() + make_interval(secs => ${Math.min(15 * 2 ** (r.attempts - 1), 600)})
          where id = ${r.id}
        `,
      );
    }
  }
  return { n };
}

/** Housekeeping for prompts, expired proposals, and old DM outbox entries. */
export async function pruneManagerTablesTx(tx: Sql): Promise<void> {
  await tx`delete from telegram_prompts where expires_at < now() - interval '1 hour'`;
  await tx`
    update telegram_proposals set status = 'expired', decided_at = now()
    where status = 'proposed' and expires_at <= now()
  `;
  await tx`delete from telegram_proposals where created_at < now() - interval '14 days'`;
  await tx`delete from telegram_dm_outbox where created_at < now() - interval '14 days'`;
}
