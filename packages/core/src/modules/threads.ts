import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { leadJson, type LeadRow } from './leads.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from './integrations.ts';

// Unified inbox: one thread per (lead, channel); owns persistence + the
// draft→approve→dispatch lifecycle — provider sends live in agent/channels.

export const CHANNELS = ['email', 'whatsapp', 'instagram', 'manual'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Channels that dispatch through a provider ('manual' is a staff note), in
 *  auto-pick preference order. */
export const SEND_CHANNELS = ['whatsapp', 'instagram', 'email'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
export function isSendChannel(v: unknown): v is SendChannel {
  return typeof v === 'string' && (SEND_CHANNELS as readonly string[]).includes(v);
}

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
  /** Opt-out goodbye — the one message allowed to dispatch after
   *  unsubscribed_at is set (0021). */
  is_farewell: boolean;
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

/** The unique (lead_id, channel) key makes concurrent inbounds converge on one thread. */
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

// '@Handle', 'handle' or an instagram.com URL → 'handle'; null when it isn't one
export function instagramHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.|m\.)?(instagram\.com\/)?@?/, '')
    .replace(/[/?#].*$/, '');
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

// SQL twin of instagramHandle over leads.instagram — keep the two in step
export const IG_HANDLE_SQL = `lower(regexp_replace(regexp_replace(trim(instagram), '^(https?://)?(www\\.|m\\.)?(instagram\\.com/)?@?', '', 'i'), '[/?#].*$', ''))`;

export interface InboundResult {
  leadId: string;
  threadId: string;
  messageId: string;
  leadCreated: boolean;
  /** true when provider_message_id was already recorded — callers must not
   *  re-trigger side effects (opt-out logging, reply runs) on replays. */
  alreadySeen: boolean;
}

// Lead lookup → thread → message → activity; unknown contacts create a lead.
// Idempotent on provider_message_id.
export async function addInboundMessage(
  sql: Sql,
  input: {
    channel: Channel;
    /** sender's address/jid as the provider reports it */
    from: string;
    /** the sender's complementary provider address (whatsapp LID ↔ phone jid) —
     *  matched as an alias so a contact first seen under the other form doesn't re-mint a lead */
    fromAlias?: string;
    fromName?: string;
    subject?: string;
    body: string;
    providerMessageId?: string;
    externalThreadId?: string;
    /** 'out' = the account's own copy of a sent message (history echo / a
     *  reply typed on the phone) — recorded as staff context, never
     *  treated as a fresh inbound. */
    direction?: 'in' | 'out';
    /** provider timestamp — history import preserves it in created_at and
     *  last_message_at; live ingest leaves it unset for now(). */
    sentAt?: Date;
    /** history import: context-only record — no activity row, no
     *  cadence-floor clear, and ingestInbound never queues a reply. */
    historical?: boolean;
  },
): Promise<InboundResult> {
  const body = str(input.body, 'body', 8000).trim();
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'body is required');
  const direction = input.direction ?? 'in';
  const result = await controlTx(sql, async (tx) => {
    // Provider ids are namespaced per channel — they share no global namespace.
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

    // Lead match: email on `email`, the sender's thread then handle on instagram,
    // digits on phone/whatsapp for whatsapp.
    let leadId: string | null = null;
    const from = str(input.from, 'from', 300).trim();
    const igHandle = input.channel === 'instagram' ? instagramHandle(from) : null;
    if (input.channel === 'instagram') {
      // externalThreadId is the sender's account id — stable across handle renames
      if (input.externalThreadId) {
        const rows = await tx`
          select t.lead_id as id from lead_threads t join leads l on l.id = t.lead_id
          where t.channel = 'instagram' and t.external_id = ${input.externalThreadId}
            and l.archived_at is null
          order by t.created_at desc limit 1
        `;
        leadId = rows[0]?.id ?? null;
      }
      if (!leadId && igHandle) {
        const rows = await tx`
          select id from leads where archived_at is null
            and ${tx.unsafe(IG_HANDLE_SQL)} = ${igHandle}
          order by created_at desc limit 1
        `;
        leadId = rows[0]?.id ?? null;
      }
      if (leadId && igHandle) {
        await tx`
          update leads set instagram = ${`@${igHandle}`}
          where id = ${leadId} and (instagram is null or trim(instagram) = '')
        `;
      }
    } else if (input.channel === 'email') {
      const rows = await tx`
        select id from leads where archived_at is null
          and lower(trim(email)) = lower(${from}) order by created_at desc limit 1
      `;
      leadId = rows[0]?.id ?? null;
    } else {
      const digits = from.replace(/\D/g, '');
      // `whatsapp` matches on either alias (LID ↔ PN jid pair) so a lid-first contact
      // isn't re-minted; `phone` stays primary-only — the lid is not a phone number.
      const altDigits = input.fromAlias?.replace(/\D/g, '') ?? '';
      const whatsappDigits = [digits, altDigits].filter((d) => d.length >= 6);
      if (whatsappDigits.length) {
        const rows = await tx`
          select id from leads where archived_at is null and (
            regexp_replace(coalesce(whatsapp, ''), '\\D', '', 'g') = any(${whatsappDigits})
            or regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits}
          ) order by created_at desc limit 1
        `;
        leadId = rows[0]?.id ?? null;
      }
      // Inbound proves `from`: an empty or digit-matching whatsapp takes it verified;
      // a different stored value keeps provenance — unless it IS the message's own alias
      // (provider proved both), then canonicalize to `from` so later messages converge.
      if (leadId && input.channel === 'whatsapp') {
        const hasAlt = altDigits.length >= 6;
        await tx`
          update leads set
            whatsapp = case
              when whatsapp is null or whatsapp = '' then ${from}
              when ${hasAlt} and regexp_replace(whatsapp, '\\D', '', 'g') = ${altDigits} then ${from}
              else whatsapp
            end,
            whatsapp_verified = whatsapp_verified
              or whatsapp is null or whatsapp = ''
              or regexp_replace(whatsapp, '\\D', '', 'g') = ${digits}
              or (${hasAlt} and regexp_replace(whatsapp, '\\D', '', 'g') = ${altDigits})
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
      else if (input.channel === 'instagram') {
        if (igHandle) fields.instagram = `@${igHandle}`;
      } else {
        // An inbound whatsapp number is self-evidencing.
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

    const author = direction === 'in' ? 'lead' : 'staff';
    const status = direction === 'in' ? 'received' : 'sent';
    const message = (
      await tx<MessageRow[]>`
        insert into lead_messages (thread_id, direction, author, body, status, provider_message_id, created_at, historical)
        values (${thread.id}, ${direction}, ${author}, ${body}, ${status}, ${pmid}, ${input.sentAt ?? new Date()}, ${input.historical === true})
        returning *
      `
    )[0]!;

    // greatest(): history chunks arrive out of order.
    await tx`
      update lead_threads set last_message_at = greatest(last_message_at, ${input.sentAt ?? new Date()})
      where id = ${thread.id}
    `;
    await tx`update leads set updated_at = now() where id = ${leadId}`;
    if (direction === 'in' && !input.historical) {
      // A reply clears 'cadence'/'auto' nudges (the reply run re-commits what's still
      // wanted); 'requested'/'staff'/legacy 'agent' survive — 0025 made their provenance
      // unrecoverable, so they're treated as promises a reply can't cancel.
      await tx`
        update leads set next_action_at = null, next_action_source = null
        where id = ${leadId} and next_action_source in ('cadence', 'auto')
      `;
    }
    // History import would flood the activity feed.
    if (!input.historical) {
      await tx`
        insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${leadId}, 'agent',
                ${direction === 'in' ? `Recebida via ${input.channel}` : `Enviada via ${input.channel}`},
                ${tx.json({ channel: input.channel, messageId: message.id } as never)}, 'system')
      `;
    }

    return { leadId, threadId: thread.id, messageId: message.id, leadCreated, alreadySeen: false };
  });
  if (!result.alreadySeen) {
    emitControlEvent('thread.message', result.threadId);
    emitControlEvent('lead.change', result.leadId);
  }
  return result;
}

/** 'draft' when approval is required, 'queued' when it can ship. Dispatch is in agent/send.ts. */
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
    /** Opt-out goodbye — exempt from the unsubscribed suppression at
     *  dispatch. Only unsubscribe() sets this. */
    farewell?: boolean;
  },
  idemKey: string,
): Promise<
  ClaimResult<{ thread: ReturnType<typeof threadJson>; message: ReturnType<typeof messageJson> }>
> {
  const body = str(input.body, 'body', 8000).trim();
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'body is required');
  const res = await claimControl(sql, idemKey, (tx) => composeMessageTx(tx, input));
  if (!res.replayed) {
    emitControlEvent('thread.message', res.body.thread.id);
    if (res.body.message.status === 'draft') {
      emitControlEvent('draft.change', res.body.thread.id);
    }
  }
  return res;
}

// Tx-local compose — send_message calls this under the lead's advisory lock.
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
    /** Opt-out goodbye — exempt from the unsubscribed suppression at
     *  dispatch. Only unsubscribe() sets this. */
    farewell?: boolean;
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
  // Snapshot the effective subject — dispatch must send what was approved (thread.subject is already effective).
  const messageSubject = thread.subject;
  const message = (
    await tx<MessageRow[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, subject, meeting_id, is_farewell)
      values (${thread.id}, 'out', ${input.author}, ${body}, ${input.status ?? 'draft'}, ${input.agentRunId ?? null}, ${messageSubject}, ${input.meetingId ?? null}, ${input.farewell ?? false})
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
): Promise<
  ClaimResult<{
    message: ReturnType<typeof messageJson>;
    stale?: boolean;
    runId?: string;
    retired?: string[];
  }>
> {
  let capFlagged = false;
  const res = await claimControl<{
    message: ReturnType<typeof messageJson>;
    stale?: boolean;
    runId?: string;
    retired?: string[];
  }>(sql, idemKey, async (tx) => {
    const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
    const staleDays = g.staleDraftDays ?? DEFAULT_GUARDRAILS.staleDraftDays;
    if (staleDays > 0) {
      // capfin BEFORE the draft row lock — the inbound gate takes capfin first; the
      // reverse order here is the AB-BA deadlock the capfin-first rule prevents.
      const leadRow = await tx<{ lead_id: string }[]>`
        select t.lead_id from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where m.id = ${messageId}
      `;
      if (leadRow[0]) {
        const { capLockTx } = await import('../agent/runner.ts');
        await capLockTx(tx, leadRow[0].lead_id);
      }
      // A stale AGENT draft never ships — supersede and enqueue a draftOnly regen
      // (staff drafts exempt). The exists() mirrors claimRun's lead gate: an unrunnable
      // lead falls through to a normal approve. The cap is skipped — a capped lead is
      // refused below, never silently sent.
      const stale = await tx<MessageRow[]>`
        update lead_messages
        set status = 'rejected',
            error = ${`rascunho expirado (>${staleDays}d) — regenerando`},
            updated_at = now()
        where id = ${messageId} and status = 'draft' and author = 'agent'
          and created_at < now() - make_interval(days => ${staleDays})
          and exists (
            select 1 from lead_threads t
            join leads l on l.id = t.lead_id
            where t.id = lead_messages.thread_id
              and t.agent_enabled
              and l.agent_mode <> 'off'
              and l.archived_at is null
              and l.unsubscribed_at is null
              and l.agent_paused_at is null
          )
        returning *
      `;
      if (stale[0]) {
        const thread = (
          await tx<{ lead_id: string }[]>`
            select lead_id from lead_threads where id = ${stale[0].thread_id}
          `
        )[0]!;
        // Dedupe on the same regen intent only — a generic outreach run lacks draftOnly,
        // so for it the regen mails as an 'event' inbox item handled in-context instead.
        const active = await tx<{ id: string; src: 'run' | 'mail' }[]>`
          select 'run' as src, id::text as id, created_at from agent_runs
          where lead_id = ${thread.lead_id} and kind = 'outreach'
            and status in ('queued', 'running')
            and params->>'auto' = 'regenerate'
            and params->>'src' = ${messageId}
          union all
          select 'mail' as src, id::text, created_at from agent_inbox
          where lead_id = ${thread.lead_id} and consumed_at is null
            and payload->>'auto' = 'regenerate'
            and payload->>'src' = ${messageId}
          order by created_at limit 1
        `;
        // runId is only ever an agent_runs id — an undrained inbox item has no run to point the UI at.
        let queued = false;
        let runId: string | null = null;
        const cap: { flagged?: boolean; retired?: string[] } = {};
        if (active[0]) {
          // A queued regen is reusable only while it can still claim — if the lead
          // crossed the cap after queueing, claimRun parks it forever; refuse instead.
          const { leadUnderCostCapTx } = await import('../agent/runner.ts');
          const verdict = await leadUnderCostCapTx(tx, thread.lead_id);
          cap.flagged = verdict === 'flagged';
          queued = verdict === 'under';
          runId = queued && active[0].src === 'run' ? active[0].id : null;
        } else {
          const { insertRun } = await import('../agent/runner.ts');
          const { enqueueInboxTx } = await import('../agent/inbox.ts');
          const focus = `o rascunho anterior expirou (${staleDays}d sem envio) — reescreva a mesma intenção com o estado atual do lead. Texto anterior: ${stale[0].body.slice(0, 500)}`;
          const params = {
            draftOnly: true,
            auto: 'regenerate',
            src: messageId,
            focus,
          };
          runId = await insertRun(
            tx,
            {
              kind: 'outreach',
              leadId: thread.lead_id,
              threadId: stale[0].thread_id,
              params,
            },
            cap,
          );
          if (runId) {
            await enqueueInboxTx(tx, thread.lead_id, 'event', {
              text: focus,
              requestedKind: 'outreach',
              threadId: stale[0].thread_id,
              auto: 'regenerate',
              src: messageId,
              params,
            });
            queued = true;
            // insertRun may return an already-active run's id — report it only when that
            // run is draftOnly and can actually drain this item; a generic run would finish
            // without recomposing and the item waits for the orphan sweep's draftOnly run.
            const drains = await tx<{ id: string }[]>`
              select id from agent_runs
              where id = ${runId}
                and coalesce(params->>'draftOnly', 'false') = 'true'
            `;
            if (!drains.length) runId = null;
          }
        }
        if (!queued) {
          // The cap refused the regen and the expired text must not send — keep it
          // a draft and refuse the approve; staff rewrites or rejects it.
          capFlagged = cap.flagged === true;
          const kept = await tx<MessageRow[]>`
            update lead_messages
            set status = 'draft',
                error = ${'rascunho expirado — lead acima do teto de custo do agente'},
                updated_at = now()
            where id = ${messageId}
            returning *
          `;
          return {
            status: 422,
            body: {
              error: {
                code: 'LEAD_COST_CAP',
                message:
                  'draft is stale and the lead is over its agent cost cap — rewrite the text or reject it',
              },
              message: messageJson(kept[0]!),
            } as never,
          };
        } else {
          await tx`
            insert into lead_activities (lead_id, kind, body, meta, created_by)
            values (${thread.lead_id}, 'system',
                    ${`rascunho expirado (${staleDays}d) — regenerando contra o estado atual`},
                    ${tx.json({ messageId, runId } as never)}, 'system')
          `;
          return {
            status: 200,
            body: {
              message: messageJson(stale[0]),
              stale: true,
              ...(runId ? { runId } : {}),
              ...(cap.retired?.length ? { retired: cap.retired } : {}),
            },
          };
        }
      }
    }
    const rows = await tx<MessageRow[]>`
      update lead_messages
      set status = 'queued', approved_by = ${approvedBy}, approved_at = now()
      where id = ${messageId} and status = 'draft'
      returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'draft message not found');
    return { status: 200, body: { message: messageJson(rows[0]!) } };
  });
  if (!res.replayed) {
    emitControlEvent('draft.change', res.body.message.threadId);
    emitControlEvent('thread.message', res.body.message.threadId);
    if (res.body.runId) emitControlEvent('run.update', res.body.runId);
    for (const r of res.body.retired ?? []) emitControlEvent('run.update', r);
    if (res.body.stale || capFlagged) emitControlEvent('lead.change');
  }
  return res;
}

export async function rejectMessage(
  sql: Sql,
  messageId: string,
  idemKey: string,
): Promise<ClaimResult<{ message: ReturnType<typeof messageJson> }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    // capfin before the reject (same ordering as approveMessage): a reject committing
    // between the finish gate's liveness read and 'done' flip would strand a finished run.
    const leadRow = await tx<{ lead_id: string }[]>`
      select t.lead_id from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where m.id = ${messageId}
    `;
    if (leadRow[0]) {
      const { capLockTx } = await import('../agent/runner.ts');
      await capLockTx(tx, leadRow[0].lead_id);
    }
    const rows = await tx<MessageRow[]>`
      update lead_messages set status = 'rejected', updated_at = now()
      where id = ${messageId} and status = 'draft'
      returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'draft message not found');
    return { status: 200, body: { message: messageJson(rows[0]!) } };
  });
  if (!res.replayed) {
    emitControlEvent('draft.change', res.body.message.threadId);
    emitControlEvent('thread.message', res.body.message.threadId);
  }
  return res;
}

export async function setThreadAgent(
  sql: Sql,
  threadId: string,
  enabled: boolean,
  idemKey: string,
  /** Optional fence run first inside the claim tx — a live-claim check so a reclaimed run can't still mutate. */
  guard?: (tx: Sql) => Promise<void>,
): Promise<ClaimResult<{ thread: ReturnType<typeof threadJson> }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    await guard?.(tx);
    const rows = await tx<ThreadRow[]>`
      update lead_threads set agent_enabled = ${enabled} where id = ${threadId} returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
    // Re-enabling is staff's resume signal — clears the lead-wide handoff marker.
    if (enabled) {
      await tx`
        update leads set agent_paused_at = null, updated_at = now()
        where id = ${rows[0].lead_id} and agent_paused_at is not null
      `;
    }
    return { status: 200, body: { thread: threadJson(rows[0]!) } };
  });
  if (!res.replayed) emitControlEvent('thread.message', threadId);
  return res;
}

/** Approvals queue — joined to lead context so the reviewer doesn't open each lead. */
export async function listDrafts(sql: Sql) {
  return controlTx(
    sql,
    (tx) =>
      tx.unsafe(
        `select m.id, m.thread_id, m.body, m.author, m.status, m.subject, m.created_at,
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
          subject: string | null;
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
      subject: r.subject,
      createdAt: r.created_at,
    })),
  );
}

// Tx-local — call inside the dispatch tx (no controlTx: tx handles lack `.begin()`).
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
  // Reason goes to `error` — provider_message_id is unique-indexed and same-reason failures would collide.
  await tx`
    update lead_messages set status = 'failed', error = ${reason.slice(0, 300)}, updated_at = now()
    where id = ${messageId}
  `;
}
