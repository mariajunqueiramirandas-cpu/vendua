import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import {
  DEFAULT_GUARDRAILS,
  getIntegrationTx,
  getSettingTx,
  type Guardrails,
  type IntegrationRow,
} from '../modules/integrations.ts';
import { markMessageFailed, markMessageSent, type Channel } from '../modules/threads.ts';
import { sendEmail } from './channels/email.ts';
import { sendWhatsApp } from './channels/whatsapp.ts';
import { applyDeliveryEventTx } from './channels/email-inbound.ts';

/**
 * agent/send — outbound dispatch, two transactions around the provider call:
 *
 *  1. claim tx — row-lock the message, re-check suppression, resolve the
 *     enabled integration, flip queued → 'sending', commit. A dispatcher that
 *     loses the race sees 'sending' instead of 'queued' and bails.
 *  2. provider call — outside any transaction; slow providers never hold a
 *     row lock or a pooled connection hostage.
 *  3. finalize tx — mark sent/failed.
 *
 * A crash between 1 and 3 leaves 'sending' (drain fails it past the lease),
 * never 'queued' again — at-most-once delivery by construction.
 */
export async function dispatchMessage(
  sql: Sql,
  messageId: string,
  /** Optional fence run first inside the claim tx — agent-run dispatches
   *  pass a live-claim check so a canceled/reclaimed run can't still push a
   *  queued message to the provider. Staff approvals, meeting sends, and the
   *  stranded-message recovery in drain() pass nothing: they legitimately
   *  dispatch messages whose authoring run already finished. */
  guard?: (tx: Sql) => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  // Phase 1: claim.
  const job = await controlTx(sql, async (tx) => {
    await guard?.(tx);
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
    // Terminal/in-flight states are honest outcomes, not errors — a replayed
    // approve/compose hits this and must report the real result, not a failure.
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
          unsubscribed_at: string | null;
          archived_at: string | null;
          email_bounced_at: string | null;
        }[]
      >`
        select id, email, whatsapp, unsubscribed_at, archived_at, email_bounced_at from leads where id = ${thread.lead_id}
      `
    )[0]!;

    // Re-check suppression at dispatch time — a draft approved after the lead
    // was archived, unsubscribed, or had its email bounce must not leave the
    // building.
    const suppressed = lead.archived_at
      ? 'lead archived'
      : lead.unsubscribed_at && !msg.is_farewell
        ? 'lead unsubscribed'
        : thread.channel === 'email' && lead.email_bounced_at
          ? 'email bounced'
          : null;
    if (suppressed) {
      await markMessageFailed(tx, messageId, suppressed);
      return { fail: suppressed };
    }

    // Meeting-bound messages (confirmations, reminders) die with the meeting:
    // the row lock serializes the check against a cancel/reschedule that
    // commits between compose and this claim — including the stranded-message
    // recovery path in drain(), which re-checks the same durable link.
    if (msg.meeting_id) {
      const meeting = (
        await tx<
          { status: string }[]
        >`select status from meetings where id = ${msg.meeting_id} for update`
      )[0];
      if (!meeting || meeting.status !== 'scheduled') {
        await markMessageFailed(tx, messageId, 'meeting no longer scheduled');
        return { fail: 'meeting no longer scheduled' };
      }
    }

    // A disabled/absent integration must fail loudly — never fall through to
    // the dev `log` driver and record `sent` for a message nobody received.
    // `log` is still usable when explicitly configured + enabled.
    let integration: IntegrationRow | null = null;
    let to: string | null = null;
    if (thread.channel === 'email') {
      to = lead.email;
      if (!to) {
        await markMessageFailed(tx, messageId, 'lead has no email');
        return { fail: 'lead has no email' };
      }
      integration = await getIntegrationTx(tx, 'email');
    } else if (thread.channel === 'whatsapp') {
      to = lead.whatsapp ?? thread.external_id;
      if (!to) {
        await markMessageFailed(tx, messageId, 'lead has no whatsapp');
        return { fail: 'lead has no whatsapp' };
      }
      integration = await getIntegrationTx(tx, 'whatsapp');
    }
    if (thread.channel !== 'manual' && !integration) {
      const reason = `no enabled ${thread.channel} integration`;
      await markMessageFailed(tx, messageId, reason);
      return { fail: reason };
    }

    await tx`update lead_messages set status = 'sending', updated_at = now() where id = ${messageId}`;
    return {
      send: {
        channel: thread.channel,
        to,
        // The compose-time snapshot wins; the thread subject is only the
        // fallback for rows written before message-level subjects existed.
        subject: msg.subject ?? thread.subject ?? 'Venduá',
        body: msg.body,
        integration,
        leadId: thread.lead_id,
        author: msg.author,
      },
    };
  });

  if ('alreadySent' in job) return { ok: true, reason: 'already sent' };
  if ('inFlight' in job) return { ok: true, reason: 'dispatch in flight' };
  if ('fail' in job && job.fail != null) return { ok: false, reason: job.fail };
  const { send } = job;

  // Phase 2: provider call, no transaction held.
  let providerMessageId: string | null = null;
  let sendError: string | null = null;
  try {
    if (send.channel === 'email') {
      // Phase 1 guarantees a non-null enabled integration for email/whatsapp.
      providerMessageId = await sendEmail(send.integration!, {
        to: send.to!,
        subject: send.subject,
        body: send.body,
      });
    } else if (send.channel === 'whatsapp') {
      providerMessageId = await sendWhatsApp(sql, send.integration!, send.to!, send.body);
    }
    // manual: nothing to dispatch — staff copies it elsewhere.
  } catch (e) {
    sendError = e instanceof Error ? e.message : 'send failed';
  }

  // Phase 3: finalize. Provider ids are channel-namespaced — they share no
  // global namespace, so a Resend id must not collide with a Baileys id in
  // the dedupe index.
  return controlTx(sql, async (tx) => {
    if (sendError) {
      await markMessageFailed(tx, messageId, sendError);
      return { ok: false, reason: sendError };
    }
    const pmid = providerMessageId ? `${send.channel}:${providerMessageId}` : null;
    // The webhook parks events that find no pmid — serialize both sides on
    // this advisory key so a parker can't slip between our pmid write and
    // the drain below (its pmid check happens under the same lock).
    if (providerMessageId) {
      await tx`select pg_advisory_xact_lock(hashtext(${`pev:${send.channel}:${providerMessageId}`}))`;
    }
    await markMessageSent(tx, messageId, pmid);
    // Cadence floor: an agent send leaves the lead awaiting a reply — stamp
    // the default cadence so a run that forgot nextActionAt still gets a
    // follow-up. NULL-only fill: an agent- or staff-set value always wins,
    // and the suppression fields mirror claimRun's lead gate so the stamp
    // lands only on leads the sweeps would actually pick up.
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
        `;
      }
    }
    // A delivery event can beat this finalize — Resend emits it before our
    // send call returns the provider id. Webhook ingest parks those in
    // provider_events; now that the pmid exists, replay them in-order so the
    // message/lead land in the state the event described.
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
          await applyDeliveryEventTx(
            tx,
            ev.event as 'email.bounced' | 'email.failed' | 'email.complained',
            providerMessageId,
            ev.payload?.to,
          );
        }
      }
      if (pending.length) {
        await tx`
          delete from provider_events
          where channel = ${send.channel} and provider_id = ${providerMessageId}`;
      }
    }
    return { ok: true };
  });
}
