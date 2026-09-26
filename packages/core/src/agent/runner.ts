import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { controlTx } from '../modules/control.ts';
import {
  getIntegration,
  getPitch,
  getSetting,
  getSettingTx,
  capCentsOf,
  DEFAULT_GUARDRAILS,
  phoneDigits,
  phoneIsIgnored,
  type Guardrails,
} from '../modules/integrations.ts';
import {
  appendDebriefTx,
  hasMemoryTablesTx,
  leadFactsTx,
  memoryForRunTx,
} from '../modules/agent-memory.ts';
import { segmentStats, type AgentGoal } from '../modules/leads.ts';
import {
  estimateModelCostUsd,
  providerFor,
  type AgentMessage,
  type AgentTool,
  type LlmProvider,
  type LlmResult,
  type ToolCall,
} from './llm.ts';
import { buildSystemPrompt, ladderTags } from './prompts.ts';
import { JOBS, type JobDef } from './jobs.ts';
import {
  agentSettingTx,
  automationAllowedTx,
  discoveryBudgetTx,
  parked,
  parkPolicyTx,
} from './policy.ts';
import { pendingWakeupsTx } from './wakeups.ts';
import { enqueueInboxTx, renderInboxItems, type InboxItem } from './inbox.ts';
import { requestAgentTx, sweepOrphanInbox } from './dispatch.ts';
import { anchorTx } from './schedule-anchors.ts';
import { provenance, SOURCE_PRIORITY, type TriggerSource } from './sources.ts';
import {
  executeTool,
  toolsFor,
  bookDigest,
  toolGate,
  type BookEntry,
  type ToolGate,
  type ToolContext,
} from './tools.ts';
import { MonidBudget } from './channels/monid.ts';
import {
  ACTION_TOOLS,
  MUTABLE_READS,
  NON_IDEMPOTENT,
  JOB_KINDS,
  READ_TOOLS,
  toolAvailable,
  type JobKind,
} from './tool-meta.ts';
import { pageKey } from './channels/discovery.ts';
import { dispatchMessage } from './send.ts';
import { channelAvailabilityTx, sendableNowTx, whatsappReadyTx } from './guardrails.ts';
import { isSendChannel, SEND_CHANNELS } from '../modules/threads.ts';
import { bookingLinkForRunner } from '../modules/meetings.ts';
import { emitControlEvent } from '../modules/control-events.ts';

const agentLog = log.child({ mod: 'agent' });

// Agent loop: claim queued runs (SKIP LOCKED), converge the tool loop, journal the trajectory in agent_runs.steps.

const HEARTBEAT_MS = 20_000;
/** Lead ceiling for meta-less discovery runs; runs with a meta cap at it. */
const DISCOVERY_LEAD_CAP = 20;

export interface RunRow {
  id: string;
  kind: 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
  lead_id: string | null;
  thread_id: string | null;
  params: Record<string, unknown>;
  /** Fencing token: every worker write is conditioned on it so a reclaimed worker can't overwrite the new owner. */
  claim_token: string;
  /** Prior-attempts journal — replayed into the conversation on reclaim (see replayJournal). */
  steps: unknown[];
  /** Executions consumed; at max_attempts the reclaim lands 'failed'. */
  attempts: number;
  max_attempts: number;
}

// Cost cap enforced at insert, not claim — a capped lead must not even queue.
type CapVerdict = 'under' | 'flagged' | 'already';

// 'capfin' must be a tx's FIRST lock for a lead — taken empty-handed it can't deadlock;
// taken after row locks it can cycle (inbound holds lead → wants capfin; finisher vice-versa).
export async function capLockTx(tx: Sql, leadId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${'capfin:' + leadId}))`;
}

// 'flagged' = this call wrote the flag; 'already' = flag existed at this cap level.
export async function leadUnderCostCapTx(tx: Sql, leadId: string): Promise<CapVerdict> {
  const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const capUsd = g.leadLifetimeCostCapUsd ?? DEFAULT_GUARDRAILS.leadLifetimeCostCapUsd;
  if (capUsd <= 0) return 'under';
  // Blocking xact advisory serializes same-lead cap eval across concurrent finishers.
  await capLockTx(tx, leadId);
  const spent = (
    await tx<{ cents: number }[]>`
      select coalesce(sum(cost_cents), 0)::int as cents
      from agent_runs where lead_id = ${leadId}
    `
  )[0]!.cents;
  if (spent < capCentsOf(g)) return 'under';
  // Dedupe per cap level — a raised cap re-flags on the next cross.
  const flagged = await tx`
    select 1 from lead_activities
    where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
      and (meta->>'capUsd')::numeric = ${capUsd}
    limit 1
  `;
  if (flagged[0]) return 'already';
  const name =
    (await tx<{ name: string }[]>`select name from leads where id = ${leadId}`)[0]?.name ?? leadId;
  await tx`
    insert into lead_activities (lead_id, kind, body, meta, created_by)
    values (${leadId}, 'system',
            ${`custo acumulado do agente atingiu o teto (US$ ${capUsd}) — novas runs suspensas`},
            ${tx.json({ type: 'cost-cap', capUsd, spentCents: spent } as never)}, 'system')
  `;
  await tx`
    insert into lead_tasks (lead_id, title, due_at, created_by)
    values (${leadId},
            ${`[humano] ${name}: custo do agente ≥ US$ ${capUsd} — suba o teto ou encerre a automação`.slice(0, 300)},
            null, 'agent')
  `;
  return 'flagged';
}

type ActiveRow = {
  id: string;
  status: string;
  kind: string;
  thread_id: string | null;
  params: Record<string, unknown>;
  run_at: Date | null;
  source: TriggerSource;
  promised: boolean;
};

// Transaction-local insert (postgres.js tx handles have no .begin()); null = cost-cap refusal.
// Producers go through dispatch.ts (requestAgentTx), which files the inbox mail first.
export async function insertRun(
  tx: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    params?: Record<string, unknown>;
    /** earliest start; null = claimable immediately */
    runAt?: Date | null;
    /** why the run exists (ADR 0016) — only dispatch.ts produces it outside tests */
    source: TriggerSource;
    promised?: boolean;
  },
  /** out-box: flagged = fresh cap flag (emit lead.change post-commit); refused = the cost cap
   *  said no; retired = adopt-canceled ids (emit run.update each). */
  cap?: { flagged?: boolean; refused?: boolean; retired?: string[] },
): Promise<string | null> {
  // Adopt an already-active row as the mail's owner — or retire it when it can't serve: policy-parked,
  // or scheduled (its run_at never slides earlier). A retire re-anchors the row's intent as an 'event'
  // item unless pending mail already covers it, then releases its consumed mail.
  const callerAt = input.runAt ?? new Date();
  const prov = provenance(input.source, input.promised);
  const priority = SOURCE_PRIORITY[prov.source];
  const adopt = async (a: ActiveRow): Promise<string | null> => {
    if (a.status !== 'queued') return a.id;
    const p = a.params ?? {};
    const parkedByPolicy = parked(await parkPolicyTx(tx), a.kind, a);
    const scheduled = a.run_at !== null && a.run_at.getTime() > callerAt.getTime();
    if (parkedByPolicy || scheduled) {
      // Status-conditional: a claim in flight owns arriving mail just the same.
      const retired = await tx<{ id: string }[]>`
        update agent_runs
        set status = 'canceled',
            error = ${parkedByPolicy ? 'policy-parked — a newer request replaced it' : 'a newer request takes over'},
            finished_at = now()
        where id = ${a.id} and status = 'queued'
        returning id
      `;
      if (!retired.length) return a.id;
      if (cap) (cap.retired ??= []).push(a.id);
      // A pending item stands in only if it carries the same intent whole (kind, thread, equal
      // params, same provenance, and for a scheduled row a notBefore reaching its deadline).
      const covered = (
        await tx<{ ok: boolean }[]>`
          select exists (
            select 1 from agent_inbox i
            where i.lead_id = ${input.leadId ?? null} and i.consumed_at is null
              and i.payload->>'requestedKind' = ${a.kind}
              and coalesce(i.payload->>'threadId', '') = ${a.thread_id ?? ''}
              and coalesce(i.payload->'params', '{}'::jsonb) = ${tx.json(p as never)}::jsonb
              and i.source = ${a.source} and i.promised = ${a.promised}
              and (not ${scheduled}
                   or coalesce(nullif(i.payload->>'notBefore', '')::timestamptz,
                        '-infinity'::timestamptz)
                      >= ${a.run_at ?? null}::timestamptz - interval '5 seconds')
          ) as ok
        `
      )[0]!.ok;
      if (!covered) {
        await enqueueInboxTx(
          tx,
          input.leadId!,
          'event',
          {
            text: `uma '${a.kind}' estava marcada${typeof p['focus'] === 'string' ? ` — ${p['focus']}` : ''}`,
            requestedKind: a.kind as JobKind,
            threadId: a.thread_id,
            params: p,
            ...(scheduled ? { notBefore: a.run_at!.toISOString() } : {}),
          },
          { source: a.source, promised: a.promised },
        );
      }
      await releaseInboxTx(tx, a.id, true);
      return null;
    }
    // Runnable + no schedule conflict: keep the row, pull its start and priority to the
    // more urgent intent (a promise adopted into a follow-up must not wait behind briefs).
    await tx`
      update agent_runs
      set run_at = least(coalesce(run_at, now()), ${callerAt}),
          priority = least(priority, ${priority})
      where id = ${a.id} and status = 'queued'
    `;
    return a.id;
  };
  if (input.leadId) {
    // An already-active run owns the mail regardless of the cap — delivery into it costs nothing.
    const active = await tx<ActiveRow[]>`
      select id, status, kind, thread_id, params, run_at, source, promised from agent_runs
      where lead_id = ${input.leadId} and status in ('queued', 'running')
      order by created_at limit 1
    `;
    if (active.length) {
      const adopted = await adopt(active[0]!);
      if (adopted) return adopted;
    }
    const verdict = await leadUnderCostCapTx(tx, input.leadId);
    if (verdict !== 'under') {
      if (cap) {
        cap.flagged = verdict === 'flagged';
        cap.refused = true;
      }
      return null;
    }
  }
  // One active run per lead (agent_runs_one_active_per_lead); on conflict the existing row owns the mail's delivery.
  const row = (
    await tx<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, thread_id, params, run_at, source, promised, priority)
      values (${input.kind}, ${input.leadId ?? null}, ${input.threadId ?? null}, ${tx.json((input.params ?? {}) as never)}, ${input.runAt ?? null},
              ${prov.source}, ${prov.promised}, ${priority})
      on conflict (lead_id) where status in ('queued', 'running') do nothing
      returning id
    `
  )[0];
  if (row) return row.id;
  const existing = await tx<ActiveRow[]>`
    select id, status, kind, thread_id, params, run_at, source, promised from agent_runs
    where lead_id = ${input.leadId ?? null} and status in ('queued', 'running')
    order by created_at limit 1
  `;
  // Same adopt path — a policy-parked row retires and the caller's item waits for the orphan sweep.
  return existing[0] ? await adopt(existing[0]) : null;
}

/** A bare run with no inbox mail — tests and tooling; producers use dispatch.ts. */
export async function enqueueRun(
  sql: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    runAt?: Date | null;
    params?: Record<string, unknown>;
    source?: TriggerSource;
    promised?: boolean;
  },
): Promise<string | null> {
  const { id, capFlagged, retired } = await controlTx(sql, async (tx) => {
    const cap: { flagged?: boolean; retired?: string[] } = {};
    return {
      id: await insertRun(tx, { ...input, source: input.source ?? 'staff' }, cap),
      capFlagged: cap.flagged === true,
      retired: cap.retired ?? [],
    };
  });
  if (id) emitControlEvent('run.update', id);
  for (const r of retired) emitControlEvent('run.update', r);
  // A fresh flag committed a [humano] task — unscoped emit or Tasks stays stale.
  if (capFlagged) emitControlEvent('lead.change');
  return id;
}

// Flags leads already over the cap whose crossing no insert/finish will see (e.g. cap lowered
// below existing spend); emits lead.change for fresh flags.
export async function flagCappedLeads(sql: Sql, limit = 200): Promise<number> {
  const fresh: string[] = [];
  const excluded: string[] = [];
  // One committed tx per batch so xact-scoped capfin advisories release incrementally.
  // Scan only returns unflagged-at-this-cap leads, in fixed lead_id order so concurrent sweeps can't cross-lock.
  for (;;) {
    const batch = await controlTx(sql, async (tx) => {
      // Settings re-read per batch so a mid-sweep cap write is honored.
      const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
      const capUsd = g.leadLifetimeCostCapUsd ?? DEFAULT_GUARDRAILS.leadLifetimeCostCapUsd;
      const capCents = capCentsOf(g);
      if (capCents <= 0) return { flagged: [] as string[], done: true };
      const capped = await tx<{ lead_id: string }[]>`
        select x.lead_id
        from (
          select lead_id, sum(cost_cents) s from agent_runs
          where lead_id is not null and cost_cents > 0
          group by lead_id
        ) x
        where x.s >= ${capCents}
          and not exists (
            select 1 from lead_activities a
            where a.lead_id = x.lead_id and a.kind = 'system'
              and a.meta->>'type' = 'cost-cap'
              and (a.meta->>'capUsd')::numeric = ${capUsd}
          )
          and not (x.lead_id = any(${excluded}::uuid[]))
        order by x.lead_id
        limit ${limit}
      `;
      const flagged: string[] = [];
      for (const { lead_id } of capped) {
        const verdict = await leadUnderCostCapTx(tx, lead_id);
        if (verdict === 'flagged') flagged.push(lead_id);
        // 'under' = cap rose mid-sweep — exclude or a later batch re-selects it.
        if (verdict === 'under') excluded.push(lead_id);
      }
      return { flagged, done: capped.length < limit };
    });
    fresh.push(...batch.flagged);
    if (batch.done) break;
  }
  // Unscoped: the coalescer drops per-lead refs on bursts; one bare event refreshes all open cards.
  if (fresh.length) emitControlEvent('lead.change');
  return fresh.length;
}

