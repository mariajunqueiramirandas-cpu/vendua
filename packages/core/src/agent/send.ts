import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  getIntegrationTx,
  getSettingTx,
  phoneIsIgnored,
  type Guardrails,
  type IntegrationRow,
} from '../modules/integrations.ts';
import { markMessageFailed, markMessageSent, type Channel } from '../modules/threads.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { sendEmail } from './channels/email.ts';
import { sendWhatsApp } from './channels/whatsapp.ts';
import { applyDeliveryEventTx } from './channels/email-inbound.ts';

/**
 * Outbound dispatch: claim tx (row-lock → 'sending'), provider call outside
 * any tx, finalize tx. A crash mid-flight leaves 'sending', never 'queued'
 * again — at-most-once delivery by construction.
 */
export async function dispatchMessage(
  sql: Sql,
  messageId: string,
  /** Optional fence inside the claim tx — a returned string marks the
   *  message failed without sending. */
  guard?: (tx: Sql) => Promise<string | null | void>,
): Promise<{ ok: boolean; reason?: string }> {
  let wroteTid: string | null = null;
  const job = await controlTx(sql, async (tx) => {
    const refused = (await guard?.(tx)) || null;
    const msg = (
      await tx<
        {
          id: string;
          thread_id: string;
          body: string;
          status: string;
          subject: string | null;
          author: string;
          is_farewell: boolean;
          meeting_id: string | null;
        }[]
      >`select id, thread_id, body, status, author, subject, is_farewell, meeting_id from lead_messages where id = ${messageId} for update`
    )[0];
    if (!msg) return { fail: 'message not found' as const };
    // terminal/in-flight states are honest outcomes — a replayed approve
    // must report the real result, not fail
    if (msg.status === 'sent' || msg.status === 'delivered') {
      return { fail: null, alreadySent: true as const };
    }
    if (msg.status === 'sending') return { fail: null, inFlight: true as const };
    if (msg.status === 'failed') {
      return { fail: 'previously failed' as const };
    }
    if (msg.status !== 'queued') return { fail: `status ${msg.status}` as const };

    const thread = (
      await tx<
        {
          id: string;
          lead_id: string;
          channel: Channel;
          subject: string | null;
          external_id: string | null;
        }[]
      >`select * from lead_threads where id = ${msg.thread_id}`
    )[0]!;
    const lead = (
      await tx<
        {
          id: string;
          email: string | null;
          whatsapp: string | null;
          phone: string | null;
          unsubscribed_at: string | null;
          archived_at: string | null;
          agent_paused_at: string | null;
          email_bounced_at: string | null;
        }[]
      >`
        select id, email, whatsapp, phone, unsubscribed_at, archived_at, agent_paused_at, email_bounced_at from leads where id = ${thread.lead_id}
      `
    )[0]!;

    // re-check suppression at dispatch — an approved draft must not send
    // after archive/unsub/handoff/bounce; handoff mutes the AGENT only
    // (staff + system notices still flow)
    const suppressed = lead.archived_at
      ? 'lead archived'
      : lead.unsubscribed_at && !msg.is_farewell
        ? 'lead unsubscribed'
        : lead.agent_paused_at && msg.author === 'agent'
          ? 'agent paused for lead'
          : thread.channel === 'email' && lead.email_bounced_at
            ? 'email bounced'
            : null;
    if (suppressed) {
      await markMessageFailed(tx, messageId, suppressed);
      wroteTid = msg.thread_id;
      return { fail: suppressed };
    }

    // meeting-bound messages die with the meeting — the row lock serializes
    // against a cancel/reschedule (incl. drain's stranded-message recovery)
    if (msg.meeting_id) {
      const meeting = (
        await tx<
          { status: string }[]
        >`select status from meetings where id = ${msg.meeting_id} for update`
      )[0];
      if (!meeting || meeting.status !== 'scheduled') {
        await markMessageFailed(tx, messageId, 'meeting no longer scheduled');
        wroteTid = msg.thread_id;
        return { fail: 'meeting no longer scheduled' };
      }
    }

    // a disabled/absent integration must fail loudly — never fall through
    // to `log` and record `sent` for a message nobody received
    let integration: IntegrationRow | null = null;
    let to: string | null = null;
    if (thread.channel === 'email') {
      to = lead.email;
      if (!to) {
        await markMessageFailed(tx, messageId, 'lead has no email');
        wroteTid = msg.thread_id;
        return { fail: 'lead has no email' };
      }
      integration = await getIntegrationTx(tx, 'email');
    } else if (thread.channel === 'whatsapp') {
      to = lead.whatsapp ?? thread.external_id;
      if (!to) {
        await markMessageFailed(tx, messageId, 'lead has no whatsapp');
        wroteTid = msg.thread_id;
        return { fail: 'lead has no whatsapp' };
      }
      // staff/founder numbers never get agent traffic — the net for leads
      // created before the ignore list
      const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
      if (phoneIsIgnored(g.ignoredPhones ?? [], to, lead.whatsapp, lead.phone)) {
        await markMessageFailed(tx, messageId, 'número ignorado');
        wroteTid = msg.thread_id;
        return { fail: 'número ignorado' };
      }
      integration = await getIntegrationTx(tx, 'whatsapp');
    }
    if (thread.channel !== 'manual' && !integration) {
      const reason = `no enabled ${thread.channel} integration`;
      await markMessageFailed(tx, messageId, reason);
      wroteTid = msg.thread_id;
      return { fail: reason };
    }

    // caller-refused sends fail durably — 'failed' keeps stranded-message
    // recovery from resending
    if (refused) {
      await markMessageFailed(tx, messageId, refused);
      wroteTid = msg.thread_id;
      return { fail: refused };
    }

    // 'sending' is the point of no return — stamp the attempt so dedupe
    // can tell it from a pre-wire refusal
    const upd = await tx<{ sending_at: string }[]>`
      update lead_messages set status = 'sending', dispatch_attempted_at = clock_timestamp(),
        updated_at = clock_timestamp()
      where id = ${messageId} returning updated_at as sending_at
    `;
    wroteTid = thread.id;
    return {
      send: {
        threadId: thread.id,
        // 'sending' is the dispatch boundary an inbound must post-date to
        // count as answering; clock_timestamp() since now() freezes at tx start
        sendingAt: upd[0]!.sending_at,
        channel: thread.channel,
        to,
        // compose-time subject wins; thread subject is the fallback
        subject: msg.subject ?? thread.subject ?? 'Venduá',
        body: msg.body,
        integration,
        leadId: thread.lead_id,
        author: msg.author,
      },
    };
  });

  if (wroteTid) emitControlEvent('thread.message', wroteTid);
  if ('alreadySent' in job) return { ok: true, reason: 'already sent' };
  if ('inFlight' in job) return { ok: true, reason: 'dispatch in flight' };
  if ('fail' in job && job.fail != null) return { ok: false, reason: job.fail };
  const { send } = job;

  let providerMessageId: string | null = null;
  let sendError: string | null = null;
  try {
    if (send.channel === 'email') {
      providerMessageId = await sendEmail(send.integration!, {
        to: send.to!,
        subject: send.subject,
        body: send.body,
      });
    } else if (send.channel === 'whatsapp') {
      providerMessageId = await sendWhatsApp(sql, send.integration!, send.to!, send.body);
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : 'send failed';
  }

  // provider ids are channel-namespaced so e.g. a Resend id can't collide
  // with a Baileys id in the dedupe index
  const threadsTouched = new Set<string>();
  const leadsTouched = new Set<string>();
  const out = await controlTx(sql, async (tx) => {
    if (sendError) {
      await markMessageFailed(tx, messageId, sendError);
      return { ok: false, reason: sendError };
    }
    const pmid = providerMessageId ? `${send.channel}:${providerMessageId}` : null;
    // advisory key serializes against webhook parkers so one can't slip
    // between the pmid write and the drain replay
    if (providerMessageId) {
      await tx`select pg_advisory_xact_lock(hashtext(${`pev:${send.channel}:${providerMessageId}`}))`;
    }
    await markMessageSent(tx, messageId, pmid);
    // cadence floor: NULL-only fill (agent/staff values win) gated like
    // claimRun; skip when a real inbound post-dates 'sending' — 'historical'
    // imports and NULL received_at (0030 backfill legacy) are never answers
    if (send.author === 'agent') {
      const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
      const days = g.followupCadenceDays ?? DEFAULT_GUARDRAILS.followupCadenceDays;
      if (days > 0) {
        await tx`
          update leads set next_action_at = now() + make_interval(days => ${days}),
                           next_action_source = 'cadence'
          where id = ${send.leadId}
            and next_action_at is null
            and archived_at is null
            and unsubscribed_at is null
            and agent_mode <> 'off'
            and not exists (
              select 1 from lead_messages im
              join lead_threads it on it.id = im.thread_id
              where it.lead_id = ${send.leadId}
                and im.direction = 'in'
                and not im.historical
                and im.received_at is not null
                and im.received_at > ${send.sendingAt}::timestamptz
            )
        `;
      }
    }
    // replay provider_events parked before the pmid existed so the message
    // lands in the event-described state
    if (providerMessageId) {
      const pending = await tx<{ event: string; payload: { to?: string[] } }[]>`
        select event, payload from provider_events
        where channel = ${send.channel} and provider_id = ${providerMessageId}
        order by id
      `;
      for (const ev of pending) {
        if (ev.event === 'email.delivered') {
          await tx`
            update lead_messages set status = 'delivered', updated_at = now()
            where id = ${messageId} and status = 'sent'`;
        } else if (
          ev.event === 'email.bounced' ||
          ev.event === 'email.failed' ||
          ev.event === 'email.complained'
        ) {
          const applied = await applyDeliveryEventTx(
            tx,
            ev.event as 'email.bounced' | 'email.failed' | 'email.complained',
            providerMessageId,
            ev.payload?.to,
          );
          if ('leadId' in applied) {
            leadsTouched.add(applied.leadId);
            for (const t of applied.threadIds) threadsTouched.add(t);
          }
        }
      }
      if (pending.length) {
        await tx`
          delete from provider_events
          where channel = ${send.channel} and provider_id = ${providerMessageId}`;
      }
    }
    // sent outbound IS first contact → deterministic lead→contacted (model
    // can't be relied on); runs after the parked-event replay so a bounced
    // send can't promote; forward-only, and 'manual' never counts
    // (it dispatches nothing)
    const promoted =
      send.channel === 'manual'
        ? []
        : await tx<{ id: string }[]>`
      update leads set state = 'contacted', updated_at = now()
      where id = ${send.leadId} and state = 'lead'
        and exists (
          select 1 from lead_messages m
          where m.id = ${messageId} and m.status in ('sent', 'delivered')
        )
      returning id
    `;
    if (promoted[0]) {
      const actor = send.author === 'agent' || send.author === 'staff' ? send.author : 'system';
      await tx`
        insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
        select ${send.leadId}, 'lead', 'contacted', ${actor}, deal_value_cents
        from leads where id = ${send.leadId}
      `;
      await tx`
        insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${send.leadId}, 'state_change', 'lead → contacted',
                ${tx.json({ from: 'lead', to: 'contacted' } as never)}, ${actor})
      `;
      leadsTouched.add(send.leadId);
    }
    return { ok: true };
  });
  threadsTouched.add(send.threadId);
  for (const t of threadsTouched) emitControlEvent('thread.message', t);
  for (const l of leadsTouched) emitControlEvent('lead.change', l);
  return out;
}
