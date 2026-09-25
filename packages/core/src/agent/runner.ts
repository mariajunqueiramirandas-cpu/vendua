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
import { sweepPipelineSnapshots } from '../modules/forecast.ts';
import { sweepDigest } from '../modules/digest.ts';
import {
  estimateModelCostUsd,
  providerFor,
  type AgentMessage,
  type AgentTool,
  type LlmProvider,
  type LlmResult,
  type ToolCall,
} from './llm.ts';
import { buildSystemPrompt } from './prompts.ts';
import { loadPlaybookTx, mergePlaybook, PLAYBOOKS, type EffectivePlaybook } from './playbooks.ts';
import {
  automationAllowedTx,
  autonomyTx,
  claimPolicyTx,
  discoveryBudgetTx,
  playbookEnabledTx,
} from './policy.ts';
import { pendingWakeupsTx, sweepWakeups } from './wakeups.ts';
import { enqueueInboxTx, renderInboxItems, sweepOrphanInbox, type InboxItem } from './inbox.ts';
import { executeTool, toolsFor, bookDigest, type BookEntry, type ToolContext } from './tools.ts';
import { MonidBudget } from './channels/monid.ts';
import {
  ACTION_TOOLS,
  MUTABLE_READS,
  NON_IDEMPOTENT,
  PLAYBOOK_KINDS,
  READ_TOOLS,
  type PlaybookKind,
} from './tool-meta.ts';
import { pageKey } from './channels/discovery.ts';
import { dispatchMessage } from './send.ts';
import { channelAvailabilityTx, whatsappReadyTx } from './guardrails.ts';
import { bookingLinkForRunner, sweepMeetingReminders } from '../modules/meetings.ts';
import { emitControlEvent } from '../modules/control-events.ts';

const agentLog = log.child({ mod: 'agent' });

/**
 * agent/runner — the Hermes-style agent loop, CRM-sized: claim a queued run
 * (FOR UPDATE SKIP LOCKED — no double-runs across replicas), converge an
 * OpenAI-style tool loop, write the whole trajectory into agent_runs.steps.
 * Every step is a journal entry; a crashed run resumes as `failed` but its
 * steps are the audit trail.
 */

const HEARTBEAT_MS = 20_000;
/** Per-run lead ceiling for discovery runs launched without a meta — the
 *  safety bound the prompt can't talk past. Runs WITH a meta cap at it. */
const DISCOVERY_LEAD_CAP = 20;

export interface RunRow {
  id: string;
  kind: 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
  lead_id: string | null;
  thread_id: string | null;
  params: Record<string, unknown>;
  /** Minted at claim; every worker write is conditioned on it so a worker
   *  that loses its lease (reclaimed row) can't overwrite the new owner. */
  claim_token: string;
  /** Journal from prior attempts — a reclaimed row keeps it; the next
   *  execution replays it into the conversation (see replayJournal) and
   *  monid_spend markers rebuild the enrichment budget. */
  steps: unknown[];
  /** Executions consumed — each drain() reclaim +1; at max_attempts the
   *  reclaim lands 'failed' instead of requeuing. */
  attempts: number;
  max_attempts: number;
}

/** Per-lead lifetime spend ceiling (leadLifetimeCostCapUsd guardrail) —
 *  enforced at insert, not claim: a capped lead must not even queue (the
 *  row would park in 'queued' forever and every sweep tick would re-spend
 *  the evaluation). The card is flagged once — a system activity plus the
 *  same '[humano] <reason>' task request_human writes — so staff sees why
 *  the agent went quiet and can raise the cap or retire the lead. */
type CapVerdict = 'under' | 'flagged' | 'already';

/** 'capfin' ordering rule: this blocking advisory must be a tx's FIRST
 *  lock for a lead — before any lead_threads/leads FOR UPDATE or agent_runs
 *  writes that target the same lead. A tx that takes it empty-handed can
 *  never deadlock: its later row-lock waits (a finisher's flag insert takes
 *  key-share on leads through the FK; an inbound's l,t lock is FOR UPDATE)
 *  always resolve against holders that never wait on capfin themselves —
 *  claims only TRY it, and every other evaluator holds it first too.
 *  Conversely a tx that grabbed row locks first and then waits here CAN
 *  cycle (inbound holds the lead → wants capfin; finisher holds capfin →
 *  wants the lead's key-share). */
