import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import type { Thread } from './threads.ts';

const JID = /^[0-9:.]{1,40}@(s\.whatsapp\.net|lid)$/;
const BR_PHONE = /^\d{10,11}$/;

/**
 * A message that isn't a model turn: Core's own notice (a handoff, a degrade) or the merchant's
 * reply from the admin. One `shopper_messages` row and, on WhatsApp, its chat row on the store's
 * outbox, in the caller's transaction. `key` makes a retried request write nothing new.
 */
export async function sendDirectTx(
  tx: Sql,
  thread: Thread,
  o: { author: 'core' | 'merchant'; text: string; key: string; merchantUserId?: string | null },
): Promise<string> {
  const status = thread.channel === 'whatsapp' ? 'queued' : 'sent';
  const body = o.text.slice(0, 2000);
  const rows = await tx<{ id: string }[]>`
    insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, agent_step, merchant_user_id)
    values (${thread.tenantId}, ${thread.id}, ${o.author}, 'text', ${body}, ${status}, ${o.key.slice(0, 200)},
            ${o.merchantUserId ?? null})
    on conflict (tenant_id, agent_step) where agent_step is not null do nothing
    returning id`;
  if (!rows[0]) {
    const [existing] = await tx<{ id: string }[]>`
      select id from shopper_messages where tenant_id = ${thread.tenantId} and agent_step = ${o.key.slice(0, 200)}`;
    return existing!.id;
  }
  const id = rows[0].id;
  if (status === 'queued') {
    const jid = JID.test(thread.address) ? thread.address : null;
    const phone = thread.phone && BR_PHONE.test(thread.phone) ? thread.phone : null;
    if (jid || phone)
      await tx`
        insert into store_wa_messages (tenant_id, kind, phone, jid, body, shopper_message_id, expires_at)
        values (${thread.tenantId}, 'chat', ${phone}, ${jid}, ${body}, ${id}, now() + interval '30 minutes')
        on conflict (shopper_message_id) where shopper_message_id is not null do nothing`;
  }
  await tx`update shopper_threads set last_out_at = now(),
      ${o.author === 'merchant' ? tx`last_merchant_at = now(), pending_since = null, waiting_since = null,` : tx``}
      updated_at = now()
    where id = ${thread.id}`;
  await emitAdminTx(tx, thread.tenantId, 'vendedor', thread.id);
  return id;
}

/** "digitando…" while a turn is in flight (the gateway sends 'composing', never 'available'). */
export async function typingTx(tx: Sql, tenantId: string, threadId: string): Promise<void> {
  await tx`select pg_notify('vendua_wa', ${`${tenantId}|typing|${threadId}`})`;
}
