import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegrationTx, type IntegrationRow } from '../modules/integrations.ts';
import { markMessageFailed, markMessageSent, type Channel } from '../modules/threads.ts';
import { sendEmail } from './channels/email.ts';
import { sendWhatsApp } from './channels/whatsapp.ts';

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
): Promise<{ ok: boolean; reason?: string }> {
  // Phase 1: claim.
  const job = await controlTx(sql, async (tx) => {
    const msg = (
      await tx<
        { id: string; thread_id: string; body: string; status: string; subject: string | null }[]
      >`select id, thread_id, body, status, subject from lead_messages where id = ${messageId} for update`
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
      : lead.unsubscribed_at
        ? 'lead unsubscribed'
        : thread.channel === 'email' && lead.email_bounced_at
          ? 'email bounced'
          : null;
    if (suppressed) {
      await markMessageFailed(tx, messageId, suppressed);
      return { fail: suppressed };
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
    await markMessageSent(tx, messageId, pmid);
    return { ok: true };
  });
}