export async function capLockTx(tx: Sql, leadId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext(${'capfin:' + leadId}))`;
}

/** 'under' admits the run; the rest refuse it. Only 'flagged' means THIS
 *  call wrote the flag + staff task — 'already' saw the flag committed at
 *  this level. */
export async function leadUnderCostCapTx(tx: Sql, leadId: string): Promise<CapVerdict> {
  const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const capUsd = g.leadLifetimeCostCapUsd ?? DEFAULT_GUARDRAILS.leadLifetimeCostCapUsd;
  if (capUsd <= 0) return 'under';
  // Serialize same-lead cap decisions: two concurrent finishers each see
  // the other's uncommitted cost_cents as absent — both under-cap, no
  // flag, parked siblings with no task. The blocking xact advisory makes
  // the second evaluator read the first's COMMITTED total (its own spend
  // is visible to itself, committed or not).
  await capLockTx(tx, leadId);
  const spent = (
    await tx<{ cents: number }[]>`
      select coalesce(sum(cost_cents), 0)::int as cents
      from agent_runs where lead_id = ${leadId}
    `
  )[0]!.cents;
  if (spent < capCentsOf(g)) return 'under';
  // Dedupe is per cap LEVEL — after staff raises the cap, hitting the new
  // ceiling flags again; re-crossing the same level doesn't re-alert.
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

/** Transaction-local insert — call inside an existing tx (e.g. claimControl's)
 *  to atomically pair a run with another write. postgres.js transaction
 *  handles have no .begin(), so callers holding one must not use enqueueRun.
 *  Returns null when the lead's lifetime cost cap refuses the run. */
export async function insertRun(
  tx: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    params?: Record<string, unknown>;
    /** earliest start — the row sits 'queued' until run_at is due
     *  (guardrails-configured pacing); null = claimable immediately. */
    runAt?: Date | null;
  },
  /** Out-box for tx-owning callers: `flagged` set when a refusal wrote a
   *  FRESH cap flag (emit lead.change post-commit); `retired` collects the
   *  ids of rows `adopt` canceled — emit run.update for each post-commit,
   *  or a Runs view watching only the new owner keeps them as queued. */
  cap?: { flagged?: boolean; retired?: string[] },
): Promise<string | null> {
  // Adopt an already-active row as the mail's owner — or retire it when
  // it can't serve this mail: policy-parked (a queued auto row under
  // workspace 'off', or a disabled playbook's kind) or SCHEDULED — a
  // future-dated row never slides earlier for a caller (paced first
  // contact has no mail carrying its delay — run_at is the only gate),
  // so adoption can't pull its start forward. A retire re-anchors
  // the row's own intent as an 'event' item carrying its params and
  // deadline — unless pending mail already carries that SAME intent
  // (matching kind, provenance marker, channel and draftOnly — and for a
  // scheduled row a notBefore at least its deadline, e.g. the reply-quiet
  // mail that parked it) — then releases its consumed mail. The intent
  // parks/fires under exactly the gates the row had.
  const callerAt = input.runAt ?? new Date();
  const adopt = async (a: {
    id: string;
    status: string;
    kind: string;
    thread_id: string | null;
    params: Record<string, unknown>;
    run_at: Date | null;
  }): Promise<string | null> => {
    if (a.status !== 'queued') return a.id;
    const { disabledKinds, autoOff } = await claimPolicyTx(tx);
    const p = a.params ?? {};
    const parkedByPolicy =
      disabledKinds.includes(a.kind as PlaybookKind) ||
      (autoOff && ('auto' in p || p['origin'] === 'inbound'));
    const scheduled = a.run_at !== null && a.run_at.getTime() > callerAt.getTime();
    if (parkedByPolicy || scheduled) {
      // Status-conditional — a worker claiming between our select and this
      // update means the row already owns everything arriving for it.
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
      // A pending item only stands in for the retired row when it carries
      // the same intent whole: same kind, same thread, and EQUAL params —
      // the sweep respawns from the item's own params, so a missing key
      // loses intent while an extra gating key ('auto', channel,
      // draftOnly) makes it spawn or drain under different constraints
      // than the row had. A scheduled row also needs a notBefore reaching
      // its deadline or the schedule evaporates with it.
      const covered = (
        await tx<{ ok: boolean }[]>`
          select exists (
            select 1 from agent_inbox i
            where i.lead_id = ${input.leadId ?? null} and i.consumed_at is null
              and i.payload->>'requestedKind' = ${a.kind}
              and coalesce(i.payload->>'threadId', '') = ${a.thread_id ?? ''}
              and coalesce(i.payload->'params', '{}'::jsonb) = ${tx.json(p as never)}::jsonb
              and (not ${scheduled}
                   or coalesce(nullif(i.payload->>'notBefore', '')::timestamptz,
                        '-infinity'::timestamptz)
                      >= ${a.run_at ?? null}::timestamptz - interval '5 seconds')
          ) as ok
        `
      )[0]!.ok;
      if (!covered) {
        await enqueueInboxTx(tx, input.leadId!, 'event', {
          text: `uma '${a.kind}' estava marcada${typeof p['focus'] === 'string' ? ` — ${p['focus']}` : ''}`,
          requestedKind: a.kind as PlaybookKind,
          threadId: a.thread_id,
          params: p,
          ...(scheduled ? { notBefore: a.run_at!.toISOString() } : {}),
        });
      }
      await releaseInboxTx(tx, a.id, true);
      return null;
    }
    // Runnable + no schedule conflict — keep the row, pull its start to
    // the earlier of the two intents (status-conditional: a claim in
    // flight owns the mail just the same). Each item's own notBefore
    // still gates its drain, so inbound quiet periods hold.
    await tx`
      update agent_runs
      set run_at = least(coalesce(run_at, now()), ${callerAt})
      where id = ${a.id} and status = 'queued'
    `;
    return a.id;
  };
  if (input.leadId) {
    // An already-active run owns the mail regardless of the cap — delivery
    // into it costs nothing extra, so the active row wins before the cap
    // check (a refused verdict must not strand an enqueue site that could
    // have delivered). Callers hold capfin — the read can't race a sibling.
    const active = await tx<
      {
        id: string;
        status: string;
        kind: string;
        thread_id: string | null;
        params: Record<string, unknown>;
        run_at: Date | null;
      }[]
    >`
      select id, status, kind, thread_id, params, run_at from agent_runs
      where lead_id = ${input.leadId} and status in ('queued', 'running')
      order by created_at limit 1
    `;
    if (active.length) {
      const adopted = await adopt(active[0]!);
      if (adopted) return adopted;
    }
    const verdict = await leadUnderCostCapTx(tx, input.leadId);
    if (verdict !== 'under') {
      if (cap) cap.flagged = verdict === 'flagged';
      return null;
    }
  }
  // One active run per lead (agent_runs_one_active_per_lead). The mailbox
  // model means a second insert is never an error: the caller's intent
  // already lives in an agent_inbox item, so a conflicting row just owns
  // the delivery — return its id. ON CONFLICT's arbiter does the check
  // atomically inside the insert; on hit the row aborts and DO NOTHING
  // returns nothing (the plain INSERT would instead abort the whole tx on
  // the unique violation).
  const row = (
    await tx<{ id: string }[]>`
      insert into agent_runs (kind, lead_id, thread_id, params, run_at)
      values (${input.kind}, ${input.leadId ?? null}, ${input.threadId ?? null}, ${tx.json((input.params ?? {}) as never)}, ${input.runAt ?? null})
      on conflict (lead_id) where status in ('queued', 'running') do nothing
      returning id
    `
  )[0];
  if (row) return row.id;
  const existing = await tx<
    {
      id: string;
      status: string;
      kind: string;
      thread_id: string | null;
      params: Record<string, unknown>;
      run_at: Date | null;
    }[]
  >`
    select id, status, kind, thread_id, params, run_at from agent_runs
    where lead_id = ${input.leadId ?? null} and status in ('queued', 'running')
    order by created_at limit 1
  `;
  // Same adopt path — if the just-appearing row is policy-parked it retires
  // and the caller's item waits for the orphan sweep (same disposition as a
  // cap refusal: the mail is pending, the sweep mints its owner).
  return existing[0] ? await adopt(existing[0]) : null;
}

export async function enqueueRun(
  sql: Sql,
  input: {
    kind: RunRow['kind'];
    leadId?: string | null;
    threadId?: string | null;
    runAt?: Date | null;
    params?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { id, capFlagged, retired } = await controlTx(sql, async (tx) => {
    const cap: { flagged?: boolean; retired?: string[] } = {};
    return {
      id: await insertRun(tx, input, cap),
      capFlagged: cap.flagged === true,
      retired: cap.retired ?? [],
    };
  });
  if (id) emitControlEvent('run.update', id);
  for (const r of retired) emitControlEvent('run.update', r);
  // A fresh flag committed a [humano] task — emit lead.change (unscoped;
  // the coalescer drops middle refs on bursts) or Tasks stays stale.
  if (capFlagged) emitControlEvent('lead.change');
  return id;
}

/** Flags leads already over the lifetime cap whose crossing no insert or
 *  finish will ever see (e.g. staff LOWERED leadLifetimeCostCapUsd below
 *  existing spend): without this pass their queued runs park silently.
 *  leadUnderCostCapTx dedupes per (lead, cap level) — re-runs are cheap.
 *  Called after a committed guardrails write; emits lead.change for leads
 *  that got a NEW flag so the task list refreshes at once. */
export async function flagCappedLeads(sql: Sql, limit = 200): Promise<number> {
  const fresh: string[] = [];
  const excluded: string[] = [];
  // One COMMITTED tx per batch: the xact-scoped 'capfin:' advisories
  // leadUnderCostCapTx takes pile up until commit, so a single sweep tx on
  // a populated DB would hold every flagged lead's lock for the whole
  // request. Per-batch commits release them incrementally — and the
  // not-exists dedupe makes chunking safe: a flag batch N wrote drops the
  // lead out of batch N+1's fresh snapshot.
  // Only UNFLAGGED-at-this-cap leads come back — without the filter a
  // window full of already-flagged leads would let every lead beyond
  // `limit` park silently, pass after pass. No round cap: a settings write
  // is the only trigger, so every unflagged over-cap lead must flag or it
  // stays parked with no staff task. Lead order is fixed (lead_id) so two
  // concurrent sweeps take the per-lead advisories in the same order and
  // can't cross-lock each other.
  for (;;) {
    const batch = await controlTx(sql, async (tx) => {
      // Settings are re-read per batch — a cap write mid-sweep is honored
      // on the next chunk instead of being masked by the stale threshold.
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
        // 'under' means the cap ROSE mid-sweep — exclude it or a later
        // batch re-selects it. 'already' drops out of the next batch's
        // not-exists on its own.
        if (verdict === 'under') excluded.push(lead_id);
      }
      return { flagged, done: capped.length < limit };
    });
    fresh.push(...batch.flagged);
    if (batch.done) break;
  }
  // Unscoped: the console coalesces a burst of events into one pending
  // event and keeps a single ref — per-lead refs would drop intermediate
  // cards' refreshes; one bare event refreshes every open card + the badge.
  if (fresh.length) emitControlEvent('lead.change');
  return fresh.length;
}

export async function claimRun(sql: Sql): Promise<RunRow | null> {
  const capFlagged: string[] = [];
  const run = await controlTx(sql, async (tx) => {
    // Staff/founder numbers never run — ingest already refuses to mint
    // them, this covers leads created before the list existed.
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const ignoredPhones = g.ignoredPhones ?? [];
    const ignoredDigits = ignoredPhones.map(phoneDigits).filter((d) => d.length >= 6);
    // Over-cap leads are excluded in the SCAN — not just rejected post-pick —
    // so a prefix of parked capped runs can't monopolize the 8-attempt loop
    // and starve runnable leads queued behind them. The locked revalidation
    // below still catches spend landing between scan and claim.
    const capCents = capCentsOf(g);
    // Autonomy/playbook switches park queued work in the scan (like the
    // other suppressions): a disabled playbook holds every row of its kind,
    // workspace 'off' holds only automation-queued rows (auto marker or
    // inbound origin) — staff runs and promised callbacks stay eligible.
    const { disabledKinds, autoOff } = await claimPolicyTx(tx);
    // Outreach is serial per lead: a 'running' outreach row is the durable
    // ownership token — it outlives the claim tx, so a queued same-lead
    // outreach can only claim once the owner finishes (a crashed owner is
    // reclaimed by lease first).
    const rejected: string[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const cand = await tx<RunRow[]>`
        select r.id, r.kind, r.lead_id, r.thread_id, r.params, r.steps
        from agent_runs r
        where r.status = 'queued'
          and (r.run_at is null or r.run_at <= now())
          -- suppressed leads hold their queue: 'off' is a human veto, archived
          -- and unsubscribed are suppressed everywhere else already. Runs stay
          -- queued (pause semantics — they resume if the flag lifts).
          and (r.lead_id is null or exists (
            select 1 from leads l
            where l.id = r.lead_id
              and l.agent_mode <> 'off'
              and l.archived_at is null
              and l.unsubscribed_at is null
              -- lead-wide handoff (unbound request_human): parked like the
              -- other suppressions — claims resume when staff lifts the flag.
              and l.agent_paused_at is null
              -- ignored numbers park in the scan itself — rejected rows
              -- would still consume the 8-attempt loop and a parked prefix
              -- could starve the whole queue.
              and (l.whatsapp is null or
                regexp_replace(l.whatsapp, '\D', '', 'g') <> all(${ignoredDigits}::text[]))
              and (l.phone is null or
                regexp_replace(l.phone, '\D', '', 'g') <> all(${ignoredDigits}::text[]))
              -- lifetime cost cap in the scan itself (0 = uncapped): a
              -- capped lead never becomes a candidate, it parks until the
              -- ceiling moves.
              and (${capCents} <= 0 or
                coalesce((select sum(x.cost_cents) from agent_runs x
                          where x.lead_id = l.id), 0) < ${capCents})
          ))
          -- a staff-paused thread suppresses the same way — revalidated here
          -- on a fresh snapshot so a pause landing after enqueue still holds
          -- the run (the enqueue gate can't close the post-insert window).
          and (r.thread_id is null or exists (
            select 1 from lead_threads t
            where t.id = r.thread_id and t.agent_enabled
          ))
          -- the busy-lead exclusion lives in the scan itself so a durably
          -- blocked lead never becomes a candidate — no queue-wide barrier
          and (r.kind <> 'outreach' or r.lead_id is null or not exists (
            select 1 from agent_runs x
            where x.lead_id = r.lead_id and x.kind = 'outreach'
              and x.status = 'running'
          ))
          and not (r.kind = any(${disabledKinds}::text[]))
          and not (${autoOff} and (r.params ? 'auto' or r.params->>'origin' = 'inbound'))
          and not (r.id = any(${rejected}::uuid[]))
        order by r.created_at
        limit 1
        for update skip locked
      `;
      const run = cand[0];
      if (!run) return null;
      // 'capfin' must be a tx's first lock for a lead (see capLockTx) — a
      // claim holding this row and BLOCKING on it would cycle against a
      // finisher's key-share. Try-only: a live evaluator means "flagging
      // or about to be capped" — parking this candidate is the right
      // disposition anyway, so contention just means reject. It also
      // serializes the claim against ingestInbound's gate (which holds
      // capfin through its cancel): while the gate runs, every same-lead
      // candidate rejects here and the queued cancel always wins.
      if (run.lead_id) {
        const capFree = await tx<{ got: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtext(${'capfin:' + run.lead_id})) as got
        `;
        if (!capFree[0]!.got) {
          rejected.push(run.id);
          continue;
        }
      }
      // Both row revalidations fail fast under one savepoint — a contended
      // lock means the pause/suppression writer wins, so park instead of
      // waiting (a blocking wait on rows while holding this candidate's
      // lock is how claims and the inbound cancel deadlocked each other).
      // The savepoint is load-bearing: a 55P03 outside it would abort the
      // whole claim tx, failing every later statement with 25P02.
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
        // The scan predicate reads t.agent_enabled on the select snapshot —
        // a pause committed between it and the status flip below would
        // still claim. Revalidate under the thread row lock — nowait for
        // the same reason as the lead leg: contention is "about to be
        // suppressed", so reject.
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
        // Lifetime cost cap, re-checked at claim: runs queued while the lead
        // was under budget must not sail past it — parked like the other
        // suppressions so raising the cap resumes the queued work. The lead
        // row lock above serializes this with same-lead claim decisions.
        const capVerdict = await leadUnderCostCapTx(tx, run.lead_id);
        if (capVerdict !== 'under') {
          if (capVerdict === 'flagged') capFlagged.push(run.lead_id);
          rejected.push(run.id);
          continue;
        }
      }
      if (run.kind === 'outreach' && run.lead_id) {
        // Serialization point for concurrent claims on one lead: the scan's
        // not-exists only sees committed owners — a claim still mid-flight
        // would slip past it, so the decision is made atomic under a
        // try-advisory (it never waits → no deadlock) and 'running' is
        // re-checked under it on a fresh snapshot.
        const got = await tx<{ got: boolean }[]>`
          select pg_try_advisory_xact_lock(hashtext(${'claimrun:' + run.lead_id})) as got
        `;
        if (!got[0]!.got) {
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
        -- run_at re-checks atomically: the scan's due filter is a stale
        -- snapshot — an inbound quiet floor or a test park can push run_at
        -- forward between scan and claim, and claiming anyway would fire a
        -- send inside the quiet period.
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
  // Claim-time refusals commit fresh flags in the same tx — the task
  // refresh rides lead.change, unscoped like the other flag emitters.
  if (capFlagged.length) emitControlEvent('lead.change');
  return run;
}

/** Consumed mail a dead run can no longer answer returns to pending —
 *  the orphan sweep respawns a run for it rather than stranding the
 *  intent in a failed journal. Bounded: `deliveries` counts respawns,
 *  and after 2 the item keeps its stamp — a permanently failing item
 *  would otherwise respawn forever, and the failed run's staff task is
 *  already the human path. Shared by finishRun's 'failed' branch, the
 *  terminal-reclaim commit, and the staff-cancel endpoint. Delivery is
 *  at-least-once — the first re-serve stamps a `resumed` marker and a
 *  note in the rendered text so the serving run checks the thread
 *  history for what the dead run already did (it may have sent).
 *
 *  `event` retirements (staff cancel, wakeup cancel, inbound cancel,
 *  promised-work takeover) carry no failure signal — the run didn't die
 *  serving the mail, an event retired it — so the bound lifts: every
 *  outstanding request returns for another serve rather than stranding
 *  consumed by a canceled run. Failure retirements keep the bound —
 *  that's where poison mail lives. */
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
      -- an inbound whose stamped answer is live, landed, or merely
      -- ATTEMPTED is never outstanding work: send_message writes
      -- answeredBy at compose-commit, and run-scoped dedup can't see
      -- that send under a respawned run's id — releasing it re-sends.
      -- 'failed' with dispatch_attempted_at went to the wire (timeout
      -- after accept, worker death mid-call): at-most-once says don't
      -- re-serve on an uncertain outcome. 'failed'/'draft' with no
      -- attempt provably never left, so that mail re-serves.
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
  },
): Promise<boolean> {
  const out = await controlTx(sql, async (tx) => {
    // capfin before the run-row update — the cap evaluator that takes it
    // first can never deadlock (see capLockTx); grabbing it after locking
    // the run row would invert against inbound's cancel predicate, which
    // now covers 'running' auto rows too.
    if (run.leadId) await capLockTx(tx, run.leadId);
    const updated = await tx<{ id: string; lead_id: string | null; kind: RunRow['kind'] }[]>`
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
    // Same commit: the journaled trajectory lands in agent_run_steps too.
    if (r) await syncRunStepsTx(tx, run.id, result.steps);
    // Failed-run visibility — a run dying here only ever showed in the Runs
    // UI. Lead-bound failures flag the card with the same '[humano] <reason>'
    // task request_human writes; board-scoped failures have no card and roll
    // up into the daily digest counter instead.
    if (r?.lead_id && result.status === 'failed') {
      // Consumed mail a dead run can no longer answer returns to pending —
      // the orphan sweep respawns a run for it rather than stranding the
      // intent in a failed journal. 'done'/'canceled' keep their mail: a
      // finished run rendered it; cancel paths handle their own (the
      // staff-cancel endpoint releases consumed mail, unsubscribe drops
      // pending mail itself).
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
    // The run that CROSSES the cap is where the alert must land — queued
    // siblings are scan-excluded and never reach the claim check, so this
    // is the only flag write that covers "spent past the ceiling".
    // A SUCCESSFUL crossing flags too — the verdict distinguishes "we
    // wrote the flag" from "it already existed", which the post-commit
    // emit needs.
    const cap = r?.lead_id ? await leadUnderCostCapTx(tx, r.lead_id) : 'under';
    return { updated, cap };
  });
  if (out.updated.length) {
    emitControlEvent('run.update', run.id);
    // The [humano] task lands in the tx — the task list/badge refresh on
    // lead.change, so mirror the event a real lead update would emit. A
    // fresh cap flag writes the same kind of task — emit on that too, or
    // open Tasks views stay stale on a successful crossing. Fresh flags go
    // UNSCOPED: the console coalesces a burst into one pending event with a
    // single ref, so scoped emits would strand the middle leads' refreshes
    // (the same reason flagCappedLeads emits bare).
    const r = out.updated[0];
    if (r?.lead_id && (result.status === 'failed' || out.cap === 'flagged'))
      emitControlEvent('lead.change', out.cap === 'flagged' ? undefined : r.lead_id);
  }
  return out.updated.length > 0;
}

export async function contextFor(
  sql: Sql,
  run: RunRow,
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
      // Run params can override the lead's standing goal for a one-off run —
      // dispatch writes agent_goal; ad-hoc callers may pass params.goal only.
      if (run.params.goal === 'meeting' || run.params.goal === 'negotiation') {
        goal = run.params.goal;
      }
      if (run.kind === 'triage' || run.kind === 'reply' || run.kind === 'outreach') {
        parts.push(`GOAL: ${goal}`);
        // The negotiation plan lives on the lead — surface it as its own block
        // so the model ticks it instead of re-deriving strategy each run.
        const plan = rows[0].j.agent_plan;
        if (Array.isArray(plan) && plan.length) {
          parts.push(`PLANO: ${JSON.stringify(plan)}`);
        }
        // Structured per-lead memory (memory v2): durable key/value facts
        // set by set_fact calls and staff PUTs — survives plan rewrites and
        // note churn. Low-confidence entries are marked so the model knows
        // to re-verify before asserting them. Bounded + recent-first: a
        // lead with >50 facts still surfaces the freshest ones. Pre-0035
        // schemas have no table — omit the block, don't fail the run.
        const facts = await controlTx(sql, async (tx) =>
          (await hasMemoryTablesTx(tx))
            ? leadFactsTx(tx, run.lead_id!, { limit: 50, order: 'recent' })
            : [],
        );
        if (facts.length) {
          parts.push(
            `FATOS (memória estruturada do lead — set_fact atualiza):\n${facts
              .map(
                (f) =>
                  `- ${f.key}: ${f.value}${f.confidence < 1 ? ` (confiança ${f.confidence})` : ''}`,
              )
              .join('\n')}`,
          );
        }
        // Dossier: recent notes + research findings — the agent must know the
        // business it's negotiating with, not just the raw lead row.
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
          // CRM-native link: /agendar?t=<per-lead signed token>. The stored
          // bookingUrl stays as the fallback — mint needs the boot secret.
          try {
            bookingUrl =
              (await bookingLinkForRunner(sql, run.lead_id!)) ?? meeting.bookingUrl ?? null;
          } catch (e) {
            agentLog.warn({ err: e }, 'booking link mint failed — falling back to setting');
            bookingUrl = meeting.bookingUrl ?? null;
          }
          parts.push(`BOOKING_URL: ${bookingUrl ?? '(não configurado)'}`);
        }
        // Ground truth on reachable channels — the model must not compose on
        // a channel the lead can't be reached on (the classic bug: draft on
        // whatsapp when the lead has no number or the driver is off).
        const avail = await controlTx(sql, (tx) => channelAvailabilityTx(tx, run.lead_id!));
        const chanLine = (['whatsapp', 'email'] as const)
          .map((ch) => `${ch} ${avail[ch].ok ? 'ok' : `indisponível (${avail[ch].reason})`}`)
          .join(' · ');
        parts.push(`CANAIS: ${chanLine}`);
        const want = run.params.channel;
        if (want === 'whatsapp' || want === 'email') {
          // The pin's source is either a staff pick or the channel that
          // delivered the mail — either way sends must ride this channel.
          parts.push(`CANAL FORÇADO: ${want}`);
        }
        if (run.params.draftOnly === true) {
          parts.push(
            'MODO ASSISTÊNCIA: staff pediu uma sugestão — send_message compõe rascunho, nada sai sem aprovação da equipe.',
          );
        }
      }
    }
  }
  if (run.thread_id) {
    // Messages whose inbox item is still inside its quiet period stay out
    // of context too — drainInbox holds the item, but the model could
    // otherwise read the same text straight off the thread and reply
    // before notBefore. Once the deadline passes the item drains and the
    // message shows normally.
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
      `AGENDA (seus retornos agendados — use schedule para remarcar):\n${
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
    // Caller-chosen lead goal — the prompt turns it into the stop condition
    // and create_lead enforces it as the per-run cap (ctx.leadCap).
    const target = Number(run.params.target);
    if (Number.isFinite(target) && target > 0) {
      parts.push(`META: criar até ${Math.floor(target)} leads`);
    }
    if (run.params.briefName) {
      parts.push(`BRIEF: ${String(run.params.briefName)}`);
    }
    // What already converts — the learning loop. Discovery should lean toward
    // segments that reply, not just the brief's default.
    const stats = await segmentStats(sql);
    if (stats.length) {
      parts.push(
        `SEGMENTOS (leads · responderam · ativos · custo):\n${stats
          .map(
            (s) =>
              // costCents is agent spend — metered in USD, unlike deal values.
              `- ${s.segment}: ${s.leads} leads · ${s.replied} responderam · ${s.live} ativos · US$${(s.costCents / 100).toFixed(2)}`,
          )
          .join('\n')}`,
      );
    }
  }
  if (run.kind === 'strategist') {
    // The weekly review's inputs: what converts (same segment table
    // discovery sees) plus every current brief — the model proposes only
    // gaps, so it must read the coverage it would be duplicating.
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
    // Every brief contributes one complete signature line — name, query,
    // segment, and city are the fields overlap is judged on, so none can be
    // truncated (a shared 80-char prefix could hide a distinguishing suffix).
    // The section itself fits a char budget, newest first: a board that
    // outgrows it degrades to a count rather than overflowing the context
    // window. Exact dup checking stays deterministic in propose_brief's DB
    // check.
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

/** Journal mining — every query fired and url read this run, for the
 *  reflection tick and finish nudge ("don't re-walk dead ends"). */
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

/** Tool-behaviour sets (ACTION/READ/MUTABLE_READS/NON_IDEMPOTENT) are
 *  derived from agent/tool-meta.ts. */

/** True once this run's journal holds a landed action call — a result that
 *  neither errored, came back {blocked} (a blocked send produced nothing
 *  visible) nor {ignored} (an update_lead stripped of every field changed
 *  nothing). */
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

/** Max chars of a replayed tool result — the model needs the call's outcome
 *  (contacts found, blocked reason, ids), not a full page dump. */
const REPLAY_OUT_MAX = 3000;

export interface JournalReplay {
  /** Model turns across ALL prior attempts — seeds ctx.step so a resumed
   *  run's idempotency keys (agent:run:step:name:callId) keep their per-step
   *  uniqueness instead of colliding with the earlier attempt's step 0..k. */
  baseStep: number;
  /** Assistant/tool/user turns from the MOST RECENT attempt (entries after
   *  the last 'resumed' marker), ready to append to the conversation. */
  messages: AgentMessage[];
  /** Prior attempt's prospect ledger + banked contacts — the discovery
   *  reflection/nudge read these; without them a resumed run re-walks. */
  book: Map<string, BookEntry>;
  seenContacts: Set<string>;
  /** Latest stored discovery plan — lives only in ctx (no durable field), so
   *  the journal's plan tool output is the only place it survives a crash. */
  plan: string | null;
  /** Reply's read_pages spend carries over — the cap is per RUN, not per
   *  attempt, or a reclaim would hand back a fresh budget. */
  pageReads: number;
  /** Pages the journal already fetched — a reread after recovery hits the
   *  rebuilt cache instead of spending against the cap twice. */
  pageCache: Map<string, Promise<unknown>>;
  /** Signatures of artifact-minting calls the journal proves landed
   *  (clean result — pending entries whose durable claim proves they
   *  committed are resolved into clean outs by reconcileInterrupted
   *  before this runs; unclaimed pendings minted nothing and stay
   *  retryable): a re-emitted one would mint a second row. */
  landedSigs: Set<string>;
}

/** Replay a reclaimed run's journal into live conversation + harness state.
 *  A requeued run used to restart blind — the model redid the work and
 *  could double-contact (idempotency keys only dedupe the identical call at
 *  the identical step, which a fresh index sequence can't express). Entries
 *  land verbatim: assistant turns keep their toolCalls (id + Gemini
 *  thoughtSignature ride along), tool results replay truncated, and calls
 *  that crashed mid-batch (pending, no out) close with an explicit
 *  interrupted marker so the model re-checks state instead of assuming. */
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
  /** Every contact-bearing tool output shape — mirrors what the live tools
   *  push through ctx.seenContacts (book channels, maps candidates,
   *  instagram foundContacts, serp result contacts). */
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
  // Harness reconstruction scans the WHOLE journal — unlike the
  // conversation (bounded to the latest attempt below), the ledger and
  // banked contacts accumulate across attempts. Skipping earlier attempts
  // would re-bank a phone attempt 1 already found and reset the
  // no-progress detector.
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
      // Clean result = definitely landed (reconcileInterrupted resolved
      // committed pendings into their stored responses upstream, so
      // they arrive here as clean outs too). Errored/blocked/ignored
      // minted nothing, and an unclaimed still-pending entry never
      // executed — both stay retryable. Exception: when the claim
      // lookup itself failed, an out-less entry might have committed —
      // suppressing the re-emission beats a possible duplicate row.
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
      // The journaled marker is authoritative: it's the fetch spend the
      // call charged (0 for a fully-cached read — the cap prices fetches,
      // not calls). Current code stamps readSpent: 0 at journal time and
      // increments it per reservation, so a dead pending entry carries
      // its real spend — and one stamped 0 provably died before
      // validation. Markerless entries are pre-marker legacy journals:
      // completed calls count one spend (that era charged per call), and
      // a still-pending/out-less entry reserves one too — the legacy
      // runner may have died mid-fetch, and whether its fetch issued is
      // unknowable from the journal; reserving is the conservative side
      // for a spend cap (it can only under-fetch recovery, never breach
      // the budget the entry's run was charged against). The two
      // pre-check rejections (REPEAT suppression; a malformed 'needs
      // urls' call) never reached the counter.
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
      // Re-bank fetched pages under both request and final url — a
      // recovered run's reread then hits the rebuilt cache instead of
      // paying for a page the run already holds.
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
    // Last stored plan wins — including an empty one: a cleared plan must
    // clear, not resurrect the previous string.
    if (t.name === 'plan' && p?.stored === true && typeof p.plan === 'string') {
      replay.plan = p.plan;
    }
  }
  // Boundary = the last 'resumed' marker whose attempt actually reached the
  // model: replay only that attempt. Earlier attempts' effects are already
  // in CRM state (fresh contextFor output) — replaying them too would just
  // bloat context each retry. A 'resumed' marker with no 'model' after it is
  // an attempt that died between claim and first chat — skipping past it
  // would hide the last substantive attempt's journal entirely, so keep
  // walking back to one that did work.
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
  // Calls the last model turn announced that still lack a journaled result.
  // Flushed at the next model entry / end: each gets an interrupted result.
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
      // journals before replay shipped names-only; current entries carry the
      // full ToolCall (id + thoughtSignature keep Gemini replay verbatim).
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
    if (s.type === 'nudge' || s.type === 'reflection' || s.type === 'inbox') {
      flush();
      replay.messages.push({ role: 'user', content: s.content ?? '' });
      continue;
    }
    // 'system_prompt' / 'monid_spend' / 'resumed' — handled elsewhere.
  }
  flush();
  return replay;
}

/** Reconcile journaled-but-unresolved tool calls against the durable claim
 *  table. A mutation commits through claimControl under key
 *  `agent:run:step:name:callId` BEFORE the runner can journal the result —
 *  a worker that died inside that window left a real, applied effect marked
 *  pending. The stored response IS the call's result: writing it into the
 *  journal entry turns a would-be 'interrupted — verify before re-doing'
 *  into the true outcome, which is stronger than dedupe (the model never
 *  thinks the effect is missing, so it won't emit a fresh call at all). */
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

/** The run prompt's memory feed — memory v2: pinned learnings, learnings
 *  matching the run's segment (the brief's `params.segment`, else the bound
 *  lead's `segment`), workspace learnings, latest debriefs. The legacy flat
 *  facts list only serves a schema that never ran 0035 — once the table
 *  exists it's the only source (0035 backfilled every v1 fact, so an empty
 *  feed means staff emptied it, not a gap to backfill).
 *  Exported for tests. */
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

/** Doctrine write-back — a deterministic debrief line stored as a
 *  scope='debrief' memory item on a finished run: what the segment/city
 *  yielded, which tools resolved whatsapp, which prospects dead-ended.
 *  Next run's memory feed includes recent debriefs, so runs compound. */
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
  // memory v2: debriefs are their own capped scope — they no longer evict
  // the learnings the way the shared facts list let them. A schema ahead
  // of the 0035 migration has no debrief sink — skip (the deploy-ordering
  // window is hours, not a state worth alerting on). Never throws:
  // doctrine write-back must not fail a finished run, but warn so a broken
  // write doesn't go silent.
  await controlTx(sql, async (tx) => {
    if (!(await hasMemoryTablesTx(tx))) return;
    await appendDebriefTx(tx, {
      content: fact.slice(0, 500),
      sourceRunId: run.id,
      segment: typeof run.params.segment === 'string' ? run.params.segment : null,
    });
  }).catch((e) => agentLog.warn({ err: e, runId: run.id }, 'debrief write failed'));
}

