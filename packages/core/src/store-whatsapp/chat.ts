import { withTenant, type Sql } from '../platform/db.ts';
import { planHas } from '../modules/billing/plans.ts';
import type { Fence } from './auth-store.ts';
import {
  IMAGES_PER_MINUTE,
  MAX_AUDIO_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_BYTES,
  MAX_PROFILE_NAME,
  type ChatContent,
} from './content.ts';
import { heldTx } from './state.ts';
import { threadPhoneForJid } from './text.ts';

// The Vendedor's side of the gateway (ADR 0031): for a store with store_agent.enabled, every
// 1:1 message — the shopper's, or typed on the store's phone — lands in its conversation, and
// Core's ingest wakes on it (the shopper_messages trigger). Fenced on the lease like every write.

export const SHOPPER_CHANNEL = 'vendua_shopper';

export async function agentEnabled(sql: Sql, tenantId: string): Promise<boolean> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<{ enabled: boolean }[]>`
        select enabled from store_agent where tenant_id = ${tenantId}`;
    // a plan without the Vendedor is the switch off (ADR 0032)
    return rows[0]?.enabled === true && (await planHas(tx, tenantId, 'vendedor'));
  });
}

export interface ChatMessage {
  id: string;
  fromMe: boolean;
  /** the phone-number jid, when known */
  pn: string | null;
  lid: string | null;
  pushName: string | null;
  content: ChatContent;
}

export type ChatStored =
  | { stored: true; threadId: string; messageId: string; address: string }
  | { stored: false; reason: 'duplicate' | 'ours' };

const addressesOf = (m: ChatMessage) => [m.pn, m.lid].filter((a): a is string => !!a);

/** Store one message and its conversation. `download` runs outside any transaction, only when
 *  the media is within bounds; a failed or refused download keeps the message, marked skipped. */
