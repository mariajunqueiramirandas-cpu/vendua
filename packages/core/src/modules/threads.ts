import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { leadJson, type LeadRow } from './leads.ts';

/**
 * threads module — the unified inbox. One thread per (lead, channel):
 * `email`, `whatsapp` (Baileys), `manual` (staff-logged side conversations).
 * Provider sends live in src/agent/channels — this module owns persistence
 * and the draft→approve→dispatch lifecycle only, so modules never import the
 * agent layer (the agent's tools call INTO these functions).
 */

export const CHANNELS = ['email', 'whatsapp', 'manual'] as const;
export type Channel = (typeof CHANNELS)[number];

export function channel(v: unknown): Channel {
  if (typeof v !== 'string' || !(CHANNELS as readonly string[]).includes(v)) {
    throw new HttpError(422, 'INVALID_CHANNEL', `channel must be one of: ${CHANNELS.join(', ')}`);
  }
  return v as Channel;
}

export interface ThreadRow {
  id: string;
  lead_id: string;
  channel: Channel;
  subject: string | null;
  external_id: string | null;
  agent_enabled: boolean;
  last_message_at: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  direction: 'in' | 'out';
  author: 'staff' | 'agent' | 'lead' | 'system';
  body: string;
  status:
    'draft' | 'queued' | 'sending' | 'sent' | 'delivered' | 'received' | 'failed' | 'rejected';
  provider_message_id: string | null;
  agent_run_id: string | null;
  /** Compose-time subject snapshot for outbound messages (0008). */
  subject: string | null;
  error: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export function threadJson(row: ThreadRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    channel: row.channel,
    subject: row.subject,
    externalId: row.external_id,
    agentEnabled: row.agent_enabled,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

export function messageJson(row: MessageRow) {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    author: row.author,
    body: row.body,
    status: row.status,
    providerMessageId: row.provider_message_id,
    agentRunId: row.agent_run_id,
    subject: row.subject,
    error: row.error,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

export interface ThreadListItem {
  id: string;
  leadId: string;
  leadName: string;
  businessName: string | null;
  leadState: string;
  channel: Channel;
  subject: string | null;
  agentEnabled: boolean;
  lastMessageAt: string | null;
  messageCount: number;
  lastBody: string | null;
  lastDirection: 'in' | 'out' | null;
  pendingDrafts: number;
  needsReply: boolean;
}

export async function listThreads(
  sql: Sql,
  filter: { channel?: Channel; q?: string } = {},
): Promise<ThreadListItem[]> {
  const q = filter.q?.trim();
  const qEsc = q ? `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%` : null;
  return controlTx(sql, (tx) => {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = [
      'l.archived_at is null',
      filter.channel ? `t.channel = ${p(filter.channel)}` : 'true',
      qEsc
        ? `(l.name ilike ${p(qEsc)} or l.business_name ilike ${p(qEsc)} or t.subject ilike ${p(qEsc)})`
        : 'true',
    ];
    return tx.unsafe(
      `select t.id, t.lead_id, t.channel, t.subject, t.agent_enabled, t.last_message_at,
              l.name as lead_name, l.business_name, l.state as lead_state,
              lm.n as message_count, lm.last_body, lm.last_direction,
              dr.n as pending_drafts,
              (lm.last_direction = 'in'
                 and not exists (
                   select 1 from lead_messages m2
                   where m2.thread_id = t.id and m2.direction = 'out'
                     and m2.created_at > lm.last_at
                 )) as needs_reply
       from lead_threads t
       join leads l on l.id = t.lead_id
       left join lateral (
         select count(*)::int n,
                (array_agg(m.body order by m.created_at desc))[1] as last_body,
                (array_agg(m.direction order by m.created_at desc))[1] as last_direction,
                max(m.created_at) as last_at
         from lead_messages m
         where m.thread_id = t.id and m.status <> 'rejected'
       ) lm on true
       left join lateral (
         select count(*)::int n from lead_messages m
         where m.thread_id = t.id and m.status = 'draft'
       ) dr on true
       where ${where.join(' and ')}
       order by t.last_message_at desc nulls last, t.created_at desc`,
      params as never[],
    ) as Promise<
      (ThreadRow & {
        lead_name: string;
        business_name: string | null;
        lead_state: string;
        message_count: number | null;
        last_body: string | null;
        last_direction: 'in' | 'out' | null;
        pending_drafts: number | null;
        needs_reply: boolean | null;
      })[]
    >;
  }).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      leadName: r.lead_name,
      businessName: r.business_name,
      leadState: r.lead_state,
      channel: r.channel,
      subject: r.subject,
      agentEnabled: r.agent_enabled,
      lastMessageAt: r.last_message_at,
      messageCount: r.message_count ?? 0,
      lastBody: r.last_body,
      lastDirection: r.last_direction,
      pendingDrafts: r.pending_drafts ?? 0,
      needsReply: r.needs_reply ?? false,
    })),
  );
}

