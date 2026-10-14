import { defineTool, s, type Json } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { recordBlockedSendTx } from '../../../modules/channel-health.ts';
import { recordStaffEventTx } from '../../../modules/staff-events.ts';
import {
  channel,
  composeMessageTx,
  isSendChannel,
  type SendChannel,
} from '../../../modules/threads.ts';
import { dropLeadMailTx } from '../../../crm/agenda.ts';
import { CRM_OUTBOX_CHANNEL } from '../../../crm/outbox.ts';
import {
  agentPausedForChannelTx,
  checkSendAllowedTx,
  resolveChannelTx,
} from '../../../crm/guardrails.ts';
import { messageStyleIssues, normalizeMessageBody } from '../../../crm/style.ts';
import { MESSAGE_BODY, MESSAGE_SUBJECT } from './fields.ts';
import { crm, emitAfter, leadOf, refusals, turn, type Ctx } from './shared.ts';

// The lead agent's only ways to reach a person. A message is a lead_messages row written in the
// step's transaction (ADR 0030 decision 4): a draft for staff to approve, or `queued` for the CRM
// outbox (crm/outbox.ts) to deliver once the step commits. The send is the commit point: the
// runtime preempts a send-effect tool when the lead wrote again, so no answer goes out stale.

/** Staff's pin for this turn (a first contact's channel, an inbound's own channel). */
function override(ctx: Ctx): SendChannel | null {
  const c = turn(ctx.state).params.channel;
  return isSendChannel(c) ? c : null;
}

/** The first message of a turn that sounds like a robot goes back once; the next goes as written. */
function styleBounce(ctx: Ctx, body: string, ch: string | null): Json | null {
  if (turn(ctx.state).styleBounced) return null;
  const issues = messageStyleIssues(body, ch);
  if (!issues.length) return null;
  return {
    error:
      'ESTILO — a mensagem não saiu: soa como robô. Reescreva como uma pessoa digitaria no celular e chame de novo.',
    issues,
    styleBounced: true,
  } as unknown as Json;
}

const notifyOutbox = (tx: Sql) => tx`select pg_notify(${CRM_OUTBOX_CHANNEL}, '')`;

export const draftMessageTool = defineTool<
  { channel?: string | undefined; body: string; subject?: string | undefined },
  Sql
>({
  name: 'draft_message',
  description:
    'Draft an outbound message for human approval — always allowed, never sends. Omit channel to auto-pick the reachable one (last inbound channel, else whatsapp > instagram > email); if you pass a dead channel you get {blocked, reason, use} — retry on `use`. No send channel reaching the lead → channel "manual": staff sends it by hand. Instagram DMs max 1000 chars.',
  effect: 'write',
  input: s.object({
    channel: s.enum(['email', 'whatsapp', 'instagram', 'manual']).optional(),
    body: MESSAGE_BODY,
    subject: MESSAGE_SUBJECT,
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const body = normalizeMessageBody(input.body);
      const bounced = styleBounce(ctx, body, input.channel ?? override(ctx));
      if (bounced) return bounced;
      const out = await crm(ctx, async (tx) => {
        const pick = await resolveChannelTx(tx, leadId, {
          requested: input.channel ? channel(input.channel) : null,
          override: override(ctx),
          threadId: turn(ctx.state).params.threadId ?? null,
        });
        if (!pick.ok)
          return { blocked: true, reason: pick.reason, use: pick.available[0] ?? 'manual' };
        // same pause check as send_message — a staff-paused thread gets no output, drafts included
        if (await agentPausedForChannelTx(tx, leadId, pick.channel))
          return { blocked: true, reason: 'thread paused for agent' };
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: pick.channel,
          body,
          ...(input.subject ? { subject: input.subject } : {}),
          author: 'agent',
          status: 'draft',
          agentRunId: ctx.turnId,
        });
        return { ...composed.body, channel: pick.channel, via: pick.via };
      });
      if (!('blocked' in out)) {
        emitAfter(ctx, 'draft.change', out.thread.id);
        emitAfter(ctx, 'thread.message', out.thread.id);
      }
      return out as unknown as Json;
    }),
});

export const sendMessageTool = defineTool<
  { channel?: string | undefined; body: string; subject?: string | undefined },
  Sql
