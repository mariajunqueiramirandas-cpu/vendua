import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { insertRun } from './runner.ts';
import { enqueueInboxTx } from './inbox.ts';
import { autonomyTx, playbookEnabledTx } from './policy.ts';
import type { PlaybookKind } from './tool-meta.ts';
import { capCentsOf, getSettingTx, type Guardrails } from '../modules/integrations.ts';

const agentLog = log.child({ mod: 'agent' });

/**
 * agent/wakeups — the agent's own agenda. `schedule` writes a pending
 * wakeup (one per lead for agent-authored rows — a new one replaces the
 * old), sweepWakeups turns due rows into runs through insertRun, and a live
 * inbound retires non-requested ones exactly like auto outreach.
 */

export const WAKEUP_MIN_LEAD_MS = 10 * 60_000;
export const WAKEUP_MAX_AHEAD_MS = 90 * 86_400_000;

export interface Wakeup {
  id: string;
  leadId: string | null;
  leadName: string | null;
  kind: PlaybookKind;
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
  kind: PlaybookKind;
  at: Date;
  focus: string;
  status: Wakeup['status'];
  /** Immutable stamp written at the fired flip — metrics attribute by it
   *  (updated_at can't serve: cancelWakeup bumps it even on fired rows). */
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

/** ISO-8601 shape — Date.parse alone also accepts "March 5, 2030" or
 *  "05/03/2030" and would silently land the wakeup on a guess. A full
 *  datetime with an explicit offset is required: date-only lands at UTC
 *  midnight and a bare datetime resolves in the server's timezone — both
 *  are guesses, not the instant the caller named. */
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Validates and parses a schedule time — the bounds keep the agent from
 *  hot-looping itself (≥10 min) or parking work past any useful horizon. */
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

/** Replace the lead's pending agent wakeup with a new one. Caller runs it
 *  inside the tool's claim tx (after assertRunClaimTx). The per-lead
 *  advisory makes replace+insert atomic across concurrent runs; it is never
 *  held while waiting on capfin or lead rows, so it can't join a cycle. */
export async function scheduleWakeupTx(
  tx: Sql,
  input: {
    leadId: string;
    at: Date;
    focus: string;
    requested: boolean;
    runId: string | null;
    createdBy?: 'agent' | 'staff';
  },
): Promise<{ wakeup: Wakeup; replaced: string | null } | { error: string }> {
  await tx`select pg_advisory_xact_lock(hashtext(${'wakeup:' + input.leadId}))`;
  // parseWakeupAt's app-clock bounds go stale while this tx waits on the
  // advisory (or any conflicting writer): a long hold can push `at` under
  // the floor between validation and insert. Recheck inside the lock —
  // clock_timestamp(), not now(): now() is the tx-start time and would
  // repeat the same stale boundary the wait already outlived.
  const soon = (
    await tx<{ soon: boolean }[]>`
      select (${input.at}::timestamptz < clock_timestamp() + make_interval(secs => ${WAKEUP_MIN_LEAD_MS / 1000})) as soon
    `
  )[0]!.soon;
  if (soon) return { error: 'at must be at least 10 minutes from now' };
  const createdBy = input.createdBy ?? 'agent';
  let replaced: string | null = null;
  if (createdBy === 'agent') {
    const prev = await tx<{ id: string }[]>`
      update agent_wakeups set status = 'canceled', cancel_reason = 'substituído', updated_at = now()
      where lead_id = ${input.leadId} and status = 'pending' and created_by = 'agent'
      returning id
    `;
    replaced = prev[0]?.id ?? null;
  }
  const row = (
    await tx<WakeupRow[]>`
      insert into agent_wakeups (lead_id, kind, at, focus, requested, created_by, created_by_run_id)
      values (${input.leadId}, 'outreach', ${input.at}, ${input.focus.slice(0, 500)},
              ${input.requested}, ${createdBy}, ${input.runId})
      returning *, (select name from leads where id = ${input.leadId}) as lead_name
    `
  )[0]!;
  return { wakeup: toWakeup(row), replaced };
}

/** Pending wakeups of a lead — rendered into lead-bound run context so the
 *  agent knows what it already promised itself. */
export async function pendingWakeupsTx(tx: Sql, leadId: string): Promise<Wakeup[]> {
  const rows = await tx<WakeupRow[]>`
    select w.*, l.name as lead_name from agent_wakeups w
    left join leads l on l.id = w.lead_id
    where w.lead_id = ${leadId} and w.status = 'pending'
    order by w.at limit 5
  `;
  return rows.map(toWakeup);
}

/** Inbound retires the agent's own pending follow-ups — the reply run
 *  re-schedules with fresh context. Requested callbacks survive. SKIP
 *  LOCKED: a row the sweep is firing right now becomes an auto outreach the
 *  inbound cancel passes already cover. */
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
    return { status: 200, body: { wakeup: toWakeup(row) } };
  });
  if (!res.replayed) emitControlEvent('run.update', id);
  return res;
}