export async function getThread(
  sql: Sql,
  id: string,
): Promise<{
  thread: ReturnType<typeof threadJson>;
  lead: unknown;
  messages: ReturnType<typeof messageJson>[];
} | null> {
  return controlTx(sql, async (tx) => {
    const t = (await tx<ThreadRow[]>`select * from lead_threads where id = ${id}`)[0];
    if (!t) return null;
    const lead = leadJson((await tx<LeadRow[]>`select * from leads where id = ${t.lead_id}`)[0]!);
    const messages = await tx<MessageRow[]>`
      select * from lead_messages where thread_id = ${id} order by created_at asc
    `;
    return {
      thread: threadJson(t),
      lead,
      messages: messages.map(messageJson),
    };
  });
}

export async function threadsForLead(sql: Sql, leadId: string) {
  const rows = await controlTx(
    sql,
    (tx) => tx<ThreadRow[]>`select * from lead_threads where lead_id = ${leadId} order by channel`,
  );
  return rows.map(threadJson);
}

/** find-or-create inside the caller's transaction — the unique (lead_id,
 *  channel) key makes concurrent inbounds converge on one thread. */
export async function ensureThread(
  tx: Sql,
  leadId: string,
  chan: Channel,
  fields: { subject?: string | null; externalId?: string | null } = {},
): Promise<ThreadRow> {
  const rows = await tx<ThreadRow[]>`
    insert into lead_threads (lead_id, channel, subject, external_id)
    values (${leadId}, ${chan}, ${fields.subject ?? null}, ${fields.externalId ?? null})
    on conflict (lead_id, channel)
    do update set
      subject = coalesce(lead_threads.subject, excluded.subject),
      external_id = coalesce(lead_threads.external_id, excluded.external_id)
    returning *
  `;
  return rows[0]!;
}

export interface InboundResult {
  leadId: string;
  threadId: string;
  messageId: string;
  leadCreated: boolean;
  /** true when provider_message_id was already recorded — callers must not
   *  re-trigger side effects (opt-out logging, reply runs) on replays. */
  alreadySeen: boolean;
}

/** Inbound message → lead lookup by contact point → thread → message →
 *  activity. Unknown contacts create a fresh `lead` row — inbound interest
 *  is the best kind of lead. Returns ids so the caller can enqueue a reply
 *  run. Idempotent on provider_message_id. */
