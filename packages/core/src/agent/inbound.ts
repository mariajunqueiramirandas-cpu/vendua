import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { getGuardrails, phoneIsIgnored } from '../modules/integrations.ts';
import { addInboundMessage, type Channel, type InboundResult } from '../modules/threads.ts';
import { capLockTx, drain, insertRun, releaseInboxTx } from './runner.ts';
import { enqueueInboxTx } from './inbox.ts';
import { automationAllowedTx } from './policy.ts';
import { retireWakeupsOnInboundTx } from './wakeups.ts';
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
  const supersededThreads: string[] = [];
  const canceledRunIds: string[] = [];
  const { runId, capFlagged } = await controlTx(sql, async (tx) => {
    // 'capfin' first: the per-lead advisory serializes this whole gate
    // against claims (claimRun only TRIES it — while we hold it every
    // same-lead candidate rejects there) AND against cap evaluators. It must
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
    // Inbound retires COMPOSED drafts of auto outreach — a "first contact"
    // answering nothing is obsolete the moment the lead writes, wherever
    // the run that authored it stands (queued, running, done, failed).
    // Queued auto outreach rows retire alongside them (below); a RUNNING
    // outreach is untouched — the message mails to it through agent_inbox
    // instead of superseding it. 'regenerate'/'agent' stay exempt —
    // provenance says "possibly a promise", never disposable.
    const drafts = await tx<{ thread_id: string }[]>`
      update lead_messages m
      set status = 'rejected', error = 'lead respondeu', updated_at = now()
      where m.status = 'draft'
        and m.agent_run_id in (
          select r.id from agent_runs r
          where r.lead_id = ${res.leadId} and r.kind = 'outreach'
            and r.params->>'auto' is not null
            and r.params->>'auto' not in ('regenerate', 'agent')
        )
      returning m.thread_id
    `;
    supersededThreads.push(...drafts.map((d) => d.thread_id));
    // Queued AUTO outreach retires with the drafts: it can never serve the
    // new mail (drainInbox only runs inside an executing run, its channel
    // pin may not match the item's, and it would fire before the inbound's
    // quiet period ends) — so it would send a "reopening" that answers
    // nothing. 'regenerate'/'agent' stay exempt — provenance says
    // "possibly a promise", never disposable. A RUNNING outreach keeps
    // its claim and drains the mail mid-flight — and the 'queued'
    // predicate keeps this update's row locks behind the l,t lock, the
    // same ordering every other writer follows (a 'running' predicate
    // would wait on rows held by tool txs that took run→lead).
    const canceled = await tx<{ id: string }[]>`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where lead_id = ${res.leadId} and kind = 'outreach' and status = 'queued'
        and params->>'auto' is not null
        and params->>'auto' not in ('regenerate', 'agent')
      returning id
    `;
    canceledRunIds.push(...canceled.map((c) => c.id));
    // A canceled requeued run keeps mail consumed in its dead attempt —
    // release it so the reply serves it (event retire: the deliveries
    // bound is for failure paths), then tombstone the pending cadence
    // events those runs minted: 'a cadência disparou' is obsolete the
    // moment the lead writes. Scoped to requestedKind='outreach' — an
    // auto discovery/strategist event owes the lead nothing and waits
    // for its own run.
    for (const rid of canceledRunIds) await releaseInboxTx(tx, rid, true);
    await tx`
      update agent_inbox
      set consumed_at = now(), consumed_by_run = null
      where lead_id = ${res.leadId} and kind = 'event' and consumed_at is null
        and payload->>'requestedKind' = 'outreach'
        and payload->'params'->>'auto' is not null
        and payload->'params'->>'auto' not in ('regenerate', 'agent')
    `;
    await retireWakeupsOnInboundTx(tx, res.leadId);
    const gate = gateRows[0];

    if (
      !gate ||
      !gate.agent_enabled ||
      gate.agent_mode === 'off' ||
      gate.unsubscribed_at ||
      gate.archived_at
    ) {
      return { runId: null, capFlagged: false };
    }
    if (!(await automationAllowedTx(tx, 'reply')).ok) {
      return { runId: null, capFlagged: false };
    }
    // Mailbox delivery: the message enqueues as an inbox item no matter
    // who owns the lead's run — a queued or running run drains it between
    // steps and renders it to the model (burst coalescing for free: five
    // rapid messages = five items drained by the SAME run, in order).
    // The channel pin keeps the item thread-bound: an inbound on a
    // different channel than the active run's DEFERS instead of draining
    // (drainInbox's channel check) and the orphan sweep later spawns a
    // run pinned to this channel + thread — a reply can never ship on
    // the wrong conversation. insertRun's on-conflict path returns the
    // already-active run's id, so a missing row here means the cap
    // refused — the item stays pending for the sweep when the cap lifts.
    // notBefore carries the quiet period into the deferred path: if the
    // mail waits for another run to finish, the sweep's replacement run
    // still can't claim before this deadline (same slide the parked-run
    // path gets).
    await enqueueInboxTx(tx, res.leadId, 'inbound', {
      text: `mensagem do lead [${input.channel}]: ${input.body.slice(0, 400)}`,
      threadId: res.threadId,
      messageId: res.messageId,
      requestedKind: 'reply',
      params: { origin: 'inbound', channel: input.channel },
      ...(inboundReplyDelayMin > 0
        ? {
            notBefore: new Date(Date.now() + inboundReplyDelayMin * 60_000).toISOString(),
          }
        : {}),
    });
    const cap: { flagged?: boolean } = {};
    const id = await insertRun(
      tx,
      {
        kind: 'reply',
        leadId: res.leadId,
        threadId: res.threadId,
        params: { origin: 'inbound', channel: input.channel },
        ...(inboundReplyDelayMin > 0
          ? { runAt: new Date(Date.now() + inboundReplyDelayMin * 60_000) }
          : {}),
      },
      cap,
    );
    return { runId: id, capFlagged: cap.flagged === true };
  });
  for (const tid of new Set(supersededThreads)) emitControlEvent('draft.change', tid);
  for (const id of canceledRunIds) emitControlEvent('run.update', id);
  if (capFlagged) emitControlEvent('lead.change');
  if (runId) {
    // The latest message earns its own quiet period: slide the parked
    // reply forward to now+delay — done OUTSIDE the l,t tx because
    // claimRun locks run→thread while the gate holds thread→run; a run
    // write there can deadlock. Applies to the delivered target as much
    // as to a fresh insert — the same 'queued' + not-yet-due guards that
    // made the old coalesced slide safe bound it here (a running or
    // already-due run is never rescheduled).
    if (inboundReplyDelayMin > 0) {
      const due = new Date(Date.now() + inboundReplyDelayMin * 60_000);
      await controlTx(sql, async (tx) => {
        await tx`
          update agent_runs
          set run_at = case
            when kind = 'reply' then greatest(run_at, ${due})
            else least(run_at, ${due})
          end
          where id = ${runId} and status = 'queued' and run_at > now()
        `;
      });
    }
    emitControlEvent('run.update', runId);
    // Kick the queue now — don't wait up to the poll interval for a reply
    // (a delayed run_at is simply not due yet; the worker tick picks it up).
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
  }
  return res;
}