// Set when a claim skipped a due row only because a lock was busy — the row is claimable
// a moment later, and nothing will notify about it, so the scheduler retries shortly.
let claimContended = false;
export function takeClaimContention(): boolean {
  const c = claimContended;
  claimContended = false;
  return c;
}

export async function claimRun(sql: Sql): Promise<RunRow | null> {
  const capFlagged: string[] = [];
  const run = await controlTx(sql, async (tx) => {
    // Staff/founder numbers never run (covers leads predating the list).
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const ignoredPhones = g.ignoredPhones ?? [];
    const ignoredDigits = ignoredPhones.map(phoneDigits).filter((d) => d.length >= 6);
    // Over-cap leads excluded in the scan itself so parked capped runs can't starve the 8-attempt loop.
    const capCents = capCentsOf(g);
    // Preset 'off' / a job switched off parks only automated rows; staff asks and promises stay
    // eligible. Claim order is priority (source) first — a customer waiting beats a brief.
    const { offJobs, autoOff } = await parkPolicyTx(tx);
    const rejected: string[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const cand = await tx<RunRow[]>`
        select r.id, r.kind, r.lead_id, r.thread_id, r.params, r.steps
        from agent_runs r
        where r.status = 'queued'
          and (r.run_at is null or r.run_at <= now())
          -- suppressed leads park 'queued' (pause semantics — they resume if the flag lifts)
          and (r.lead_id is null or exists (
            select 1 from leads l
            where l.id = r.lead_id
              and l.agent_mode <> 'off'
              and l.archived_at is null
              and l.unsubscribed_at is null
              and l.agent_paused_at is null
              -- ignored numbers park in the scan so rejected rows can't starve the 8-attempt loop
              and (l.whatsapp is null or
                regexp_replace(l.whatsapp, '\D', '', 'g') <> all(${ignoredDigits}::text[]))
              and (l.phone is null or
                regexp_replace(l.phone, '\D', '', 'g') <> all(${ignoredDigits}::text[]))
              -- cost cap in the scan itself: a capped lead parks until the ceiling moves
              and (${capCents} <= 0 or
                coalesce((select sum(x.cost_cents) from agent_runs x
                          where x.lead_id = l.id), 0) < ${capCents})
          ))
          -- staff-paused threads suppress the same way
          and (r.thread_id is null or exists (
            select 1 from lead_threads t
            where t.id = r.thread_id and t.agent_enabled
          ))
          -- outreach serial per lead: a running same-lead outreach excludes the candidate
          and (r.kind <> 'outreach' or r.lead_id is null or not exists (
            select 1 from agent_runs x
            where x.lead_id = r.lead_id and x.kind = 'outreach'
              and x.status = 'running'
          ))
          and not ((${autoOff} or r.kind = any(${offJobs}::text[]))
                   and r.source <> 'staff' and not r.promised)
          and not (r.id = any(${rejected}::uuid[]))
        order by r.priority, r.created_at
        limit 1
        for update skip locked
      `;
      const run = cand[0];
      if (!run) return null;
      // capfin first-lock rule (see capLockTx) — try-only, contention = about to be capped, so reject.
      // Also serializes the claim against ingestInbound's gate so the queued cancel always wins.
      if (run.lead_id) {
        const capFree = await tx<{ got: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtext(${'capfin:' + run.lead_id})) as got
        `;
        if (!capFree[0]!.got) {
          claimContended = true;
          rejected.push(run.id);
          continue;
        }
      }
      // Revalidations fail fast under a savepoint: contention = suppression writer wins, park instead
      // of waiting; the savepoint is load-bearing (a bare 55P03 would poison the claim tx).
      await tx`savepoint cand_check`;
      let lockLost = false;
      let lead:
        | {
            agent_mode: string;
            archived_at: string | null;
            unsubscribed_at: string | null;
            agent_paused_at: string | null;
            whatsapp: string | null;
            phone: string | null;
          }
        | undefined;
      try {
        // Revalidate thread/lead under row locks — a pause committed after the scan's snapshot must still hold.
        if (run.thread_id) {
          const enabled = await tx<{ agent_enabled: boolean }[]>`
            select agent_enabled from lead_threads where id = ${run.thread_id} for update nowait
          `;
          if (!enabled[0]?.agent_enabled) {
            rejected.push(run.id);
            continue;
          }
        }
        if (run.lead_id) {
          lead = (
            await tx<
              {
                agent_mode: string;
                archived_at: string | null;
                unsubscribed_at: string | null;
                agent_paused_at: string | null;
                whatsapp: string | null;
                phone: string | null;
              }[]
            >`
              select agent_mode, archived_at, unsubscribed_at, agent_paused_at, whatsapp, phone
              from leads where id = ${run.lead_id} for update nowait
            `
          )[0];
        }
      } catch (e) {
        if ((e as { code?: string }).code !== '55P03') throw e;
        await tx`rollback to savepoint cand_check`;
        lockLost = true;
      }
      if (lockLost) {
        claimContended = true;
        rejected.push(run.id);
        continue;
      }
      if (run.lead_id) {
        if (
          !lead ||
          lead.agent_mode === 'off' ||
          lead.archived_at ||
          lead.unsubscribed_at ||
          lead.agent_paused_at ||
          phoneIsIgnored(ignoredPhones, lead.whatsapp, lead.phone)
        ) {
          rejected.push(run.id);
          continue;
        }
        // Re-check the lifetime cap at claim — runs queued under budget must not sail past it.
        const capVerdict = await leadUnderCostCapTx(tx, run.lead_id);
        if (capVerdict !== 'under') {
          if (capVerdict === 'flagged') capFlagged.push(run.lead_id);
          rejected.push(run.id);
          continue;
        }
      }
      if (run.kind === 'outreach' && run.lead_id) {
        // Serialize concurrent same-lead claims under a try-advisory; 'running' re-checked under it.
        const got = await tx<{ got: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtext(${'claimrun:' + run.lead_id})) as got
        `;
        if (!got[0]!.got) {
          claimContended = true;
          rejected.push(run.id);
          continue;
        }
        const busy = await tx`
          select 1 from agent_runs
          where lead_id = ${run.lead_id} and kind = 'outreach'
            and status = 'running' and id <> ${run.id}
          limit 1
        `;
        if (busy.length) {
          rejected.push(run.id);
          continue;
        }
      }
      const rows = await tx<RunRow[]>`
        -- run_at re-checks atomically — the scan's due filter is a stale snapshot
        update agent_runs set status = 'running', started_at = now(), alive_at = now(),
          claim_token = gen_random_uuid()::text
        where id = ${run.id} and status = 'queued'
          and (run_at is null or run_at <= now())
        returning id, kind, lead_id, thread_id, params, claim_token, steps, attempts, max_attempts
      `;
      if (rows[0]) return rows[0];
      rejected.push(run.id);
    }
    return null;
  });
  if (run) emitControlEvent('run.update', run.id);
  // Claim-time refusals commit fresh flags in the same tx — refresh via unscoped lead.change.
  if (capFlagged.length) emitControlEvent('lead.change');
  return run;
}

// Re-pends consumed mail a dead/retired run can no longer answer. `deliveries` bounds respawns
// (poison mail); `event` retirements carry no failure signal so the bound lifts.
export async function releaseInboxTx(tx: Sql, runId: string, event?: boolean): Promise<void> {
  await tx`
    update agent_inbox i
    set consumed_at = null, consumed_by_run = null,
        payload = i.payload || jsonb_build_object(
          'deliveries', coalesce((i.payload->>'deliveries')::int, 0) + 1)
        || case when i.payload ? 'resumed' then '{}'::jsonb
            else jsonb_build_object(
              'text', coalesce(i.payload->>'text', '') ||
                ' — (reentregue: a run anterior foi interrompida — confira o histórico antes de agir de novo)',
              'resumed', true)
            end
    where i.consumed_by_run = ${runId}
      and (${event === true} or coalesce((i.payload->>'deliveries')::int, 0) < 2)
      -- a stamped answeredBy that is live or merely attempted means the mail was answered
      -- (at-most-once on uncertain outcomes) — never re-serve it
      and not exists (
        select 1 from lead_messages m
        where m.id::text = i.payload->>'answeredBy'
          and (
            m.status in ('queued', 'sending', 'sent', 'delivered')
            or m.dispatch_attempted_at is not null
          )
      )
  `;
}

async function finishRun(
  sql: Sql,
  run: { id: string; claimToken: string; leadId?: string | null },
  result: {
    status: 'done' | 'failed' | 'canceled';
    steps: unknown[];
    tokensIn: number;
    tokensOut: number;
    costCents: number;
    error?: string;
    /** 'done' is refused unless a listed message is still alive — the read rides the same capfin hold, so an inbound rejection serialized before it nudges instead of stranding a 'done' run on a dead draft. */
    liveMessageIds?: string[] | undefined;
  },
): Promise<{ matched: boolean; deadAction: boolean }> {
  const out = await controlTx(sql, async (tx) => {
    // capfin before the run-row update (first-lock rule, see capLockTx).
    if (run.leadId) await capLockTx(tx, run.leadId);
    const liveRows =
      result.status === 'done' && result.liveMessageIds?.length
        ? await tx<{ id: string }[]>`
          select id::text as id from lead_messages
          where id = any(${result.liveMessageIds}::uuid[])
            and status not in ('rejected', 'failed') limit 1
        `
        : null;
    const deadAction = liveRows !== null && liveRows.length === 0;
    const updated = deadAction
      ? []
      : await tx<{ id: string; lead_id: string | null; kind: RunRow['kind'] }[]>`
    update agent_runs set
      status = ${result.status},
      steps = ${tx.json(result.steps as never[])},
      tokens_in = ${result.tokensIn},
      tokens_out = ${result.tokensOut},
      cost_cents = ${result.costCents},
      error = ${result.error ?? null},
      finished_at = now()
    where id = ${run.id} and status = 'running' and claim_token = ${run.claimToken}
    returning id, lead_id, kind
    `;
    const r = updated[0];
    // Dual-write the journal into agent_run_steps in the same commit.
    if (r) await syncRunStepsTx(tx, run.id, result.steps);
    // Lead-bound failures flag the card with a '[humano]' task; board-scoped ones roll into the digest.
    if (r?.lead_id && result.status === 'failed') {
      // A dead run's consumed mail re-pends for the orphan sweep; 'done'/'canceled' keep theirs.
      await releaseInboxTx(tx, run.id);
      const name =
        (await tx<{ name: string }[]>`select name from leads where id = ${r.lead_id}`)[0]?.name ??
        r.lead_id;
      await tx`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${r.lead_id},
                ${`[humano] ${name}: run ${r.kind} falhou — ${(result.error ?? 'sem detalhe').slice(0, 200)}`.slice(0, 300)},
                null, 'agent')
      `;
    }
    // The crossing run is the only flag write covering "spent past the ceiling" (queued siblings never reach claim).
    const cap = r?.lead_id ? await leadUnderCostCapTx(tx, r.lead_id) : 'under';
    return { updated, cap, deadAction };
  });
  if (out.updated.length) {
    emitControlEvent('run.update', run.id);
    // Emit lead.change when the tx wrote a task (failure or fresh cap flag); fresh flags emit unscoped (burst coalescing).
    const r = out.updated[0];
    if (r?.lead_id && (result.status === 'failed' || out.cap === 'flagged'))
      emitControlEvent('lead.change', out.cap === 'flagged' ? undefined : r.lead_id);
  }
  return { matched: out.updated.length > 0, deadAction: out.deadAction };
}

