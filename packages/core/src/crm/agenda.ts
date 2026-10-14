import { randomUUID } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import { CRM_AGENT_ID, LEAD_SUBJECT, requestLeadTx } from './dispatch.ts';

// The agenda (ADR 0016, on Agent Runtime v3): every future touch on a lead is a timer row in the
// `crm` actor's mailbox, written by the one producer. The agent's own follow-up (cadence or a date
// it picked) is `timer.followup`; a callback the lead asked for and a date staff set are
// `timer.callback`, which the preset never parks. leads.next_action_at only mirrors the earliest.

export const WAKEUP_MIN_LEAD_MS = 10 * 60_000;
export const WAKEUP_MAX_AHEAD_MS = 90 * 86_400_000;

export type TimerBy = 'agent' | 'staff' | 'cadence';

export interface Wakeup {
  id: string;
  leadId: string | null;
  leadName: string | null;
  kind: 'outreach';
  at: string;
  focus: string;
  status: 'pending' | 'fired' | 'canceled';
  requested: boolean;
  createdBy: 'agent' | 'staff';
  createdByRunId: string | null;
  firedRunId: string | null;
  cancelReason: null;
  createdAt: string;
}

interface TimerRow {
  id: string;
  lead_id: string;
  lead_name: string | null;
  deliver_at: Date;
  payload: { focus?: string; requested?: boolean; by?: TimerBy; turnId?: string } | null;
  consumed_by_turn: string | null;
  created_at: Date;
}

const TIMER_KINDS = ['timer.followup', 'timer.callback'];

function toWakeup(r: TimerRow): Wakeup {
  const p = r.payload ?? {};
  return {
    id: r.id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    kind: 'outreach',
    at: r.deliver_at.toISOString(),
    focus: p.focus ?? '',
    status: r.consumed_by_turn ? 'fired' : 'pending',
    requested: p.requested === true,
    createdBy: p.by === 'staff' ? 'staff' : 'agent',
    createdByRunId: p.turnId ?? null,
    firedRunId: r.consumed_by_turn,
    cancelReason: null,
    createdAt: r.created_at.toISOString(),
  };
}

const TIMER_SELECT = (tx: Sql) => tx`
  select m.id, a.subject_id as lead_id, l.name as lead_name, m.deliver_at, m.payload,
         m.consumed_by_turn, m.created_at
  from agent_mailbox m
  join agent_actors a on a.id = m.actor_id
  left join leads l on l.id::text = a.subject_id
  where a.agent_id = ${CRM_AGENT_ID} and a.subject_kind = ${LEAD_SUBJECT}
    and m.kind = any(${TIMER_KINDS})`;

/** strict ISO datetime with explicit offset — date-only/bare forms resolve as guesses */
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** bounds keep the agent from hot-looping itself or parking work past a useful horizon */
export function parseWakeupAt(v: unknown, now = Date.now()): Date | string {
  if (typeof v !== 'string' || !v.trim()) return 'at must be an ISO-8601 datetime';
  const s = v.trim();
  if (!ISO_DATETIME_RE.test(s)) return 'at must be an ISO-8601 datetime';
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return 'at must be an ISO-8601 datetime';
  if (t < now + WAKEUP_MIN_LEAD_MS) return 'at must be at least 10 minutes from now';
  if (t > now + WAKEUP_MAX_AHEAD_MS) return 'at must be within 90 days';
  return new Date(t);
}

const lockLead = (tx: Sql, leadId: string) =>
  tx`select pg_advisory_xact_lock(hashtext(${'wakeup:' + leadId}))`;

/** Pending timers of the lead's actor matching `which`, removed before they fire. */
async function dropTimersTx(
  tx: Sql,
  leadId: string,
  which: (p: { by: TimerBy; requested: boolean }) => boolean,
): Promise<string[]> {
  const rows = await tx<{ id: string; payload: TimerRow['payload'] }[]>`
    select m.id, m.payload from agent_mailbox m
    join agent_actors a on a.id = m.actor_id
    where a.agent_id = ${CRM_AGENT_ID} and a.subject_kind = ${LEAD_SUBJECT}
      and a.subject_id = ${leadId} and m.kind = any(${TIMER_KINDS})
      and m.consumed_by_turn is null
    for update of m skip locked`;
  const ids = rows
    .filter((r) =>
      which({ by: r.payload?.by ?? 'agent', requested: r.payload?.requested === true }),
    )
    .map((r) => r.id);
  if (ids.length) await tx`delete from agent_mailbox where id = any(${ids}::uuid[])`;
  return ids;
}