export async function addInboundMessage(
  sql: Sql,
  input: {
    channel: Channel;
    /** sender's address/jid as the provider reports it */
    from: string;
    fromName?: string;
    subject?: string;
    body: string;
    providerMessageId?: string;
    externalThreadId?: string;
  },
): Promise<InboundResult> {
  const body = str(input.body, 'body', 8000).trim();
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'body is required');
  return controlTx(sql, async (tx) => {
    // Provider ids are namespaced per channel ('whatsapp:AB12…') — they share
    // no global namespace, so a raw id stored from one channel could suppress
    // a legitimate inbound on another.
    const pmid = input.providerMessageId ? `${input.channel}:${input.providerMessageId}` : null;
    if (pmid) {
      const seen = await tx`
        select m.id, t.lead_id, m.thread_id from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where m.provider_message_id = ${pmid}
      `;
      if (seen[0]) {
        return {
          leadId: seen[0].lead_id,
          threadId: seen[0].thread_id,
          messageId: seen[0].id,
          leadCreated: false,
          alreadySeen: true,
        };
      }
    }

    // Lead match: email on `email`, digits on phone/whatsapp for whatsapp.
    let leadId: string | null = null;
    const from = str(input.from, 'from', 300).trim();
    if (input.channel === 'email') {
      const rows = await tx`
        select id from leads where archived_at is null
          and lower(trim(email)) = lower(${from}) order by created_at desc limit 1
      `;
      leadId = rows[0]?.id ?? null;
    } else {
      const digits = from.replace(/\D/g, '');
      if (digits.length >= 6) {
        const rows = await tx`
          select id from leads where archived_at is null and (
            regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = ${digits}
            or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
          ) order by created_at desc limit 1
        `;
        leadId = rows[0]?.id ?? null;
      }
      // The sender number is proven for a matched lead too: an empty
      // whatsapp (e.g. phone-only match) takes it verified; a digit-matching
      // stored value gets verified; a different stored value keeps its own
      // provenance — inbound proves `from`, not that other number.
      if (leadId && input.channel === 'whatsapp') {
        await tx`
          update leads set
            whatsapp = coalesce(nullif(whatsapp, ''), ${from}),
            whatsapp_verified = whatsapp_verified
              or whatsapp is null or whatsapp = ''
              or regexp_replace(whatsapp, '\\D', '', 'g') = ${digits}
          where id = ${leadId}
        `;
      }
    }

    let leadCreated = false;
    if (!leadId) {
      const name = str(input.fromName ?? from, 'name', 200) || from;
      const fields: Record<string, unknown> = {
        name,
        source: `inbound:${input.channel}`,
        discovered_via: input.channel,
      };
      if (input.channel === 'email') fields.email = from;
      else {
        // An inbound whatsapp number is self-evidencing — they messaged us
        // from it — so the provenance flag lands with the value.
        fields.whatsapp = from;
        fields.whatsapp_verified = true;
      }
      const lead = (
        await tx<
          { id: string; deal_value_cents: number | null }[]
        >`insert into leads ${tx(fields)} returning id, deal_value_cents`
      )[0]!;
      leadId = lead.id;
      leadCreated = true;
      await tx`
        insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
        values (${leadId}, null, 'lead', 'system', ${lead.deal_value_cents})
      `;
    }

    const thread = await ensureThread(tx, leadId, input.channel, {
      subject: input.subject ?? null,
      externalId: input.externalThreadId ?? null,
    });

    const message = (
      await tx<MessageRow[]>`
        insert into lead_messages (thread_id, direction, author, body, status, provider_message_id)
        values (${thread.id}, 'in', 'lead', ${body}, 'received', ${pmid})
        returning *
      `
    )[0]!;

    await tx`update lead_threads set last_message_at = now() where id = ${thread.id}`;
    await tx`update leads set updated_at = now() where id = ${leadId}`;
    await tx`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${leadId}, 'agent', ${`Recebida via ${input.channel}`},
              ${tx.json({ channel: input.channel, messageId: message.id } as never)}, 'system')
    `;

    return { leadId, threadId: thread.id, messageId: message.id, leadCreated, alreadySeen: false };
  });
}

/** Staff/agent compose → status 'draft' when approval is required, 'queued'
 *  when it can ship. Dispatch happens in src/agent/send.ts. */
export async function composeMessage(
  sql: Sql,
  input: {
    leadId: string;
    channel: Channel;
    body: string;
    author: 'staff' | 'agent' | 'system';
    status?: 'draft' | 'queued';
    subject?: string;
    subjectOverride?: string;
    /** the run that produced this message — send_message sets it so a
     *  reclaimed-and-replayed run recognizes its earlier send. */
    agentRunId?: string;
    /** the meeting this message belongs to — dispatch suppresses the send
     *  once that meeting is no longer 'scheduled'. */
    meetingId?: string;
  },
  idemKey: string,
): Promise<
  ClaimResult<{ thread: ReturnType<typeof threadJson>; message: ReturnType<typeof messageJson> }>
> {
  const body = str(input.body, 'body', 8000).trim();
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'body is required');
  return claimControl(sql, idemKey, (tx) => composeMessageTx(tx, input));
}

/** Tx-local compose — the send_message tool calls this inside the same
 *  transaction that took the lead's advisory lock and checked guardrails. */
