import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { getGuardrails, phoneIsIgnored } from '../modules/integrations.ts';
import { addInboundMessage, type Channel, type InboundResult } from '../modules/threads.ts';
import { capLockTx, drain, insertRun } from './runner.ts';
import { log } from '../platform/log.ts';

const agentLog = log.child({ mod: 'agent' });

type ReplyGate = {
  agent_enabled: boolean;
  agent_mode: string;
  unsubscribed_at: string | null;
  archived_at: string | null;
};

/**
 * agent/inbound — the shared inbound path: a message from any channel (the
 * Baileys socket handler or an email webhook) lands here. Opt-out intent is
 * the agent's call — the reply run reads the message and flips
 * unsubscribed_at via the `unsubscribe` tool; this file just queues the run
 * (and skips it entirely once the lead is already unsubscribed). A bare
 * "sair"/"cancelar" can be normal speech, so nothing is decided by regex.
 */

export type IngestResult = InboundResult | { ignored: string };

export async function ingestInbound(
  sql: Sql,
  input: {
    channel: Channel;
    from: string;
    /** The sender's complementary provider address when the channel carried
     *  one (whatsapp LID ↔ phone-number jid) — lets lead matching converge
     *  on a contact first seen under the other alias. */
    fromAlias?: string;
    fromName?: string;
    subject?: string;
    body: string;
    providerMessageId?: string | null;
    /** 'out' = account's own copy of a sent message — context, never an
     *  inbound to answer. */
    direction?: 'in' | 'out';
    /** provider timestamp for history import */
    sentAt?: Date;
    /** history import: record for context only — never queues a reply run. */
    historical?: boolean;
  },
): Promise<IngestResult> {
  const { ignoredPhones, inboundReplyDelayMin } = await getGuardrails(sql);
  // Staff/founder numbers drop before a lead is ever minted — the agent
  // must never see them as leads, in either direction.
  if (phoneIsIgnored(ignoredPhones, input.from, input.fromAlias)) {
    return { ignored: `número ignorado: ${input.from}` };
  }
  const res = await addInboundMessage(sql, {
    channel: input.channel,
    from: input.from,
    ...(input.fromAlias ? { fromAlias: input.fromAlias } : {}),
    ...(input.fromName ? { fromName: input.fromName } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    body: input.body,
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.sentAt ? { sentAt: input.sentAt } : {}),
    ...(input.historical ? { historical: input.historical } : {}),
  });

  // Provider retry of an already-recorded message: no side effects again.
  if (res.alreadySeen) return res;
  emitControlEvent('thread.message', res.threadId);
  if (res.leadCreated) emitControlEvent('lead.change', res.leadId);

  // History and own-account echoes are context only — an old message must
  // not turn into a live reply, and the agent never answers a message the
  // account itself sent.
  if (input.historical || input.direction === 'out') return res;
  // Gate check and run insert in one tx: `for update of l, t` serializes
  // with both suppression writers — archive/unsubscribe land on `leads`,
  // the staff pause toggle on `lead_threads` — so a suppression committed
  // between the message insert and now is seen here instead of stranding a
  // queued reply on a suppressed thread/lead.
  const { runId, coalescedId, canceledIds } = await controlTx(sql, async (tx) => {
    // 'capfin' first: the per-lead advisory serializes this whole gate
    // against claims (claimRun only TRIES it — while we hold it every
    // same-lead candidate rejects there, so the cancel below can never
    // lose to a concurrent claim) AND against cap evaluators. It must
    // come before the l,t lock — the advisory is this tx's first lock or
    // a finisher holding it + waiting on our lead row would cycle (the
    // flag insert's FK takes key-share on leads). See capLockTx.
    await capLockTx(tx, res.leadId);
    const gateRows = await tx<ReplyGate[]>`
      select t.agent_enabled, l.agent_mode, l.unsubscribed_at, l.archived_at
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${res.threadId}
      for update of l, t
    `;
    // A live inbound retires queued AUTO outreach — the lead already wrote,
    // so a "reopening" message queued by cadence/discovery/first-contact
    // would arrive answering nothing. Only runs the automation itself
    // queued (params->>'auto' set) are canceled: a staff-triggered run is an
    // explicit decision and outranks the reply. 'regenerate' is exempt —
    // it's draftOnly composition work (staff approved the supersede); on
    // claim it recomposes against CURRENT state, so the fresh inbound makes
    // its draft more right, and canceling it would orphan the rejected
    // draft with no replacement. The cancel stays 'queued'-only inside the
    // gate: its row locks land AFTER the l,t lock, matching every other
    // writer's leads→runs order (a 'running' predicate would wait on rows
    // held by tool txs that took their run row + lead lock the other way).
    // Runs claimed in the capfin-free window before this gate are flipped
    // by the post-commit pass below. The ids come back so post-commit
    // run.update emissions refresh the Runs view — without them canceled
    // rows keep showing as 'queued'.
    const canceled = await tx<{ id: string }[]>`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where lead_id = ${res.leadId} and kind = 'outreach' and status = 'queued'
        and params->>'auto' is not null and params->>'auto' <> 'regenerate'
      returning id
    `;
    const canceledIds = canceled.map((c) => c.id);
    const gate = gateRows[0];

    if (
      !gate ||
      !gate.agent_enabled ||
      gate.agent_mode === 'off' ||
      gate.unsubscribed_at ||
      gate.archived_at
    ) {
      return { runId: null, coalescedId: null, canceledIds };
    }
    // Burst coalescing: a still-queued reply reads the freshest thread
    // state at claim anyway, so one parked run covers every message that
    // lands before it starts — a WhatsApp burst must not fan out into
    // parallel replies on the same lead. 'running' doesn't count: its
    // context froze at claim, so a genuinely new message still earns a
    // fresh run. The origin marker scopes the dedupe to auto-created
    // inbound runs only — a params={} row is ambiguous (pre-marker auto
    // run vs plain staff reply) and can't be told apart, so it never
    // coalesces: a bounded one-time duplicate for rows parked across the
    // marker deploy beats silently absorbing an inbound behind a staff
    // run's intent or schedule.
    const parked = await tx<{ id: string }[]>`
      select id from agent_runs
      where kind = 'reply' and thread_id = ${res.threadId} and status = 'queued'
        and params->>'origin' = 'inbound'
      limit 1
    `;
    if (parked.length) return { runId: null, coalescedId: parked[0]!.id, canceledIds };
    // null = the lifetime cost cap refused the run — nothing queued to
    // announce or kick.
    const id = await insertRun(tx, {
      kind: 'reply',
      leadId: res.leadId,
      threadId: res.threadId,
      params: { origin: 'inbound' },
      ...(inboundReplyDelayMin > 0
        ? { runAt: new Date(Date.now() + inboundReplyDelayMin * 60_000) }
        : {}),
    });
    return { runId: id, coalescedId: null, canceledIds };
  });
  // A run claimed in the capfin-free window before the gate acquired the
  // advisory legitimately owns its attempt — but its send would still go
  // out answering nothing. Flip 'running' auto outreach in a separate
  // post-commit pass. SKIP LOCKED keeps this tx from ever waiting on a row
  // — its own flips are visited (and lock-evaluated) by suppression
  // cancels, so a wait here could cycle back through a leads-holder. A
  // skipped row is one mid-tool-call; the residual window is one tool
  // tx's duration. The owner sees 'canceled' at its next step check and
  // aborts through persistAborted; drain terminal-marks its queued sends.
  const runningCanceled = await controlTx(sql, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where id in (
        select id from agent_runs
        where lead_id = ${res.leadId} and kind = 'outreach' and status = 'running'
          and params->>'auto' is not null and params->>'auto' <> 'regenerate'
        for update skip locked
      )
      returning id
    `;
    return rows.map((r) => r.id);
  }).catch((e) => {
    // Best-effort pass — a failure here must not mask the committed ingest.
    agentLog.warn({ err: e, leadId: res.leadId }, 'running-outreach cancel failed');
    return [] as string[];
  });
  for (const id of [...canceledIds, ...runningCanceled]) emitControlEvent('run.update', id);
  const enqueuedId = runId ?? coalescedId;
  if (enqueuedId) {
    // The latest message earns its own quiet period: slide the parked run
    // forward to now+delay — done OUTSIDE the l,t tx because claimRun locks
    // run→thread while the gate holds thread→run; a run write there can
    // deadlock. The status/run_at guards keep it safe and narrow: an
    // already-claimed or already-overdue reply fires as-is, delay=0 needs
    // no write at all.
    if (coalescedId && inboundReplyDelayMin > 0) {
      await controlTx(sql, async (tx) => {
        await tx`
          update agent_runs
          set run_at = greatest(run_at, ${new Date(Date.now() + inboundReplyDelayMin * 60_000)})
          where id = ${coalescedId} and status = 'queued' and run_at > now()
        `;
      });
    }
    emitControlEvent('run.update', enqueuedId);
    // Kick the queue now — don't wait up to the poll interval for a reply
    // (a delayed run_at is simply not due yet; the worker tick picks it up).
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
  }
  return res;
}
