import type { Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  getGuardrails,
  getSetting,
  phoneIsIgnored,
  whatsappHistoryOf,
} from '../modules/integrations.ts';
import { addInboundMessage, type Channel, type InboundResult } from '../modules/threads.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { blockedPhonesTx } from '../modules/staff.ts';
import { isMerchantPhone } from '../admin/phones.ts';
import { reserveParkedFollowupsTx, retireWakeupsOnInboundTx } from './agenda.ts';
import { CRM_AGENT_ID, LEAD_SUBJECT, requestLeadTx } from './dispatch.ts';

type ReplyGate = {
  agent_enabled: boolean;
  agent_mode: string;
  unsubscribed_at: string | null;
  archived_at: string | null;
};

// shared inbound path. Opt-out intent is the reply turn's call via the `unsubscribe`
// tool — a bare "sair"/"cancelar" can be normal speech, so nothing is decided by regex.

/** The agent's own unanswered outreach: what a fresh inbound makes obsolete. */
export const OWN_OUTREACH_KINDS = ['timer.followup', 'lead.first_contact'];

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
    /** email whose From failed DKIM/DMARC — never matched to an existing lead */
    unverifiedSender?: boolean;
  },
): Promise<IngestResult> {
  const { inboundReplyDelayMin } = await getGuardrails(sql);
  // Team numbers drop before a lead is ever minted — the agent
  // must never see them as leads, in either direction.
  const blocked = await controlTx(sql, blockedPhonesTx);
  if (phoneIsIgnored(blocked, input.from, input.fromAlias)) {
    return { ignored: `número ignorado: ${input.from}` };
  }
  // Store owners get their admin sign-in codes from this same number; a "valeu" back
  // is not a sales lead, and the agent must not answer a customer as a prospect.
  if (input.channel === 'whatsapp' && (await isMerchantPhone(sql, input.from, input.fromAlias))) {
    return { ignored: `número de lojista: ${input.from}` };
  }
  // whatsapp_history scopes the pairing-time import; live messages are never filtered here
  const history =
    input.historical && input.channel === 'whatsapp'
      ? whatsappHistoryOf(await getSetting<unknown>(sql, 'whatsapp_history', null))
      : null;
  if (history?.mode === 'off') return { ignored: 'histórico do whatsapp desligado' };
  if (
    history?.maxAgeDays &&
    input.sentAt &&
    input.sentAt.getTime() < Date.now() - history.maxAgeDays * 86_400_000
  ) {
    return { ignored: `histórico com mais de ${history.maxAgeDays} dias` };
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
    ...(input.unverifiedSender ? { unverifiedSender: true } : {}),
    ...(history
      ? {
          createLead: history.mode === 'leads',
          ...(history.leadMode !== 'inbound' ? { newLeadAgentMode: history.leadMode } : {}),
        }
      : {}),
  });
  if (!res) return { ignored: 'histórico de contato sem lead' };

  // history imports and own-account echoes are context only — never answered
  if (input.historical || input.direction === 'out') return res;
  if (!res.alreadySeen) {
    emitControlEvent('thread.message', res.threadId);
    if (res.leadCreated) emitControlEvent('lead.change', res.leadId);
  }
  // gate check + mailbox row in one tx: `for update of l, t` serializes with the suppression
  // writers so a suppression committed mid-flight is seen here
  const supersededThreads: string[] = [];
  const dedupeKey = `crm:inbound:${res.messageId}`;
  await controlTx(sql, async (tx) => {
    const gateRows = await tx<ReplyGate[]>`
      select t.agent_enabled, l.agent_mode, l.unsubscribed_at, l.archived_at
      from lead_threads t join leads l on l.id = t.lead_id
      where t.id = ${res.threadId}
      for update of l, t
    `;
    // A provider retry of a recorded message has no side effects again — unless the attempt
    // that recorded it died before this tx: its mailbox row is missing and nothing came after it.
    if (res.alreadySeen) {
      const lost = await tx`
        select 1 from lead_messages m
        where m.id = ${res.messageId} and m.direction = 'in' and not m.historical
          and m.created_at > now() - interval '1 day'
          and not exists (
            select 1 from lead_messages n
            where n.thread_id = m.thread_id and n.id <> m.id and n.created_at >= m.created_at
          )
          and not exists (select 1 from agent_mailbox b where b.dedupe_key = ${dedupeKey})
      `;
      if (!lost.length) return;
    }
    // retire the agent's own unanswered outreach drafts — obsolete once the lead writes; drafts
    // of promises and staff asks survive (a turn's batch says what it answered)
    const drafts = await tx<{ id: string; thread_id: string }[]>`
      update lead_messages m
      set status = 'rejected', error = 'lead respondeu', updated_at = now()
      where m.status = 'draft' and m.author = 'agent' and m.agent_run_id is not null
        and m.thread_id in (select id from lead_threads where lead_id = ${res.leadId})
        and exists (
          select 1 from agent_mailbox b where b.consumed_by_turn = m.agent_run_id
            and b.kind = any(${OWN_OUTREACH_KINDS}))
        and not exists (
          select 1 from agent_mailbox b where b.consumed_by_turn = m.agent_run_id
            and b.kind <> all(${OWN_OUTREACH_KINDS}))
      returning m.id, m.thread_id
    `;
    supersededThreads.push(...drafts.map((d) => d.thread_id));
    for (const d of drafts) {
      await recordStaffEventTx(tx, 'draft.resolved', {
        messageId: d.id,
        outcome: 'superseded',
        by: null,
      });
    }
    // a pending first contact can't serve the mail and would fire a "reopening"
    await tx`
      delete from agent_mailbox m using agent_actors a
      where a.id = m.actor_id and a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID} and a.subject_kind = ${LEAD_SUBJECT}
        and a.subject_id = ${res.leadId} and m.kind = 'lead.first_contact'
        and m.consumed_by_turn is null
    `;
    await retireWakeupsOnInboundTx(tx, res.leadId);
    const gate = gateRows[0];
    if (
      !gate ||
      !gate.agent_enabled ||
      gate.agent_mode === 'off' ||
      gate.unsubscribed_at ||
      gate.archived_at
    )
      return;
    // a preset/job switched off or a paused agent files nothing now: the message is served when
    // the agent is back (reserveUnansweredTx); quiet hours move the
    // answer to the window's end when it would go out live; a burst coalesces in the actor's
    // quiet window and a turn already running is preempted at its next step
    await requestLeadTx(tx, {
      leadId: res.leadId,
      kind: 'message.inbound',
      source: input.channel,
      dedupeKey,
      payload: {
        messageId: res.messageId,
        threadId: res.threadId,
        channel: input.channel,
      },
      ...(inboundReplyDelayMin > 0
        ? { at: new Date(Date.now() + inboundReplyDelayMin * 60_000) }
        : {}),
    });
  });
  for (const tid of new Set(supersededThreads)) emitControlEvent('draft.change', tid);
  emitControlEvent('run.update', res.leadId);
  return res;
}

