import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import type { Fence } from './auth-store.ts';
import { parseContent } from './content.ts';
import type { WaMessage } from './session.ts';
import { heldTx } from './state.ts';
import { userJid } from './text.ts';

// "Who Duá answers": when a new number writes, Core asks for that one chat's latest messages
// (store_wa_history_requests). The gateway fetches them from the phone on demand and writes them
// to the request row only — Core reads them once, classifies, and nulls them.

export const HISTORY_CHANNEL = 'vendua_history';
export const HISTORY_COUNT = 10;
export const HISTORY_TIMEOUT_MS = 15_000;
const MAX_TEXT = 500;
/** the column's cap is 16000 octets; emoji-heavy chats get their oldest lines dropped */
const MAX_BYTES = 15_000;

export interface HistoryLine {
  fromMe: boolean;
  at: string;
  text: string;
}

export type HistoryFailure = 'offline' | 'no_session' | 'timeout' | 'error';

export type HistoryOutcome =
  | { status: 'done'; messages: HistoryLine[] }
  | { status: 'empty' }
  | { status: 'failed'; failure: HistoryFailure };

/** baileys' `messaging-history.set`, the part an on-demand answer uses */
export interface HistorySet {
  syncType?: number | null;
  peerDataRequestSessionId?: string | null;
  chats?: { id?: string | null }[];
  messages?: (WaMessage & { messageTimestamp?: unknown })[];
}

export interface HistoryWait {
  /** the chat in both forms (PN and LID) */
  jids: Set<string>;
  /** what `fetchMessageHistory` returned: the request message's id */
  sessionId: string | null;
}

const PLACEHOLDER: Record<string, string> = {
  image: '[foto]',
  audio: '[áudio]',
  video: '[vídeo]',
  document: '[documento]',
  sticker: '[figurinha]',
};

const inChat = (m: WaMessage, jids: Set<string>) =>
  jids.has(userJid(m.key?.remoteJid) ?? '') || jids.has(userJid(m.key?.remoteJidAlt) ?? '');

/** The messages of an on-demand answer to `w`, or null when the set isn't one. Matched by the
 *  request's id when WhatsApp echoes it, else by the chat; only that chat's messages are taken. */
export function answerFor(h: HistorySet, w: HistoryWait): WaMessage[] | null {
  const msgs = h.messages ?? [];
  const ofChat = msgs.filter((m) => inChat(m, w.jids));
  if (w.sessionId && h.peerDataRequestSessionId === w.sessionId) {
    if (ofChat.length || !msgs.length) return ofChat;
    // our answer filed under the chat's other form (PN or LID): only if it is one chat; several
    // chats can't be told apart, so none is taken and the wait times out (the message alone decides)
    const chats = new Set(msgs.map((m) => userJid(m.key?.remoteJid)).filter(Boolean));
    return chats.size === 1 ? msgs : null;
  }
  if (ofChat.length) return ofChat;
  if ((h.chats ?? []).some((c) => w.jids.has(userJid(c.id) ?? ''))) return [];
  return null;
}

const seconds = (v: unknown): number | null => {
  const n = typeof v === 'object' && v !== null ? Number(String(v)) : Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
};

/** What the request row keeps: up to 10 messages before the anchor, oldest first, text only
 *  (media as a placeholder, captions as text), reactions and system messages left out. */
export function historyLines(
  messages: (WaMessage & { messageTimestamp?: unknown })[],
  normalize: (message: unknown) => unknown,
  anchor: { anchorId: string; anchorAt: Date },
): HistoryLine[] {
  const lines: { at: number; line: HistoryLine }[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    const id = m.key?.id;
    if (!id || id === anchor.anchorId || seen.has(id)) continue;
    const ts = seconds(m.messageTimestamp);
    if (ts == null || ts * 1000 > anchor.anchorAt.getTime()) continue;
    const c = parseContent(normalize(m.message) ?? m.message);
    if (!c || c.kind === 'reaction') continue;
    const text = c.body ?? PLACEHOLDER[c.kind] ?? '[outro]';
    seen.add(id);
    lines.push({
      at: ts,
      line: {
        fromMe: !!m.key?.fromMe,
        at: new Date(ts * 1000).toISOString(),
        text: text.slice(0, MAX_TEXT),
      },
    });
  }
  lines.sort((a, b) => a.at - b.at);
  const out = lines.slice(-HISTORY_COUNT).map((l) => l.line);
  while (out.length && Buffer.byteLength(JSON.stringify(out)) > MAX_BYTES) out.shift();
  return out;
}

