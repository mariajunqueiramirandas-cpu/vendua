import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { getGuardrails } from '../modules/integrations.ts';
import { addInboundMessage, type Channel, type InboundResult } from '../modules/threads.ts';
import { drain, insertRun } from './runner.ts';
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

export async function ingestInbound(
  sql: Sql,
  input: {
    channel: Channel;
    from: string;
    fromName?: string;
    subject?: string;
    body: string;
    providerMessageId?: string | null;
  },
): Promise<InboundResult> {
  const res = await addInboundMessage(sql, {
    channel: input.channel,
    from: input.from,
    ...(input.fromName ? { fromName: input.fromName } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    body: input.body,
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
  });

  // Provider retry of an already-recorded message: no side effects again.
  if (res.alreadySeen) return res;
  emitControlEvent('thread.message', res.threadId);
  if (res.leadCreated) emitControlEvent('lead.change', res.leadId);

  // guardrails.inboundReplyDelayMin paces the answer — the run sits queued
  // with a future run_at instead of replying while the lead is still typing.
  const { inboundReplyDelayMin } = await getGuardrails(sql);
  // Gate check and run insert in one tx: `for update of l` serializes with
  // the lead row's own writers — archive/unsubscribe land on `leads`, so a
  // suppression committed between the message insert and now is seen here
  // instead of stranding a queued reply on a suppressed lead.
  const runId = await controlTx(sql, async (tx) => {
    const gateRows = await tx<ReplyGate[]>`
      select t.agent_enabled, l.agent_mode, l.unsubscribed_at, l.archived_at
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${res.threadId}
      for update of l
    `;
    const gate = gateRows[0];

    if (
      !gate ||
      !gate.agent_enabled ||
      gate.agent_mode === 'off' ||
      gate.unsubscribed_at ||
      gate.archived_at
    ) {
      return null;
    }
    return insertRun(tx, {
      kind: 'reply',
      leadId: res.leadId,
      threadId: res.threadId,
      ...(inboundReplyDelayMin > 0
        ? { runAt: new Date(Date.now() + inboundReplyDelayMin * 60_000) }
        : {}),
    });
  });
  if (runId) {
    emitControlEvent('run.update', runId);
    // Kick the queue now — don't wait up to the poll interval for a reply
    // (a delayed run_at is simply not due yet; the worker tick picks it up).
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
  }
  return res;
}
