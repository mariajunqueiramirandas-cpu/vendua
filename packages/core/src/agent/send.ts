import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { getIntegration } from '../modules/integrations.ts';
import { markMessageFailed, markMessageSent, type Channel } from '../modules/threads.ts';
import { sendEmail } from './channels/email.ts';
import { sendWhatsApp } from './channels/whatsapp.ts';

/**
 * agent/send — outbound dispatch. Loads a queued message with its thread +
 * lead, picks the enabled provider for the channel, sends, and records the
 * outcome on the message row. The only path outbound traffic takes — routes,
 * the approvals queue, and the agent runner all converge here.
 */
export async function dispatchMessage(
  sql: Sql,
  messageId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const bundle = await controlTx(sql, async (tx) => {
    const msg = (
      await tx<
        { id: string; thread_id: string; body: string; status: string }[]
      >`select id, thread_id, body, status from lead_messages where id = ${messageId}`
    )[0];
    if (!msg) return null;
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
      await tx<{ id: string; name: string; email: string | null; whatsapp: string | null }[]>`
        select id, name, email, whatsapp from leads where id = ${thread.lead_id}
      `
    )[0]!;
    return { msg, thread, lead };
  });
  if (!bundle) return { ok: false, reason: 'message not found' };
  const { msg, thread, lead } = bundle;
  if (msg.status !== 'queued') return { ok: false, reason: `status ${msg.status}` };

  try {
    if (thread.channel === 'email') {
      if (!lead.email) throw new Error('lead has no email');
      const integration = await getIntegration(sql, 'email');
      const providerMessageId = await sendEmail(integration, {
        to: lead.email,
        subject: thread.subject ?? 'Venduá',
        body: msg.body,
      });
      await markMessageSent(sql, messageId, providerMessageId);
    } else if (thread.channel === 'whatsapp') {
      const to = lead.whatsapp ?? thread.external_id;
      if (!to) throw new Error('lead has no whatsapp');
      const integration = await getIntegration(sql, 'whatsapp');
      const providerMessageId = await sendWhatsApp(sql, integration, to, msg.body);
      await markMessageSent(sql, messageId, providerMessageId);
    } else {
      // manual channel: nothing to dispatch — staff copies it elsewhere.
      await markMessageSent(sql, messageId, null);
    }
    return { ok: true };
  } catch (e) {
    await markMessageFailed(sql, messageId, e instanceof Error ? e.message : 'send failed');
    return { ok: false, reason: e instanceof Error ? e.message : 'send failed' };
  }
}