// ---------------------------------------------------------------------------
// runOnce kernel — the agent loop decomposed into named phases that share
// one Attempt bag. runOnce itself is the spine: claim → openAttempt
// (journal resume + cost accounting) → buildAttemptContext → runKernel
// (model call → guards → finish gate → tool dispatch) → endgame.
// ---------------------------------------------------------------------------

/** One execution of a claimed run. The kernel phases mutate this bag so
 *  the loop reads as its spine instead of one ~700-line block. None of
 *  it is a public contract — phases own their own fields. */
interface Attempt {
  sql: Sql;
  run: RunRow;
  claim: { id: string; claimToken: string; leadId: string | null };
  /** reconcileInterrupted ran — false leaves pending artifact-mints
   *  replayed conservatively (see replayJournal). */
  claimsChecked: boolean;
  /** The row's journal at claim time — a prefix of `steps`. */
  priorSteps: unknown[];
  /** journal: the whole trajectory across attempts (the audit trail). */
  steps: unknown[];
  messages: AgentMessage[];
  /** Set when the row stops matching this execution: canceled via the API,
   *  or reclaimed and re-queued after going stale. The loop unwinds at the
   *  next boundary — in-flight tool calls finish but nothing else is
   *  persisted or sent. */
  lost: boolean;
  /** Serializes journal writes — see persist. */
  tail: Promise<void>;
  /** agent_run_steps cursors — entries committed so far, and the earliest
   *  seq still pending (its row re-writes until the call's `out` lands). */
  synced: number;
  dirtyFrom: number;
  /** cost accounting: prior attempts' usage folded back in (finishRun
   *  overwrites the columns wholesale) plus this attempt's deltas;
   *  monidBudget is the live enrichment ledger. */
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  monidBudget: MonidBudget;
  playbook: EffectivePlaybook;
  heartbeat: ReturnType<typeof setInterval>;
  /** context build — provider/prompt plus the journal-replayed harness. */
  replay: JournalReplay;
  ctx: ToolContext;
  provider: LlmProvider;
  system: string;
  tools: AgentTool[];
  /** Playbook kinds whose toolsets this attempt may serve — seeded with
   *  run.kind; drainInbox adds a drained item's requestedKind so mail
   *  asking for another kind's work (a reply intent inside an outreach
   *  run) keeps its tools — e.g. an opt-out needs reply's unsubscribe. */
  toolKinds: Set<string>;
  /** kernel-loop state — res is the current chat() result. */
  i: number;
  res: LlmResult;
  nudged: boolean;
  /** steps index of the latest drained batch carrying mail whose requestedKind
   *  requiresAction — the finish gate's action bar inside a run whose own
   *  playbook doesn't demand one (a triage run that picked up reply mail
   *  still owes the lead an answer). -1 = no action-mail drained. */
  actionInboxIdx: number;
  /** The action-mail nudge's own per-attempt budget — independent of
   *  `nudged` so discovery's produce-or-perish nudge can't consume it
   *  (a zero-lead discovery nudge must not silence drained reply mail).
   *  Resets on every drained batch like `nudged`. */
  actionNudged: boolean;
  limit: number;
  lastProgress: number;
  loopNudged: boolean;
  prevSigs: Map<string, { ok: boolean; v: number }>;
  landedSigs: Set<string>;
  stateVersion: number;
}