export async function contextFor(
  sql: Sql,
  run: RunRow,
  /** the run's offered toolset — context lines only name tools it can call */
  has: (tool: string) => boolean = () => true,
): Promise<{ text: string; goal: AgentGoal; bookingUrl: string | null }> {
  const parts: string[] = [];
  let goal: AgentGoal = 'negotiation';
  let bookingUrl: string | null = null;
  if (run.lead_id) {
    const rows = await controlTx(
      sql,
      (tx) =>
        tx<
          { j: { agent_goal?: AgentGoal } & Record<string, unknown> }[]
        >`select row_to_json(l) as j from leads l where l.id = ${run.lead_id}`,
    );
    if (rows[0]) {
      parts.push(`LEAD: ${JSON.stringify(rows[0].j)}`);
      goal = rows[0].j.agent_goal === 'meeting' ? 'meeting' : 'negotiation';
      // params.goal overrides the lead's standing goal for a one-off run.
      if (run.params.goal === 'meeting' || run.params.goal === 'negotiation') {
        goal = run.params.goal;
      }
      if (run.kind === 'triage' || run.kind === 'reply' || run.kind === 'outreach') {
        parts.push(`GOAL: ${goal}`);
        // Who spoke first decides whether "what do you sell?" is allowed: fine when the
        // lead came to us, amateur on a cold approach. Only what reached the wire counts —
        // not drafts, not queued sends, not manual-thread notes.
        const first = (
          await controlTx(
            sql,
            (tx) => tx<{ direction: 'in' | 'out' }[]>`
              select m.direction from lead_messages m
              join lead_threads t on t.id = m.thread_id
              where t.lead_id = ${run.lead_id} and t.channel <> 'manual'
                and (m.direction = 'in' or m.status in ('sending', 'sent', 'delivered'))
              order by m.created_at, m.id limit 1
            `,
          )
        )[0];
        parts.push(
          first?.direction === 'in'
            ? 'ORIGEM: inbound — o lead nos procurou primeiro'
            : 'ORIGEM: outbound — nós abordamos primeiro (ou ainda não houve conversa)',
        );
        const plan = rows[0].j.agent_plan;
        if (Array.isArray(plan) && plan.length) {
          parts.push(`PLANO: ${JSON.stringify(plan)}`);
        }
        // Durable key/value lead facts (memory v2); pre-0035 schemas have no table — omit, don't fail.
        const facts = await controlTx(sql, async (tx) =>
          (await hasMemoryTablesTx(tx))
            ? leadFactsTx(tx, run.lead_id!, { limit: 50, order: 'recent' })
            : [],
        );
        if (facts.length) {
          parts.push(
            `FATOS (memória estruturada do lead${has('set_fact') ? ' — set_fact atualiza' : ''}):\n${facts
              .map(
                (f) =>
                  `- ${f.key}: ${f.value}${f.confidence < 1 ? ` (confiança ${f.confidence})` : ''}`,
              )
              .join('\n')}`,
          );
        }
        const dossier = await controlTx(
          sql,
          (tx) => tx<{ kind: string; body: string | null }[]>`
            select kind, body from lead_activities
            where lead_id = ${run.lead_id!} and kind = 'note'
            order by at desc limit 6
          `,
        );
        if (dossier.length) {
          parts.push(
            `DOSSIÊ (notes + research, newest first):\n${dossier
              .map((a) => `- ${(a.body ?? '').slice(0, 800)}`)
              .join('\n')}`,
          );
        }
        if (goal === 'meeting') {
          const meeting = await getSetting<{ bookingUrl?: string }>(sql, 'meeting', {});
          // CRM-native token link; stored bookingUrl is the fallback.
          try {
            bookingUrl =
              (await bookingLinkForRunner(sql, run.lead_id!)) ?? meeting.bookingUrl ?? null;
          } catch (e) {
            agentLog.warn({ err: e }, 'booking link mint failed — falling back to setting');
            bookingUrl = meeting.bookingUrl ?? null;
          }
          parts.push(`BOOKING_URL: ${bookingUrl ?? '(não configurado)'}`);
        }
        // Reachable-channel truth — never compose on a channel the lead can't be reached on.
        const avail = await controlTx(sql, (tx) => channelAvailabilityTx(tx, run.lead_id!));
        const chanLine = SEND_CHANNELS.map(
          (ch) => `${ch} ${avail[ch].ok ? 'ok' : `indisponível (${avail[ch].reason})`}`,
        ).join(' · ');
        parts.push(`CANAIS: ${chanLine}`);
        const want = run.params.channel;
        if (isSendChannel(want)) {
          parts.push(`CANAL FORÇADO: ${want}`);
        }
        if (run.params.draftOnly === true) {
          parts.push(
            `MODO ASSISTÊNCIA: staff pediu uma sugestão — ${has('send_message') ? 'send_message compõe' : 'draft_message compõe o'} rascunho, nada sai sem aprovação da equipe.`,
          );
        }
      }
    }
  }
  if (run.thread_id) {
    // Items inside their quiet period stay out of context — else the model reads them off the thread and replies before notBefore.
    const rows = await controlTx(
      sql,
      (tx) => tx`
        select jsonb_build_object(
          'thread', row_to_json(t),
          'messages', (
            select coalesce(jsonb_agg(m order by m.created_at), '[]'::jsonb)
            from (select direction, body, status, author, created_at
                  from lead_messages where thread_id = ${run.thread_id}
                    and id::text not in (
                      select i.payload->>'messageId' from agent_inbox i
                      where i.consumed_at is null and i.payload->>'messageId' is not null
                        and (i.payload->>'notBefore')::timestamptz > now()
                    )
                  order by created_at desc limit 12) m
          )
        ) as j
        from lead_threads t where t.id = ${run.thread_id}
      `,
    );
    if (rows[0]) parts.push(`THREAD: ${JSON.stringify(rows[0].j)}`);
  }
  if (run.kind === 'outreach' && run.params.focus) {
    parts.push(`FOCUS: ${String(run.params.focus)}`);
  }
  if (run.lead_id && run.kind !== 'discovery') {
    const wakeups = await controlTx(sql, (tx) => pendingWakeupsTx(tx, run.lead_id!));
    parts.push(
      `AGENDA (seus retornos agendados${has('schedule') ? ' — use schedule para remarcar' : ''}):\n${
        wakeups.length
          ? wakeups
              .map((w) => `- ${w.at}: ${w.focus}${w.requested ? ' (pedido pelo lead)' : ''}`)
              .join('\n')
          : '(nenhum)'
      }`,
    );
  }
  if (run.kind === 'discovery' && run.params.query) {
    parts.push(`DISCOVERY QUERY: ${String(run.params.query)}`);
    if (run.params.segment) parts.push(`SEGMENT: ${String(run.params.segment)}`);
    if (run.params.city) parts.push(`CITY: ${String(run.params.city)}`);
    // params.target is the caller-chosen lead goal (create_lead enforces it as ctx.leadCap).
    const target = Number(run.params.target);
    if (Number.isFinite(target) && target > 0) {
      parts.push(`META: criar até ${Math.floor(target)} leads`);
    }
    if (run.params.briefName) {
      parts.push(`BRIEF: ${String(run.params.briefName)}`);
    }
    // Learning loop: lean toward segments that reply.
    const stats = await segmentStats(sql);
    if (stats.length) {
      parts.push(
        `SEGMENTOS (leads · responderam · ativos · custo):\n${stats
          .map(
            (s) =>
              `- ${s.segment}: ${s.leads} leads · ${s.replied} responderam · ${s.live} ativos · US$${(s.costCents / 100).toFixed(2)}`,
          )
          .join('\n')}`,
      );
    }
  }
  if (run.kind === 'strategist') {
    // The weekly review reads what converts plus every current brief.
    const stats = await segmentStats(sql);
    if (stats.length) {
      parts.push(
        `SEGMENTOS (leads · responderam · ativos · custo):\n${stats
          .map(
            (s) =>
              `- ${s.segment}: ${s.leads} leads · ${s.replied} responderam · ${s.live} ativos · US$${(s.costCents / 100).toFixed(2)}`,
          )
          .join('\n')}`,
      );
    }
    const briefs = await controlTx(
      sql,
      (tx) =>
        tx<
          {
            name: string;
            query: string;
            segment: string | null;
            city: string | null;
            target: number | null;
            enabled: boolean;
            created_by: string;
          }[]
        >`select name, query, segment, city, target, enabled, created_by
           from discovery_briefs order by created_at desc`,
    );
    // One full signature line per brief — name/query/segment/city are the overlap fields, none truncated.
    const BRIEFS_BUDGET = 12_000;
    let budget = BRIEFS_BUDGET;
    const lines: string[] = [];
    let hidden = 0;
    for (const b of briefs) {
      const line = `- ${b.name} — "${b.query}"${b.segment ? ` · ${b.segment}` : ''}${b.city ? ` · ${b.city}` : ''}${b.target ? ` · ≤${b.target}` : ''} · ${b.enabled ? 'ativo' : b.created_by === 'strategist' ? 'rascunho (já proposto)' : 'pausado'}`;
      if (budget - line.length - 1 < 0) {
        hidden++;
        continue;
      }
      lines.push(line);
      budget -= line.length + 1;
    }
    parts.push(
      `BRIEFS ATUAIS (não re-proponha o que já existe):\n${
        lines.length ? lines.join('\n') : '(nenhum)'
      }${hidden ? `\n+${hidden} mais antigos além do orçamento de contexto` : ''}`,
    );
  }
  return { text: parts.join('\n\n') || '(no extra context)', goal, bookingUrl };
}

// Journal mining — queries/urls fired this run, for the reflection tick and finish nudge.
function mineAttempts(steps: unknown[]): { queries: Set<string>; urls: Set<string> } {
  const queries = new Set<string>();
  const urls = new Set<string>();
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const st = s as {
      name?: string;
      args?: Record<string, unknown>;
      out?: { pages?: { url?: string }[] };
    };
    if ((st.name === 'web_search' || st.name === 'serp') && typeof st.args?.query === 'string')
      queries.add(st.args.query);
    if (st.name === 'read_pages') {
      const seen = [
        ...(Array.isArray(st.args?.urls) ? st.args.urls : []),
        ...(st.out?.pages ?? []).map((p) => p.url),
      ];
      for (const u of seen) {
        try {
          const uu = new URL(String(u));
          urls.add(`${uu.hostname}${uu.pathname}`.replace(/\/+$/, ''));
        } catch {
          urls.add(String(u));
        }
      }
    }
  }
  return { queries, urls };
}

// True once the journal holds a landed action call (non-errored, non-blocked, non-ignored).
function runActed(steps: unknown[]): boolean {
  return steps.some((s) => {
    if (typeof s !== 'object' || s === null) return false;
    const st = s as { type?: string; name?: string; out?: unknown };
    if (st.type !== 'tool' || !st.name || !ACTION_TOOLS.has(st.name)) return false;
    const out = st.out as { error?: unknown; blocked?: unknown; ignored?: unknown } | null;
    return (
      typeof out === 'object' &&
      out !== null &&
      !out.error &&
      out.blocked !== true &&
      out.ignored !== true
    );
  });
}

// Message ids a slice's actions minted; 'done' is refused if all are dead (an inbound rejection
// can commit under a journal-side read — the liveness read rides finishRun's capfin hold).
// onlyMessages = the slice minted ONLY messages; non-message actions are live unconditionally.
function actedMessageIds(steps: unknown[]): { ids: string[]; onlyMessages: boolean } {
  const ids: string[] = [];
  let onlyMessages = true;
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const st = s as { type?: string; name?: string; out?: unknown };
    if (st.type !== 'tool' || !st.name || !ACTION_TOOLS.has(st.name)) continue;
    const out = st.out as {
      error?: unknown;
      blocked?: unknown;
      ignored?: unknown;
      message?: { id?: unknown };
      messageId?: unknown;
    } | null;
    if (typeof out !== 'object' || out === null) continue;
    if (out.error || out.blocked === true || out.ignored === true) continue;
    const mid =
      typeof out.message?.id === 'string'
        ? out.message.id
        : typeof out.messageId === 'string'
          ? out.messageId
          : null;
    if (mid) ids.push(mid);
    else onlyMessages = false;
  }
  return { ids, onlyMessages };
}

// Cap on replayed tool-result chars — the outcome, not the full page dump.
const REPLAY_OUT_MAX = 3000;

export interface JournalReplay {
  /** Model turns across ALL prior attempts — seeds ctx.step so idempotency keys stay unique. */
  baseStep: number;
  /** Most recent attempt's turns (entries after the last 'resumed' marker). */
  messages: AgentMessage[];
  /** Prior attempts' prospect ledger + banked contacts. */
  book: Map<string, BookEntry>;
  seenContacts: Set<string>;
  /** Latest discovery plan — lives only in ctx; survives a crash only via the journal. */
  plan: string | null;
  /** read_pages spend carries over — the cap is per RUN, not per attempt. */
  pageReads: number;
  /** Pages already fetched — a reread hits the rebuilt cache instead of spending twice. */
  pageCache: Map<string, Promise<unknown>>;
  /** Sigs of artifact-minting calls the journal proves landed — a re-emit would mint a second row. */
  landedSigs: Set<string>;
}