export async function storeChatMessage(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  m: ChatMessage,
  download: () => Promise<Uint8Array>,
): Promise<ChatStored> {
  const addrs = addressesOf(m);
  const media = m.content.media;
  const pre = await withTenant(sql, tenantId, async (tx) => {
    const seen = await tx`
      select 1 from shopper_messages where tenant_id = ${tenantId} and wa_id = ${m.id} limit 1`;
    if (seen.length) return 'duplicate' as const;
    // our own send, echoed back to the linked device
    if (m.fromMe) {
      const ours = await tx`
        select 1 from store_wa_messages where tenant_id = ${tenantId} and wa_id = ${m.id} limit 1`;
      if (ours.length) return 'ours' as const;
    }
    if (media?.type !== 'image') return null;
    const recent = await tx<{ n: number }[]>`
      select count(*)::int as n from shopper_media d
        join shopper_messages msg on msg.id = d.message_id
        join shopper_threads t on t.id = msg.thread_id
      where d.tenant_id = ${tenantId} and t.channel = 'whatsapp' and t.address = any(${addrs})
        and msg.kind = 'image' and d.created_at > now() - interval '1 minute'`;
    return recent[0]!.n >= IMAGES_PER_MINUTE ? ('rate' as const) : null;
  });
  if (pre === 'duplicate' || pre === 'ours') return { stored: false, reason: pre };

  const meta: Record<string, unknown> = { ...m.content.meta };
  let bytes: Buffer | null = null;
  if (media) {
    const cap = media.type === 'image' ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
    let skipped: string | null = null;
    if (pre === 'rate') skipped = 'rate';
    else if (media.type === 'audio' && (media.seconds ?? 0) > MAX_AUDIO_SECONDS)
      skipped = 'too_long';
    else if ((media.size ?? 0) > cap) skipped = 'too_big';
    else {
      try {
        const got = await download();
        if (!got.byteLength) skipped = 'empty';
        else if (got.byteLength > cap) skipped = 'too_big';
        else bytes = Buffer.from(got.buffer, got.byteOffset, got.byteLength);
      } catch {
        skipped = 'download_failed';
      }
    }
    if (skipped) meta.skipped = skipped;
  }

  const shopper = !m.fromMe;
  const name = shopper ? (m.pushName?.trim().slice(0, MAX_PROFILE_NAME) ?? null) || null : null;
  const phone = threadPhoneForJid(m.pn);
  const want = m.pn ?? m.lid!;
  return withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    // one conversation per shopper: a LID thread becomes the number's once WhatsApp tells us it
    const found = (
      await tx<{ id: string; address: string }[]>`
        select id, address from shopper_threads
        where tenant_id = ${tenantId} and channel = 'whatsapp' and address = any(${addrs})
        order by (address = ${want}) desc
        limit 1
        for update`
    )[0];
    if (found && found.address !== want)
      await tx`update shopper_threads set address = ${want} where id = ${found.id}`;
    const thread = (
      await tx<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address, phone, profile_name,
                                     last_in_at, last_merchant_at, pending_since)
        values (${tenantId}, 'whatsapp', ${want}, ${phone}, ${name},
                case when ${shopper}::boolean then now() end, case when ${shopper}::boolean then null else now() end,
                case when ${shopper}::boolean then now() end)
        on conflict (tenant_id, channel, address) do update set
          phone = coalesce(excluded.phone, shopper_threads.phone),
          profile_name = coalesce(excluded.profile_name, shopper_threads.profile_name),
          last_in_at = coalesce(excluded.last_in_at, shopper_threads.last_in_at),
          last_merchant_at = coalesce(excluded.last_merchant_at, shopper_threads.last_merchant_at),
          -- the store answering by hand answers whatever was waiting
          pending_since = case when ${shopper}::boolean
            then coalesce(shopper_threads.pending_since, excluded.pending_since) end,
          updated_at = now()
        returning id`
    )[0]!;
    const msg = (
      await tx<{ id: string }[]>`
        insert into shopper_messages (tenant_id, thread_id, author, kind, body, meta, wa_id,
                                      quoted_wa_id, status, ingest)
        values (${tenantId}, ${thread.id}, ${shopper ? 'shopper' : 'merchant'}, ${m.content.kind},
                ${m.content.body}, ${tx.json(meta as never)}, ${m.id}, ${m.content.quotedId},
                'received', 'pending')
        on conflict (tenant_id, wa_id) where wa_id is not null do nothing
        returning id`
    )[0];
    if (!msg) return { stored: false, reason: 'duplicate' } as const;
    if (bytes && media) {
      const seconds =
        media.seconds == null ? null : Math.max(0, Math.min(600, Math.round(media.seconds)));
      await tx`
        insert into shopper_media (tenant_id, message_id, mime, bytes, seconds)
        values (${tenantId}, ${msg.id}, ${media.mime}, ${bytes}, ${seconds})`;
    }
    return { stored: true, threadId: thread.id, messageId: msg.id, address: want } as const;
  });
}

/** The thread a typing jid belongs to (its address, either form). */
export async function threadForJid(
  sql: Sql,
  tenantId: string,
  jid: string,
): Promise<string | null> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ id: string }[]>`
      select id from shopper_threads
      where tenant_id = ${tenantId} and channel = 'whatsapp' and address = ${jid} limit 1`,
  );
  return rows[0]?.id ?? null;
}

/** The shopper is typing: Core holds a reply that would cut them off. */
export async function recordTyping(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  threadId: string,
): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    const r = await tx`
      update shopper_threads set typing_at = now()
      where tenant_id = ${tenantId} and id = ${threadId}`;
    if (r.count)
      await tx`select pg_notify(${SHOPPER_CHANNEL}, ${`${tenantId}|presence|${threadId}`})`;
  });
}

/** Where to show "digitando…" for a thread Core is answering. */
export async function threadAddress(
  sql: Sql,
  tenantId: string,
  threadId: string,
): Promise<string | null> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ address: string }[]>`
      select address from shopper_threads
      where tenant_id = ${tenantId} and id = ${threadId} and channel = 'whatsapp'`,
  );
  return rows[0]?.address ?? null;
}

export interface VoiceNote {
  bytes: Uint8Array;
  seconds: number | null;
}

export async function voiceNote(
  sql: Sql,
  tenantId: string,
  mediaId: string,
): Promise<VoiceNote | null> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx<{ bytes: Buffer; seconds: number | null }[]>`
      select bytes, seconds from shopper_media where tenant_id = ${tenantId} and id = ${mediaId}`,
  );
  const r = rows[0];
  return r ? { bytes: r.bytes, seconds: r.seconds } : null;
}