/** Non-terminal tool entries — their row re-writes until `out` lands (the
 *  same predicate reconcileInterrupted heals on). */
const pendingToolEntry = (e: unknown): boolean => {
  const s = e as { type?: string; pending?: boolean; out?: unknown } | null;
  return s?.type === 'tool' && (s.pending === true || s.out === undefined);
};

/** Dual-write the journal into agent_run_steps inside the same commit as
 *  the agent_runs.steps write, so the two stores can't diverge mid-crash.
 *  seq is the entry's index in the committed snapshot; a committed entry
 *  is immutable except pending→out, which `on conflict` carries. `from`
 *  skips the terminal prefix. A batch entry can shift positions when a
 *  spend marker lands mid-flight — the delete first re-seats that call's
 *  row instead of doubling it under a new seq. */
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
    // Monetary cost only — model usage carries real USD. readSpent is a
    // fetch count, not money, and monid_spend markers are cumulative
    // snapshots, so neither maps to a per-row cost_cents.
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
  // Ghost rows: a mid-batch spend marker commits a snapshot that doesn't
  // carry the pending `extra` batch, so previously-synced entries past the
  // committed length are stale — drop them. Always keyed on the full
  // snapshot length, not `from`.
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

/** Streaming journal: every write commits the steps so far — staff watch
 *  the trajectory live instead of a silent 'running' chip — AND refreshes
 *  alive_at, the reclaim lease in drain() (started_at stays the real
 *  attempt-start timestamp — UIs read it for elapsed time). Fenced by
 *  claim_token: a stale worker's write no-ops once a new claim owns the
 *  row. Writes serialize on `tail` and each snapshots [...steps, ...extra]
 *  when its turn begins, so parallel tool resolutions can only advance the
 *  journal — a delayed write never re-commits an older pending state. */
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
        // Inbox items render exactly once: the drain's 'inbox' entry is
        // already inside `snap`, so stamping consumed inside THIS fenced
        // commit ties "rendered" to "journaled" — a run that loses the
        // fence or dies before commit leaves them pending for the next.
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

/** Journal write for an aborted run — the trajectory up to cancellation is
 *  still the audit trail, so keep it when the cancel endpoint flipped the
 *  row mid-flight. Fenced by claim_token like every other write: a stale
 *  worker can't overwrite the newer execution's journal. */
async function persistAborted(att: Attempt): Promise<void> {
  await att.tail.catch(() => undefined);
  const cap = await controlTx(att.sql, async (tx) => {
    // capfin before the run-row update — same first-lock ordering as
    // finishRun (see capLockTx) so the wait can never cycle.
    if (att.run.lead_id) await capLockTx(tx, att.run.lead_id);
    const rows = await tx<{ id: string }[]>`
      update agent_runs set steps = ${tx.json(att.steps as never[])}, finished_at = now(),
        tokens_in = ${att.tokensIn}, tokens_out = ${att.tokensOut},
        cost_cents = ${Math.round((att.costUsd + att.monidBudget.spent) * 100)}
      where id = ${att.run.id} and status = 'canceled' and claim_token = ${att.run.claim_token}
      returning id
    `;
    if (rows.length) await syncRunStepsTx(tx, att.run.id, att.steps);
    // The persisted spend can itself push the lead over the cap — without
    // this check the lead's queued siblings park silently with no task.
    if (!rows.length || !att.run.lead_id) return 'under' as CapVerdict;
    return leadUnderCostCapTx(tx, att.run.lead_id);
  }).catch((): CapVerdict => 'under');
  emitControlEvent('run.update', att.run.id);
  if (cap === 'flagged') emitControlEvent('lead.change');
}

/** Drain the lead's mailbox into this run: pending agent_inbox items become
 *  one 'inbox' journal entry + a user message, and are stamped consumed in
 *  the same fenced commit that journals them (persist's consumeInbox path)
 *  — an item is rendered exactly once, and only by a run that actually owns
 *  the claim. Returns the item count so finishGate can buy another turn. */