/** keep leads.next_action_at/source pointing at the earliest pending timer */
export async function syncNextActionTx(tx: Sql, leadId: string): Promise<void> {
  await tx`
    update leads set (next_action_at, next_action_source) = (
      select m.deliver_at,
        case when m.payload->>'by' = 'staff' then 'staff'
             when (m.payload->>'requested')::boolean then 'requested' else 'auto' end
      from agent_mailbox m
      join agent_actors a on a.id = m.actor_id
      where a.agent_id = ${CRM_AGENT_ID} and a.subject_kind = ${LEAD_SUBJECT}
        and a.subject_id = ${leadId} and m.kind = any(${TIMER_KINDS})
        and m.consumed_by_turn is null
      order by m.deliver_at limit 1
    )
    where id = ${leadId}`;
}

/** Books a touch, replacing the lead's pending one of the same class: the agent's plans supersede
 *  each other but never a requested callback; a staff date supersedes the agent's own plan and the
 *  prior staff date. */
export async function scheduleTimerTx(
  tx: Sql,
  input: {
    leadId: string;
    at: Date;
    focus: string;
    requested: boolean;
    by: 'agent' | 'staff';
    /** the authoring turn, for an agent's own date */
    turnId?: string | null;
    /** the `schedule` tool keeps a 10-minute floor; staff dates and update_lead may be due now */
    floor?: boolean;
  },
): Promise<{ wakeup: { id: string; at: string }; replaced: string | null } | { error: string }> {
  await lockLead(tx, input.leadId);
  if (input.floor !== false) {
    // clock_timestamp(), not now() (tx-start time, possibly outlived by the lock wait)
    const [row] = await tx<{ soon: boolean }[]>`
      select (${input.at}::timestamptz < clock_timestamp() + make_interval(secs => ${WAKEUP_MIN_LEAD_MS / 1000})) as soon`;
    if (row?.soon) return { error: 'at must be at least 10 minutes from now' };
  }
  const dropped = await dropTimersTx(tx, input.leadId, (p) =>
    input.by === 'agent'
      ? p.by !== 'staff' && p.requested === input.requested
      : p.by === 'staff' || !p.requested,
  );
  const kind = input.requested || input.by === 'staff' ? 'timer.callback' : 'timer.followup';
  const out = await requestLeadTx(tx, {
    leadId: input.leadId,
    kind,
    source: input.by === 'staff' ? 'staff' : 'agent',
    dedupeKey: `crm:timer:${input.leadId}:${randomUUID()}`,
    at: input.at,
    payload: {
      focus: input.focus.slice(0, 500),
      requested: input.requested,
      by: input.by,
      ...(input.turnId ? { turnId: input.turnId } : {}),
    },
    // a booked date is the agenda itself: it waits in the mailbox, parked or not
    keepParked: true,
  });
  await syncNextActionTx(tx, input.leadId);
  return {
    wakeup: { id: out.mailboxId ?? '', at: input.at.toISOString() },
    replaced: dropped[0] ?? null,
  };
}

const NEXT_ACTION_FOCUS = {
  staff: 'a equipe marcou esta data para retomar o lead',
  requested: 'o lead pediu retorno nesta data',
  agent: 'retomar a conversa na data que você marcou',
} as const;

/** The lead's "next action" date, written from a lead patch (staff date picker or the agent's
 *  update_lead nextActionAt). null clears that actor's dates; promises survive an agent clear. */
export async function setNextActionTx(
  tx: Sql,
  leadId: string,
  at: string | Date | null,
  who: 'staff' | 'agent' | 'requested',
): Promise<void> {
  if (at === null) {
    await lockLead(tx, leadId);
    await dropTimersTx(tx, leadId, (p) =>
      // staff clearing the date clears its own and the agent's plans; a promise to the lead stays
      who === 'staff' ? p.by === 'staff' || !p.requested : p.by !== 'staff' && !p.requested,
    );
    await syncNextActionTx(tx, leadId);
    return;
  }
  await scheduleTimerTx(tx, {
    leadId,
    at: at instanceof Date ? at : new Date(at),
    focus: NEXT_ACTION_FOCUS[who],
    requested: who === 'requested',
    by: who === 'staff' ? 'staff' : 'agent',
    floor: false,
  });
}

