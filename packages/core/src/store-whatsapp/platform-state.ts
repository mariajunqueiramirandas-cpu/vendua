import { controlTx } from '../modules/control.ts';
import { recordChannelState } from '../modules/system-events.ts';
import type { Sql } from '../platform/db.ts';
import { LeaseLost, wipePlatformAuth, type Fence } from './auth-store.ts';
import type { StateUpdate } from './session.ts';

// The platform gateway's writes (platform_wa_*, control scope). Each is fenced on the session's
// lease (owner + epoch), as state.ts does for a store.

const MAX_INBOX_BODY = 8000;
const MAX_PUSH_NAME = 100;
const INBOX_BATCH = 500;
const PAIRS_PER_ROW = 500;

interface Row {
  state: string;
  wanted: boolean;
  phone: string | null;
  owner: string | null;
  lease_epoch: string | number;
}

const lost = (name: string) => new LeaseLost(`platform:${name}`);

export async function heldPlatformTx(
  tx: Sql,
  name: string,
  fence: Fence,
  lock: 'update' | 'share' = 'update',
): Promise<Row> {
  const row = (
    await tx<Row[]>`
      select state, wanted, phone, owner, lease_epoch from platform_wa_sessions
      where name = ${name} ${lock === 'update' ? tx`for update` : tx`for share`}`
  )[0];
  if (!row || row.owner !== fence.owner || Number(row.lease_epoch) !== fence.epoch)
    throw lost(name);
  return row;
}

const ERROR_DETAIL: Record<string, string> = {
  replaced: 'outra sessão assumiu o número',
  bad_session: 'sessão corrompida',
  connection_lost: 'conexão perdida',
};

/** What the team hears for a transition: up on open, down when the number stops working. */
export function channelStep(
  prev: { state: string; phone: string | null },
  u: StateUpdate,
): { state: 'up' | 'down'; detail: string } | null {
  if (u.state === 'open') {
    if (prev.state === 'open') return null;
    const phone = u.phone ?? prev.phone;
    return { state: 'up', detail: phone ? `conectado como +${phone}` : 'conectado' };
  }
  if (u.state === prev.state) return null;
  if (u.state === 'logged_out')
    return {
      state: 'down',
      detail: 'o whatsapp desvinculou o aparelho (logout) — pareie o número de novo em Config',
    };
  if (u.state === 'banned')
    return {
      state: 'down',
      detail: 'o whatsapp recusou a conta (403) — o número pode estar restrito',
    };
  if (u.state === 'error')
    return {
      state: 'down',
      detail: `a conexão caiu e não voltou (${ERROR_DETAIL[u.detail ?? ''] ?? 'erro'})`,
    };
  return null;
}

/** Persist what a platform session's socket is doing; LeaseLost when this gateway lost it. */
export async function reportPlatformState(
  sql: Sql,
  name: string,
  fence: Fence,
  u: StateUpdate,
): Promise<void> {
  const step = await controlTx(sql, async (tx) => {
    const prev = await heldPlatformTx(tx, name, fence);
    // a stop the team asked for wins over a late "open" from a socket still closing
    if (!prev.wanted && !['off', 'logged_out', 'banned'].includes(u.state)) return null;
    const set: Record<string, unknown> = { state: u.state, updated_at: new Date() };
    if (u.detail !== undefined) set.detail = u.detail;
    else if (u.state === 'open') set.detail = null;
    if (u.phone !== undefined) set.phone = u.phone && /^\d{10,15}$/.test(u.phone) ? u.phone : null;
    if (u.name !== undefined) set.account_name = u.name?.slice(0, 100) ?? null;
    if (u.pairCode !== undefined) set.pair_code = u.pairCode;
    if (u.pairCodeExpiresAt !== undefined) set.pair_code_expires_at = u.pairCodeExpiresAt;
    if (u.pairCode === null) set.pair_code_expires_at = null;
    if (u.state !== prev.state) set.state_changed_at = new Date();
    if (u.state === 'open' && prev.state !== 'open') set.connected_at = new Date();
    if (u.state === 'logged_out' || u.state === 'off') {
      set.connected_at = null;
      if (u.phone === undefined) set.phone = null;
      if (u.name === undefined) set.account_name = null;
    }
    await tx`update platform_wa_sessions set ${tx(set as never)} where name = ${name}`;
    return channelStep(prev, u);
  });
  // its own transaction, serialized per channel and deduped against the last up/down
  if (step) await recordChannelState(sql, 'whatsapp', step.state, step.detail);
}