export interface HistoryRequest {
  id: string;
  address: string;
  anchorWaId: string;
  anchorAt: Date;
  createdAt: Date;
}

/** A request still waiting, or null (answered, failed, gone). */
export async function pendingRequest(
  sql: Sql,
  tenantId: string,
  requestId: string,
): Promise<HistoryRequest | null> {
  const rows = await withTenant(
    sql,
    tenantId,
    (tx) => tx<
      { id: string; address: string; anchor_wa_id: string; anchor_at: Date; created_at: Date }[]
    >`
      select id, address, anchor_wa_id, anchor_at, created_at from store_wa_history_requests
      where tenant_id = ${tenantId} and id = ${requestId} and status = 'pending'`,
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        address: r.address,
        anchorWaId: r.anchor_wa_id,
        anchorAt: r.anchor_at,
        createdAt: r.created_at,
      }
    : null;
}

/** pending → fetching, under the store's lease; false when another pass took it. */
export async function claimRequest(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  requestId: string,
): Promise<boolean> {
  return withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    const r = await tx`
      update store_wa_history_requests set status = 'fetching', updated_at = now()
      where tenant_id = ${tenantId} and id = ${requestId} and status = 'pending'`;
    return r.count > 0;
  });
}

async function finishTx(tx: Sql, tenantId: string, requestId: string, o: HistoryOutcome) {
  const messages = o.status === 'done' ? tx.json(o.messages as never) : null;
  const failure = o.status === 'failed' ? o.failure : null;
  const r = await tx`
    update store_wa_history_requests set status = ${o.status}, failure = ${failure},
      messages = ${messages}, finished_at = now(), updated_at = now()
    where tenant_id = ${tenantId} and id = ${requestId} and status in ('pending', 'fetching')`;
  if (r.count) await tx`select pg_notify(${HISTORY_CHANNEL}, ${`${tenantId}|${requestId}`})`;
}

/** The answer (or why there is none), then Core's wake-up. */
export async function finishRequest(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  requestId: string,
  o: HistoryOutcome,
): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    await heldTx(tx, tenantId, fence);
    await finishTx(tx, tenantId, requestId, o);
  });
}

/** Requests a notification may have missed: those of the stores this gateway holds. Requests of
 *  stores no gateway holds fail at once (`no_session`) — nobody else would answer them. */
export async function sweepRequests(
  sql: Sql,
  owned: string[],
  only: string[] | null,
): Promise<{ tenant_id: string; id: string }[]> {
  return controlTx(sql, async (tx) => {
    const orphans = await tx<{ tenant_id: string; id: string }[]>`
      update store_wa_history_requests r set status = 'failed', failure = 'no_session',
        finished_at = now(), updated_at = now()
      where r.status = 'pending' and r.created_at < now() - interval '10 seconds'
        and (${only}::uuid[] is null or r.tenant_id = any(${only}::uuid[]))
        and not exists (
          select 1 from store_whatsapp w
          where w.tenant_id = r.tenant_id and w.owner is not null and w.lease_until > now())
      returning r.tenant_id, r.id`;
    for (const o of orphans)
      await tx`select pg_notify(${HISTORY_CHANNEL}, ${`${o.tenant_id}|${o.id}`})`;
    if (!owned.length) return [];
    return tx<{ tenant_id: string; id: string }[]>`
      select tenant_id, id from store_wa_history_requests
      where status = 'pending' and tenant_id = any(${owned}::uuid[])
      order by created_at
      limit 100`;
  });
}