>({
  name: 'send_message',
  description:
    "Send an outbound message now. Guardrails decide whether it queues (auto mode) or falls back to draft. Omit channel to auto-pick the reachable one; a dead channel returns {blocked, reason, use} — retry on `use`. Instagram DMs max 1000 chars; a cold instagram DM lands in the lead's message requests, so open with who you are.",
  effect: 'send',
  input: s.object({
    channel: s.enum(['email', 'whatsapp', 'instagram']).optional(),
    body: MESSAGE_BODY,
    subject: MESSAGE_SUBJECT,
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const t = turn(ctx.state);
      const draftOnly = t.params.draftOnly === true;
      const body = normalizeMessageBody(input.body);
      const bounced = styleBounce(ctx, body, input.channel ?? override(ctx));
      if (bounced) return bounced;
      const out = await crm(ctx, async (tx) => {
        // serializes concurrent sends so the unanswered cap sees the winner's row
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        const [already] = await tx`
          select 1 from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.agent_run_id = ${ctx.turnId}
            and m.status in ('queued', 'sending', 'sent', 'delivered')
          limit 1`;
        if (already) return { blocked: true, reason: 'already dispatched by this turn' };
        const pick = await resolveChannelTx(tx, leadId, {
          requested: input.channel ? channel(input.channel) : null,
          override: override(ctx),
          threadId: t.params.threadId ?? null,
        });
        if (!pick.ok) return { blocked: true, reason: pick.reason, use: pick.available[0] ?? null };
        // pause applies per (lead, channel) — a lead-wide handoff survives a channel hop
        if (await agentPausedForChannelTx(tx, leadId, pick.channel))
          return { blocked: true, reason: 'thread paused for agent' };
        // draft-only turns skip the verdict — a draft never leaves anyway
        const verdict = draftOnly
          ? ({ ok: true, forceDraft: false } as const)
          : await checkSendAllowedTx(
              tx,
              {
                ...DEFAULT_GUARDRAILS,
                ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
              },
              leadId,
              pick.channel,
            );
        if (!verdict.ok) {
          // durable signal for the channel-health rollup — blocks otherwise leave no record
          await recordBlockedSendTx(tx, leadId, pick.channel, verdict.reason ?? 'guardrail');
          return { blocked: true, reason: verdict.reason };
        }
        const drafted = verdict.forceDraft || draftOnly;
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: pick.channel,
          body,
          ...(input.subject ? { subject: input.subject } : {}),
          author: 'agent',
          status: drafted ? 'draft' : 'queued',
          agentRunId: ctx.turnId,
        });
        if (!drafted) await notifyOutbox(tx);
        return {
          ...composed.body,
          draftFallback: drafted,
          channel: pick.channel,
          via: pick.via,
          ...(pick.prevChannel && pick.prevChannel !== pick.channel
            ? { switchedFrom: pick.prevChannel }
            : {}),
        };
      });
      if (!('blocked' in out)) {
        emitAfter(ctx, 'thread.message', out.thread.id);
        if (out.draftFallback) emitAfter(ctx, 'draft.change', out.thread.id);
      }
      return out as unknown as Json;
    }),
});

export const unsubscribeTool = defineTool<
  { reason?: string | undefined; reply?: string | undefined },
  Sql
>({
  name: 'unsubscribe',
  description:
    'The sender asked to stop receiving messages / be removed — opts the lead out (unsubscribed_at). `reply` is an optional one-line farewell sent as the final message; never send anything else after calling this.',
  effect: 'send',
  input: s.object({
    reason: s.string({ max: 200 }).optional(),
    reply: s
      .string({ max: 500 })
      .describe("one short line in the lead's own register, no pitch, no question")
      .optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const leadId = leadOf(ctx);
      const draftOnly = turn(ctx.state).params.draftOnly === true;
      const reply = input.reply ? normalizeMessageBody(input.reply).slice(0, 500) : null;
      const reason = input.reason?.slice(0, 200) ?? null;
      // one transaction under the send:lead lock: farewell + opt-out stamp + note — a concurrent
      // send serializes behind it and sees the opt-out; only is_farewell survives
      const out = await crm(ctx, async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        let threadId: string | null = null;
        let sendBlocked: string | null = null;
        let drafted = false;
        let queued = false;
        if (reply) {
          const pick = await resolveChannelTx(tx, leadId, {
            requested: null,
            override: override(ctx),
            threadId: turn(ctx.state).params.threadId ?? null,
          });
          if (!pick.ok) sendBlocked = pick.reason ?? 'no channel';
          else {
            const g = await getSettingTx(tx, 'guardrails', {} as Partial<Guardrails>);
            const verdict = draftOnly
              ? ({ ok: true, forceDraft: false } as const)
              : await checkSendAllowedTx(tx, { ...DEFAULT_GUARDRAILS, ...g }, leadId, pick.channel);
            if (!verdict.ok) {
              sendBlocked = verdict.reason ?? 'guardrail';
              await recordBlockedSendTx(tx, leadId, pick.channel, sendBlocked);
            } else {
              // forceDraft keeps the opt-out but the farewell becomes an approval draft
              drafted = verdict.forceDraft || draftOnly;
              const composed = await composeMessageTx(tx, {
                leadId,
                channel: pick.channel,
                body: reply,
                author: 'agent',
                status: drafted ? 'draft' : 'queued',
                agentRunId: ctx.turnId,
                farewell: true,
              });
              threadId = composed.body.thread.id;
              queued = !drafted;
              if (queued) await notifyOutbox(tx);
            }
          }
        }
        const [changed] = await tx<{ name: string; business_name: string | null }[]>`
          update leads set unsubscribed_at = now(), updated_at = now()
          where id = ${leadId} and unsubscribed_at is null
          returning name, business_name`;
        if (changed) {
          // opt-out never lifts: what still waits for this lead's agent goes
          await dropLeadMailTx(tx, leadId);
          await tx`
            insert into lead_activities (lead_id, kind, body, created_by)
            values (${leadId}, 'system', ${`Pediu para sair — opt-out registrado${reason ? ` (${reason})` : ''}`}, 'agent')`;
          await recordStaffEventTx(tx, 'lead.unsubscribed', {
            leadId,
            leadName: changed.name,
            business: changed.business_name,
            by: 'agent',
            reason,
          });
        }
        return { threadId, sendBlocked, drafted, queued, changed: !!changed };
      });
      if (out.threadId) {
        emitAfter(ctx, 'thread.message', out.threadId);
        if (out.drafted) emitAfter(ctx, 'draft.change', out.threadId);
      }
      if (out.changed) emitAfter(ctx, 'lead.change', leadId);
      return {
        unsubscribed: true,
        farewellSent: out.queued,
        ...(out.drafted ? { farewellDrafted: true } : {}),
        ...(out.sendBlocked ? { farewellBlocked: out.sendBlocked } : {}),
      };
    }),
});