// Replay a reclaimed run's journal into conversation + harness state so it doesn't redo work or
// double-contact. Entries land verbatim (toolCalls + thoughtSignatures); crashed pending calls close with an interrupted marker.
export function replayJournal(prior: unknown[], claimsUnverified = false): JournalReplay {
  const replay: JournalReplay = {
    baseStep: 0,
    messages: [],
    book: new Map(),
    seenContacts: new Set(),
    plan: null,
    pageReads: 0,
    pageCache: new Map(),
    landedSigs: new Set(),
  };
  for (const s of prior) {
    if ((s as { type?: string } | null)?.type === 'model') replay.baseStep++;
  }
  const bank = (vals: unknown[]) => {
    for (const v of vals) {
      if (typeof v === 'string' && v) replay.seenContacts.add(v);
    }
  };
  // Every contact-bearing tool output shape — mirrors what live tools push through ctx.seenContacts.
  const bankOut = (out: unknown) => {
    if (typeof out !== 'object' || out === null) return;
    const o = out as {
      entry?: BookEntry;
      foundContacts?: { phones?: string[]; whatsappLinks?: string[]; emails?: string[] };
      candidates?: { phone?: string | null }[];
      results?: {
        contacts?: { phones?: string[]; whatsappLinks?: string[]; emails?: string[] };
      }[];
    };
    const e = o.entry;
    if (e && typeof e.name === 'string') {
      replay.book.set(e.name.toLowerCase(), e);
      bank(Object.values(e.channels ?? {}));
    }
    if (o.foundContacts) {
      bank([
        ...(o.foundContacts.phones ?? []),
        ...(o.foundContacts.whatsappLinks ?? []),
        ...(o.foundContacts.emails ?? []),
      ]);
    }
    for (const c of o.candidates ?? []) bank([c.phone]);
    for (const r of o.results ?? []) {
      if (r?.contacts) {
        bank([
          ...(r.contacts.phones ?? []),
          ...(r.contacts.whatsappLinks ?? []),
          ...(r.contacts.emails ?? []),
        ]);
      }
    }
  };
  // Harness scans the WHOLE journal — ledger and banked contacts accumulate across attempts.
  for (const s of prior) {
    const t = s as {
      type?: string;
      name?: string;
      args?: unknown;
      out?: unknown;
    } | null;
    if (t?.type !== 'tool') continue;
    bankOut(t.out);
    if (NON_IDEMPOTENT.has(t.name ?? '')) {
      // Clean result = landed; errored/blocked/ignored stay retryable. claimsUnverified →
      // suppress out-less entries (they may have committed — better than a duplicate row).
      const o = t.out as { error?: unknown; blocked?: unknown; ignored?: unknown } | null;
      if (
        o === undefined
          ? claimsUnverified
          : typeof o === 'object' &&
            o !== null &&
            !o.error &&
            o.blocked !== true &&
            o.ignored !== true
      ) {
        replay.landedSigs.add(JSON.stringify([t.name, t.args ?? {}]));
      }
    }
    if (t.name === 'read_pages') {
      // readSpent marker is authoritative (cap prices fetches, not calls). Markerless = legacy
      // journal: reserve one conservatively, except pre-check rejections that never fetched.
      const spent = (t as { readSpent?: number | boolean }).readSpent;
      if (typeof spent === 'number') {
        replay.pageReads += spent;
      } else if (spent === true) {
        replay.pageReads++;
      } else if (spent === undefined) {
        const e = (t.out as { error?: unknown } | null)?.error;
        const preCheck =
          typeof e === 'string' &&
          (e.startsWith('REPEAT') || e.startsWith('read_pages needs urls'));
        if (!preCheck) replay.pageReads++;
      }
      // Re-bank pages under request + final url so a reread hits the rebuilt cache.
      const ro = t.out as { pages?: { url?: unknown; finalUrl?: unknown }[] } | null;
      for (const pg of ro?.pages ?? []) {
        const rec = Promise.resolve({ page: pg });
        for (const u of [pg.url, pg.finalUrl]) {
          const k = typeof u === 'string' ? pageKey(u) : null;
          if (k && !replay.pageCache.has(k)) replay.pageCache.set(k, rec);
        }
      }
    }
    const p = t.out as { stored?: boolean; plan?: unknown } | null;
    // Last stored plan wins, including empty — a cleared plan must clear.
    if (t.name === 'plan' && p?.stored === true && typeof p.plan === 'string') {
      replay.plan = p.plan;
    }
  }
  // Replay only the last 'resumed' attempt that reached the model; a marker with no model
  // after it died pre-chat — keep walking back to one that did work.
  let start = 0;
  for (let i = prior.length - 1; i >= 0; i--) {
    if ((prior[i] as { type?: string } | null)?.type !== 'resumed') continue;
    let substantive = false;
    for (let j = i + 1; j < prior.length; j++) {
      if ((prior[j] as { type?: string } | null)?.type === 'model') {
        substantive = true;
        break;
      }
      if ((prior[j] as { type?: string } | null)?.type === 'resumed') break;
    }
    if (substantive) {
      start = i + 1;
      break;
    }
  }
  // Calls the last model turn announced that lack a result — each flushes as 'interrupted'.
  let pending: ToolCall[] | null = null;
  let consumed = 0;
  const flush = () => {
    if (!pending) return;
    for (let i = consumed; i < pending.length; i++) {
      replay.messages.push({
        role: 'tool',
        toolCallId: pending[i]!.id,
        name: pending[i]!.name,
        content: JSON.stringify({
          interrupted: true,
          error: 'attempt died before this call returned — outcome unknown, verify before re-doing',
        }),
      });
    }
    pending = null;
    consumed = 0;
  };
  for (let i = start; i < prior.length; i++) {
    const s = prior[i] as {
      type?: string;
      name?: string;
      args?: Record<string, unknown>;
      out?: unknown;
      content?: string;
      // legacy entries ship names-only; current carry full ToolCall (id + thoughtSignature)
      toolCalls?: (string | ToolCall)[];
      pending?: boolean;
    } | null;
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'model') {
      flush();
      const calls = (s.toolCalls ?? []).map((c, j): ToolCall =>
        typeof c === 'string'
          ? { id: `replayed-${replay.baseStep}-${i}-${j}`, name: c, args: {} }
          : {
              id: c.id,
              name: c.name,
              args: c.args ?? {},
              ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
            },
      );
      pending = calls.length ? calls : null;
      consumed = 0;
      replay.messages.push({
        role: 'assistant',
        content: s.content ?? '',
        ...(calls.length ? { toolCalls: calls } : {}),
      });
      continue;
    }
    if (s.type === 'tool') {
      const call = pending ? pending[consumed] : undefined;
      if (call && call.name === s.name) call.args = s.args ?? {};
      consumed++;
      const out =
        s.pending || s.out === undefined
          ? {
              interrupted: true,
              error:
                'attempt died before this call returned — outcome unknown, verify before re-doing',
            }
          : s.out;
      replay.messages.push({
        role: 'tool',
        toolCallId: call?.id ?? `replayed-${replay.baseStep}-${i}-x${consumed}`,
        name: s.name ?? '?',
        content:
          typeof out === 'string'
            ? out.slice(0, REPLAY_OUT_MAX)
            : JSON.stringify(out).slice(0, REPLAY_OUT_MAX),
      });
      continue;
    }
    if (
      s.type === 'nudge' ||
      s.type === 'reflection' ||
      s.type === 'inbox' ||
      s.type === 'contact'
    ) {
      flush();
      replay.messages.push({ role: 'user', content: s.content ?? '' });
      continue;
    }
    // 'system_prompt' / 'monid_spend' / 'resumed' — handled elsewhere.
  }
  flush();
  return replay;
}

// Resolve journaled-but-pending tool calls against the claim table — a worker dying between
// the mutation's commit and the result's journal left a real applied effect marked pending.
export async function reconcileInterrupted(
  sql: Sql,
  runId: string,
  steps: unknown[],
): Promise<void> {
  const pending = steps.filter(
    (
      s,
    ): s is {
      type: 'tool';
      name: string;
      callId: string;
      step: number;
      pending?: boolean;
      out?: unknown;
    } => {
      const e = s as {
        type?: string;
        callId?: unknown;
        step?: unknown;
        pending?: unknown;
        out?: unknown;
      } | null;
      return (
        e?.type === 'tool' &&
        typeof e.callId === 'string' &&
        typeof e.step === 'number' &&
        (e.pending === true || e.out === undefined)
      );
    },
  );
  if (!pending.length) return;
  const keyOf = (p: (typeof pending)[number]) => `agent:${runId}:${p.step}:${p.name}:${p.callId}`;
  const rows = await controlTx(
    sql,
    (tx) => tx<{ key: string; response: unknown }[]>`
      select key, response from control_idempotency_keys
      where key = any(${pending.map(keyOf)})
    `,
  );
  const byKey = new Map(rows.map((r) => [r.key, r.response]));
  for (const p of pending) {
    const res = byKey.get(keyOf(p));
    if (res !== undefined) {
      delete p.pending;
      p.out = res;
    }
  }
}

// Memory feed: pinned + segment + workspace learnings + debriefs; legacy flat list only for pre-0035 schemas.
export async function memoryForPrompt(sql: Sql, run: RunRow): Promise<string[]> {
  return controlTx(sql, async (tx) => {
    if (await hasMemoryTablesTx(tx)) {
      const segment =
        typeof run.params.segment === 'string' && run.params.segment
          ? run.params.segment
          : run.lead_id
            ? ((
                await tx<{ segment: string | null }[]>`
                  select segment from leads where id = ${run.lead_id}
                `
              )[0]?.segment ?? null)
            : null;
      return memoryForRunTx(tx, { segment });
    }
    const rows = await tx<{ value: { facts?: unknown } }[]>`
      select value from control_settings where key = 'agent_memory'
    `;
    const cur = rows[0]?.value?.facts;
    return Array.isArray(cur) ? (cur as string[]) : [];
  });
}

// Deterministic debrief line stored as scope='debrief' memory on a finished run — next runs' feed includes it.
export async function writeDebrief(
  sql: Sql,
  run: RunRow,
  ctx: ToolContext,
  steps: unknown[],
): Promise<void> {
  let leads = 0;
  let merges = 0;
  let withWa = 0;
  const resolvers = new Set<string>();
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const st = s as { name?: string; out?: Record<string, unknown> | null };
    const out = st.out;
    if (!out) continue;
    if (st.name === 'create_lead') {
      if (out.lead) {
        leads++;
        if (typeof (out.lead as { whatsapp?: string }).whatsapp === 'string') withWa++;
      } else if (out.duplicate) merges++;
    }
    const fc = out.foundContacts as { phones?: string[]; whatsappLinks?: string[] } | undefined;
    if (st.name && (fc?.phones?.length || fc?.whatsappLinks?.length)) resolvers.add(st.name);
    if ((out.candidates as { phone?: string | null }[] | undefined)?.some((c) => c.phone))
      resolvers.add(st.name!);
  }
  const dead = [...ctx.book.values()].filter((e) => e.status === 'dead').map((e) => e.name);
  if (!leads && !merges && !dead.length) return;
  const seg = String(run.params.query ?? run.params.briefName ?? 'discovery').slice(0, 60);
  const city = String(run.params.city ?? '').slice(0, 40);
  const fact =
    `run ${seg}${city ? `/${city}` : ''}: ${leads} leads (${withWa} c/ whatsapp)` +
    `${merges ? `, ${merges} merges` : ''}` +
    `${resolvers.size ? `; canais via ${[...resolvers].join('+')}` : ''}` +
    `${dead.length ? `; beco sem saída: ${dead.slice(0, 4).join(', ')}` : ''}` +
    `${ctx.monid?.spent ? `; monid $${ctx.monid.spent.toFixed(3)}` : ''}`;
  // debriefs are their own capped scope post-0035 (they no longer evict learnings);
  // a pre-0035 schema has no sink — skip. Never throws: warn so a broken write isn't silent.
  await controlTx(sql, async (tx) => {
    if (!(await hasMemoryTablesTx(tx))) return;
    await appendDebriefTx(tx, {
      content: fact.slice(0, 500),
      sourceRunId: run.id,
      segment: typeof run.params.segment === 'string' ? run.params.segment : null,
    });
  }).catch((e) => agentLog.warn({ err: e, runId: run.id }, 'debrief write failed'));
}

interface Attempt {
  sql: Sql;
  run: RunRow;
  claim: { id: string; claimToken: string; leadId: string | null };
  /** reconcileInterrupted ran — false leaves pending artifact-mints replayed conservatively. */
  claimsChecked: boolean;
  /** The row's journal at claim time — a prefix of `steps`. */
  priorSteps: unknown[];
  /** whole trajectory across attempts (the audit trail) */
  steps: unknown[];
  messages: AgentMessage[];
  /** row no longer owned by this execution — the loop unwinds at the next boundary */
  lost: boolean;
  /** serializes journal writes — see persist */
  tail: Promise<void>;
  /** agent_run_steps cursors: entries committed / earliest pending seq (re-writes until `out` lands) */
  synced: number;
  dirtyFrom: number;
  /** cost accounting: prior attempts folded in (finishRun overwrites wholesale) + this attempt's deltas */
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  monidBudget: MonidBudget;
  job: JobDef;
  heartbeat: ReturnType<typeof setInterval>;
  /** context build — provider/prompt plus the journal-replayed harness */
  replay: JournalReplay;
  ctx: ToolContext;
  provider: LlmProvider;
  system: string;
  tools: AgentTool[];
  /** Job kinds this attempt may serve — drainInbox adds a drained item's requestedKind. */
  toolKinds: Set<string>;
  /** what this install can run — unconfigured tools hidden from every kind this attempt serves */
  gate: ToolGate;
  /** gate + this turn's lead reachability (send/draft) — what att.tools is built from */
  liveGate: ToolGate;
  /** last contact state announced to the model; unset = open (what the prompt assumes) */
  contactState?: string;
  /** kernel-loop state — res is the current chat() result */
  i: number;
  res: LlmResult;
  nudged: boolean;
  /** steps index of the latest drained action-mail batch; -1 = none */
  actionInboxIdx: number;
  /** action-mail nudge budget, independent of `nudged`; resets per drained batch */
  actionNudged: boolean;
  limit: number;
  lastProgress: number;
  loopNudged: boolean;
  prevSigs: Map<string, { ok: boolean; v: number }>;
  landedSigs: Set<string>;
  stateVersion: number;
}

// Non-terminal tool entries — the row re-writes until `out` lands.
const pendingToolEntry = (e: unknown): boolean => {
  const s = e as { type?: string; pending?: boolean; out?: unknown } | null;
  return s?.type === 'tool' && (s.pending === true || s.out === undefined);
};

// Dual-write the journal into agent_run_steps in the same commit — the stores can't diverge
// mid-crash. seq = index in the snapshot; pending→out upserts via on conflict; `from` skips the terminal prefix.
async function syncRunStepsTx(
  tx: Sql,
  runId: string,
  snapshot: unknown[],
  from = 0,
): Promise<void> {
  const rows = snapshot.slice(from).map((e, j) => {
    const s = (e ?? {}) as {
      type?: string;
      name?: string;
      callId?: string;
      step?: number;
      args?: unknown;
      out?: unknown;
      usage?: { costUsd?: number };
    };
    // Monetary cost only — only model usage carries real USD.
    const costUsd = s.type === 'model' ? s.usage?.costUsd : undefined;
    return {
      step: typeof s.step === 'number' ? s.step : null,
      seq: from + j,
      kind: s.type ?? 'unknown',
      name: s.name ?? null,
      call_id: s.callId ?? null,
      args: s.args ?? null,
      out: s.out ?? null,
      cost_cents: typeof costUsd === 'number' ? Math.round(costUsd * 100) : null,
    };
  });
  if (!rows.length) return;
  // Drop stale rows past the committed length — a mid-batch spend marker can commit a shorter snapshot.
  await tx`
    delete from agent_run_steps where run_id = ${runId} and seq >= ${snapshot.length}
  `;
  const keyed = rows.filter((r) => r.call_id !== null && r.step !== null);
  if (keyed.length) {
    await tx`
      delete from agent_run_steps s
      using (
        select distinct t.step, t.call_id, t.seq
        from jsonb_to_recordset(${tx.json(keyed as never)}) as t(step int, call_id text, seq int)
      ) n
      where s.run_id = ${runId} and s.step = n.step and s.call_id = n.call_id
        and s.seq <> n.seq
    `;
  }
  await tx`
    insert into agent_run_steps (run_id, step, seq, kind, name, call_id, args, out, cost_cents)
    select ${runId}::uuid, t.step, t.seq, t.kind, t.name, t.call_id, t.args, t.out, t.cost_cents
    from jsonb_to_recordset(${tx.json(rows as never)}) as t(
      step int, seq int, kind text, name text, call_id text, args jsonb, out jsonb, cost_cents int
    )
    on conflict (run_id, seq) do update set
      step = excluded.step, kind = excluded.kind, name = excluded.name,
      call_id = excluded.call_id, args = excluded.args, out = excluded.out,
      cost_cents = excluded.cost_cents
  `;
}