/**
 * The agent is back (unpaused, switched on, a thread re-enabled, replies on again): each lead's
 * latest message still unanswered becomes the turn it would have been. The dedupe key is
 * ingestInbound's, so a message already served never runs twice. Runs in the transaction that
 * re-enabled the agent.
 */
export async function reserveUnansweredTx(tx: Sql, leadId: string | null): Promise<number> {
  const rows = await tx<{ lead_id: string; id: string; thread_id: string; channel: Channel }[]>`
    select distinct on (t.lead_id) t.lead_id, m.id, m.thread_id, t.channel
    from lead_messages m
    join lead_threads t on t.id = m.thread_id
    join leads l on l.id = t.lead_id
    where (${leadId}::uuid is null or t.lead_id = ${leadId}::uuid)
      and m.direction = 'in' and not m.historical and m.created_at > now() - interval '3 days'
      and t.agent_enabled and l.agent_mode <> 'off' and l.agent_paused_at is null
      and l.unsubscribed_at is null and l.archived_at is null
      and not exists (
        select 1 from lead_messages o join lead_threads o2 on o2.id = o.thread_id
        where o2.lead_id = t.lead_id and o.direction = 'out' and o.created_at > m.created_at)
    order by t.lead_id, m.created_at desc
    limit 200`;
  let n = 0;
  for (const r of rows) {
    const out = await requestLeadTx(tx, {
      leadId: r.lead_id,
      kind: 'message.inbound',
      source: r.channel,
      dedupeKey: `crm:inbound:${r.id}`,
      payload: { messageId: r.id, threadId: r.thread_id, channel: r.channel },
    });
    if (out.mailboxId) n++;
  }
  return n;
}

/** Automation back on for a lead (or for all): what waited on it runs. Unanswered messages
 *  first, so a lead who wrote meanwhile gets an answer rather than the old follow-up. */
export async function reserveParkedTx(tx: Sql, leadId: string | null): Promise<void> {
  await reserveUnansweredTx(tx, leadId);
  await reserveParkedFollowupsTx(tx, leadId);
}
