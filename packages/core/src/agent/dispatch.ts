import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import { log } from '../platform/log.ts';
import { channelAvailabilityTx, sendWindowOpenAtTx } from './guardrails.ts';
import { enqueueInboxTx, type InboxKind, type InboxPayload } from './inbox.ts';
import { agentSettingTx, parked, parkPolicyTx } from './policy.ts';
import { capLockTx, insertRun } from './runner.ts';
import { provenance, SOURCE_PRIORITY, type Provenance, type TriggerSource } from './sources.ts';
import type { JobKind } from './tool-meta.ts';

// The dispatcher (ADR 0016): the only way work reaches the agent. A producer states what
// it wants and why; the dispatcher files it in the lead's inbox, picks when it should
// start, and hands it to an active run or queues one. Nothing else calls insertRun.

const agentLog = log.child({ mod: 'agent' });

export interface AgentRequest {
  kind: JobKind;
  source: TriggerSource;
  /** default: callbacks are promises, everything else isn't */
  promised?: boolean;
  leadId?: string | null;
  threadId?: string | null;
  /** what the agent reads in its inbox — why it was called */
  text?: string;
  /** run configuration: focus, channel, draftOnly, goal, discovery query… */
  params?: Record<string, unknown>;
  /** earliest start; send-bound work may be pushed to the next send window */
  at?: Date | null;
  /** extra inbox payload (messageId, wakeupId, src…) */
  ref?: Record<string, unknown>;
  /** skip filing the inbox item when an equal pending one (same source + kind) exists */
  dedupe?: boolean;
  /** keep the filed request when the cost cap refuses the run — it waits for budget
   *  (the lead's own messages do; everything else is withdrawn and re-asked by its producer) */
  holdIfRefused?: boolean;
}

export interface Dispatched {
  runId: string | null;
  /** when the run may start (null = now) */
  startAt: Date | null;
  /** this request wrote the lead's cost-cap flag — emit lead.change after commit */
  capFlagged: boolean;
  /** the lead's cost cap refused the run */
  refused: boolean;
  /** queued rows retired in favour of this request — emit run.update after commit */
  retired: string[];
}

const INBOX_KIND: Record<TriggerSource, InboxKind> = {
  inbound: 'inbound',
  staff: 'staff',
  callback: 'wakeup',
  followup: 'wakeup',
  regenerate: 'event',
  first_contact: 'event',
  brief: 'event',
  weekly: 'event',
};

/** sources whose run exists to put a message on the wire */
const SEND_BOUND: readonly TriggerSource[] = ['inbound', 'callback', 'followup', 'first_contact'];

/** When a send-bound run should start: never inside quiet hours when it would send live.
 *  Drafting work (copilot, draft-mode leads, supervised first contact, no deliverable
 *  channel) runs right away. */
export async function smartStartTx(
  tx: Sql,
  req: Pick<AgentRequest, 'kind' | 'leadId' | 'params' | 'at'>,
  prov: Provenance,
): Promise<Date | null> {
  const at = req.at ?? null;
  if (!req.leadId || (req.kind !== 'reply' && req.kind !== 'outreach')) return at;
  if (!SEND_BOUND.includes(prov.source) || req.params?.draftOnly === true) return at;
  const { level } = await agentSettingTx(tx);
  if (level !== 'supervised' && level !== 'autopilot') return at;
  const lead = (
    await tx<{ agent_mode: string; prior_out: number }[]>`
      select l.agent_mode,
        (select count(*) from lead_messages m join lead_threads t on t.id = m.thread_id
          where t.lead_id = l.id and m.direction = 'out'
            and m.status in ('queued', 'sending', 'sent', 'delivered'))::int as prior_out
      from leads l where l.id = ${req.leadId}
    `
  )[0];
  if (!lead || lead.agent_mode === 'draft') return at;
  if (level === 'supervised' && lead.prior_out === 0) return at;
  // no deliverable channel → the run can only draft or escalate; nothing to wait for.
  // A pinned run (an inbound reply stays on its thread's channel) only counts its pin.
  const ch = await channelAvailabilityTx(tx, req.leadId);
  const pin = req.params?.channel;
  const deliverable =
    pin === 'whatsapp' || pin === 'email' ? ch[pin].ok : ch.whatsapp.ok || ch.email.ok;
  if (!deliverable) return at;
  const g: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
  };
  const from = at ?? new Date();
  const open = await sendWindowOpenAtTx(tx, g, from);
  return open.getTime() > from.getTime() ? open : at;
}