export async function wipePlatformFenced(sql: Sql, name: string, fence: Fence): Promise<void> {
  await controlTx(sql, async (tx) => {
    await heldPlatformTx(tx, name, fence);
    await wipePlatformAuth(tx, name);
  });
}

/** Take a pending pairing request (once): the phone, or null when there is none. */
export async function takePlatformPairRequest(
  sql: Sql,
  name: string,
  fence: Fence,
  seenAt: Date,
): Promise<string | null> {
  return controlTx(sql, async (tx) => {
    await heldPlatformTx(tx, name, fence);
    const r = (
      await tx<{ pair_phone: string | null; fresh: boolean }[]>`
        update platform_wa_sessions set pair_requested_at = null
        where name = ${name} and date_trunc('milliseconds', pair_requested_at) = ${seenAt}
        returning pair_phone, ${seenAt}::timestamptz > now() - interval '2 minutes' as fresh`
    )[0];
    if (!r) return null;
    if (!r.fresh || !r.pair_phone) {
      await tx`update platform_wa_sessions set state = 'off', detail = 'pair_expired',
                 state_changed_at = now(), updated_at = now()
               where name = ${name}`;
      return null;
    }
    return r.pair_phone;
  });
}

export async function finishPlatformWipe(
  sql: Sql,
  name: string,
  fence: Fence,
  seenAt: Date,
): Promise<void> {
  await controlTx(sql, async (tx) => {
    await heldPlatformTx(tx, name, fence);
    await tx`update platform_wa_sessions set wipe_requested_at = null
             where name = ${name} and date_trunc('milliseconds', wipe_requested_at) = ${seenAt}`;
  });
}

export interface InboxEntry {
  kind: 'message' | 'history';
  from_jid: string;
  alt_jid: string | null;
  phone: string | null;
  push_name: string | null;
  body: string;
  provider_id: string;
  from_me: boolean;
  sent_at: Date | null;
}

export interface InboxMedia {
  mime: string;
  bytes: Uint8Array;
  seconds: number | null;
}

const clean = (e: InboxEntry) => ({
  ...e,
  phone: e.phone && /^\d{10,15}$/.test(e.phone) ? e.phone : null,
  push_name: e.push_name?.trim().slice(0, MAX_PUSH_NAME) || null,
  body: e.body.slice(0, MAX_INBOX_BODY),
  from_jid: e.from_jid.slice(0, 120),
  alt_jid: e.alt_jid?.slice(0, 120) ?? null,
  provider_id: e.provider_id.slice(0, 128),
});

export async function inboxHas(
  sql: Sql,
  name: string,
  kind: InboxEntry['kind'],
  providerId: string,
): Promise<boolean> {
  const rows = await controlTx(
    sql,
    (tx) => tx`select 1 from platform_wa_inbox
      where session = ${name} and kind = ${kind} and provider_id = ${providerId}`,
  );
  return rows.length > 0;
}