/** The agent's own pending dates and the callbacks it booked for the lead go — staff's stay. */
export async function cancelAgentWakeupsTx(tx: Sql, leadId: string): Promise<number> {
  await lockLead(tx, leadId);
  const ids = await dropTimersTx(tx, leadId, (p) => p.by !== 'staff');
  if (ids.length) await syncNextActionTx(tx, leadId);
  return ids.length;
}

/** After an agent send: book the follow-up cadence unless something is already on the lead's
 *  agenda (the agent's own date or a promise wins). */
export async function scheduleCadenceTx(tx: Sql, leadId: string, days: number): Promise<boolean> {
  if (days <= 0) return false;
  await lockLead(tx, leadId);
  if ((await pendingWakeupsTx(tx, leadId)).length) return false;
  const out = await requestLeadTx(tx, {
    leadId,
    kind: 'timer.followup',
    source: 'cadence',
    dedupeKey: `crm:timer:${leadId}:${randomUUID()}`,
    at: new Date(Date.now() + days * 86_400_000),
    payload: {
      focus: `sem resposta há ${days} dia(s) desde o último envio — retome com um gancho novo`,
      requested: false,
      by: 'cadence',
    },
    keepParked: true,
  });
  if (out.mailboxId) await syncNextActionTx(tx, leadId);
  return out.mailboxId !== null;
}

/** rendered into the lead's context so the agent knows what it promised */
export async function pendingWakeupsTx(tx: Sql, leadId: string): Promise<Wakeup[]> {
  const rows = await tx<TimerRow[]>`
    ${TIMER_SELECT(tx)} and a.subject_id = ${leadId} and m.consumed_by_turn is null
    order by m.deliver_at limit 5`;
  return rows.map(toWakeup);
}

/** an inbound retires the agent's pending follow-ups; requested callbacks and staff dates survive */
export async function retireWakeupsOnInboundTx(tx: Sql, leadId: string): Promise<number> {
  const ids = await dropTimersTx(tx, leadId, (p) => p.by !== 'staff' && !p.requested);
  if (ids.length) await syncNextActionTx(tx, leadId);
  return ids.length;
}

export async function listWakeups(
  sql: Sql,
  q: { leadId?: string | null; status?: string | null; limit?: number },
): Promise<Wakeup[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const status = q.status === 'pending' || q.status === 'fired' ? q.status : null;
  if (q.status === 'canceled') return [];
  const rows = await controlTx(
    sql,
    (tx) => tx<TimerRow[]>`
      ${TIMER_SELECT(tx)}
        and (${q.leadId ?? null}::text is null or a.subject_id = ${q.leadId ?? null}::text)
        and (${status}::text is null
             or (${status} = 'pending') = (m.consumed_by_turn is null))
      order by case when m.consumed_by_turn is null then m.deliver_at end asc nulls last,
               m.created_at desc
      limit ${limit}`,
  );
  return rows.map(toWakeup);
}

/** Staff cancel: a pending timer is removed; one that already fired is history and stays. */
export async function cancelWakeup(sql: Sql, id: string, idemKey: string) {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const [row] = await tx<TimerRow[]>`${TIMER_SELECT(tx)} and m.id = ${id}::uuid`;
    if (!row) throw new HttpError(404, 'WAKEUP_NOT_FOUND', 'wakeup not found');
    if (row.consumed_by_turn) return { status: 200, body: { wakeup: toWakeup(row) } };
    await lockLead(tx, row.lead_id);
    await tx`delete from agent_mailbox where id = ${id}::uuid and consumed_by_turn is null`;
    await syncNextActionTx(tx, row.lead_id);
    return { status: 200, body: { wakeup: { ...toWakeup(row), status: 'canceled' as const } } };
  });
  return res;
}

/** Opt-out never lifts: everything still waiting for the lead's agent goes. */
export async function dropLeadMailTx(tx: Sql, leadId: string): Promise<number> {
  await lockLead(tx, leadId);
  const rows = await tx<{ id: string }[]>`
    delete from agent_mailbox m using agent_actors a
    where a.id = m.actor_id and a.agent_id = ${CRM_AGENT_ID} and a.subject_kind = ${LEAD_SUBJECT}
      and a.subject_id = ${leadId} and m.consumed_by_turn is null
    returning m.id`;
  if (rows.length) await syncNextActionTx(tx, leadId);
  return rows.length;
}
