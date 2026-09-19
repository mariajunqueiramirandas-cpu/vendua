import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegrationTx } from '../modules/integrations.ts';
import { markMessageFailed, markMessageSent, type Channel } from '../modules/threads.ts';
import { sendEmail } from './channels/email.ts';
import { sendWhatsApp } from './channels/whatsapp.ts';

/**
 * agent/send — outbound dispatch. Claims the queued message with a row lock
 * (`for update`) and holds it across the provider call, so two concurrent
 * dispatchers serialize: the loser sees the already-sent status instead of
 * double-sending. Routes, the approvals queue, and the agent runner all
 * converge here.
 */
export async function dispatchMessage(
  sql: Sql,
  messageId: string,
): Promise<{ ok: boolean; reason?: string }> {
  return controlTx(sql, async (tx) => {
    const msg = (
      await tx<
        { id: string; thread_id: string; body: string; status: string }[]
      >`select id, thread_id, body, status from lead_messages where id = ${messageId} for update`
    )[0];
    if (!msg) return { ok: false, reason: 'message not found' };
    if (msg.status !== 'queued') return { ok: false, reason: `status ${msg.status}` };

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
          name: string;
          email: string | null;
          whatsapp: string | null;
          unsubscribed_at: string | null;
        }[]
      >`
        select id, name, email, whatsapp, unsubscribed_at from leads where id = ${thread.lead_id}
      `
    )[0]!;
    // Re-check opt-out at dispatch time — a draft approved after the lead
    // unsubscribed must not leave the building.
    if (lead.unsubscribed_at) {
      await markMessageFailed(tx, messageId, 'lead unsubscribed');
      return { ok: false, reason: 'lead unsubscribed' };
    }

    // Flip to 'sending' inside the lock before the provider call: a crash here
    // leaves 'sending' (drain fails it past the lease), never 'queued' again —
    // a retried mutation can never double-send.
    await tx`update lead_messages set status = 'sending', updated_at = now() where id = ${messageId}`;

    try {
      if (thread.channel === 'email') {
        if (!lead.email) throw new Error('lead has no email');
        const integration = await getIntegrationTx(tx, 'email');
        const providerMessageId = await sendEmail(integration, {
          to: lead.email,
          subject: thread.subject ?? 'Venduá',
          body: msg.body,
        });
        await markMessageSent(tx, messageId, providerMessageId);
      } else if (thread.channel === 'whatsapp') {
        const to = lead.whatsapp ?? thread.external_id;
        if (!to) throw new Error('lead has no whatsapp');
        const integration = await getIntegrationTx(tx, 'whatsapp');
        const providerMessageId = await sendWhatsApp(sql, integration, to, msg.body);
        await markMessageSent(tx, messageId, providerMessageId);
      } else {
        // manual channel: nothing to dispatch — staff copies it elsewhere.
        await markMessageSent(tx, messageId, null);
      }
      return { ok: true };
    } catch (e) {
      await markMessageFailed(tx, messageId, e instanceof Error ? e.message : 'send failed');
      return { ok: false, reason: e instanceof Error ? e.message : 'send failed' };
    }
  });
}
