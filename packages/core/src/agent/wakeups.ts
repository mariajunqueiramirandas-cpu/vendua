import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { releaseInboxTx } from './runner.ts';
import { requestAgentTx } from './dispatch.ts';
import { parkPolicyTx } from './policy.ts';
import type { JobKind } from './tool-meta.ts';
import { capCentsOf, getSettingTx, type Guardrails } from '../modules/integrations.ts';

const agentLog = log.child({ mod: 'agent' });

export const WAKEUP_MIN_LEAD_MS = 10 * 60_000;
export const WAKEUP_MAX_AHEAD_MS = 90 * 86_400_000;

export interface Wakeup {
  id: string;
  leadId: string | null;
  leadName: string | null;
  kind: JobKind;
  at: string;
  focus: string;
  status: 'pending' | 'fired' | 'canceled';
  requested: boolean;
  createdBy: 'agent' | 'staff';
  createdByRunId: string | null;
  firedRunId: string | null;
  cancelReason: string | null;
  createdAt: string;
}

type WakeupRow = {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  kind: JobKind;
  at: Date;
  focus: string;
  status: Wakeup['status'];
  /** metrics attribute by this stamp; updated_at can't serve (cancel bumps it on fired rows) */
  fired_at: Date | null;
  requested: boolean;
  created_by: Wakeup['createdBy'];
  created_by_run_id: string | null;
  fired_run_id: string | null;
  cancel_reason: string | null;
  created_at: Date;
};

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d));

function toWakeup(r: WakeupRow): Wakeup {
  return {
    id: r.id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    kind: r.kind,
    at: iso(r.at),
    focus: r.focus,
    status: r.status,
    requested: r.requested,
    createdBy: r.created_by,
    createdByRunId: r.created_by_run_id,
    firedRunId: r.fired_run_id,
    cancelReason: r.cancel_reason,
    createdAt: iso(r.created_at),
  };
}

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

// The agenda (ADR 0016): every future touch on a lead is a wakeup — the agent's own
// follow-up (cadence or a date it picked), a callback the lead asked for, or a date staff
// set. leads.next_action_at is only a mirror of the earliest pending one.

/** keep leads.next_action_at/source pointing at the earliest pending wakeup */
export async function syncNextActionTx(tx: Sql, leadId: string): Promise<void> {
  await tx`
    update leads set (next_action_at, next_action_source) = (
      select w.at,
        case when w.created_by = 'staff' then 'staff' when w.requested then 'requested' else 'auto' end
      from agent_wakeups w
      where w.lead_id = ${leadId} and w.status = 'pending'
      order by w.at limit 1
    )
    where id = ${leadId}
  `;
}

/** replace the lead's pending wakeup of the same class; the per-lead advisory makes
 *  replace+insert atomic across concurrent runs */
export async function scheduleWakeupTx(
  tx: Sql,
  input: {
    leadId: string;
    at: Date;
    focus: string;
    requested: boolean;
    runId: string | null;
    createdBy?: 'agent' | 'staff';
    /** the `schedule` tool keeps a 10-minute floor; staff dates and update_lead may be due now */
    floor?: boolean;
  },
): Promise<{ wakeup: Wakeup; replaced: string | null } | { error: string }> {
  await tx`select pg_advisory_xact_lock(hashtext(${'wakeup:' + input.leadId}))`;
  if (input.floor !== false) {
    // recheck the floor inside the lock — the wait can push `at` stale;
    // clock_timestamp(), not now() (tx-start time, already outlived)
    const soon = (
      await tx<{ soon: boolean }[]>`
        select (${input.at}::timestamptz < clock_timestamp() + make_interval(secs => ${WAKEUP_MIN_LEAD_MS / 1000})) as soon
      `
    )[0]!.soon;
    if (soon) return { error: 'at must be at least 10 minutes from now' };
  }
  const createdBy = input.createdBy ?? 'agent';
  // replace within the class only: the agent's plans supersede each other but never a
  // requested callback; a staff date supersedes the agent's own plan and the prior staff date
  const prev = await tx<{ id: string }[]>`
    update agent_wakeups set status = 'canceled', cancel_reason = 'substituído', updated_at = now()
    where lead_id = ${input.leadId} and status = 'pending'
      and (
        (created_by = 'agent' and requested = ${input.requested} and ${createdBy === 'agent'})
        or (${createdBy === 'staff'} and (created_by = 'staff' or (created_by = 'agent' and not requested)))
      )
    returning id
  `;
  const replaced = prev[0]?.id ?? null;
  const row = (
    await tx<WakeupRow[]>`
      insert into agent_wakeups (lead_id, kind, at, focus, requested, created_by, created_by_run_id)
      values (${input.leadId}, 'outreach', ${input.at}, ${input.focus.slice(0, 500)},
              ${input.requested}, ${createdBy}, ${input.runId})
      returning *, (select name from leads where id = ${input.leadId}) as lead_name
    `
  )[0]!;
  await syncNextActionTx(tx, input.leadId);
  return { wakeup: toWakeup(row), replaced };
}