/** Ask the agent for work. Runs inside the caller's tx so the request commits with the event that caused it. */
export async function requestAgentTx(tx: Sql, req: AgentRequest): Promise<Dispatched> {
  const prov = provenance(req.source, req.promised);
  const startAt = await smartStartTx(tx, req, prov);
  let filed: string | null = null;
  if (req.leadId) {
    const dup =
      req.dedupe &&
      (
        await tx`
          select 1 from agent_inbox
          where lead_id = ${req.leadId} and consumed_at is null
            and source = ${prov.source} and payload->>'requestedKind' = ${req.kind}
          limit 1
        `
      ).length > 0;
    if (!dup) {
      const payload: InboxPayload = {
        text: req.text ?? `pedido '${req.kind}' (${prov.source})`,
        requestedKind: req.kind,
        ...(req.threadId ? { threadId: req.threadId } : {}),
        params: req.params ?? {},
        ...(startAt && startAt.getTime() > Date.now() ? { notBefore: startAt.toISOString() } : {}),
        ...(req.ref ?? {}),
      };
      filed = await enqueueInboxTx(tx, req.leadId, INBOX_KIND[prov.source], payload, prov);
    }
  }
  const cap: { flagged?: boolean; refused?: boolean; retired?: string[] } = {};
  const runId = await insertRun(
    tx,
    {
      kind: req.kind,
      leadId: req.leadId ?? null,
      threadId: req.threadId ?? null,
      params: req.params ?? {},
      runAt: startAt,
      ...prov,
    },
    cap,
  );
  if (cap.refused && filed && !req.holdIfRefused) {
    await tx`update agent_inbox set consumed_at = now() where id = ${filed}`;
  } else if (runId && filed && prov.source === 'staff') {
    // a staff ask belongs to the run it asked for — canceling that run tombstones it
    // instead of letting the sweep respawn what staff just stopped
    await tx`
      update agent_inbox set payload = payload || ${tx.json({ forRunId: runId } as never)}
      where id = ${filed}
    `;
  }
  return {
    runId,
    startAt,
    capFlagged: cap.flagged === true,
    refused: cap.refused === true,
    retired: cap.retired ?? [],
  };
}

/** requestAgentTx in its own tx, with the post-commit events emitted. */
export async function requestAgent(sql: Sql, req: AgentRequest): Promise<Dispatched> {
  const d = await controlTx(sql, (tx) => requestAgentTx(tx, req));
  emitDispatched(d);
  return d;
}

export function emitDispatched(d: Pick<Dispatched, 'runId' | 'retired' | 'capFlagged'>) {
  if (d.runId) emitControlEvent('run.update', d.runId);
  for (const r of d.retired) emitControlEvent('run.update', r);
  // a fresh flag committed a [humano] task — unscoped emit or Tasks stays stale
  if (d.capFlagged) emitControlEvent('lead.change');
}

// ── recovery: pending mail whose lead has no active run ─────────────────────

// Page size for the orphan scan — bounds each candidate query, not the tick.
const SWEEP_SCAN = 100;
// Per-tick cap on serve attempts — a blocked backlog re-checks once per rotation.
const SWEEP_INSPECT = 100;
// Round-robin resume point persisted across ticks. first_at is bucketed to ms — bound
// params arrive ms-only and a finer cursor re-selects the same lead forever.
let sweepAfter: { firstAt: Date; leadId: string } | null = null;

type PendingItem = {
  id: string;
  kind: InboxKind;
  payload: InboxPayload;
  source: TriggerSource;
  promised: boolean;
};

// Spawns a run for mail no active run owns (a request that was parked, capped, or
// deferred). The highest-priority servable item drives it; terminal suppressions drop
// the mail, pauses/mode 'off' keep it pending.
export async function sweepOrphanInbox(
  sql: Sql,
  limit = 10,
  opts?: { scan?: number; inspect?: number },
): Promise<number> {
  let served = 0;
  let inspected = 0;
  const pageSize = opts?.scan ?? SWEEP_SCAN;
  const maxInspect = opts?.inspect ?? SWEEP_INSPECT;
  let after = sweepAfter;
  // null = already at the rotation's head; resuming mid-list wraps once.
  let wrapped = after === null;
  while (served < limit && inspected < maxInspect) {
    const afterAt = after?.firstAt ?? new Date('1970-01-01T00:00:00.000Z');
    const afterId = after?.leadId ?? '00000000-0000-0000-0000-000000000000';
    // Only exclusions that never self-clear are filtered here; terminal leads stay
    // selectable so their mail still drops.
    const leads = await controlTx(
      sql,
      (tx) => tx<{ lead_id: string; first_at: Date }[]>`
        select i.lead_id, date_trunc('milliseconds', min(i.created_at)) as first_at
        from agent_inbox i
        join leads l on l.id = i.lead_id
        where i.consumed_at is null
          and (
            (l.agent_paused_at is null and l.agent_mode <> 'off')
            or l.unsubscribed_at is not null
            or l.archived_at is not null
          )
          and not exists (
            select 1 from agent_runs r
            where r.lead_id = i.lead_id and r.status in ('queued', 'running')
          )
        group by i.lead_id
        having (date_trunc('milliseconds', min(i.created_at)), i.lead_id) > (${afterAt}, ${afterId}::uuid)
        order by first_at, i.lead_id limit ${pageSize}
      `,
    );
    if (!leads.length) {
      if (wrapped) break;
      after = null;
      wrapped = true;
      continue;
    }
    for (const { lead_id, first_at } of leads) {
      if (served >= limit || inspected >= maxInspect) break;
      after = { firstAt: first_at, leadId: lead_id };
      inspected++;
      const res = await controlTx(sql, (tx) => serveOrphanTx(tx, lead_id)).catch((e) => {
        agentLog.warn({ err: e, leadId: lead_id }, 'orphan inbox sweep failed for lead');
        return null;
      });
      if (res?.runId) {
        served++;
        emitControlEvent('run.update', res.runId);
      }
      for (const r of res?.retired ?? []) emitControlEvent('run.update', r);
    }
    if (served >= limit || inspected >= maxInspect) continue;
    if (leads.length < pageSize) {
      if (wrapped) break;
      after = null;
      wrapped = true;
    }
  }
  sweepAfter = after;
  return served;
}

