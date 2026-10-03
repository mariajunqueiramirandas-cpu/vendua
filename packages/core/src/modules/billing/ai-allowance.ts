import type { Sql } from '../../platform/db.ts';
import { planHas, tenantPlan } from './plans.ts';

// The Vendedor's conversations (ADR 0032). A plan includes so many a month (calendar month, São
// Paulo time), a trial so many for its whole length, and paid packs add more that don't expire.
// The month's allowance is spent first, then packs. One shopper's conversation counts once per
// CONVERSATION_WINDOW_MS from when it started, however many messages it has.

export const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Sao_Paulo';

export interface AiAllowance {
  /** the plan has the Vendedor and it is paid for or in its trial */
  included: boolean;
  /** what the allowance below covers: a calendar month, or the whole trial */
  period: 'month' | 'trial' | null;
  /** conversations the period includes */
  limit: number;
  used: number;
  /** pack conversations left (they carry over months) */
  packRemaining: number;
  /** what the Vendedor can still take: the period's left + packs */
  remaining: number;
  /** when the month's allowance starts over (null in a trial) */
  resetsAt: Date | null;
}

async function trialStart(tx: Sql, tenantId: string): Promise<Date | null> {
  const row = (
    await tx<{ status: string; created_at: Date }[]>`
      select status, created_at from subscriptions where tenant_id = ${tenantId}
    `
  )[0];
  return row?.status === 'trialing' ? row.created_at : null;
}

export async function aiAllowanceTx(
  tx: Sql,
  tenantId: string,
  now = new Date(),
): Promise<AiAllowance> {
  const plan = await tenantPlan(tx, tenantId);
  const included = await planHas(tx, tenantId, 'vendedor');
  const trial = await trialStart(tx, tenantId);
  const row = (
    await tx<
      {
        month_start: Date;
        next_month: Date;
        used_month: number;
        used_trial: number;
        used_pack: number;
        credits: number;
      }[]
    >`
      with m as (
        select (date_trunc('month', ${now}::timestamptz at time zone ${ZONE}) at time zone ${ZONE}) as start
      )
      select m.start as month_start,
             ((m.start at time zone ${ZONE} + interval '1 month') at time zone ${ZONE}) as next_month,
             (select count(*)::int from ai_conversations
               where tenant_id = ${tenantId} and source = 'plan' and started_at >= m.start) as used_month,
             (select count(*)::int from ai_conversations
               where tenant_id = ${tenantId} and source = 'trial'
                 and started_at >= ${trial ?? now}) as used_trial,
             (select count(*)::int from ai_conversations
               where tenant_id = ${tenantId} and source = 'pack') as used_pack,
             (select coalesce(sum(conversations), 0)::int from ai_credits
               where tenant_id = ${tenantId}) as credits
      from m
    `
  )[0]!;
  const packRemaining = Math.max(0, row.credits - row.used_pack);
  if (!included)
    return {
      included,
      period: null,
      limit: 0,
      used: 0,
      packRemaining,
      remaining: 0,
      resetsAt: null,
    };
  const limit = trial ? plan.aiTrialConversations : plan.aiConversations;
  const used = trial ? row.used_trial : row.used_month;
  // a trial runs on its own allowance: packs are bought on a paid plan
  const left = Math.max(0, limit - used) + (trial ? 0 : packRemaining);
  return {
    included,
    period: trial ? 'trial' : 'month',
    limit,
    used,
    packRemaining,
    remaining: left,
    resetsAt: trial ? null : row.next_month,
  };
}

export type AiConversationClaim =
  | { ok: true; conversationId: string; counted: boolean }
  | { ok: false; reason: 'plan' | 'exhausted'; allowance: AiAllowance };

/**
 * May the Vendedor take this conversation? Counts it once per window: a subject that started
 * within CONVERSATION_WINDOW_MS returns the same row and spends nothing. Call it inside the
 * tenant transaction that starts the turn, and keep that transaction short: a new conversation
 * takes a per-store lock until it commits, so two shoppers can't both take the last one.
 */
export async function claimAiConversationTx(
  tx: Sql,
  tenantId: string,
  subjectKey: string,
  now = new Date(),
): Promise<AiConversationClaim> {
  if (subjectKey.length < 1 || subjectKey.length > 200)
    throw new RangeError('subjectKey must be 1–200 characters');
  const since = new Date(now.getTime() - CONVERSATION_WINDOW_MS);
  const openRow = () => tx<{ id: string }[]>`
    select id from ai_conversations
    where tenant_id = ${tenantId} and subject_key = ${subjectKey} and started_at > ${since}
    order by started_at desc limit 1
  `;
  // a conversation already counted needs no lock: every later message of it lands here
  let open = (await openRow())[0];
  if (!open) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`ai-allowance|${tenantId}`}, 0))`;
    open = (await openRow())[0];
  }
  if (open) {
    // counted earlier, but the plan may have lost the Vendedor since (a trial ended, a downgrade)
    if (!(await planHas(tx, tenantId, 'vendedor')))
      return { ok: false, reason: 'plan', allowance: await aiAllowanceTx(tx, tenantId, now) };
    return { ok: true, conversationId: open.id, counted: false };
  }
  const a = await aiAllowanceTx(tx, tenantId, now);
  if (!a.included) return { ok: false, reason: 'plan', allowance: a };
  const source =
    a.used < a.limit ? (a.period === 'trial' ? 'trial' : 'plan') : a.remaining > 0 ? 'pack' : null;
  if (!source) return { ok: false, reason: 'exhausted', allowance: a };
  const id = (
    await tx<{ id: string }[]>`
      insert into ai_conversations (tenant_id, subject_key, source, started_at)
      values (${tenantId}, ${subjectKey}, ${source}, ${now})
      returning id
    `
  )[0]!.id;
  return { ok: true, conversationId: id, counted: true };
}
