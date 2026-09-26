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
  const { runId, capFlagged, retired } = await controlTx(sql, async (tx) => {
    // 'capfin' advisory first: serializes this gate against claims and cap
    // evaluators; must precede the l,t lock to avoid a lock-order cycle. See capLockTx.
    await capLockTx(tx, res.leadId);
    const gateRows = await tx<ReplyGate[]>`
      select t.agent_enabled, l.agent_mode, l.unsubscribed_at, l.archived_at
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${res.threadId}
      for update of l, t
    `;
    // retire composed auto-outreach drafts — obsolete once the lead writes;
    // 'regenerate'/'agent' exempt (possibly a promise), running runs untouched
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
    // queued auto outreach retires too — it can't serve the mail and would fire
    // a "reopening"; the 'queued' predicate keeps its row locks behind the l,t lock
    const canceled = await tx<{ id: string }[]>`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where lead_id = ${res.leadId} and kind = 'outreach' and status = 'queued'
        and params->>'auto' is not null
        and params->>'auto' not in ('regenerate', 'agent')
      returning id
    `;
    canceledRunIds.push(...canceled.map((c) => c.id));
    // release mail consumed in the dead attempts, then tombstone pending
    // cadence/'wakeup' inbox items those runs minted — scoped to
    // requestedKind='outreach' so promised wakeups stay
    for (const rid of canceledRunIds) await releaseInboxTx(tx, rid, true);
    await tx`
      update agent_inbox
      set consumed_at = now(), consumed_by_run = null
      where lead_id = ${res.leadId} and kind in ('event', 'wakeup') and consumed_at is null
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
      return { runId: null, capFlagged: false, retired: [] };
    }
    if (!(await automationAllowedTx(tx, 'reply')).ok) {
      return { runId: null, capFlagged: false, retired: [] };
    }
    // enqueue as an inbox item: an active run drains it between steps (burst
    // coalescing); a channel mismatch defers to a sweep-spawned run pinned to
    // this channel. notBefore carries the quiet period into the deferred path.
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
    const cap: { flagged?: boolean; retired?: string[] } = {};
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
    return { runId: id, capFlagged: cap.flagged === true, retired: cap.retired ?? [] };
  });
  for (const tid of new Set(supersededThreads)) emitControlEvent('draft.change', tid);
  for (const id of [...canceledRunIds, ...retired]) emitControlEvent('run.update', id);
  if (capFlagged) emitControlEvent('lead.change');
  if (runId) {
    // slide the parked reply's quiet period to now+delay — outside the l,t tx
    // because claimRun locks run→thread while the gate holds thread→run
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
    // kick the queue now rather than waiting for the poll tick
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
  }
  return res;
}