// Streaming journal: every write commits steps-so-far + refreshes alive_at (the reclaim lease),
// fenced by claim_token and serialized on `tail` so a delayed write never re-commits older state.
function persist(att: Attempt, extra: unknown[] = [], consumeInbox: string[] = []): Promise<void> {
  const p = att.tail.then(async () => {
    if (att.lost) return;
    const snap = [...att.steps, ...extra];
    const rows = await controlTx(att.sql, async (tx) => {
      const r = await tx`
        update agent_runs set alive_at = now(), steps = ${tx.json(snap as never[])}
        where id = ${att.run.id} and status = 'running' and claim_token = ${att.run.claim_token}
        returning id
      `;
      if (r.length) {
        // Stamp consumption inside THIS fenced commit so rendered = journaled.
        if (consumeInbox.length) {
          await tx`
            update agent_inbox set consumed_by_run = ${att.run.id}, consumed_at = now()
            where id = any(${consumeInbox}::uuid[]) and consumed_at is null
          `;
        }
        await syncRunStepsTx(tx, att.run.id, snap, Math.min(att.dirtyFrom, att.synced));
      }
      return r;
    });
    if (!rows.length) {
      att.lost = true;
      return;
    }
    const first = snap.findIndex(pendingToolEntry);
    att.dirtyFrom = first === -1 ? snap.length : first;
    att.synced = snap.length;
    emitControlEvent('run.update', att.run.id);
  });
  att.tail = p.catch(() => undefined);
  return p;
}

// Journal write for an aborted run — keeps the trajectory as audit trail, fenced by claim_token.
async function persistAborted(att: Attempt): Promise<void> {
  await att.tail.catch(() => undefined);
  const cap = await controlTx(att.sql, async (tx) => {
    // capfin first-lock ordering (see capLockTx).
    if (att.run.lead_id) await capLockTx(tx, att.run.lead_id);
    const rows = await tx<{ id: string }[]>`
      update agent_runs set steps = ${tx.json(att.steps as never[])}, finished_at = now(),
        tokens_in = ${att.tokensIn}, tokens_out = ${att.tokensOut},
        cost_cents = ${Math.round((att.costUsd + att.monidBudget.spent) * 100)}
      where id = ${att.run.id} and status = 'canceled' and claim_token = ${att.run.claim_token}
      returning id
    `;
    if (rows.length) await syncRunStepsTx(tx, att.run.id, att.steps);
    // The persisted spend can itself push the lead over the cap.
    if (!rows.length || !att.run.lead_id) return 'under' as CapVerdict;
    return leadUnderCostCapTx(tx, att.run.lead_id);
  }).catch((): CapVerdict => 'under');
  emitControlEvent('run.update', att.run.id);
  if (cap === 'flagged') emitControlEvent('lead.change');
}

// Drain the lead's mailbox: pending items become one 'inbox' entry + user message, stamped
// consumed in the same fenced commit that journals them.
async function drainInbox(att: Attempt): Promise<number> {
  if (att.lost || !att.run.lead_id) return 0;
  // Draft-only mail rides only draft-only runs and vice-versa — a mismatch either ships
  // unreviewed or strands a reply as an unapproved draft.
  const runDraftOnly = (att.run.params as { draftOnly?: unknown } | null)?.draftOnly === true;
  // Channel-pinned mail defers to a run pinned the same way; a thread-bound run speaks its thread's channel.
  const runChannel = isSendChannel(att.run.params?.channel) ? att.run.params.channel : '';
  // A thread pin is a channel pin: both sides derive effective channel from their thread;
  // an unbound unpinned run can't take thread-bound mail (the derived channels would mismatch).
  const runThread = att.run.thread_id ?? '';
  // Quiet-period mail (notBefore) doesn't drain mid-flight; consumption is fenced inside
  // persist, so this read-only select can never swallow mail.
  const items = await controlTx(att.sql, async (tx) => {
    const effChannel =
      runChannel ||
      (runThread
        ? ((
            await tx<{ c: string }[]>`
            select channel::text as c from lead_threads where id = ${runThread}::uuid
          `
          )[0]?.c ?? '')
        : '');
    const scope = tx`
      lead_id = ${att.run.lead_id!} and consumed_at is null
        and (coalesce(payload->'params'->>'draftOnly', 'false') = 'true') = ${runDraftOnly}
        and coalesce(
              payload->'params'->>'channel',
              (select lt.channel::text from lead_threads lt where lt.id::text = payload->>'threadId'),
              ${effChannel}
            ) = ${effChannel}
        and (${runThread} = '' or coalesce(payload->>'threadId', ${runThread}) = ${runThread})
        and (payload->>'notBefore' is null or (payload->>'notBefore')::timestamptz <= now())
    `;
    // Same recheck for threads staff paused after the item enqueued.
    const dead = (
      await tx<{ t: string }[]>`
        select distinct payload->>'threadId' as t from agent_inbox
        where ${scope} and payload->>'threadId' is not null
          and payload->>'threadId' in (
            select id::text from lead_threads where not agent_enabled
          )
      `
    ).map((d) => d.t);
    // Same gate as the spawn: automation-marked mail parks under preset 'off' or its job off.
    const { autoOff, offJobs } = await parkPolicyTx(tx);
    return tx<InboxItem[]>`
      select id, kind, payload, created_at, source, promised from agent_inbox
      where ${scope}
        and (payload->>'threadId' is null or not (payload->>'threadId' = any(${dead})))
        and not ((${autoOff} or coalesce(payload->>'requestedKind', '') = any(${offJobs}::text[]))
                 and source <> 'staff' and not promised)
      order by created_at limit 10
    `;
  });
  if (!items.length) return 0;
  // New batch = new state: re-arm send_message's sig (its dedupe keys the newest consumption stamp)
  // so a legitimate repeat reply isn't blocked; 'mint' sigs keep run-wide suppression.
  att.stateVersion++;
  // Each batch gets its own finish-gate nudge budget.
  att.nudged = false;
  att.actionNudged = false;
  for (const s of att.landedSigs) {
    if (s.startsWith('["send_message",')) att.landedSigs.delete(s);
  }
  // A drained item's requestedKind widens both att.tools and ctx.toolKinds (same set instance).
  for (const i of items) {
    const k = i.payload?.requestedKind;
    if (k) att.toolKinds.add(k);
  }
  widenAttemptTools(att);
  const content = renderInboxItems(items);
  // Action-mail batches get their own finish-gate bar — journaled so a reclaim re-seeds it.
  const needsAction = items.some((i) => {
    const k = i.payload?.requestedKind;
    return (
      typeof k === 'string' &&
      (JOBS as Record<string, { requiresAction?: boolean }>)[k]?.requiresAction === true
    );
  });
  att.steps.push({
    type: 'inbox',
    items: items.map((i) => ({ id: i.id, kind: i.kind })),
    ...(needsAction ? { needsAction: true } : {}),
    content,
  });
  if (needsAction) att.actionInboxIdx = att.steps.length - 1;
  att.messages.push({ role: 'user', content });
  await persist(
    att,
    [],
    items.map((i) => i.id),
  );
  return items.length;
}

const attHas = (att: Attempt, name: string): boolean => att.tools.some((t) => t.name === name);

// The offered toolset follows toolKinds — deduped by tool name.
function widenAttemptTools(att: Attempt): void {
  const seen = new Set<string>();
  att.tools = [];
  for (const k of att.toolKinds) {
    for (const t of toolsFor(k, att.liveGate)) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        att.tools.push(t);
      }
    }
  }
}

const LEAD_CONTACT_TOOLS = ['send_message', 'draft_message', 'unsubscribe'];

// Per-turn lead gate: send/draft are offered only while they can land on this lead
// right now — research can add a channel mid-run, a pause or guardrail can close one.
async function refreshLeadGate(att: Attempt): Promise<void> {
  const { sql, leadId } = att.ctx;
  const wants = (n: string) =>
    !att.gate.disabled.has(n) && [...att.toolKinds].some((k) => toolAvailable(k, n));
  if (!leadId || !LEAD_CONTACT_TOOLS.some(wants)) return;
  const g = {
    ...DEFAULT_GUARDRAILS,
    ...(await getSetting<Partial<Guardrails>>(sql, 'guardrails', {})),
  };
  const reach = await controlTx(sql, (tx) =>
    sendableNowTx(tx, g, leadId, {
      channels: att.gate.channels,
      draftOnly: att.ctx.draftOnly,
      override: att.ctx.channelOverride,
    }),
  );
  const disabled = new Map(att.gate.disabled);
  const why = reach.why ?? 'sem canal alcançável';
  if (!reach.send.length) disabled.set('send_message', `envio bloqueado agora (${why})`);
  if (!reach.draft.length) disabled.set('draft_message', `rascunho bloqueado agora (${why})`);
  att.liveGate = { disabled, channels: reach.send, draftChannels: reach.draft };
  att.ctx.disabledTools = disabled;
  widenAttemptTools(att);
  // The prompt assumed contact works — say so when it doesn't, and again when it reopens.
  const sendBlocked = wants('send_message') && !reach.send.length;
  const draftBlocked = wants('draft_message') && !reach.draft.length;
  // only the hand-sent channel is left — skipped when the install has no channel at all
  // (the prompt's CANAIS block already says so)
  const manualOnly =
    wants('draft_message') &&
    att.gate.channels.length > 0 &&
    reach.draft.length > 0 &&
    reach.draft.every((c) => c === 'manual');
  const mode = draftBlocked ? 'blocked' : sendBlocked ? 'nosend' : manualOnly ? 'manual' : 'open';
  const state = mode === 'open' ? 'open' : `${mode}:${why}`;
  if (state === (att.contactState ?? 'open')) return;
  att.contactState = state;
  const has = (n: string) => attHas(att, n);
  const next = [
    has('update_lead') && 'update_lead nextActionAt',
    has('schedule') && 'schedule',
    has('request_human') ? 'request_human' : has('create_task') && 'create_task pra equipe',
  ].filter(Boolean);
  const nextStep = next.length ? `; registre o próximo passo (${next.join(', ')})` : '';
  const manual = "channel 'manual' — a equipe envia à mão";
  const note =
    mode === 'blocked'
      ? `CONTATO BLOQUEADO agora (${why}): nenhuma mensagem sai nem vira rascunho nesta run. Não insista${nextStep}.`
      : mode === 'nosend'
        ? `ENVIO BLOQUEADO agora (${why}): nenhuma mensagem sai nesta run — ${
            manualOnly
              ? `rascunho só com ${manual}`
              : 'só rascunho, nos canais que a ferramenta lista'
          }. Não insista${nextStep}.`
        : mode === 'manual'
          ? `Nenhum canal alcança este lead agora (${why}): o rascunho vai com ${manual}.`
          : `CONTATO LIBERADO: ${
              has('send_message')
                ? `envio por ${reach.send.join(', ')}`
                : `rascunho em ${reach.draft.filter((c) => c !== 'manual').join(', ')}`
            } — siga o plano.`;
  att.steps.push({ type: 'contact', content: note, contactState: state });
  att.messages.push({ role: 'user', content: note });
}

// Attempt setup — journal resume + cost accounting + lease heartbeat.
async function openAttempt(sql: Sql, run: RunRow): Promise<Attempt> {
  const priorSteps = Array.isArray(run.steps) ? run.steps : [];
  // Heal pending entries whose mutation committed before the worker died; if the claim lookup
  // fails, replayJournal must suppress artifact-mints conservatively.
  const claimsChecked = await reconcileInterrupted(sql, run.id, priorSteps).then(
    () => true,
    () => false,
  );
  const steps: unknown[] = [...priorSteps];
  if (priorSteps.length) {
    steps.push({ type: 'resumed', attempt: run.attempts, at: new Date().toISOString() });
  }
  const messages: AgentMessage[] = [];
  // finishRun overwrites cost columns wholesale — fold prior attempts' journaled usage deltas back in.
  let tokensIn = 0;
  let tokensOut = 0;
  // accumulate fractional dollars — per-step cents rounding would zero sub-cent calls
  let costUsd = 0;
  for (const s of priorSteps) {
    const e = s as {
      type?: string;
      usage?: { tokensIn?: number; tokensOut?: number; costUsd?: number };
    } | null;
    if (e?.type === 'model' && e.usage) {
      tokensIn += e.usage.tokensIn ?? 0;
      tokensOut += e.usage.tokensOut ?? 0;
      costUsd += e.usage.costUsd ?? 0;
    }
  }
  // Paid-enrichment budget — a reclaim rebuilds it from the journal's monid_spend markers.
  const priorSpend = (run.steps ?? []).reduce<number>((acc, s) => {
    const e = s as { type?: string; spentUsd?: number } | null;
    return e?.type === 'monid_spend' && typeof e.spentUsd === 'number' ? e.spentUsd : acc;
  }, 0);
  // Every kind gets a cap — a null budget would silently mean uncapped monid calls.
  const job = JOBS[run.kind];
  const monidBudget = new MonidBudget(
    // 0 is a real cap — only an absent/non-numeric param gets the job default
    run.params.monidCapUsd == null || !Number.isFinite(Number(run.params.monidCapUsd))
      ? job.monidCapUsd
      : Math.min(5, Math.max(0, Number(run.params.monidCapUsd))),
    priorSpend,
  );
  // Seed the new journal with the restored balance before first persist — a second reclaim needs it.
  if (priorSpend > 0) steps.push({ type: 'monid_spend', spentUsd: priorSpend });
  const att: Attempt = {
    sql,
    run,
    claim: { id: run.id, claimToken: run.claim_token, leadId: run.lead_id },
    claimsChecked,
    priorSteps,
    steps,
    messages,
    lost: false,
    tail: Promise.resolve(),
    synced: 0,
    dirtyFrom: Number.POSITIVE_INFINITY,
    tokensIn,
    tokensOut,
    costUsd,
    monidBudget,
    job,
    heartbeat: undefined as never,
    replay: undefined as never,
    ctx: undefined as never,
    provider: undefined as never,
    system: '',
    tools: [],
    toolKinds: new Set([run.kind]),
    gate: { disabled: new Map(), channels: [] },
    liveGate: { disabled: new Map(), channels: [] },
    i: 0,
    res: undefined as never,
    nudged: false,
    actionNudged: false,
    // re-seeded from the journal — a prior batch still owes its answer after a reclaim
    actionInboxIdx: priorSteps.reduce<number>(
      (acc, s, i) =>
        typeof s === 'object' &&
        s !== null &&
        (s as { type?: string; needsAction?: boolean }).type === 'inbox' &&
        (s as { needsAction?: boolean }).needsAction === true
          ? i
          : acc,
      -1,
    ),
    limit: job.stepBudget,
    // starts at -1 so the first tick fires after 3 truly idle steps
    lastProgress: -1,
    loopNudged: false,
    prevSigs: new Map(),
    landedSigs: new Set(),
    stateVersion: 0,
  };
  // monid_spend markers let a retried attempt rebuild the budget before re-spending.
  monidBudget.onChange = (spent) => {
    att.steps.push({ type: 'monid_spend', spentUsd: spent });
    void persist(att);
  };
  // A single call can outlive the 10-min lease — the timer keeps alive_at fresh through it.
  att.heartbeat = setInterval(() => {
    void controlTx(
      sql,
      (tx) => tx`
        update agent_runs set alive_at = now()
        where id = ${run.id} and status = 'running' and claim_token = ${run.claim_token}
      `,
    ).catch(() => undefined);
  }, HEARTBEAT_MS);
  att.heartbeat.unref?.();
  return att;
}