/** Materialize due wakeups. Mirrors sweepOutreach's lock discipline: rows
 *  are taken FOR UPDATE SKIP LOCKED, capfin is only TRIED (a busy lead is
 *  skipped and stays pending), insertRun applies the lifetime cost cap. */
export async function sweepWakeups(sql: Sql): Promise<number> {
  const queuedIds: string[] = [];
  let capFlagged = false;
  await controlTx(sql, async (tx) => {
    await tx`
      update agent_wakeups w set status = 'canceled', updated_at = now(),
        cancel_reason = case when l.unsubscribed_at is not null then 'descadastrado' else 'arquivado' end
      from leads l
      where l.id = w.lead_id and w.status = 'pending'
        and (l.unsubscribed_at is not null or l.archived_at is not null)
    `;
    // The playbook switch gates every wakeup; workspace autonomy gates
    // only the automation kind — promised callbacks (lead-asked or
    // staff-created) run unmarked like claimRun allows them to.
    if (!(await playbookEnabledTx(tx, 'outreach')).ok) return;
    const { level } = await autonomyTx(tx);
    const autoOff = level === 'off';
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const capCents = capCentsOf(g);
    // Over-cap leads stay out of the 20-row window (same reason as
    // sweepOutreach): a parked prefix must not starve later due wakeups.
    // Same for autonomy-off — automation wakeups stay pending and would
    // re-pick every tick, so the query excludes them rather than skipping
    // them in-loop and letting 20 parked rows starve promised callbacks.
    // An already-active run is no longer "busy" — the fired wakeup mails
    // its intent to it through agent_inbox instead of waiting it out.
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
      const cap: { flagged?: boolean } = {};
      // Agent self-schedules are automation ('auto' — a reply retires them);
      // lead-asked callbacks and staff wakeups are promises: unmarked,
      // so autonomy 'off' never stalls them (same exemption claimRun gives
      // unmarked rows) — they park pending while autonomy is off only when
      // the run itself is automation.
      const promised = w.requested || w.created_by === 'staff';
      if (!promised && level === 'off') continue;
      const params: Record<string, unknown> = {
        ...(promised ? {} : { auto: 'wakeup' }),
        focus: `agendado por você: ${w.focus}`,
        wakeupId: w.id,
      };
      const runId = await insertRun(
        tx,
        {
          kind: 'outreach',
          leadId: w.lead_id,
          params,
        },
        cap,
      );
      if (cap.flagged) capFlagged = true;
      if (runId) {
        queuedIds.push(runId);
        // A fired wakeup is mail for the lead's run — created now or
        // already active, the item carries the focus into it (insertRun's
        // conflict path returns the active run either way).
        await enqueueInboxTx(tx, w.lead_id, 'wakeup', {
          text: `agendado por você: ${w.focus}`,
          requestedKind: 'outreach',
          params,
        });
        await tx`
          update agent_wakeups set status = 'fired', fired_run_id = ${runId}, fired_at = now(), updated_at = now()
          where id = ${w.id}
        `;
        // One follow-up per lead: a due automation nudge (cadence/auto) is
        // the same intent — the wakeup run consumes it. capfin is held, so
        // the lead row lock comes second as capLockTx requires.
        await tx`
          update leads set next_action_at = null, next_action_source = null
          where id = ${w.lead_id} and next_action_at <= now()
            and next_action_source in ('cadence', 'auto')
        `;
      }
      // insertRun refusing (cost cap) leaves the wakeup pending: a raised
      // cap resumes it, and the scan's cap predicate keeps it out of the way.
    }
  }).catch((e) => agentLog.error({ err: e }, 'wakeup sweep failed'));
  for (const id of queuedIds) emitControlEvent('run.update', id);
  if (capFlagged) emitControlEvent('lead.change');
  return queuedIds.length;
}
