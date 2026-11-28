import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { planHas, tenantPlan } from './plans.ts';

// Duá's conversations (ADR 0032). A plan includes so many a month (calendar month, São Paulo
// time), a trial so many for its whole length, and paid packs add more for PACK_DAYS from their
// payment. The month's allowance is spent first, then the pack that lapses soonest. One shopper's
// conversation counts once per CONVERSATION_WINDOW_MS from when it started, however many
// messages it has. Conversations the team gives in the CRM (ai_credits source 'staff', 0158)
// spend like a pack, and unlike one they count during a trial too.

export const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** how long a paid pack's conversations count (ai_credits.expires_at) */
export const PACK_DAYS = 30;
const ZONE = 'America/Sao_Paulo';

export interface AiAllowance {
  /** the plan has the Vendedor and it is paid for or in its trial */
  included: boolean;
  /** what the allowance below covers: a calendar month, or the whole trial */
  period: 'month' | 'trial' | null;
  /** conversations the period includes */
  limit: number;
  used: number;
  /** pack conversations left and not lapsed (they carry over months) */
  packRemaining: number;
  /** when the soonest of the packs with conversations left lapses (null without one) */
  packExpiresAt: Date | null;
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
        pack_left: number;
        pack_expires: Date | null;
        staff_left: number;
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
             coalesce(p.remain, 0)::int as pack_left, p.expires as pack_expires,
             coalesce(p.staff_remain, 0)::int as staff_left
      from m left join lateral (
        select sum(c.remain) as remain, min(c.expires_at) as expires,
               sum(c.remain) filter (where c.source = 'staff') as staff_remain from (
          select c.expires_at, c.source, c.conversations - (
            select count(*) from ai_conversations a where a.credit_id = c.id) as remain
          from ai_credits c
          where c.tenant_id = ${tenantId} and c.expires_at > ${now}
        ) c where c.remain > 0
      ) p on true
    `
  )[0]!;
  const packRemaining = Math.max(0, row.pack_left);
  const packExpiresAt = packRemaining > 0 ? row.pack_expires : null;
  if (!included)
    return {
      included,
      period: null,
      limit: 0,
      used: 0,
      packRemaining,
      packExpiresAt,
      remaining: 0,
      resetsAt: null,
    };
  const limit = trial ? plan.aiTrialConversations : plan.aiConversations;
  const used = trial ? row.used_trial : row.used_month;
  // a trial runs on its own allowance (packs are bought on a paid plan), plus what the team gave
  const left = Math.max(0, limit - used) + (trial ? Math.max(0, row.staff_left) : packRemaining);
  return {
    included,
    period: trial ? 'trial' : 'month',
    limit,
    used,
    packRemaining,
    packExpiresAt,
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
  // a pack conversation comes out of the pack that lapses first (the per-store lock holds); in a
  // trial only the team's count
  const credit =
    source === 'pack'
      ? (
          await tx<{ id: string }[]>`
            select c.id from ai_credits c
            where c.tenant_id = ${tenantId} and c.expires_at > ${now}
              and (${a.period !== 'trial'} or c.source = 'staff')
              and c.conversations > (select count(*) from ai_conversations a where a.credit_id = c.id)
            order by c.expires_at, c.id limit 1
          `
        )[0]?.id
      : null;
  if (source === 'pack' && !credit) return { ok: false, reason: 'exhausted', allowance: a };
  const id = (
    await tx<{ id: string }[]>`
      insert into ai_conversations (tenant_id, subject_key, source, started_at, credit_id)
      values (${tenantId}, ${subjectKey}, ${source}, ${now}, ${credit ?? null})
      returning id
    `
  )[0]!.id;
  return { ok: true, conversationId: id, counted: true };
}

/** what the team may give at once from the CRM */
export const STAFF_AI_MAX = 10_000;
export const STAFF_AI_DAYS_MAX = 365;

/**
 * The team gives a store Duá conversations (CRM): they spend like a pack, lapse after `days` and,
 * unlike a pack, count in a trial too. The plan must have the Vendedor, paid or in its trial: on
 * any other they could never be spent.
 */
export async function grantAiConversationsTx(
  tx: Sql,
  tenantId: string,
  o: { conversations: number; days: number; note: string | null; now: Date },
): Promise<{ id: string; expiresAt: Date }> {
  if (!Number.isInteger(o.conversations) || o.conversations < 1 || o.conversations > STAFF_AI_MAX)
    throw new RangeError(`conversations must be 1–${STAFF_AI_MAX}`);
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > STAFF_AI_DAYS_MAX)
    throw new RangeError(`days must be 1–${STAFF_AI_DAYS_MAX}`);
  if (!(await planHas(tx, tenantId, 'vendedor')))
    throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include the Vendedor", {
      feature: 'vendedor',
    });
  const row = (
    await tx<{ id: string; expires_at: Date }[]>`
      insert into ai_credits (tenant_id, invoice_id, conversations, expires_at, source, note)
      values (${tenantId}, null, ${o.conversations},
              ${o.now}::timestamptz + make_interval(days => ${o.days}), 'staff', ${o.note})
      returning id, expires_at
    `
  )[0]!;
  return { id: row.id, expiresAt: row.expires_at };
}