async function drainInbox(att: Attempt): Promise<number> {
  if (att.lost || !att.run.lead_id) return 0;
  // Draft-only mail rides only a draft-only run and vice-versa:
  // delivering draft-only mail to a send-capable run would let the
  // reaction ship unreviewed, and delivering ordinary mail to a
  // draft-only run would strand a reply as an unapproved draft. Both
  // sides wait pending for a compatible run (the request itself is new
  // work, not run context).
  const runDraftOnly = (att.run.params as { draftOnly?: unknown } | null)?.draftOnly === true;
  // Channel-pinned mail likewise defers to a run pinned the same way — a
  // delivered item can't re-point ctx.channelOverride mid-flight. A
  // thread-bound run speaks its thread's channel even unpinned: sends
  // route through the thread, so compatibility is judged on that channel.
  const runChannel =
    att.run.params?.channel === 'whatsapp' || att.run.params?.channel === 'email'
      ? att.run.params.channel
      : '';
  // And a thread pin is a channel pin by another name — staff's 'reply on
  // the email thread' carries payload.threadId, often without params.channel;
  // judged on channel alone it would drain into the whatsapp run and answer
  // on the wrong conversation. Both sides derive their effective channel
  // from their thread (run below via runThread, item inside the scope), and
  // a thread-bound run only takes its own thread's mail — an unbound run
  // stays channel-compatible (its sends resolve the item's thread).
  const runThread = att.run.thread_id ?? '';
  // A run with neither pin is a wildcard: it serves any thread the item
  // asks for, so channel/thread compat doesn't restrict what drains.
  const unpinned = runChannel === '' && runThread === '';
  // Mail still inside its quiet period (payload.notBefore, stamped at
  // enqueue) doesn't drain mid-flight either — the inbound delay holds
  // uniformly whether the item waits for this run or its own later one.
  // Read-only select — consumption is fenced inside persist, so a stale
  // worker picking items here only fails later at the fence, never
  // swallows the mail.
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
        and (${unpinned}
             or coalesce(
               payload->'params'->>'channel',
               (select lt.channel::text from lead_threads lt where lt.id::text = payload->>'threadId'),
               ${effChannel}
             ) = ${effChannel})
        and (${runThread} = '' or coalesce(payload->>'threadId', ${runThread}) = ${runThread})
        and (payload->>'notBefore' is null or (payload->>'notBefore')::timestamptz <= now())
    `;
    // A disabled playbook's mail parks — symmetric with the sweep's
    // eligible-first gate: draining it here would hand this run the
    // requestedKind's toolset (reply's unsubscribe inside an outreach
    // run) after staff switched that playbook off. The gate runs before
    // the limit, so parked mail can't starve eligible items behind it.
    const kinds = await tx<{ k: string }[]>`
      select distinct payload->>'requestedKind' as k from agent_inbox
      where ${scope} and payload->>'requestedKind' is not null
    `;
    const off: string[] = [];
    for (const { k } of kinds) {
      if (
        (PLAYBOOK_KINDS as readonly string[]).includes(k) &&
        !(await playbookEnabledTx(tx, k as PlaybookKind)).ok
      )
        off.push(k);
    }
    // Same recheck for a thread staff paused after the item enqueued —
    // the spawn gate consults lead_threads.agent_enabled, so the drain
    // must too or an unbound run still serves that thread's mail.
    const dead = (
      await tx<{ t: string }[]>`
        select distinct payload->>'threadId' as t from agent_inbox
        where ${scope} and payload->>'threadId' is not null
          and payload->>'threadId' in (
            select id::text from lead_threads where not agent_enabled
          )
      `
    ).map((d) => d.t);
    // Autonomy gates each item like the sweep's spawn gate: automation-
    // marked mail ('auto' key or origin='inbound' — the same markers
    // claimRun reads off run params) parks under workspace 'off' instead
    // of riding an allowed staff run. Unmarked mail — staff's, promised
    // work, the lead's own messages — still drains.
    const autoOff = (await autonomyTx(tx)).level === 'off';
    return tx<InboxItem[]>`
      select id, kind, payload, created_at from agent_inbox
      where ${scope}
        and (payload->>'requestedKind' is null or not (payload->>'requestedKind' = any(${off})))
        and (payload->>'threadId' is null or not (payload->>'threadId' = any(${dead})))
        and (not ${autoOff}
             or not (coalesce(payload->'params', '{}'::jsonb) ? 'auto'
                     or coalesce(payload->'params'->>'origin', '') = 'inbound'))
      order by created_at limit 10
    `;
  });
  if (!items.length) return 0;
  // Fresh mail is a state change for the repeat gate: bump the version so
  // a repeated call after the batch can't match its pre-drain twin's
  // stamp, and re-arm send_message's sig — its own dedupe keys the newest
  // consumption stamp, so the loop gate must not hold an earlier batch's
  // sig over a legitimately identical reply ('Obrigado!' is a valid
  // answer twice). 'mint' sigs keep run-wide suppression — a new batch
  // never makes a duplicate create_lead/draft legitimate, and
  // replay-seeded sigs for THIS batch stay until it answers.
  att.stateVersion++;
  // The finish gate's one-nudge budget resets with the batch: mail that
  // arrives after an earlier nudge deserves its own action demand, or a
  // text-only close consumes it with nothing on the wire.
  att.nudged = false;
  att.actionNudged = false;
  for (const s of att.landedSigs) {
    if (s.startsWith('["send_message",')) att.landedSigs.delete(s);
  }
  // The mail's requestedKind joins the run's tool kinds: an 'inbound'
  // item inside an outreach run can need reply-only tools (unsubscribe
  // honoring an opt-out). Widen both what the model is told (att.tools)
  // and what dispatch permits (ctx.toolKinds — same set instance).
  for (const i of items) {
    const k = i.payload?.requestedKind;
    if (k) att.toolKinds.add(k);
  }
  widenAttemptTools(att);
  const content = renderInboxItems(items);
  // Action-mail batches get their own finish-gate bar: reply/outreach mail
  // drained into a run whose playbook doesn't demand action still owes the
  // lead a visible answer — journaled so a reclaimed attempt re-seeds it.
  const needsAction = items.some((i) => {
    const k = i.payload?.requestedKind;
    return (
      typeof k === 'string' &&
      (PLAYBOOKS as Record<string, { requiresAction?: boolean }>)[k]?.requiresAction === true
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

/** The offered toolset follows toolKinds: whatever widened the kind set
 *  (a live drain, a reclaim's stamped mail) must be visible to the
 *  model, not just permitted in dispatch. Deduped by tool name. */
function widenAttemptTools(att: Attempt): void {
  const seen = new Set(att.tools.map((t) => t.name));
  for (const k of att.toolKinds) {
    for (const t of toolsFor(k)) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        att.tools.push(t);
      }
    }
  }
}

/** Attempt setup — journal resume + cost accounting: reconcile journaled
 *  calls that outlived their worker, fold prior attempts' spend back into
 *  the ledger, seed the journal (resumed marker + restored monid balance),
 *  then start the lease heartbeat. */
async function openAttempt(sql: Sql, run: RunRow): Promise<Attempt> {
  const priorSteps = Array.isArray(run.steps) ? run.steps : [];
  // Heal pending entries whose mutation actually committed before the
  // worker died — the stored claim response is the real result, not an
  // 'interrupted' guess. Best-effort: a failed lookup just leaves them
  // pending and they replay as interrupted like before.
  // Whether the claim lookup actually ran — a swallowed failure means
  // pending artifact-mints couldn't be verified, and replayJournal must
  // suppress them conservatively rather than risk a duplicate row.
  const claimsChecked = await reconcileInterrupted(sql, run.id, priorSteps).then(
    () => true,
    () => false,
  );
  const steps: unknown[] = [...priorSteps];
  if (priorSteps.length) {
    steps.push({ type: 'resumed', attempt: run.attempts, at: new Date().toISOString() });
  }
  const messages: AgentMessage[] = [];
  // finishRun overwrites tokens_*/cost_cents wholesale, so a reclaimed run
  // would lose everything its dead attempts already spent. Model entries
  // journal per-call usage deltas — sum them back in before this attempt
  // adds its own. Journals predating the usage field contribute 0.
  let tokensIn = 0;
  let tokensOut = 0;
  // accumulate fractional dollars — rounding to cents per step would zero out
  // sub-cent calls and skew the run total.
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
  // Paid-enrichment budget — hoisted beside costUsd so the catch-path
  // finishRun can fold monid spend into the run's stored cost. A reclaimed
  // run rebuilds from the journal's monid_spend markers — the provider
  // re-bills whether or not the local counter survived the crash.
  const priorSpend = (run.steps ?? []).reduce<number>((acc, s) => {
    const e = s as { type?: string; spentUsd?: number } | null;
    return e?.type === 'monid_spend' && typeof e.spentUsd === 'number' ? e.spentUsd : acc;
  }, 0);
  // Every kind gets a cap — research tools aren't discovery-only anymore
  // (triage/outreach enrich fresh cards, reply falls back to them), so a
  // null budget would silently mean uncapped monid calls. Discovery
  // prospecting keeps the bigger default.
  // Playbook = code defaults merged with the staff override. A failed
  // settings read falls back to the code defaults — never an uncapped run.
  const playbook = await controlTx(sql, (tx) => loadPlaybookTx(tx, run.kind)).catch(() =>
    mergePlaybook(run.kind),
  );
  const monidBudget = new MonidBudget(
    // 0 is a real cap (free tools only) — only an absent/non-numeric
    // param gets the playbook default
    run.params.monidCapUsd == null || !Number.isFinite(Number(run.params.monidCapUsd))
      ? playbook.monidCapUsd
      : Math.min(5, Math.max(0, Number(run.params.monidCapUsd))),
    priorSpend,
  );
  // The restored balance must survive another crash: seed the NEW journal
  // with it before the first persist, or a second reclaim restores zero.
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
    playbook,
    heartbeat: undefined as never,
    replay: undefined as never,
    ctx: undefined as never,
    provider: undefined as never,
    system: '',
    tools: [],
    toolKinds: new Set([run.kind]),
    i: 0,
    res: undefined as never,
    nudged: false,
    actionNudged: false,
    // Re-seeded from the journal: a prior attempt's action-mail batch still
    // owes its answer after a reclaim — the flag rides the inbox entry.
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
    limit: playbook.stepBudget,
    // Last step index that produced something (lead/merge/new channel) —
    // starts at -1 so the first tick fires after 3 truly idle steps.
    lastProgress: -1,
    loopNudged: false,
    prevSigs: new Map(),
    landedSigs: new Set(),
    stateVersion: 0,
  };
  // Every reserve/reconcile journals a monid_spend marker — a future
  // retried attempt reads it back into the budget before it can re-spend.
  monidBudget.onChange = (spent) => {
    att.steps.push({ type: 'monid_spend', spentUsd: spent });
    void persist(att);
  };
  // A single tool/model call can outlive the 10-min lease on its own — the
  // timer keeps alive_at fresh through it, so reclaim means a dead worker,
  // never a live one stuck inside a slow provider call.
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

/** Context build — provider, system prompt (pitch + memory + lead context
 *  + playbook instructions), toolset, and the journal replay: conversation,
 *  book, banked contacts and the discovery plan all restored into ctx. */
async function buildAttemptContext(att: Attempt): Promise<void> {
  const { sql, run, steps, messages } = att;
  // A reclaimed attempt seeds toolKinds from run.kind only — but mail a
  // dead earlier attempt already consumed can't re-drain, so the kinds it
  // asked for would be gone while their text still sits in the replayed
  // conversation (an opt-out needing reply's unsubscribe inside an
  // outreach run). Re-seed from the items stamped to this run — still
  // gated: a playbook switched off between attempts doesn't get its
  // tools back through the replayed mail.
  const drainedKinds = await controlTx(sql, async (tx) => {
    const rows = await tx<{ k: string }[]>`
      select distinct payload->>'requestedKind' as k from agent_inbox
      where consumed_by_run = ${run.id} and payload->>'requestedKind' is not null
    `;
    const out: string[] = [];
    for (const { k } of rows) {
      if (
        (PLAYBOOK_KINDS as readonly string[]).includes(k) &&
        (await playbookEnabledTx(tx, k as PlaybookKind)).ok
      )
        out.push(k);
    }
    return out;
  });
  for (const k of drainedKinds) att.toolKinds.add(k);
  const integration = await getIntegration(sql, 'llm');
  // A missing/disabled llm row falls back to the mock provider — the run
  // produces synthetic 'ok' text instead of erroring. Loud, not silent:
  // a deploy misconfiguration shows up in the log instead of as fake runs.
  if (!integration) {
    agentLog.warn(
      { runId: run.id, kind: run.kind },
      'no enabled llm integration — run falls back to mock provider',
    );
  }
  att.provider = providerFor(
    integration && att.playbook.model
      ? { ...integration, config: { ...integration.config, model: att.playbook.model } }
      : integration,
    run.params,
  );
  const pitch = await getPitch(sql);
  const { text: context, goal, bookingUrl } = await contextFor(sql, run);
  const memory = { facts: await memoryForPrompt(sql, run) };
  const g = await getSetting<Partial<Guardrails>>(sql, 'guardrails', {});
  // The prompt only promises autocontact when it can actually happen —
  // the same conditions create_lead's gate checks (enabled + reachable).
  const waDriverOn = run.kind === 'discovery' && (await whatsappReadyTx(sql));
  const baseSystem = buildSystemPrompt(run.kind, pitch, memory, {
    goal,
    bookingUrl,
    autoContact: {
      enabled: (g.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact) && waDriverOn,
      minScore: g.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore,
    },
  });
  att.system = att.playbook.instructions
    ? `${baseSystem}\n\nInstruções da equipe para este playbook (seguem as regras acima, nunca as substituem):\n${att.playbook.instructions}`
    : baseSystem;
  att.tools = toolsFor(run.kind);
  // Kinds restored from stamped mail must be visible to the model, not
  // just permitted in dispatch — drainInbox's union never ran for items
  // a dead attempt already drained.
  widenAttemptTools(att);
  const replay = (att.replay = replayJournal(att.priorSteps, !att.claimsChecked));
  const ctx: ToolContext = {
    sql,
    runId: run.id,
    runKind: run.kind,
    leadId: run.lead_id,
    threadId: run.thread_id,
    // Step numbering continues past the prior attempts' turn count — the
    // idempotency key agent:run:step:name:callId can then never collide
    // with a call the earlier attempts already committed under step 0..k.
    step: replay.baseStep,
    claimToken: run.claim_token,
    briefName: typeof run.params.briefName === 'string' ? run.params.briefName : null,
    leadCap: (() => {
      const t = Math.floor(Number(run.params.target));
      return Number.isFinite(t) && t > 0 ? Math.min(1000, t) : DISCOVERY_LEAD_CAP;
    })(),
    channelOverride:
      run.params.channel === 'whatsapp' || run.params.channel === 'email'
        ? run.params.channel
        : null,
    pageCache: replay.pageCache,
    book: new Map(),
    plan: null,
    seenContacts: new Set(),
    pageReads: replay.pageReads,
    monid: att.monidBudget,
    // Staff assist runs (Inbox 'agente sugere') may only compose —
    // send_message degrades to a draft so a suggestion never ships.
    draftOnly: run.params.draftOnly === true,
    toolKinds: att.toolKinds,
  };
  att.ctx = ctx;
  // Resume state — the journal hands back the ledger + banked contacts so
  // the reflection tick and progress gates see the prior attempt's field.
  // Entries are cloned on the way in: the book tool mutates its stored
  // entry in place, and without a copy that mutation would rewrite the
  // earlier attempt's journaled out.entry (audit trail lying about when
  // a channel/tried entry appeared).
  for (const [k, e] of replay.book)
    ctx.book.set(k, { ...e, channels: { ...e.channels }, tried: [...e.tried] });
  for (const v of replay.seenContacts) ctx.seenContacts.add(v);
  // Discovery plan is harness state with no durable home — rebuild from the
  // journal or reflection falsely reports '(nenhum)' after a resume.
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

/** Model call — one chat() turn: usage folds into the ledger and the turn
 *  journals verbatim (ids + thoughtSignature make replay byte-identical). */
async function modelTurn(att: Attempt): Promise<void> {
  const res = (att.res = await att.provider.chat({
    system: att.system,
    messages: att.messages,
    tools: att.tools,
  }));
  att.tokensIn += res.tokensIn;
  att.tokensOut += res.tokensOut;
  // Provider-reported USD wins; when it reports none (gemini/anthropic/
  // openai all return null), estimate from tokens × list rate — else a
  // model-only lead never reaches the lifetime cost cap.
  const callCostUsd =
    res.costUsd ?? estimateModelCostUsd(att.provider.name, res.tokensIn, res.tokensOut);
  att.costUsd += callCostUsd;
  // Full ToolCall objects, not just names: a resumed run replays this
  // turn verbatim into the conversation — ids pair with the tool results
  // and Gemini 3 400s without each call's thoughtSignature.
  att.steps.push({
    type: 'model',
    content: res.text,
    toolCalls: res.toolCalls,
    usage: { tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: callCostUsd },
  });
  await persist(att);
}

/** Finish gate — a no-toolCalls turn either ends the run or buys it ONE
 *  enforcement nudge: discovery's produce-or-perish pressure, or the
 *  messaging kinds' visible-action requirement. A nudge sets its own
 *  absolute limit (i + 5 → four follow-up calls plus the finishing turn)
 *  so it can't strand a run in 'max steps reached' late NOR inflate an
 *  early finish into a full second budget. */
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
    // A duplicate merge isn't a create — but it did merge contacts +
    // findings into an existing lead, so a merge-only run produced
    // work and escapes the zero-lead nudge.
    const merged = steps.some(
      (s) =>
        typeof s === 'object' &&
        s !== null &&
        (s as { name?: string }).name === 'create_lead' &&
        (s as { out?: { duplicate?: boolean } }).out?.duplicate === true,
    );
    const missingWa = created.filter((l) => !(typeof l.whatsapp === 'string' && l.whatsapp.trim()));
    // The journal knows every query fired and url read — feed it back
    // so the extra round tries new angles instead of re-walking the
    // dead ends that got the run here.
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
    // Per-prospect untried moves from the ledger — 'serp'/'dir' left on
    // a wa-less lead is a concrete next step, not a generic recipe.
    const LADDER = ['maps', 'ig', 'hub', 'serp', 'dir'];
    const untried = (leadName: string): string => {
      const e = att.ctx.book.get(leadName.toLowerCase());
      if (!e) return '';
      const left = LADDER.filter((m) => !e.tried.includes(m));
      return left.length ? ` (falta: ${left.join('/')})` : '';
    };
    const nudge =
      !created.length && !merged
        ? `Nenhum lead entrou no CRM ainda — descoberta só conta quando o lead é criado.${tried} Siga por um sabor NÃO tentado — outra variação de segmento/modelo de negócio/cidade — ou read_pages no prospect fraco (o diretório que citar o nome é onde telefone mora).`
        : missingWa.length
          ? `${missingWa.length} lead(s) sem whatsapp: ${missingWa
              .map((l) => `${String(l.name ?? '?')}${untried(String(l.name ?? ''))}`)
              .slice(0, 6)
              .join(
                ', ',
              )}.${tried} Uma rodada por nome antes de encerrar: serp "<nome> <cidade>" telefone/whatsapp (ângulo novo, não repita as buscas listadas); e no resultado que citar o nome — mesmo diretório/guia local — read_pages vale (é onde telefone e endereço moram).`
          : null;
    if (nudge) {
      att.nudged = true;
      // Exactly four calls after this turn: search + read +
      // create_lead + a closing response. Firing early shrinks the
      // remaining budget to that allowance; firing on the last step
      // extends it just enough to process the nudge.
      att.limit = att.i + 5;
      messages.push({ role: 'assistant', content: res.text ?? 'ok' });
      messages.push({ role: 'user', content: nudge });
      steps.push({ type: 'nudge', content: nudge });
      await persist(att);
      return 'again';
    }
  }
  // Messaging finish gate — the playbook already requires every
  // reply/outreach run to end on a visible action; a run trying to
  // close having only researched gets ONE nudge (same i+5 allowance
  // as discovery's), then ends on its own. The bar resets per drained
  // batch: mail picked up mid-attempt demands its own action — a send
  // that answered an earlier batch can't close a text-only turn over
  // fresh mail, or that item ends consumed with nothing on the wire.
  // And the bar exists even when the playbook doesn't demand one:
  // action-mail (requestedKind requiring action) drained into a
  // triage/discovery/strategist run would otherwise close consumed and
  // unanswered — no later run ever re-picks a consumed item.
  const lastInbox = steps.reduce<number>(
    (acc, s, i) =>
      typeof s === 'object' && s !== null && (s as { type?: string }).type === 'inbox' ? i : acc,
    -1,
  );
  const actionBar = att.playbook.requiresAction ? lastInbox : att.actionInboxIdx;
  // The action nudge spends `nudged` for requiresAction playbooks (it IS the
  // playbook's own nudge) but the independent `actionNudged` elsewhere — a
  // discovery run's zero-lead nudge must not silence drained action-mail.
  const actionSpent = att.playbook.requiresAction ? att.nudged : att.actionNudged;
  if (
    !actionSpent &&
    (att.playbook.requiresAction || actionBar >= 0) &&
    !runActed(steps.slice(actionBar + 1))
  ) {
    if (att.playbook.requiresAction) att.nudged = true;
    else att.actionNudged = true;
    att.limit = att.i + 5;
    const nudge = `Ação pendente — a run ainda não teve efeito visível (send_message/draft, request_human, set_state, unsubscribe, update_lead, create_task). Pesquisar e sair sem agir deixa o lead falando sozinho — aja agora; se um guardrail ou canal morto trava a ação, request_human é a saída.`;
    messages.push({ role: 'assistant', content: res.text ?? 'ok' });
    messages.push({ role: 'user', content: nudge });
    steps.push({ type: 'nudge', content: nudge });
    await persist(att);
    return 'again';
  }
  // Mail that landed mid-attempt rides this run instead of a second one:
  // drain before finishing so the run answers what arrived while it
  // worked, not just what it started with. Only when a turn remains —
  // consuming mail with no model turn left strands it in a dead journal
  // (pending items instead fall to the orphan sweep's respawned run).
  if (att.i + 1 < att.limit && (await drainInbox(att))) return 'again';
  // A cancel landing between the last persist and now leaves the row
  // 'canceled' — finishRun matches nothing; persistAborted's canceled-
  // fence still stores the usage so the spend isn't lost. Debrief runs
  // ONLY after a matched finish: work a staff member canceled must not
  // leak into the next run's doctrine.
  if (
    await finishRun(sql, att.claim, {
      status: 'done',
      steps,
      tokensIn: att.tokensIn,
      tokensOut: att.tokensOut,
      costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
    })
  ) {
    if (att.playbook.debrief) {
      // debrief → agent_memory_items: the doctrine that makes the next run
      // start smarter. Best-effort — never fail a finished run on it.
      await writeDebrief(sql, run, att.ctx, steps).catch(() => undefined);
    }
  } else {
    await persistAborted(att);
  }
  return 'end';
}

/** Tool dispatch — parallel for discovery-style playbooks (remote reads +
 *  idempotent inserts; one provider automation per call would take
 *  minutes), sequential for messaging kinds (calls in one response may
 *  depend on each other's ordering — draft before send). */
async function dispatchStep(att: Attempt): Promise<void> {
  if (att.playbook.parallelTools) await dispatchParallel(att);
  else await dispatchSequential(att);
}

/** Parallel dispatch — pending entries journal callId+step BEFORE
 *  execution: a crash mid-batch leaves entries reconcileInterrupted can
 *  resolve against the durable claim table (key agent:run:step:name:callId).
 *  After the batch lands, the reflection tick pressures the model when
 *  four steps passed without progress. */
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

  // Reflection tick — progress = a lead created/merged, a channel
  // landed on the book, or an enrichment hit. 4 steps of drift and the
  // harness reflects the field state back and asks for the next move;
  // what to do stays the model's call, this is just pressure.
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
      // book: only NEWLY added channels count — a repeat upsert of the
      // same instagram isn't progress
      if (s.name === 'book' && (out.addedChannels as string[] | undefined)?.length) return true;
      // enrichment: only contacts not already banked count
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
      }; leituras ${[...urls].slice(0, 8).join(', ') || 'nenhuma'}.\nPassos restantes: ~${Math.max(0, att.limit - att.i)}. Qual o próximo melhor movimento — novo ângulo de busca, maps_lookup, instagram_profile num @ que sobrou, ou fechar um prospect como dead? Responda e siga.`;
      steps.push({ type: 'reflection', content: reflection });
      messages.push({ role: 'user', content: reflection });
    }
  }
}