// Context build — provider, system prompt, toolset, journal replay into ctx.
async function buildAttemptContext(att: Attempt): Promise<void> {
  const { sql, run, steps, messages } = att;
  // Re-seed toolKinds from items stamped to this run — mail a dead attempt consumed can't
  // re-drain.
  const drainedKinds = await controlTx(sql, async (tx) => {
    const rows = await tx<{ k: string }[]>`
      select distinct payload->>'requestedKind' as k from agent_inbox
      where consumed_by_run = ${run.id} and payload->>'requestedKind' is not null
    `;
    const out: string[] = [];
    for (const { k } of rows) {
      if ((JOB_KINDS as readonly string[]).includes(k)) out.push(k);
    }
    return out;
  });
  for (const k of drainedKinds) att.toolKinds.add(k);
  const integration = await getIntegration(sql, 'llm');
  // A missing/disabled llm row falls back to the mock provider — loud, not silent.
  if (!integration) {
    agentLog.warn(
      { runId: run.id, kind: run.kind },
      'no enabled llm integration — run falls back to mock provider',
    );
  }
  att.provider = providerFor(integration, run.params);
  const pitch = await getPitch(sql);
  const { instructions } = await controlTx(sql, (tx) => agentSettingTx(tx));
  // A mock LLM runs against discovery's mock pages; a real one only gets tools that can work.
  att.gate = await toolGate(sql, {
    simulated: !integration || integration.driver === 'mock',
  });
  att.liveGate = att.gate;
  // a resumed attempt already told the model the contact state — don't repeat it
  for (const e of att.priorSteps) {
    const cs = (e as { contactState?: unknown } | null)?.contactState;
    if (typeof cs === 'string') att.contactState = cs;
  }
  att.tools = toolsFor(run.kind, att.gate);
  const offered = new Set(att.tools.map((t) => t.name));
  const { text: context, goal, bookingUrl } = await contextFor(sql, run, (n) => offered.has(n));
  const memory = { facts: await memoryForPrompt(sql, run) };
  const g = await getSetting<Partial<Guardrails>>(sql, 'guardrails', {});
  // The prompt only promises autocontact under the same conditions create_lead's gate checks.
  const waDriverOn = run.kind === 'discovery' && (await whatsappReadyTx(sql));
  att.system = buildSystemPrompt(run.kind, pitch, instructions, memory, {
    goal,
    bookingUrl,
    autoContact: {
      enabled: (g.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact) && waDriverOn,
      minScore: g.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore,
    },
    tools: offered,
    channels: att.gate.channels,
  });
  // Kinds from stamped mail must be visible to the model, not just permitted in dispatch.
  widenAttemptTools(att);
  // Discovery with nothing to search or read can only burn tokens — fail it up front, with why.
  if (
    run.kind === 'discovery' &&
    !['web_search', 'read_pages', 'serp', 'maps_lookup', 'instagram_profile'].some((n) =>
      attHas(att, n),
    )
  ) {
    const why = [...new Set(att.gate.disabled.values())].join('; ');
    throw new Error(`discovery sem ferramenta de pesquisa configurada (${why})`);
  }
  const replay = (att.replay = replayJournal(att.priorSteps, !att.claimsChecked));
  const ctx: ToolContext = {
    sql,
    runId: run.id,
    runKind: run.kind,
    leadId: run.lead_id,
    threadId: run.thread_id,
    // Step numbering continues past prior attempts so the idempotency key can't collide.
    step: replay.baseStep,
    claimToken: run.claim_token,
    briefName: typeof run.params.briefName === 'string' ? run.params.briefName : null,
    leadCap: (() => {
      const t = Math.floor(Number(run.params.target));
      return Number.isFinite(t) && t > 0 ? Math.min(1000, t) : DISCOVERY_LEAD_CAP;
    })(),
    channelOverride: isSendChannel(run.params.channel) ? run.params.channel : null,
    pageCache: replay.pageCache,
    book: new Map(),
    plan: null,
    seenContacts: new Set(),
    pageReads: replay.pageReads,
    monid: att.monidBudget,
    // staff assist runs may only compose — send_message degrades to a draft
    draftOnly: run.params.draftOnly === true,
    toolKinds: att.toolKinds,
    disabledTools: att.gate.disabled,
  };
  att.ctx = ctx;
  // Clone book entries on the way in — in-place mutation would rewrite the earlier
  // attempt's journaled out.entry.
  for (const [k, e] of replay.book)
    ctx.book.set(k, { ...e, channels: { ...e.channels }, tried: [...e.tried] });
  for (const v of replay.seenContacts) ctx.seenContacts.add(v);
  // No durable home for the plan — rebuild from the journal or reflection reports '(nenhum)'.
  if (replay.plan) ctx.plan = replay.plan;

  steps.push({ type: 'system_prompt', content: att.system });
  messages.push({ role: 'user', content: context });
  if (replay.messages.length) {
    messages.push(...replay.messages);
    messages.push({
      role: 'user',
      content:
        'RETOMADA: esta execução foi recuperada após o worker morrer — o histórico acima é seu próprio trabalho anterior nesta run (os efeitos já estão aplicados no CRM). Continue de onde parou; NÃO repita chamadas que já retornaram. Chamadas marcadas "interrupted" têm resultado desconhecido — verifique o estado antes de refazer.',
    });
  }
  await persist(att);
}

// One chat() turn: usage folds into the ledger and the turn journals verbatim.
async function modelTurn(att: Attempt): Promise<void> {
  await refreshLeadGate(att);
  const res = (att.res = await att.provider.chat({
    system: att.system,
    messages: att.messages,
    tools: att.tools,
  }));
  att.tokensIn += res.tokensIn;
  att.tokensOut += res.tokensOut;
  // Provider-reported USD wins; else estimate from tokens × list rate.
  const callCostUsd =
    res.costUsd ?? estimateModelCostUsd(att.provider.name, res.tokensIn, res.tokensOut);
  att.costUsd += callCostUsd;
  // Full ToolCall objects — a resumed run replays this verbatim (ids + thoughtSignature).
  att.steps.push({
    type: 'model',
    content: res.text,
    toolCalls: res.toolCalls,
    usage: { tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: callCostUsd },
  });
  await persist(att);
}

// Finish gate — a no-toolCalls turn either ends the run or buys it ONE nudge, with an
// absolute limit (i + 5) so it can't strand the run late or inflate an early finish.
async function finishGate(att: Attempt): Promise<'end' | 'again'> {
  const { sql, run, steps, messages, res } = att;
  if (run.kind === 'discovery' && !att.nudged) {
    const created = steps
      .filter(
        (s) =>
          typeof s === 'object' &&
          s !== null &&
          (s as { name?: string }).name === 'create_lead' &&
          typeof (s as { out?: { lead?: { id?: string } } }).out?.lead?.id === 'string',
      )
      .map((s) => (s as { out: { lead: Record<string, unknown> } }).out.lead);
    // A merge-only run produced work — escapes the zero-lead nudge.
    const merged = steps.some(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        (s as { name?: string }).name === 'create_lead' &&
        (s as { out?: { duplicate?: boolean } }).out?.duplicate === true,
    );
    const missingWa = created.filter((l) => !(typeof l.whatsapp === 'string' && l.whatsapp.trim()));
    // Feed back tried queries/urls so the extra round doesn't re-walk dead ends.
    const { queries: triedQueries, urls: readUrls } = mineAttempts(steps);
    const tried =
      triedQueries.size || readUrls.size
        ? ` Já tentado — NÃO repita: buscas ${[...triedQueries]
            .slice(0, 8)
            .map((q) => `"${q}"`)
            .join(
              ', ',
            )}${readUrls.size ? `; leituras ${[...readUrls].slice(0, 8).join(', ')}` : ''}.`
        : '';
    // Per-prospect untried moves from the ledger.
    const has = (n: string) => attHas(att, n);
    const LADDER = ladderTags(has);
    const search = has('serp') ? 'serp' : has('web_search') ? 'web_search' : null;
    const untried = (leadName: string): string => {
      const e = att.ctx.book.get(leadName.toLowerCase());
      if (!e) return '';
      const left = LADDER.filter((m) => !e.tried.includes(m));
      return left.length ? ` (falta: ${left.join('/')})` : '';
    };
    const nudge =
      !created.length && !merged
        ? `Nenhum lead entrou no CRM ainda — descoberta só conta quando o lead é criado.${tried} Siga por um sabor NÃO tentado — outra variação de segmento/modelo de negócio/cidade${has('read_pages') ? ' — ou read_pages no prospect fraco (o diretório que citar o nome é onde telefone mora)' : ''}.`
        : missingWa.length
          ? `${missingWa.length} lead(s) sem whatsapp: ${missingWa
              .map((l) => `${String(l.name ?? '?')}${untried(String(l.name ?? ''))}`)
              .slice(0, 6)
              .join(', ')}.${tried} Uma rodada por nome antes de encerrar: ${
              [
                search &&
                  `${search} "<nome> <cidade>" telefone/whatsapp (ângulo novo, não repita as buscas listadas)`,
                has('read_pages') &&
                  'no resultado que citar o nome — mesmo diretório/guia local — read_pages vale (é onde telefone e endereço moram)',
              ]
                .filter(Boolean)
                .join('; e ') ||
              'sem ferramenta de busca nesta run — marque no book como dead os que não têm whatsapp'
            }.`
          : null;
    if (nudge) {
      att.nudged = true;
      // Four calls after this turn: search + read + create_lead + a closing response.
      att.limit = att.i + 5;
      messages.push({ role: 'assistant', content: res.text ?? 'ok' });
      messages.push({ role: 'user', content: nudge });
      steps.push({ type: 'nudge', content: nudge });
      await persist(att);
      return 'again';
    }
  }
  // Messaging finish gate: one nudge (same i+5 allowance), resetting per drained batch —
  // a send answering an earlier batch can't close over fresh mail. The bar exists even when
  // the job doesn't demand one: action-mail drained into another kind would otherwise
  // close consumed and unanswered — no later run re-picks a consumed item.
  const lastInbox = steps.reduce<number>(
    (acc, s, i) =>
      typeof s === 'object' && s !== null && (s as { type?: string }).type === 'inbox' ? i : acc,
    -1,
  );
  const actionBar = att.job.requiresAction ? lastInbox : att.actionInboxIdx;
  // requiresAction jobs spend `nudged`; others spend the independent `actionNudged` —
  // a zero-lead nudge must not silence drained action-mail.
  const actionSpent = att.job.requiresAction ? att.nudged : att.actionNudged;
  const actedSlice = steps.slice(actionBar + 1);
  const gated = !actionSpent && (att.job.requiresAction || actionBar >= 0);
  const actionNudge = async (): Promise<'again'> => {
    if (att.job.requiresAction) att.nudged = true;
    else att.actionNudged = true;
    att.limit = att.i + 5;
    const acts = [
      'send_message',
      'draft_message',
      'request_human',
      'set_state',
      'unsubscribe',
      'update_lead',
      'create_task',
    ].filter((n) => attHas(att, n));
    const way = attHas(att, 'request_human')
      ? 'request_human'
      : attHas(att, 'create_task')
        ? 'create_task pra equipe'
        : null;
    const nudge = `Ação pendente — a run ainda não teve efeito visível (${acts.join(', ')}). Pesquisar e sair sem agir deixa o lead falando sozinho — aja agora${way ? `; se um guardrail ou canal morto trava a ação, ${way} é a saída` : ''}.`;
    messages.push({ role: 'assistant', content: res.text ?? 'ok' });
    messages.push({ role: 'user', content: nudge });
    steps.push({ type: 'nudge', content: nudge });
    await persist(att);
    return 'again';
  };
  if (gated && !runActed(actedSlice)) return actionNudge();
  // Drain mid-attempt mail before finishing — but only when a turn remains, else it strands
  // consumed in a dead journal.
  if (att.i + 1 < att.limit && (await drainInbox(att))) return 'again';
  // A cancel landing since the last persist leaves the row 'canceled' — finishRun matches
  // nothing; persistAborted still stores the usage. Message ids ride into finishRun's tx so
  // an artifact rejected under capfin before commit makes the run nudge/fail instead of
  // closing 'done' on nothing approvable.
  const actedIds = att.job.requiresAction || actionBar >= 0 ? actedMessageIds(actedSlice) : null;
  const liveMessageIds =
    actedIds && actedIds.onlyMessages && actedIds.ids.length ? actedIds.ids : undefined;
  const fin = await finishRun(sql, att.claim, {
    status: 'done',
    steps,
    tokensIn: att.tokensIn,
    tokensOut: att.tokensOut,
    costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
    liveMessageIds,
  });
  if (fin.deadAction) {
    if (gated) return actionNudge();
    // 'failed' releases consumed mail for the orphan sweep; 'done' would claim a
    // visible effect that never landed.
    const dead = await finishRun(sql, att.claim, {
      status: 'failed',
      steps,
      tokensIn: att.tokensIn,
      tokensOut: att.tokensOut,
      costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
      error: 'every produced message artifact was rejected before close',
    });
    if (!dead.matched) await persistAborted(att);
    return 'end';
  }
  if (fin.matched) {
    if (att.job.debrief) {
      // debrief → agent_memory_items; best-effort — never fail a finished run on it.
      await writeDebrief(sql, run, att.ctx, steps).catch(() => undefined);
    }
  } else {
    await persistAborted(att);
  }
  return 'end';
}

