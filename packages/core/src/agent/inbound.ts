import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { getGuardrails, phoneIsIgnored } from '../modules/integrations.ts';
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
  const runId = await controlTx(sql, async (tx) => {
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
    // draft with no replacement. Runs under the l,t lock — claimRun's lead
    // revalidation can't slip a row through while we hold it.
    await tx`
      update agent_runs
      set status = 'canceled', error = 'lead respondeu', finished_at = now()
      where lead_id = ${res.leadId} and kind = 'outreach' and status = 'queued'
        and params->>'auto' is not null and params->>'auto' <> 'regenerate'
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
    const parked = await tx`
      select 1 from agent_runs
      where kind = 'reply' and thread_id = ${res.threadId} and status = 'queued'
        and params->>'origin' = 'inbound'
      limit 1
    `;
    if (parked.length) return null;
    return insertRun(tx, {
      kind: 'reply',
      leadId: res.leadId,
      threadId: res.threadId,
      params: { origin: 'inbound' },
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