const NEXT_ACTION_FOCUS = {
  staff: 'a equipe marcou esta data para retomar o lead',
  requested: 'o lead pediu retorno nesta data',
  agent: 'retomar a conversa na data que você marcou',
} as const;

/** The lead's "next action" date, written from a lead patch (staff date picker or the
 *  agent's update_lead nextActionAt). null clears that actor's dates; promises survive
 *  an agent clear. */
export async function setNextActionTx(
  tx: Sql,
  leadId: string,
  at: string | Date | null,
  who: 'staff' | 'agent' | 'requested',
): Promise<void> {
  if (at === null) {
    await tx`select pg_advisory_xact_lock(hashtext(${'wakeup:' + leadId}))`;
    await tx`
      update agent_wakeups set status = 'canceled', cancel_reason = ${who === 'staff' ? 'removido pela equipe' : 'removido pelo agente'},
        updated_at = now()
      where lead_id = ${leadId} and status = 'pending'
        and (created_by = 'agent' and not requested or ${who === 'staff'} and created_by = 'staff')
    `;
    await syncNextActionTx(tx, leadId);
    return;
  }
  await scheduleWakeupTx(tx, {
    leadId,
    at: at instanceof Date ? at : new Date(at),
    focus: NEXT_ACTION_FOCUS[who],
    requested: who === 'requested',
    runId: null,
    createdBy: who === 'staff' ? 'staff' : 'agent',
    floor: false,
  });
}

/** After an agent send: book the follow-up cadence unless something is already on the
 *  lead's agenda (the agent's own date or a promise wins). */
export async function scheduleCadenceTx(
  tx: Sql,
  leadId: string,
  days: number,
  runId: string | null,
): Promise<boolean> {
  if (days <= 0) return false;
  await tx`select pg_advisory_xact_lock(hashtext(${'wakeup:' + leadId}))`;
  const rows = await tx`
    insert into agent_wakeups (lead_id, kind, at, focus, requested, created_by, created_by_run_id)
    select ${leadId}, 'outreach', now() + make_interval(days => ${days}),
      ${`sem resposta há ${days} dia(s) desde o último envio — retome com um gancho novo`}, false, 'agent', ${runId}
    where not exists (select 1 from agent_wakeups where lead_id = ${leadId} and status = 'pending')
    on conflict (lead_id) where status = 'pending' and created_by = 'agent' and not requested do nothing
    returning id
  `;
  if (rows.length) await syncNextActionTx(tx, leadId);
  return rows.length > 0;
}

/** rendered into lead-bound run context so the agent knows what it promised */
export async function pendingWakeupsTx(tx: Sql, leadId: string): Promise<Wakeup[]> {
  const rows = await tx<WakeupRow[]>`
    select w.*, l.name as lead_name from agent_wakeups w
    left join leads l on l.id = w.lead_id
    where w.lead_id = ${leadId} and w.status = 'pending'
    order by w.at limit 5
  `;
  return rows.map(toWakeup);
}