/** Sequential dispatch + loop guard — re-emitting a call whose previous
 *  result was clean can't produce anything new, and re-running a
 *  side-effecting call would duplicate it (send_message has no
 *  cross-step dedupe — a re-emitted identical send literally re-sends).
 *  Suppress per call — each repeated call gets a "já executada" result —
 *  and when the whole turn repeated, nudge once: act differently or
 *  finish. */
async function dispatchSequential(att: Attempt): Promise<void> {
  const { res, steps, messages } = att;
  const curSigs = new Map<string, { ok: boolean; v: number }>();
  let allRepeat = res.toolCalls.length > 0;
  for (const [callIndex, call] of res.toolCalls.entries()) {
    const callId = call.id ?? String(callIndex);
    // Journal the pending call BEFORE executing: a crash between the
    // mutation's commit and the result's journal write leaves an
    // entry the next attempt reconciles against the claim table.
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
    // read_pages carries its spend marker from birth — 0 until a
    // reservation stamps it. A markerless entry in a replayed
    // journal can therefore only be a pre-marker legacy read, which
    // replay counts conservatively (that era charged per call).
    if (call.name === 'read_pages') entry.readSpent = 0;
    steps.push(entry);
    await persist(att);
    const sig = JSON.stringify([call.name, call.args ?? {}]);
    const prev = att.prevSigs.get(sig);
    // Suppress only while NOTHING landed since the prior clean
    // result — reads AND writes share the version check, since a
    // repeated write after an intervening mutation can be a
    // legitimate state-restore. Artifact-minters are the exception:
    // a duplicate is never legitimate, always suppressed.
    const repeatHit = att.landedSigs.has(sig) || (prev?.ok === true && prev.v === att.stateVersion);
    // Mutable reads re-execute on a repeat so external edits stay
    // visible — but they still count toward allRepeat, or a
    // read-only loop would dodge the LOOP nudge entirely.
    const suppress = !MUTABLE_READS.has(call.name) && repeatHit;
    const readsBefore = att.ctx.pageReads;
    // Let a read_pages call stamp each fetch reservation onto its
    // pending journal entry the moment it validates — a worker that
    // dies mid-batch leaves the real spend persisted, and an entry
    // without one provably never reached validation.
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
      // A proven repeat that isn't suppressed (a mutable read) still
      // counts as a repeat for the loop nudge.
      if (!repeatHit) allRepeat = false;
      try {
        out = await executeTool(att.ctx, callId, call.name, call.args);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    // Journal whether the call spent a read: the cap charges fetches,
    // not calls, so a cached read_pages entry must not count on replay.
    if (call.name === 'read_pages') entry.readSpent = att.ctx.pageReads - readsBefore;
    const res_ = out as {
      error?: unknown;
      blocked?: unknown;
      ignored?: unknown;
      errors?: unknown;
    } | null;
    // Per-url failures ride in errors[] (read_pages), not top-level
    // error — a result that reports fetch failures isn't a clean
    // prior result, so its retry must reissue, not suppress.
    const clean =
      typeof res_ === 'object' &&
      res_ !== null &&
      !res_.error &&
      res_.blocked !== true &&
      res_.ignored !== true &&
      !(Array.isArray(res_.errors) && res_.errors.length > 0);
    // A suppressed call stands on its earlier clean result — its own
    // REPEAT error must not mark the signature retryable or the next
    // identical emission would execute again.
    if (clean && !READ_TOOLS.has(call.name)) att.stateVersion++;
    // Writes record the POST-call version — 'nothing landed since it
    // ran' must not count the call's own write, or every repeated
    // write would look stale to itself.
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

/** Endgame — the loop unwound: lost fencing journals the abort; otherwise
 *  step exhaustion is a failure — the model never converged. For
 *  discovery the trajectory still reports what it produced: the create
 *  count keeps a lead-yielding run from reading as a dead loss. */
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
    await finishRun(att.sql, att.claim, {
      status: 'failed',
      steps: att.steps,
      tokensIn: att.tokensIn,
      tokensOut: att.tokensOut,
      costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
      error: `max steps reached${created ? ` — ${created} lead(s) created` : ''}`,
    })
  ) {
    // A budget-exhausted run still taught the field something — its leads
    // and dead ends belong in the doctrine too.
    if (att.playbook.debrief)
      await writeDebrief(att.sql, att.run, att.ctx, att.steps).catch(() => undefined);
  } else {
    await persistAborted(att);
  }
}

/** Error path — any throw lands as a failed run; losing the fence degrades
 *  to persistAborted so the trajectory + spend still commit. */
async function failAttempt(att: Attempt, e: unknown): Promise<void> {
  if (
    !(await finishRun(att.sql, att.claim, {
      status: 'failed',
      steps: att.steps,
      tokensIn: att.tokensIn,
      tokensOut: att.tokensOut,
      costCents: Math.round((att.costUsd + att.monidBudget.spent) * 100),
      error: e instanceof Error ? e.message : String(e),
    }))
  )
    await persistAborted(att);
}

/** The kernel loop — the phases as middleware: inbox drain → model turn →
 *  finish gate → tool dispatch, for `limit` steps or until the run loses
 *  its fence. Draining first covers both "items queued while the run sat
 *  parked" (first iteration) and "items landed mid-attempt" (every step
 *  boundary after). */
async function runKernel(att: Attempt): Promise<void> {
  // Artifact-minters get a run-wide window instead: a duplicate row is
  // never a state-restore no matter how many turns passed, and the
  // journal-seeded set survives reclaim.
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

/** Drain the queue — called by the worker loop and after enqueues. First
 *  reclaims runs whose worker died mid-flight (crash/restart leaves them
 *  'running' forever): past the lease they're requeued, not failed, so a
 *  crashed outreach still reaches the lead. */
const RUN_LEASE_MIN = 10;

export async function drain(sql: Sql, limit = 20): Promise<number> {
  // Reclaim consumes an attempt: the row requeues behind an exponential
  // backoff (run_at = now + 2^attempts min) so a poisoned run stops jumping
  // ahead of healthy work, and the attempt that exhausts max_attempts lands
  // 'failed' — journal kept — instead of looping the lease forever.
  const capFlaggedIds: string[] = [];
  // Track task writes separately from cap flags — a normal failed run's
  // [humano] task needs the same lead.change refresh a fresh flag earns.
  let taskLanded = false;
  const { requeued, terminal } = await controlTx(sql, async (tx) => {
    // Requeue below-cap attempts in one bulk pass — nothing else needs to
    // commit with them (the retry's own finishRun folds its total spend).
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
    // Terminal rows are finalized one tx each below — the 'running' row
    // itself is the pending marker: a crash between rows leaves the rest
    // stale, and the next drain re-picks them (spend fold + task + cap
    // check all retry with it). A bulk mark-then-finalize split would
    // strand a 'failed' row with no spend and no task on restart.
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
      // capfin before the row write — the bulk pass holds every reclaimed
      // row's lock, so a capfin wait in there could cycle against an
      // inbound gate (see capLockTx); inside each small tx it's first.
      if (f.lead_id) await capLockTx(tx, f.lead_id);
      // The 'failed' transition, spend fold, staff task, and cap check are
      // one commit — fenced on staleness so a row revived between the
      // select and here skips the whole finalize instead of half of it.
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
      // A stale row revived between select and update skips the whole
      // finalize — no task, no flag, no emit, and consumed mail stays
      // stamped to the (still-living) run.
      if (!row) return { task: false, cap: false };
      // Mail the dead run consumed goes back to pending in the same
      // fenced commit — the inbox sweep respawns it.
      await releaseInboxTx(tx, row.id);
      // A dead attempt never reached finishRun — its spend lives only in
      // the journal. Model entries are usage DELTAS (sum them); monid_spend
      // markers carry the CUMULATIVE budget balance at each write — the
      // fold above reads the LAST marker like runOnce's priorSpend, never
      // a sum (summing cumulative balances would inflate cost_cents).
      // Same failed-run visibility as finishRun's path; board-scoped
      // failures roll into the digest instead — no task, no emit.
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
      // And now that the spend persisted, run the same cap check every
      // other terminal path does — dead-run spend can itself cross the cap.
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
  // Terminal suppressions strand queued runs forever — the claim gate's
  // pause semantics never lifts them. unsubscribe writers cancel inline,
  // archive doesn't, so this sweep is the catch-all for both (a writer
  // that forgets, or rows parked before the inline cancels existed).
  // agent_paused_at and agent_mode='off' are NOT touched: those flags
  // lift and their parked runs must resume.
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
  // 'sending' past the lease = worker died between provider call and status
  // write. Fail it visibly — staff redrafts — instead of silently requeuing
  // (at-most-once: the provider may already have accepted it).
  const failedSending = await controlTx(
    sql,
    (tx) => tx<{ thread_id: string }[]>`
      update lead_messages set status = 'failed', error = 'dispatch-interrupted', updated_at = now()
      where status = 'sending' and updated_at < now() - make_interval(mins => ${RUN_LEASE_MIN})
      returning thread_id
    `,
  );
  for (const m of failedSending) emitControlEvent('thread.message', m.thread_id);
  // Queued messages outlive the request that queued them — a crash between
  // approve/commit and dispatch must not strand one. The 20s grace lets the
  // inline request-path dispatch win first.
  // Agent-authored rows die with their run first: the tool path's claim
  // fence leaves a canceled/cap-exhausted run's message 'queued' on purpose
  // — picking it up here unguarded would outflank the fence 20s later.
  // Staff-approved drafts are staff-owned (approved_by set) even though
  // they keep agent_run_id — approval is the explicit decision to send.
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
  // Mail a dead run still holds re-pends. Reconcile/cancel releases ran
  // once, when the run's answering send may still have been in flight —
  // a suppressed answeredBy marker that later flips 'failed' never gets
  // another pass and strands the item forever. Re-running the same
  // release on dead owners picks up exactly those flips; live/attempted
  // markers still suppress, so a landed (or on-the-wire) answer keeps
  // its mail consumed. Canceled owners release unbounded like the cancel
  // endpoint — a cancel carries no failure signal, so the poison-mail
  // deliveries bound doesn't apply. The 2h bound keeps the scan
  // proportional to recent deaths: every post-death flip (queued→failed,
  // stale sending→failed) resolves within the message lease horizon, so
  // older dead runs are settled history.
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
    // Agent-authored rows only recover once the run is 'done': a 'queued' or
    // 'running' run still owns its send — the owning attempt dispatches it
    // under the new claim (a replayed compose re-runs dispatch with the new
    // token, and an already-sent row no-ops on status). The terminal-mark
    // above already failed canceled/failed runs; approved rows are staff-
    // owned. The guard locks the run row inside the dispatch claim tx so a
    // cancel landing in the mark→dispatch gap still can't send.
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
  // Orphaned mail: items whose enqueueing side never got a run for them
  // (cap refusal, the run they rode died before draining, a lost race).
  // The sweep creates the fallback run each payload describes.
  await sweepOrphanInbox(sql).catch((e) => agentLog.error({ err: e }, 'inbox sweep failed'));
  let ran = 0;
  while (ran < limit && (await runOnce(sql))) ran++;
  return ran;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/** Persistent in-process worker: polls the durable queue, plus the periodic
 *  outreach sweep. Queue lives in Postgres, so queued runs survive reboots. */
export function startAgentWorker(sql: Sql, intervalMs = 15_000) {
  if (workerTimer) return;
  // Leads already over the cap before this deploy (or stranded by a
  // direct-db spend write) park all queued work until flagged — the
  // settings-write sweep can't reach them without a write. The boot pass
  // covers the deploy case now; keeping it in the tick chain means a
  // failed pass retries next interval instead of waiting for a restart.
  void flagCappedLeads(sql).catch((e) => agentLog.error({ err: e }, 'boot cap flag failed'));
  workerTimer = setInterval(() => {
    if (draining) return;
    draining = true;
    void drain(sql)
      .then(() =>
        flagCappedLeads(sql).catch((e) => agentLog.error({ err: e }, 'cap flag sweep failed')),
      )
      .then(() => sweepOutreach(sql))
      .then(() => sweepWakeups(sql))
      .then(() => sweepBriefs(sql))
      .then(() => sweepStrategist(sql))
      .then(() => sweepPipelineSnapshots(sql))
      .then(() => sweepMeetingReminders(sql))
      .then(() => sweepDigest(sql))
      .catch((e) => agentLog.error({ err: e }, 'worker failed'))
      .finally(() => {
        draining = false;
      });
  }, intervalMs);
  workerTimer.unref?.();
}

/** Scheduled discovery: each enabled brief past its 23h cadence gets a
 *  discovery run carrying its query/segment/city/target + briefId (the
 *  not-exists check keeps a still-queued brief run from double-firing). Leads
 *  it creates land tagged 'descoberto' — whether they also get called now is
 *  the guardrails.discoveryAutoContact gate in tools.ts. */
export async function sweepBriefs(sql: Sql): Promise<number> {
  const queuedIds: string[] = [];
  const pausedIds: string[] = [];
  const fired = await controlTx(sql, async (tx) => {
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
        and (last_run_at is null or last_run_at < now() - interval '23 hours')
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
    // An auto-approved brief keeps firing on its original reservation
    // forever — the approval only checked the budget ONCE. Re-run the same
    // spent+open*est check before each refire and disable the brief the
    // moment the rolling 7d window no longer fits. serialized on the
    // 'brief-proposals' advisory so the check serializes with proposals
    // and other sweep passes exactly like it does across runs.
    if (due.some((b) => b.created_by === 'strategist' && !b.rearmed_at)) {
      await tx`select pg_advisory_xact_lock(hashtext('brief-proposals'))`;
    }
    let fired = 0;
    for (const b of due) {
      // rearmed_at marks a staff re-arm — the enablement is then a human
      // decision, not autopilot spend, and exempt from the budget gate.
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
      // Dead-brief gate: a brief whose last N finished runs produced zero
      // leads pauses itself (enabled=false + a note) instead of burning the
      // daily run forever. The journal is the source of truth — a
      // create_lead step with out.lead.id is what "produced" means (merge-
      // only runs still count as dead: no NEW lead entered the board).
      // rearmed_at bounds the window: staff re-enabling or editing the
      // brief starts a fresh evaluation. The bound is on created_at (when
      // the run was enqueued with its params), not finished_at — a run
      // queued before the edit still carries the old definition even if it
      // finishes afterward, so its zero-yield isn't evidence against the
      // new one. Only 'done' counts as an observation: a 'failed' run can
      // die before discovery ever evaluated the brief — provider outages
      // must not masquerade as zero-yield.
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
      const runId = await insertRun(tx, {
        kind: 'discovery',
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
  // A budget pause lands no run — but it changed the board, so the
  // discovery view refreshes on the same event it polls.
  for (const id of pausedIds) emitControlEvent('run.update', id);
  return fired;
}

/** Weekly strategist cadence: one 'strategist' run every 7 days, stamped by
 *  the run's own created_at (a manual fire resets the clock — same enqueue-
 *  stamp idiom sweepBriefs uses for its 23h cadence). The advisory lock is
 *  the row-lock equivalent on a sweep with no anchor row: two workers in the
 *  same tick can't both pass the emptiness check and double-fire. */
export async function sweepStrategist(sql: Sql): Promise<boolean> {
  let queuedId: string | null = null;
  const fired = await controlTx(sql, async (tx) => {
    const locked = await tx<{ ok: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtext('sweep:strategist')) as ok
    `;
    if (!locked[0]?.ok) return false;
    if (!(await automationAllowedTx(tx, 'strategist')).ok) return false;
    // only board-scoped runs fill the cadence slot — a lead-bound strategist
    // (rejected at the API, still possible via direct insertRun) can park in
    // queue forever and must not suppress the weekly review
    const recent = await tx`
      select 1 from agent_runs
      where kind = 'strategist' and lead_id is null
        and created_at > now() - interval '7 days'
      limit 1
    `;
    if (recent.length) return false;
    queuedId = await insertRun(tx, { kind: 'strategist', params: { auto: 'weekly' } });
    return true;
  });
  if (queuedId) emitControlEvent('run.update', queuedId);
  return fired;
}

/** Periodic sweep: leads due for a follow-up get an outreach run. */
export async function sweepOutreach(sql: Sql): Promise<number> {
  const queuedIds: string[] = [];
  const capFlagged: string[] = [];
  const fired = await controlTx(sql, async (tx) => {
    // Autonomy 'off' parks only the automation's own nudges — promised
    // work ('staff'/'requested'/'agent' sources, materialized unmarked
    // below) is a human's schedule or a lead-asked callback and still
    // fires. The playbook switch gates everyone.
    const level = (await autonomyTx(tx)).level;
    if (!(await playbookEnabledTx(tx, 'outreach')).ok) return 0;
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const capCents = capCentsOf(g);
    // for update skip locked — concurrent sweeps on different replicas take
    // disjoint lead sets instead of both inserting a run for the same due
    // lead (the not-exists check alone only sees committed runs). The cap
    // predicate keeps over-cap leads OUT of the 20-row window — otherwise a
    // wall of capped leads would starve every eligible lead behind them
    // (their due dates stay untouched, so a raised cap resumes them).
    const due = await tx<{ id: string; next_action_source: string }[]>`
      select l.id, l.next_action_source from leads l
      where l.next_action_at is not null and l.next_action_at <= now()
        and l.archived_at is null and l.unsubscribed_at is null
        and l.agent_mode != 'off'
        and (l.next_action_source in ('staff', 'requested', 'agent') or ${level !== 'off'})
        and (${capCents} <= 0 or
          coalesce((select sum(x.cost_cents) from agent_runs x
                    where x.lead_id = l.id), 0) < ${capCents})
      limit 20
      for update skip locked
    `;
    for (const { id, next_action_source } of due) {
      // The select's for-update already holds THIS lead's row lock, so a
      // blocking capfin wait here would invert against ingestInbound's
      // gate (capfin first, then the lead lock — see capLockTx). Try the
      // advisory instead: a busy capfin means an inbound gate or a cost
      // finalizer is serializing the lead right now — skip this pass; the
      // due date stays for the next sweep.
      const capFree = await tx<{ got: boolean }[]>`
        select pg_try_advisory_xact_lock(hashtext(${'capfin:' + id})) as got
      `;
      if (!capFree[0]!.got) continue;
      // params.auto marks automation-scheduled work — a fresh inbound cancels
      // it (ingestInbound). 'cadence' AND 'auto' sources are the
      // automation's own nudges (the prompt writes nextActionAt as the
      // "próxima cadência"): obsolete the moment the lead writes back — the
      // reply run re-commits any still-wanted follow-up with fresh context.
      // 'staff', 'requested' AND legacy 'agent' materialize UNMARKED like
      // every staff-triggered run: a human's schedule and a lead-asked
      // callback ("me chama terça") are promises a reply can't cancel —
      // they outrank the reply exactly like an explicit staff decision.
      // 'agent' is legacy-only: 0025 backfilled every pre-existing date to
      // it (self-schedules AND asked callbacks, unrecoverably mixed), so it
      // takes the preserved side like 'requested'. insertRun also
      // applies the lifetime cost cap — a capped lead returns null and
      // KEEPS its due action (claimRun parks it anyway, so no run executes
      // over budget).
      // The agent's own due wakeup is the same follow-up — fold it into
      // this run instead of firing a second outreach after it, carrying
      // its focus into the run's params (at most one pending agent wakeup
      // exists per lead — the unique index enforces it). Read it BEFORE
      // insertRun so the focus lands in the run's context, not the floor.
      // Under autonomy 'off' the model's self-schedule is parked — the
      // wakeup stays pending for sweepWakeups' own gate, never rides an
      // allowed staff/requested run.
      const fold =
        level === 'off'
          ? undefined
          : (
              await tx<{ id: string; focus: string }[]>`
                select id, focus from agent_wakeups
                where lead_id = ${id} and status = 'pending' and at <= now()
                  and created_by = 'agent' and not requested
                for update skip locked
              `
            )[0];
      const promised =
        next_action_source === 'staff' ||
        next_action_source === 'requested' ||
        next_action_source === 'agent';
      // Under autonomy 'off' an already-queued auto outreach can never
      // claim — delivering the promised date into it would park the
      // promise forever. Retire the disposable autos so insertRun mints
      // the runnable unmarked row; their dead-attempt mail releases too.
      if (promised && level === 'off') {
        const retired = await tx<{ id: string }[]>`
          update agent_runs
          set status = 'canceled', error = 'promised work takes over', finished_at = now()
          where lead_id = ${id} and kind = 'outreach' and status = 'queued'
            and params->>'auto' is not null
            and params->>'auto' not in ('regenerate', 'agent')
          returning id
        `;
        for (const r of retired) await releaseInboxTx(tx, r.id, true);
        queuedIds.push(...retired.map((r) => r.id));
      }
      const params: Record<string, unknown> = {
        ...(promised ? {} : { auto: next_action_source }),
        ...(fold ? { focus: `agendado por você: ${fold.focus}`, wakeupId: fold.id } : {}),
      };
      const cap: { flagged?: boolean; retired?: string[] } = {};
      const runId = await insertRun(
        tx,
        {
          kind: 'outreach',
          leadId: id,
          params,
        },
        cap,
      );
      if (cap.flagged) capFlagged.push(id);
      // Retired rows changed too — same run.update refresh the minted run
      // gets, or the view keeps showing them queued.
      if (cap.retired) queuedIds.push(...cap.retired);
      if (runId) {
        queuedIds.push(runId);
        // The cadence intent rides the mailbox too: when insertRun found an
        // already-active run (same or another kind) the item is what carries
        // the intent into it — and it doubles as the audit trail either way.
        await enqueueInboxTx(tx, id, 'event', {
          text: `a cadência disparou${fold ? ` — ${params.focus}` : ''}`,
          requestedKind: 'outreach',
          params,
        });
        await tx`update leads set next_action_at = null, next_action_source = null where id = ${id}`;
        if (fold) {
          await tx`
            update agent_wakeups set status = 'fired', fired_run_id = ${runId}, fired_at = now(), updated_at = now()
            where id = ${fold.id}
          `;
        }
      }
    }
    return queuedIds.length;
  });
  for (const id of queuedIds) emitControlEvent('run.update', id);
  if (capFlagged.length) emitControlEvent('lead.change');
  return fired;
}