// Parallel for discovery-style jobs, sequential for messaging kinds (calls may
// depend on each other's ordering — draft before send).
async function dispatchStep(att: Attempt): Promise<void> {
  if (att.job.parallelTools) await dispatchParallel(att);
  else await dispatchSequential(att);
}

// Pending entries journal callId+step BEFORE execution so reconcileInterrupted can resolve
// a mid-batch crash against the claim table; the reflection tick follows the batch.
async function dispatchParallel(att: Attempt): Promise<void> {
  const { res, steps, messages } = att;
  const batch: unknown[] = res.toolCalls.map((call, callIndex) => ({
    type: 'tool',
    name: call.name,
    args: call.args,
    callId: call.id ?? String(callIndex),
    step: att.ctx.step,
    pending: true,
  }));
  const toolMsgs: AgentMessage[] = new Array(res.toolCalls.length);
  await persist(att, batch);
  await Promise.all(
    res.toolCalls.map(async (call, callIndex) => {
      let out: unknown;
      try {
        out = await executeTool(att.ctx, call.id ?? String(callIndex), call.name, call.args);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      batch[callIndex] = {
        type: 'tool',
        name: call.name,
        args: call.args,
        callId: call.id ?? String(callIndex),
        step: att.ctx.step,
        out,
      };
      toolMsgs[callIndex] = {
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(out),
      };
      await persist(att, batch);
    }),
  );
  steps.push(...batch);
  messages.push(...toolMsgs);

  // Reflection tick — 4 steps without progress (no lead/merge, new channel, or enrichment
  // hit) reflects the field state back and asks for the next move.
  if (!att.lost) {
    const progressed = batch.some((b) => {
      if (typeof b !== 'object' || !b) return false;
      const s = b as {
        name?: string;
        out?: Record<string, unknown> | null;
      };
      const out = s.out;
      if (!out) return false;
      if (s.name === 'create_lead' && (out.lead || out.duplicate)) return true;
      // book: only NEWLY added channels count; enrichment: only non-banked contacts
      if (s.name === 'book' && (out.addedChannels as string[] | undefined)?.length) return true;
      if (typeof out.newContacts === 'number' && out.newContacts > 0) return true;
      return false;
    });
    if (progressed) att.lastProgress = att.i;
    else if (att.i - att.lastProgress >= 3) {
      const drift = att.i - att.lastProgress;
      att.lastProgress = att.i;
      const { queries, urls } = mineAttempts(steps);
      const reflection = `REFLEXÃO — ${drift} passos sem progresso (nenhum canal novo, lead criado ou merge).\nPlano atual: ${att.ctx.plan ?? '(nenhum — escreva um via plan)'}\nLivro:\n${bookDigest(att.ctx.book)}\nJá tentado: buscas ${
        [...queries]
          .slice(0, 8)
          .map((q) => `"${q}"`)
          .join(', ') || 'nenhuma'
      }; leituras ${[...urls].slice(0, 8).join(', ') || 'nenhuma'}.\nPassos restantes: ~${Math.max(0, att.limit - att.i)}. Qual o próximo melhor movimento — ${[
        'novo ângulo de busca',
        attHas(att, 'maps_lookup') && 'maps_lookup',
        attHas(att, 'instagram_profile')
          ? 'instagram_profile num @ que sobrou'
          : attHas(att, 'read_pages') && 'read_pages num @ ou site que sobrou',
        'ou fechar um prospect como dead',
      ]
        .filter(Boolean)
        .join(', ')}? Responda e siga.`;
      steps.push({ type: 'reflection', content: reflection });
      messages.push({ role: 'user', content: reflection });
    }
  }
}

// Sequential dispatch + loop guard: a repeated clean call can't produce anything new and
// re-running a side-effecting call would duplicate it — suppress per call; nudge when the whole turn repeats.
async function dispatchSequential(att: Attempt): Promise<void> {
  const { res, steps, messages } = att;
  const curSigs = new Map<string, { ok: boolean; v: number }>();
  let allRepeat = res.toolCalls.length > 0;
  for (const [callIndex, call] of res.toolCalls.entries()) {
    const callId = call.id ?? String(callIndex);
    // Journal the pending call BEFORE executing — a crash leaves it reconcilable.
    const entry: {
      type: 'tool';
      name: string;
      args: unknown;
      callId: string;
      step: number;
      pending?: boolean;
      readSpent?: number;
      out?: unknown;
    } = {
      type: 'tool',
      name: call.name,
      args: call.args,
      callId,
      step: att.ctx.step,
      pending: true,
    };
    // A markerless read_pages entry in a replayed journal is a legacy pre-marker read,
    // counted conservatively.
    if (call.name === 'read_pages') entry.readSpent = 0;
    steps.push(entry);
    await persist(att);
    const sig = JSON.stringify([call.name, call.args ?? {}]);
    const prev = att.prevSigs.get(sig);
    // Suppress only while nothing landed since the prior clean result; artifact-minters
    // are the exception — a duplicate is never legitimate.
    const repeatHit = att.landedSigs.has(sig) || (prev?.ok === true && prev.v === att.stateVersion);
    // Mutable reads re-execute but still count toward allRepeat.
    const suppress = !MUTABLE_READS.has(call.name) && repeatHit;
    const readsBefore = att.ctx.pageReads;
    // read_pages stamps each fetch reservation onto its pending journal entry the moment
    // it validates — a mid-batch death leaves the real spend persisted.
    if (call.name === 'read_pages') {
      att.ctx.markReadSpent = async (delta: number) => {
        entry.readSpent = (entry.readSpent ?? 0) + delta;
        await persist(att);
      };
    } else {
      delete att.ctx.markReadSpent;
    }
    let out: unknown;
    if (suppress) {
      out = {
        error:
          'REPEAT — chamada idêntica à anterior já foi executada nesta run; o resultado já está no contexto e não muda. Faça algo diferente ou encerre.',
      };
    } else {
      if (!repeatHit) allRepeat = false;
      try {
        out = await executeTool(att.ctx, callId, call.name, call.args);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    // The cap charges fetches, not calls — a cached read_pages entry must not count on replay.
    if (call.name === 'read_pages') entry.readSpent = att.ctx.pageReads - readsBefore;
    const res_ = out as {
      error?: unknown;
      blocked?: unknown;
      ignored?: unknown;
      errors?: unknown;
    } | null;
    // Per-url fetch failures ride in errors[] — such a result isn't a clean prior, retry reissues.
    const clean =
      typeof res_ === 'object' &&
      res_ !== null &&
      !res_.error &&
      res_.blocked !== true &&
      res_.ignored !== true &&
      !(Array.isArray(res_.errors) && res_.errors.length > 0);
    // A suppressed call's REPEAT error must not mark the signature retryable.
    if (clean && !READ_TOOLS.has(call.name)) att.stateVersion++;
    // Writes record the post-call version — 'nothing landed since' must not count the call's own write.
    curSigs.set(sig, suppress ? prev! : { ok: clean, v: att.stateVersion });
    if (clean && NON_IDEMPOTENT.has(call.name)) att.landedSigs.add(sig);
    delete entry.pending;
    entry.out = out;
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify(out),
    });
    await persist(att);
    if (att.lost) break;
  }
  att.prevSigs = curSigs;
  if (allRepeat && !att.loopNudged && !att.lost) {
    att.loopNudged = true;
    const nudge = `LOOP — você emitiu exatamente as mesmas chamadas com os mesmos argumentos duas vezes seguidas; os resultados mais recentes já estão no contexto. Repetir a mesma chamada não avança a run — faça a próxima ação do plano ou encerre.`;
    steps.push({ type: 'nudge', content: nudge });
    messages.push({ role: 'user', content: nudge });
    await persist(att);
  }
}

// Loop unwound: step exhaustion is a failure; the create count still reports what it produced.
async function endAttempt(att: Attempt): Promise<void> {
  if (att.lost) {
    await persistAborted(att);
    return;
  }
  const created = att.steps.filter(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      (s as { name?: string }).name === 'create_lead' &&
      typeof (s as { out?: { lead?: { id?: string } } }).out?.lead?.id === 'string',
  ).length;
  if (
    (
      await finishRun(att.sql, att.claim, {
        status: 'failed',
        steps: att.steps,
        tokensIn: att.tokensIn,
        tokensOut: att.tokensOut,
        costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
        error: `max steps reached${created ? ` — ${created} lead(s) created` : ''}`,
      })
    ).matched
  ) {
    if (att.job.debrief)
      await writeDebrief(att.sql, att.run, att.ctx, att.steps).catch(() => undefined);
  } else {
    await persistAborted(att);
  }
}

// Any throw lands as a failed run; a lost fence degrades to persistAborted.
async function failAttempt(att: Attempt, e: unknown): Promise<void> {
  if (
    !(
      await finishRun(att.sql, att.claim, {
        status: 'failed',
        steps: att.steps,
        tokensIn: att.tokensIn,
        tokensOut: att.tokensOut,
        costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
        error: e instanceof Error ? e.message : String(e),
      })
    ).matched
  )
    await persistAborted(att);
}

// Kernel loop: inbox drain → model turn → finish gate → tool dispatch, for `limit` steps
// or until the run loses its fence.
async function runKernel(att: Attempt): Promise<void> {
  // Artifact-minters get a run-wide window — a duplicate is never a state-restore.
  att.landedSigs = new Set(att.replay.landedSigs);
  for (att.i = 0; att.i < att.limit && !att.lost; att.i++) {
    await drainInbox(att);
    if (att.lost) break;
    await modelTurn(att);
    if (att.lost) break;
    if (!att.res.toolCalls.length) {
      if ((await finishGate(att)) === 'end') return;
      continue;
    }
    att.messages.push({
      role: 'assistant',
      content: att.res.text ?? '',
      toolCalls: att.res.toolCalls,
    });
    // Global step index across attempts — keeps idempotency keys unique
    // (replay.baseStep counts the prior journal's model turns).
    att.ctx.step = att.replay.baseStep + att.i;
    await dispatchStep(att);
  }
  await endAttempt(att);
}

export async function runOnce(sql: Sql): Promise<boolean> {
  const run = await claimRun(sql);
  if (!run) return false;
  // A reclaimed row carries its prior attempts' journal — keep it (the audit
  // trail for the whole run, not just this attempt) and mark the boundary so
  // the next resume replays only the latest attempt's entries.
  let att: Attempt;
  try {
    att = await openAttempt(sql, run);
  } catch (e) {
    // Setup died before the attempt bag existed — land the row 'failed'
    // directly instead of parking it 'running' until the reclaim lease.
    await finishRun(
      sql,
      { id: run.id, claimToken: run.claim_token, leadId: run.lead_id },
      {
        status: 'failed',
        steps: Array.isArray(run.steps) ? run.steps : [],
        tokensIn: 0,
        tokensOut: 0,
        costCents: 0,
        error: e instanceof Error ? e.message : String(e),
      },
    );
    return true;
  }
  try {
    await buildAttemptContext(att);
    await runKernel(att);
  } catch (e) {
    await failAttempt(att, e);
  } finally {
    clearInterval(att.heartbeat);
  }
  return true;
}

// Drain the queue; reclaims runs whose worker died (requeued past the lease, not failed).
export const RUN_LEASE_MIN = 10;

// Every drain — a scheduler pass, an HTTP kick, an inbound kick — registers here so a
// shutdown can wait for all of them, not just the scheduler's own.
const drainsInFlight = new Set<Promise<number>>();

/** Recover, then claim and run what's due. `orphans: false` skips the full orphan scan —
 *  the scheduler serves orphaned mail per lead from notifications (ADR 0017). */
export function drain(sql: Sql, limit = 20, opts?: { orphans?: boolean }): Promise<number> {
  if (claimsStopped) return Promise.resolve(0);
  const p = drainOnce(sql, limit, opts?.orphans !== false);
  drainsInFlight.add(p);
  void p.then(
    () => drainsInFlight.delete(p),
    () => drainsInFlight.delete(p),
  );
  return p;
}

/** resolves when every drain running right now has settled */
export function drainsSettled(): Promise<unknown> {
  return Promise.allSettled([...drainsInFlight]);
}

async function drainOnce(sql: Sql, limit: number, orphans: boolean): Promise<number> {
  // Requeue behind exponential backoff (2^attempts min); exhausting max_attempts lands 'failed'.
  const capFlaggedIds: string[] = [];
  // A normal failed run's [humano] task needs the same lead.change refresh a fresh flag earns.
  let taskLanded = false;
  const { requeued, terminal } = await controlTx(sql, async (tx) => {
    // Bulk requeue below-cap attempts; the retry's own finishRun folds its total spend.
    const requeued = await tx<{ id: string }[]>`
      update agent_runs set
        attempts = attempts + 1,
        status = 'queued',
        run_at = now() + make_interval(mins => 1 << least(attempts + 1, 16)),
        started_at = null,
        alive_at = null,
        claim_token = null
      where status = 'running' and attempts + 1 < max_attempts
        and coalesce(alive_at, started_at) < now() - make_interval(mins => ${RUN_LEASE_MIN})
      returning id
    `;
    // Finalize terminal rows one tx each — the 'running' row is the pending marker,
    // so a crash mid-finalize leaves the rest for the next drain to re-pick.
    const terminal = await tx<{ id: string; lead_id: string | null; kind: RunRow['kind'] }[]>`
      select id, lead_id, kind from agent_runs
      where status = 'running' and attempts + 1 >= max_attempts
        and coalesce(alive_at, started_at) < now() - make_interval(mins => ${RUN_LEASE_MIN})
    `;
    return { requeued, terminal };
  });
  for (const r of requeued) emitControlEvent('run.update', r.id);
  for (const f of terminal) {
    const flagged = await controlTx(sql, async (tx) => {
      // capfin first inside each small tx (see capLockTx).
      if (f.lead_id) await capLockTx(tx, f.lead_id);
      // One commit, fenced on staleness — a revived row skips the whole finalize.
      const rows = await tx<{ id: string; lead_id: string | null }[]>`
        update agent_runs set
          attempts = attempts + 1,
          status = 'failed',
          error = 'attempt cap reached — run kept dying mid-execution',
          finished_at = now(),
          started_at = null,
          alive_at = null,
          claim_token = null,
          cost_cents = round((
            coalesce((select sum((e->'usage'->>'costUsd')::numeric)
                      from jsonb_array_elements(steps) e
                      where e->>'type' = 'model'), 0)
            + coalesce((select (e.v->>'spentUsd')::numeric
                        from jsonb_array_elements(steps) with ordinality as e(v, idx)
                        where e.v->>'type' = 'monid_spend'
                        order by idx desc limit 1), 0)
          ) * 100)::int
        where id = ${f.id} and status = 'running'
          and coalesce(alive_at, started_at) < now() - make_interval(mins => ${RUN_LEASE_MIN})
        returning id, lead_id
      `;
      const row = rows[0];
      if (!row) return { task: false, cap: false };
      // The dead run's consumed mail re-pends in the same commit — the inbox sweep respawns it.
      await releaseInboxTx(tx, row.id);
      // Spend lives only in the journal: model entries are DELTAS (sum), monid_spend markers
      // are CUMULATIVE (read the last). Board-scoped failures roll into the digest — no task, no emit.
      if (!row.lead_id) return { task: false, cap: false };
      const name =
        (await tx<{ name: string }[]>`select name from leads where id = ${row.lead_id}`)[0]?.name ??
        row.lead_id;
      await tx`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${row.lead_id},
                ${`[humano] ${name}: run ${f.kind} falhou — tentativas esgotadas, a run morria no meio`.slice(0, 300)},
                null, 'agent')
      `;
      // Dead-run spend can itself cross the cap.
      return {
        task: true,
        cap: (await leadUnderCostCapTx(tx, row.lead_id)) === 'flagged',
      };
    }).catch(() => ({ task: false, cap: false }));
    if (flagged.cap) capFlaggedIds.push(f.lead_id!);
    if (flagged.task) taskLanded = true;
    emitControlEvent('run.update', f.id);
  }
  if (capFlaggedIds.length || taskLanded) emitControlEvent('lead.change');
  // Terminal suppressions strand queued runs forever — the catch-all for writers that
  // didn't cancel inline. agent_paused_at / agent_mode='off' lift, so their parked runs must resume.
  const parked = await controlTx(
    sql,
    (tx) => tx<{ id: string }[]>`
      update agent_runs r set status = 'canceled', finished_at = now(),
        error = case when l.unsubscribed_at is not null then 'descadastrado' else 'arquivado' end
      from leads l
      where l.id = r.lead_id and r.status = 'queued'
        and (l.unsubscribed_at is not null or l.archived_at is not null)
      returning r.id
    `,
  );
  for (const r of parked) emitControlEvent('run.update', r.id);
  // 'sending' past the lease = worker died mid-send — fail visibly (at-most-once: the
  // provider may already have accepted it).
  const failedSending = await controlTx(
    sql,
    (tx) => tx<{ thread_id: string }[]>`
      update lead_messages set status = 'failed', error = 'dispatch-interrupted', updated_at = now()
      where status = 'sending' and updated_at < now() - make_interval(mins => ${RUN_LEASE_MIN})
      returning thread_id
    `,
  );
  for (const m of failedSending) emitControlEvent('thread.message', m.thread_id);
  // Queued messages outlive their request; the 20s grace lets the inline dispatch win.
  // Agent-authored rows stay 'queued' under the claim fence until the run is terminal;
  // staff-approved drafts are staff-owned.
  const failedQueued = await controlTx(
    sql,
    (tx) => tx<{ thread_id: string }[]>`
      update lead_messages m set status = 'failed', updated_at = now(),
        error = 'authoring run no longer active'
      where m.status = 'queued' and m.agent_run_id is not null
        and m.approved_by is null
        and (
          select r.status from agent_runs r where r.id = m.agent_run_id
        ) in ('canceled', 'failed')
      returning m.thread_id
    `,
  );
  for (const m of failedQueued) emitControlEvent('thread.message', m.thread_id);
  // Re-run release on dead owners: a suppressed answeredBy that later flips 'failed'
  // otherwise strands its mail forever. Canceled owners release unbounded (no failure
  // signal → deliveries bound doesn't apply). 2h bound keeps the scan proportional to recent deaths.
  await controlTx(sql, async (tx) => {
    const deadOwners = await tx<{ id: string; status: string }[]>`
      select distinct i.consumed_by_run as id, r.status
      from agent_inbox i
      join agent_runs r on r.id = i.consumed_by_run
      where i.consumed_at is not null and r.status in ('canceled', 'failed')
        and coalesce(r.finished_at, r.alive_at, r.created_at) > now() - interval '2 hours'
    `;
    for (const r of deadOwners) await releaseInboxTx(tx, r.id, r.status === 'canceled');
  });
  const stranded = await controlTx(
    sql,
    (tx) =>
      tx<{ id: string; agent_run_id: string | null; approved_by: string | null }[]>`
        select id, agent_run_id, approved_by from lead_messages m
        where m.status = 'queued' and m.created_at < now() - interval '20 seconds'
          and (
            m.agent_run_id is null
            or m.approved_by is not null
            or (select r.status from agent_runs r where r.id = m.agent_run_id) = 'done'
          )
        order by m.created_at limit 10
      `,
  );
  for (const m of stranded) {
    // Agent-authored rows recover only once the run is 'done' — a live run still owns its
    // send; the run-row lock inside the claim tx keeps a cancel in the gap from sending.
    const runId = m.approved_by ? null : m.agent_run_id;
    const guard = runId
      ? async (tx: Sql) => {
          const rows = await tx<{ status: string }[]>`
            select status from agent_runs where id = ${runId} for update
          `;
          if (rows[0]?.status !== 'done') {
            throw new HttpError(
              409,
              'STALE_CLAIM',
              'authoring run still active — owner dispatches',
            );
          }
        }
      : undefined;
    await dispatchMessage(sql, m.id, guard).catch((e) =>
      agentLog.error({ err: e, messageId: m.id }, 'dispatch failed'),
    );
  }
  // Orphaned mail: the sweep creates the fallback run each payload describes.
  if (orphans) {
    await sweepOrphanInbox(sql).catch((e) => agentLog.error({ err: e }, 'inbox sweep failed'));
  }
  let ran = 0;
  while (ran < limit && !claimsStopped && (await runOnce(sql))) ran++;
  return ran;
}

// Set by the scheduler on shutdown: finish the run in hand, claim nothing new, start no drain.
let claimsStopped = false;
export function stopClaims(stop = true) {
  claimsStopped = stop;
}

// Each enabled brief runs once a day from agent.schedule.discoveryHour (workspace time);
// a brief that hasn't run since the latest anchor is due, a new one runs right away
// (not-exists prevents double-fire); new leads tag 'descoberto'.
export async function sweepBriefs(sql: Sql): Promise<number> {
  const queuedIds: string[] = [];
  const pausedIds: string[] = [];
  const fired = await controlTx(sql, async (tx) => {
    const { schedule } = await agentSettingTx(tx);
    const { last: anchor } = await anchorTx(tx, { hour: schedule.discoveryHour });
    const due = await tx<
      {
        id: string;
        name: string;
        query: string;
        segment: string | null;
        city: string | null;
        target: number | null;
        rearmed_at: string | null;
        created_by: string;
      }[]
    >`
      select id, name, query, segment, city, target, rearmed_at, created_by from discovery_briefs
      where enabled
        and (last_run_at is null or last_run_at < ${anchor})
        and not exists (
          select 1 from agent_runs r
          where r.kind = 'discovery' and r.status in ('queued', 'running')
            and r.params->>'briefId' = discovery_briefs.id::text
        )
      limit 10
      for update of discovery_briefs skip locked
    `;
    if (!(await automationAllowedTx(tx, 'discovery')).ok) return 0;
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const autoPauseRuns = g.briefAutoPauseRuns ?? DEFAULT_GUARDRAILS.briefAutoPauseRuns;
    // Re-check the budget before each refire — approval checked it once — and disable
    // the brief when the rolling 7d window no longer fits; serialized on 'brief-proposals'.
    if (due.some((b) => b.created_by === 'strategist' && !b.rearmed_at)) {
      await tx`select pg_advisory_xact_lock(hashtext('brief-proposals'))`;
    }
    let fired = 0;
    for (const b of due) {
      // rearmed_at = staff re-arm — a human decision, exempt from the budget gate.
      if (b.created_by === 'strategist' && !b.rearmed_at) {
        const bdg = await discoveryBudgetTx(tx, b.id);
        if (!(bdg.capCents > 0 && bdg.spent + (bdg.open + 1) * bdg.est <= bdg.capCents)) {
          const note = 'auto-pausada — orçamento semanal de descoberta esgotado';
          await tx`
            update discovery_briefs set enabled = false, note = ${note}
            where id = ${b.id}
          `;
          pausedIds.push(b.id);
          agentLog.info(
            { briefId: b.id, spent: bdg.spent, capCents: bdg.capCents },
            'discovery brief auto-paused — strategist budget exhausted',
          );
          continue;
        }
      }
      // Dead-brief gate: N finished runs with zero new leads → pause itself. rearmed_at
      // bounds the window; the bound is on created_at (a pre-edit run still carries the old
      // definition), and only 'done' counts — a 'failed' run isn't zero-yield evidence.
      if (autoPauseRuns > 0) {
        const stat = (
          await tx<{ runs: number; with_leads: number }[]>`
            with recent as (
              select steps from agent_runs
              where kind = 'discovery' and status = 'done'
                and params->>'briefId' = ${b.id}
                and (${b.rearmed_at}::timestamptz is null
                     or created_at > ${b.rearmed_at}::timestamptz)
              order by finished_at desc
              limit ${autoPauseRuns}
            )
            select count(*)::int as runs,
              count(*) filter (where exists (
                select 1 from jsonb_array_elements(steps) s
                where s->>'name' = 'create_lead'
                  and s->'out'->'lead'->>'id' is not null
              ))::int as with_leads
            from recent
          `
        )[0]!;
        if (stat.runs >= autoPauseRuns && stat.with_leads === 0) {
          const note = `auto-pausada — ${autoPauseRuns} runs seguidas sem lead`;
          await tx`
            update discovery_briefs set enabled = false, note = ${note}
            where id = ${b.id}
          `;
          agentLog.info(
            { briefId: b.id, runs: stat.runs },
            'discovery brief auto-paused — dead streak',
          );
          continue;
        }
      }
      const { runId } = await requestAgentTx(tx, {
        kind: 'discovery',
        source: 'brief',
        params: {
          query: b.query,
          ...(b.segment ? { segment: b.segment } : {}),
          ...(b.city ? { city: b.city } : {}),
          ...(b.target ? { target: b.target } : {}),
          briefId: b.id,
          briefName: b.name,
        },
      });
      if (runId) queuedIds.push(runId);
      await tx`update discovery_briefs set last_run_at = now() where id = ${b.id}`;
      fired++;
    }
    return fired;
  });
  for (const id of queuedIds) emitControlEvent('run.update', id);
  // A budget pause lands no run but still refreshes the discovery view.
  for (const id of pausedIds) emitControlEvent('run.update', id);
  return fired;
}

// Weekly review at agent.schedule weekday/hour (workspace time): due once per anchor, stamped
// by created_at; the advisory lock serializes workers so two can't double-fire.
export async function sweepStrategist(sql: Sql): Promise<boolean> {
  let queuedId: string | null = null;
  const fired = await controlTx(sql, async (tx) => {
    const locked = await tx<{ ok: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtext('sweep:strategist')) as ok
    `;
    if (!locked[0]?.ok) return false;
    if (!(await automationAllowedTx(tx, 'strategist')).ok) return false;
    const { schedule } = await agentSettingTx(tx);
    const { last: anchor } = await anchorTx(tx, {
      hour: schedule.weeklyHour,
      weekday: schedule.weeklyDay,
    });
    // only board-scoped runs fill the cadence slot
    const recent = await tx`
      select 1 from agent_runs
      where kind = 'strategist' and lead_id is null and created_at >= ${anchor}
      limit 1
    `;
    if (recent.length) return false;
    queuedId = (await requestAgentTx(tx, { kind: 'strategist', source: 'weekly' })).runId;
    return true;
  });
  if (queuedId) emitControlEvent('run.update', queuedId);
  return fired;
}