/** One live message (and its voice note); false when it was already there. */
export async function writeInboxMessage(
  sql: Sql,
  name: string,
  fence: Fence,
  entry: InboxEntry,
  media: InboxMedia | null,
): Promise<boolean> {
  const e = clean(entry);
  return controlTx(sql, async (tx) => {
    await heldPlatformTx(tx, name, fence, 'share');
    const mediaId = media
      ? (
          await tx<{ id: string }[]>`
            insert into platform_wa_media (session, mime, bytes, seconds)
            values (${name}, ${media.mime}, ${Buffer.from(media.bytes.buffer, media.bytes.byteOffset, media.bytes.byteLength)},
                    ${media.seconds == null ? null : Math.max(0, Math.min(600, Math.round(media.seconds)))})
            returning id`
        )[0]!.id
      : null;
    const inserted = await tx`
      insert into platform_wa_inbox (session, kind, from_jid, alt_jid, phone, push_name, body,
                                     media_id, provider_id, from_me, sent_at)
      values (${name}, ${e.kind}, ${e.from_jid}, ${e.alt_jid}, ${e.phone}, ${e.push_name}, ${e.body},
              ${mediaId}, ${e.provider_id}, ${e.from_me}, ${e.sent_at ?? new Date()})
      on conflict (session, kind, provider_id) where provider_id is not null do nothing
      returning id`;
    if (!inserted.length && mediaId) await tx`delete from platform_wa_media where id = ${mediaId}`;
    return inserted.length > 0;
  });
}

/** History messages, in batches; duplicates (a resent chunk) are skipped. */
export async function writeInboxHistory(
  sql: Sql,
  name: string,
  fence: Fence,
  entries: InboxEntry[],
): Promise<number> {
  let n = 0;
  for (let i = 0; i < entries.length; i += INBOX_BATCH) {
    const rows = entries.slice(i, i + INBOX_BATCH).map((x) => ({ session: name, ...clean(x) }));
    n += await controlTx(sql, async (tx) => {
      await heldPlatformTx(tx, name, fence, 'share');
      const r = await tx`
        insert into platform_wa_inbox ${tx(
          rows as never,
          'session',
          'kind',
          'from_jid',
          'alt_jid',
          'phone',
          'push_name',
          'body',
          'provider_id',
          'from_me',
          'sent_at',
        )}
        on conflict (session, kind, provider_id) where provider_id is not null do nothing
        returning id`;
      return r.length;
    });
  }
  return n;
}

/** LID↔PN pairs, as Core's adoptLidMappings takes them ([{lid, pn}] user jids). */
export async function writeLidMappings(
  sql: Sql,
  name: string,
  fence: Fence,
  pairs: { lid: string; pn: string }[],
): Promise<void> {
  if (!pairs.length) return;
  await controlTx(sql, async (tx) => {
    await heldPlatformTx(tx, name, fence, 'share');
    for (let i = 0; i < pairs.length; i += PAIRS_PER_ROW)
      await tx`
        insert into platform_wa_inbox (session, kind, pairs)
        values (${name}, 'lid_mapping', ${tx.json(pairs.slice(i, i + PAIRS_PER_ROW) as never)})`;
  });
}

/** Text of a message this number sent, for WhatsApp's resend-on-decrypt-failure. */
export async function platformMessageText(
  sql: Sql,
  name: string,
  waId: string,
): Promise<string | null> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ body: string }[]>`
      select body from platform_wa_outbox where session = ${name} and wa_id = ${waId} limit 1`,
  );
  return rows[0]?.body ?? null;
}

export async function platformHousekeeping(
  sql: Sql,
): Promise<{ expired: number; deleted: number }> {
  return controlTx(sql, async (tx) => {
    const expired = await tx`
      update platform_wa_outbox set status = 'expired', lease_until = null
      where status = 'pending' and expires_at < now()`;
    const media =
      await tx`delete from platform_wa_media where created_at < now() - interval '1 day'`;
    const inbox = await tx`
      delete from platform_wa_inbox
      where status in ('done', 'failed') and created_at < now() - interval '30 days'`;
    const outbox =
      await tx`delete from platform_wa_outbox where created_at < now() - interval '30 days'`;
    const probes =
      await tx`delete from platform_wa_probes where created_at < now() - interval '1 day'`;
    return {
      expired: expired.count,
      deleted: media.count + inbox.count + outbox.count + probes.count,
    };
  });
}