async function serveOrphanTx(
  tx: Sql,
  leadId: string,
): Promise<{ runId: string | null; retired: string[] } | null> {
  await capLockTx(tx, leadId);
  // A run claimed since the scan owns the mail now — nothing to do.
  const active = await tx`
    select 1 from agent_runs where lead_id = ${leadId} and status in ('queued', 'running') limit 1
  `;
  if (active.length) return null;
  const items = await tx<PendingItem[]>`
    select id, kind, payload, source, promised from agent_inbox
    where lead_id = ${leadId} and consumed_at is null
    order by created_at for update skip locked
  `;
  if (!items.length) return null;
  const lead = (
    await tx<
      {
        agent_mode: string;
        agent_paused_at: string | null;
        unsubscribed_at: string | null;
        archived_at: string | null;
      }[]
    >`select agent_mode, agent_paused_at, unsubscribed_at, archived_at from leads where id = ${leadId}`
  )[0];
  if (!lead) return null;
  if (lead.unsubscribed_at || lead.archived_at) {
    // Terminal suppression: consume with no run so the mail doesn't retry every tick.
    await tx`update agent_inbox set consumed_at = now() where lead_id = ${leadId} and consumed_at is null`;
    return null;
  }
  // Paused or mode 'off' lifts — keep the mail pending.
  if (lead.agent_paused_at || lead.agent_mode === 'off') return null;
  const pp = await parkPolicyTx(tx);
  // Highest-priority servable item drives the spawn — a blocked item never starves the rest.
  const ordered = [...items].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  let spawn: PendingItem | null = null;
  for (const item of ordered) {
    const kind = item.payload?.requestedKind;
    if (!kind) continue;
    if (parked(pp, kind, item)) continue;
    if (item.payload.threadId) {
      const th = await tx<{ agent_enabled: boolean }[]>`
        select agent_enabled from lead_threads where id = ${item.payload.threadId}
      `;
      if (!th[0]?.agent_enabled) continue;
    }
    spawn = item;
    break;
  }
  if (!spawn) return null;
  const params = spawn.payload.params ?? {};
  // The spawned run inherits the latest notBefore of the items it would drain.
  const runChannel =
    params.channel === 'whatsapp' || params.channel === 'email' ? (params.channel as string) : '';
  const runDraftOnly = params.draftOnly === true;
  let notBefore = 0;
  for (const i of items) {
    const ip = i.payload;
    const chan =
      ip?.params != null && typeof ip.params.channel === 'string'
        ? (ip.params.channel as string)
        : '';
    const wouldDrain =
      (chan || runChannel) === runChannel && (ip?.params?.draftOnly === true) === runDraftOnly;
    if (!wouldDrain) continue;
    // Same gate drainInbox applies: parked automation stays pending.
    if (parked(pp, ip?.requestedKind ?? '', i)) continue;
    const t = typeof ip?.notBefore === 'string' ? Date.parse(ip.notBefore) : NaN;
    if (Number.isFinite(t) && t > notBefore) notBefore = t;
  }
  const cap: { retired?: string[] } = {};
  // insertRun's cap check still applies — a refused lead keeps the mail pending.
  const runId = await insertRun(
    tx,
    {
      kind: spawn.payload.requestedKind!,
      leadId,
      threadId: spawn.payload.threadId ?? null,
      params,
      source: spawn.source,
      promised: spawn.promised,
      ...(notBefore ? { runAt: new Date(notBefore) } : {}),
    },
    cap,
  );
  return { runId, retired: cap.retired ?? [] };
}