export async function composeMessageTx(
  tx: Sql,
  input: {
    leadId: string;
    channel: Channel;
    body: string;
    author: 'staff' | 'agent' | 'system';
    status?: 'draft' | 'queued';
    subject?: string;
    /** Explicit staff/agent override — replaces the thread's subject even when
     *  one already exists (plain `subject` only fills an empty one). */
    subjectOverride?: string;
    agentRunId?: string;
    /** the meeting this message belongs to — dispatch suppresses the send
     *  once that meeting is no longer 'scheduled'. */
    meetingId?: string;
  },
): Promise<{
  status: number;
  body: { thread: ReturnType<typeof threadJson>; message: ReturnType<typeof messageJson> };
}> {
  const body = str(input.body, 'body', 8000).trim();
  const exists = await tx`select 1 from leads where id = ${input.leadId}`;
  if (!exists[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
  const thread = await ensureThread(tx, input.leadId, input.channel, {
    subject: input.subject ?? null,
  });
  if (input.subjectOverride) {
    await tx`update lead_threads set subject = ${input.subjectOverride} where id = ${thread.id}`;
    thread.subject = input.subjectOverride;
  }
  // Snapshot the effective subject on the row — dispatch must send what was
  // approved. thread.subject is already the effective value: ensureThread
  // coalesced a plain `subject` into an empty thread, and subjectOverride
  // above replaced it outright.
  const messageSubject = thread.subject;
  const message = (
    await tx<MessageRow[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, subject, meeting_id)
      values (${thread.id}, 'out', ${input.author}, ${body}, ${input.status ?? 'draft'}, ${input.agentRunId ?? null}, ${messageSubject}, ${input.meetingId ?? null})
      returning *
    `
  )[0]!;
  await tx`update lead_threads set last_message_at = now() where id = ${thread.id}`;
  return { status: 201, body: { thread: threadJson(thread), message: messageJson(message) } };
}

export async function approveMessage(
  sql: Sql,
  messageId: string,
  approvedBy: string,
  idemKey: string,
): Promise<ClaimResult<{ message: ReturnType<typeof messageJson> }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<MessageRow[]>`
      update lead_messages
      set status = 'queued', approved_by = ${approvedBy}, approved_at = now()
      where id = ${messageId} and status = 'draft'
      returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'draft message not found');
    return { status: 200, body: { message: messageJson(rows[0]!) } };
  });
}

export async function rejectMessage(
  sql: Sql,
  messageId: string,
  idemKey: string,
): Promise<ClaimResult<{ message: ReturnType<typeof messageJson> }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<MessageRow[]>`
      update lead_messages set status = 'rejected'
      where id = ${messageId} and status = 'draft'
      returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'draft message not found');
    return { status: 200, body: { message: messageJson(rows[0]!) } };
  });
}

export async function setThreadAgent(
  sql: Sql,
  threadId: string,
  enabled: boolean,
  idemKey: string,
): Promise<ClaimResult<{ thread: ReturnType<typeof threadJson> }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<ThreadRow[]>`
      update lead_threads set agent_enabled = ${enabled} where id = ${threadId} returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
    return { status: 200, body: { thread: threadJson(rows[0]!) } };
  });
}

/** Pending drafts for the Approvals queue — joined to lead context so the
 *  reviewer doesn't have to open each lead. */
export async function listDrafts(sql: Sql) {
  return controlTx(
    sql,
    (tx) =>
      tx.unsafe(
        `select m.id, m.thread_id, m.body, m.author, m.status, m.created_at,
              t.channel, t.lead_id, l.name as lead_name, l.business_name, l.state as lead_state
       from lead_messages m
       join lead_threads t on t.id = m.thread_id
       join leads l on l.id = t.lead_id
       where m.status = 'draft'
       order by m.created_at asc`,
      ) as Promise<
        {
          id: string;
          thread_id: string;
          body: string;
          author: string;
          status: string;
          created_at: string;
          channel: Channel;
          lead_id: string;
          lead_name: string;
          business_name: string | null;
          lead_state: string;
        }[]
      >,
  ).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      leadId: r.lead_id,
      leadName: r.lead_name,
      businessName: r.business_name,
      leadState: r.lead_state,
      channel: r.channel,
      body: r.body,
      author: r.author,
      createdAt: r.created_at,
    })),
  );
}

/** Marks a queued outbound as dispatched/failed — tx-local: call inside the
 *  dispatch tx (agent/send.ts holds the row lock). No controlTx wrapper —
 *  transaction handles lack `.begin()`. */
export async function markMessageSent(
  tx: Sql,
  messageId: string,
  providerMessageId: string | null,
): Promise<void> {
  await tx`
    update lead_messages
    set status = 'sent', provider_message_id = ${providerMessageId}, updated_at = now()
    where id = ${messageId} and status in ('queued', 'sending')
  `;
}

export async function markMessageFailed(tx: Sql, messageId: string, reason: string): Promise<void> {
  // Reason goes to `error`, not provider_message_id — failure text isn't a
  // provider id and repeated same-reason failures would collide on the unique
  // index, leaving the second message stuck queued.
  await tx`
    update lead_messages set status = 'failed', error = ${reason.slice(0, 300)}, updated_at = now()
    where id = ${messageId}
  `;
}
