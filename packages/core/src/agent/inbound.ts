import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { getGuardrails, phoneIsIgnored } from '../modules/integrations.ts';
import { addInboundMessage, type Channel, type InboundResult } from '../modules/threads.ts';
import { capLockTx, drain, releaseInboxTx } from './runner.ts';
import { requestAgentTx } from './dispatch.ts';
import { automationAllowedTx } from './policy.ts';
import { retireWakeupsOnInboundTx } from './wakeups.ts';
import { RETIRED_BY_INBOUND } from './sources.ts';
import { log } from '../platform/log.ts';

const agentLog = log.child({ mod: 'agent' });

type ReplyGate = {
  agent_enabled: boolean;
  agent_mode: string;
  unsubscribed_at: string | null;
  archived_at: string | null;
};

// shared inbound path. Opt-out intent is the reply run's call via the `unsubscribe`
// tool — a bare "sair"/"cancelar" can be normal speech, so nothing is decided by regex.

export type IngestResult = InboundResult | { ignored: string };

export async function ingestInbound(
  sql: Sql,
  input: {
    channel: Channel;
    from: string;
    /** complementary provider address (whatsapp LID ↔ phone jid) — helps lead matching converge */
    fromAlias?: string;
    fromName?: string;
    subject?: string;
    body: string;
    providerMessageId?: string | null;
    /** provider-side conversation key (instagram: the sender's account id) */
    externalThreadId?: string;
    /** 'out' = own sent copy — context, never answered */
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
    ...(input.externalThreadId ? { externalThreadId: input.externalThreadId } : {}),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.sentAt ? { sentAt: input.sentAt } : {}),
    ...(input.historical ? { historical: input.historical } : {}),
  });

  // Provider retry of an already-recorded message: no side effects again.
  if (res.alreadySeen) return res;
  emitControlEvent('thread.message', res.threadId);
  if (res.leadCreated) emitControlEvent('lead.change', res.leadId);

  // history imports and own-account echoes are context only — never answered
  if (input.historical || input.direction === 'out') return res;
  // gate check + run insert in one tx: `for update of l, t` serializes with the
  // suppression writers so a suppression committed mid-flight is seen here
  const supersededThreads: string[] = [];
  const canceledRunIds: string[] = [];
  const { runId, capFlagged, retired, startAt } = await controlTx(sql, async (tx) => {
    // 'capfin' advisory first: serializes this gate against claims and cap
    // evaluators; must precede the l,t lock to avoid a lock-order cycle. See capLockTx.
    await capLockTx(tx, res.leadId);
    const gateRows = await tx<ReplyGate[]>`
      select t.agent_enabled, l.agent_mode, l.unsubscribed_at, l.archived_at
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${res.threadId}
      for update of l, t
    `;
    // retire the agent's own unanswered outreach drafts — obsolete once the lead writes;
    // promises and staff asks survive, running runs untouched
    const drafts = await tx<{ thread_id: string }[]>`
      update lead_messages m
      set status = 'rejected', error = 'lead respondeu', updated_at = now()
      where m.status = 'draft'
        and m.agent_run_id in (
          select r.id from agent_runs r
          where r.lead_id = ${res.leadId} and r.kind = 'outreach'
            and r.source = any(${RETIRED_BY_INBOUND as string[]}::text[]) and not r.promised
        )
      returning m.thread_id
    `;
    supersededThreads.push(...drafts.map((d) => d.thread_id));
    // queued auto outreach retires too — it can't serve the mail and would fire
    // a "reopening"; the 'queued' predicate keeps its row locks behind the l,t lock
    const canceled = await tx<{ id: string }[]>`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where lead_id = ${res.leadId} and kind = 'outreach' and status = 'queued'
        and source = any(${RETIRED_BY_INBOUND as string[]}::text[]) and not promised
      returning id
    `;
    canceledRunIds.push(...canceled.map((c) => c.id));
    // release mail consumed in the dead attempts, then tombstone the same class of pending
    // outreach requests — promised callbacks stay
    for (const rid of canceledRunIds) await releaseInboxTx(tx, rid, true);
    await tx`
      update agent_inbox
      set consumed_at = now(), consumed_by_run = null
      where lead_id = ${res.leadId} and consumed_at is null
        and payload->>'requestedKind' = 'outreach'
        and source = any(${RETIRED_BY_INBOUND as string[]}::text[]) and not promised
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
      return { runId: null, capFlagged: false, retired: [], startAt: null };
    }
    if (!(await automationAllowedTx(tx, 'reply')).ok) {
      return { runId: null, capFlagged: false, retired: [], startAt: null };
    }
    // an active run drains the item between steps (burst coalescing); a channel mismatch
    // defers to a sweep-spawned run pinned to this channel. The dispatcher carries the
    // reply delay — and quiet hours, when the answer would go out live — into the start.
    const d = await requestAgentTx(tx, {
      kind: 'reply',
      source: 'inbound',
      leadId: res.leadId,
      threadId: res.threadId,
      text: `mensagem do lead [${input.channel}]: ${input.body.slice(0, 400)}`,
      params: { channel: input.channel },
      ref: { messageId: res.messageId },
      // a capped lead's message waits for budget — raising the cap answers it
      holdIfRefused: true,
      ...(inboundReplyDelayMin > 0
        ? { at: new Date(Date.now() + inboundReplyDelayMin * 60_000) }
        : {}),
    });
    return { runId: d.runId, capFlagged: d.capFlagged, retired: d.retired, startAt: d.startAt };
  });
  for (const tid of new Set(supersededThreads)) emitControlEvent('draft.change', tid);
  for (const id of [...canceledRunIds, ...retired]) emitControlEvent('run.update', id);
  if (capFlagged) emitControlEvent('lead.change');
  if (runId) {
    // slide the parked reply's quiet period to its start — outside the l,t tx
    // because claimRun locks run→thread while the gate holds thread→run
    if (startAt && startAt.getTime() > Date.now()) {
      const due = startAt;
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
    // run it from this process now — the scheduler's notification may land on another worker
    void drain(sql, 20, { orphans: false }).catch((e) =>
      agentLog.error({ err: e }, 'drain failed'),
    );
  }
  return res;
}