/** inbound retires the agent's pending follow-ups; requested callbacks survive; SKIP LOCKED — a row mid-fire is covered by the inbound cancel */
export async function retireWakeupsOnInboundTx(tx: Sql, leadId: string): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    update agent_wakeups set status = 'canceled', cancel_reason = 'lead respondeu', updated_at = now()
    where id in (
      select id from agent_wakeups
      where lead_id = ${leadId} and status = 'pending' and created_by = 'agent' and not requested
      for update skip locked
    )
    returning id
  `;
  if (rows.length) await syncNextActionTx(tx, leadId);
  return rows.length;
}

export async function listWakeups(
  sql: Sql,
  q: { leadId?: string | null; status?: Wakeup['status'] | null; limit?: number },
): Promise<Wakeup[]> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const rows = await controlTx(
    sql,
    (tx) => tx<WakeupRow[]>`
      select w.*, l.name as lead_name from agent_wakeups w
      left join leads l on l.id = w.lead_id
      where (${q.leadId ?? null}::uuid is null or w.lead_id = ${q.leadId ?? null}::uuid)
        and (${q.status ?? null}::text is null or w.status = ${q.status ?? null}::text)
      order by case when w.status = 'pending' then w.at end asc nulls last, w.created_at desc
      limit ${limit}
    `,
  );
  return rows.map(toWakeup);
}

export async function cancelWakeup(sql: Sql, id: string, idemKey: string) {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const row = (
      await tx<WakeupRow[]>`
        update agent_wakeups set
          status = case when status = 'pending' then 'canceled' else status end,
          cancel_reason = case when status = 'pending' then 'cancelado pela equipe' else cancel_reason end,
          updated_at = now()
        where id = ${id}
        returning *, (select name from leads where id = agent_wakeups.lead_id) as lead_name
      `
    )[0];
    if (!row) throw new HttpError(404, 'WAKEUP_NOT_FOUND', 'wakeup not found');
    if (row.lead_id) await syncNextActionTx(tx, row.lead_id);
    // a fired wakeup already materialized — cancel its pending inbox mail
    // and its still-queued run (a running run owns its in-flight steps)
    await tx`
      update agent_inbox set consumed_at = now()
      where consumed_at is null and payload->'params'->>'wakeupId' = ${id}
    `;
    if (row.fired_run_id) {
      const killed = await tx<{ id: string }[]>`
        update agent_runs set status = 'canceled', finished_at = now()
        where id = ${row.fired_run_id} and status = 'queued' and params->>'wakeupId' = ${id}
        returning id
      `;
      if (killed.length) {
        // tombstone this wakeup's items instead of re-serving; release the
        // rest like the staff run-cancel
        await tx`
          update agent_inbox set consumed_by_run = null
          where consumed_by_run = ${row.fired_run_id} and payload->'params'->>'wakeupId' = ${id}
        `;
        await releaseInboxTx(tx, row.fired_run_id, true);
      }
    }
    return { status: 200, body: { wakeup: toWakeup(row) } };
  });
  if (!res.replayed) emitControlEvent('run.update', id);
  return res;
}

/** materialize due wakeups — FOR UPDATE SKIP LOCKED, capfin only tried (busy lead stays pending), insertRun applies the cost cap */
export async function sweepWakeups(sql: Sql): Promise<number> {
  const queuedIds: string[] = [];
  let capFlagged = false;
  await controlTx(sql, async (tx) => {
    const dead = await tx<{ lead_id: string }[]>`
      update agent_wakeups w set status = 'canceled', updated_at = now(),
        cancel_reason = case when l.unsubscribed_at is not null then 'descadastrado' else 'arquivado' end
      from leads l
      where l.id = w.lead_id and w.status = 'pending'
        and (l.unsubscribed_at is not null or l.archived_at is not null)
      returning w.lead_id
    `;
    for (const id of new Set(dead.map((d) => d.lead_id))) await syncNextActionTx(tx, id);
    // preset 'off' / outreach job off park only the agent's own wakeups —
    // promised callbacks (lead-asked, staff) always fire
    const pp = await parkPolicyTx(tx);
    const autoOff = pp.autoOff || pp.offJobs.includes('outreach');
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const capCents = capCentsOf(g);
    // exclude over-cap and autonomy-off rows in the query so 20 parked
    // rows can't starve later due wakeups; an active run gets the fired
    // intent by mail
    const due = await tx<
      { id: string; lead_id: string; focus: string; requested: boolean; created_by: string }[]
    >`
      select w.id, w.lead_id, w.focus, w.requested, w.created_by from agent_wakeups w
      join leads l on l.id = w.lead_id
      where w.status = 'pending' and w.at <= now()
        and l.agent_mode != 'off' and l.agent_paused_at is null
        and (not ${autoOff} or w.requested or w.created_by = 'staff')
        and (${capCents} <= 0 or
          coalesce((select sum(x.cost_cents) from agent_runs x
                    where x.lead_id = w.lead_id), 0) < ${capCents})
      order by w.at
      limit 20
      for update of w skip locked
    `;
    for (const w of due) {
      const capFree = await tx<{ got: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtext(${'capfin:' + w.lead_id})) as got
      `;
      if (!capFree[0]!.got) continue;
      // lead-asked and staff dates are promises — the preset/job switches never stall them
      const promised = w.requested || w.created_by === 'staff';
      if (!promised && autoOff) continue;
      const focus =
        w.created_by === 'staff'
          ? `data marcada pela equipe: ${w.focus}`
          : w.requested
            ? `retorno que o lead pediu: ${w.focus}`
            : `agendado por você: ${w.focus}`;
      // the dispatcher mails the focus into the lead's run, new or active
      const d = await requestAgentTx(tx, {
        kind: 'outreach',
        source: promised ? 'callback' : 'followup',
        leadId: w.lead_id,
        text: focus,
        params: { focus, wakeupId: w.id },
      });
      if (d.capFlagged) capFlagged = true;
      queuedIds.push(...d.retired);
      if (d.runId) {
        queuedIds.push(d.runId);
        await tx`
          update agent_wakeups set status = 'fired', fired_run_id = ${d.runId}, fired_at = now(), updated_at = now()
          where id = ${w.id}
        `;
        await syncNextActionTx(tx, w.lead_id);
      }
      // insertRun refusing (cost cap) leaves the wakeup pending — a raised cap resumes it
    }
  }).catch((e) => agentLog.error({ err: e }, 'wakeup sweep failed'));
  for (const id of queuedIds) emitControlEvent('run.update', id);
  if (capFlagged) emitControlEvent('lead.change');
  return queuedIds.length;
}
