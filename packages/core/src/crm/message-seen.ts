import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import type { Sql } from '../platform/db.ts';

type ReadChannel = 'instagram' | 'whatsapp';

export const CRM_SEEN_SUFFIX = '|crm-seen';

export async function recordMessageSeenTx(
  tx: Sql,
  channel: ReadChannel,
  providerIds: string[],
): Promise<string[]> {
  const threads = new Set<string>();
  for (const id of [...new Set(providerIds)].sort()) {
    // Same lock as finalizeSentTx, including receipts that beat the send response.
    await tx`select pg_advisory_xact_lock(hashtext(${`pev:${channel}:${id}`}))`;
    const pmid = `${channel}:${id}`;
    const [message] = await tx<{ thread_id: string }[]>`
      update lead_messages m set seen_at = now()
      from lead_threads t
      where m.thread_id = t.id and t.channel = ${channel}
        and m.direction = 'out' and m.status in ('sent', 'delivered')
        and m.provider_message_id = ${pmid} and m.seen_at is null
      returning m.thread_id`;
    if (message) {
      threads.add(message.thread_id);
    } else {
      await tx`
        insert into provider_events (channel, provider_id, event)
        select ${channel}, ${id}, ${`${channel}.seen`}
        where not exists (select 1 from lead_messages where provider_message_id = ${pmid})
          and exists (
            select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
            where m.status = 'sending' and m.direction = 'out' and t.channel = ${channel}
          )
        on conflict (channel, provider_id, event) do nothing`;
    }
  }
  return [...threads];
}

export async function recordMessageSeen(
  sql: Sql,
  channel: ReadChannel,
  ids: string[],
): Promise<void> {
  const threads = await controlTx(sql, (tx) => recordMessageSeenTx(tx, channel, ids));
  for (const id of threads) emitControlEvent('thread.message', id);
}
