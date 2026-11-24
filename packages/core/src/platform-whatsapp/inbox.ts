import { ingestInbound } from '../crm/inbound.ts';
import { phoneIsIgnored } from '../modules/integrations.ts';
import { controlTx } from '../modules/control.ts';
import { blockedPhonesTx } from '../modules/staff.ts';
import { adoptLidMappings } from '../modules/threads.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { AlreadyConsumed, membershipsOf, routeToDua, type DuaDeps, type InboxRow } from './dua.ts';
import { setProbeSql } from './probe.ts';
import { refreshPlatformSession } from './session.ts';
import { VENDUA_SESSION } from './transport.ts';
import type { InboundMedia } from '../crm/channels/whatsapp.ts';
import { MAX_AUDIO_SECONDS, MAX_IMAGE_BYTES, MAX_MEDIA_BYTES } from '../store-whatsapp/content.ts';
import { AUDIO_NOT_FETCHED } from './dua-text.ts';
import { inspectWhatsAppIntake, intakeHelpText, type WhatsAppIntake } from './intake.ts';
import { enqueuePlatformWaTx } from './outbox.ts';
import { phoneForJid, phoneVariants, userJid } from '../store-whatsapp/text.ts';

// Venduá's shared number receives account replies, merchant conversations and sales inquiries.
// Run intake before handing a live message to Duá or the CRM.

const inboxLog = log.child({ mod: 'platform-wa-inbox' });

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;
const TICK_MS = 5_000;
const HELP_WINDOW_MS = 30 * 60_000;
const waBody = (text: string) => (text.length > 8000 ? text.slice(0, 8000) : text);

export interface InboxDeps extends DuaDeps {
  /** the jobs pool: the CRM ingest drains agent runs on it */
  jobsSql: Sql;
}

/**
 * The oldest due row, except a message whose sender has an older one still pending (in flight on
 * another Core, deferred or retrying): one sender's messages run in order, so a slow voice note
 * can't land after the text sent behind it. Different senders still run side by side.
 */
export async function claimInboxRow(sql: Sql, session?: string): Promise<InboxRow | null> {
  const [row] = await controlTx(
    sql,
    (tx) => tx<InboxRow[]>`
      update platform_wa_inbox set attempts = attempts + 1,
        next_attempt_at = now() + ${LEASE_MS} * interval '1 millisecond'
      where id = (
        select i.id from platform_wa_inbox i
        where i.status = 'pending' and i.next_attempt_at <= now()
          and (${session ?? null}::text is null or i.session = ${session ?? null})
          and not (i.kind = 'message' and exists (
            select 1 from platform_wa_inbox o
            where o.status = 'pending' and o.kind = 'message' and o.session = i.session
              and coalesce(o.phone, o.from_jid) = coalesce(i.phone, i.from_jid)
              and (o.created_at, o.id) < (i.created_at, i.id)))
        order by i.created_at, i.id limit 1
        for update skip locked)
      returning id, session, kind, from_jid, alt_jid, phone, push_name, body, media_id,
                provider_id, from_me,
                case when kind = 'message' then coalesce(sent_at, created_at) else sent_at end as sent_at,
                pairs, attempts`,
  );
  return row ?? null;
}

async function finish(sql: Sql, id: string) {
  await controlTx(
    sql,
    (tx) => tx`
      update platform_wa_inbox set status = 'done', consumed_at = now(), error = null
      where id = ${id} and status = 'pending'`,
  );
}

async function toCrm(d: InboxDeps, row: InboxRow) {
  if (row.kind === 'lid_mapping') {
    const ids = await adoptLidMappings(d.jobsSql, row.pairs ?? []);
    if (ids.length) inboxLog.info({ count: ids.length }, 'lid leads re-keyed to phone');
    return;
  }
  if (!row.from_jid || row.body == null) return;
  const common = {
    channel: 'whatsapp' as const,
    from: row.from_jid,
    ...(row.push_name ? { fromName: row.push_name } : {}),
    ...(row.alt_jid ? { fromAlias: row.alt_jid } : {}),
    body: waBody(row.body),
    providerMessageId: row.provider_id,
  };
  if (row.kind === 'history')
    await ingestInbound(d.jobsSql, {
      ...common,
      direction: row.from_me ? 'out' : 'in',
      ...(row.sent_at ? { sentAt: row.sent_at } : {}),
      historical: true,
    });
  else await ingestInbound(d.jobsSql, common);
}

async function consumeIntake(
  d: InboxDeps,
  row: InboxRow,
  route: Exclude<WhatsAppIntake, 'conversation'>,
) {
  await controlTx(d.sql, async (tx) => {
    const consumed = await tx`
      update platform_wa_inbox
      set status = 'done', consumed_at = now(), error = null,
          body = case when ${route === 'code'} then null else body end
      where id = ${row.id} and status = 'pending' returning id`;
    if (!consumed.length) return;
    if (route === 'code' || route === 'receipt' || route === 'spam' || route === 'automated-reply')
      return;

    const from = userJid(row.from_jid);
    const alias = userJid(row.alt_jid);
    const to = from?.endsWith('@s.whatsapp.net') ? from : (alias ?? from);
    if (!to || to.length < 10) return;
    if (phoneIsIgnored(await blockedPhonesTx(tx), row.from_jid, row.alt_jid)) return;

    const phone = phoneForJid(to) ?? phoneForJid(row.alt_jid);
    const sender = phone ? phoneVariants(phone).sort()[0] : to;
    const window = Math.floor(Date.now() / HELP_WINDOW_MS);
    await enqueuePlatformWaTx(tx, {
      to,
      session: row.session,
      body: intakeHelpText(route, d.origin),
      purpose: 'notice',
      dedupeKey: `wa-intake:${row.session}:${sender}:${route}:${window}`,
      ttlMs: HELP_WINDOW_MS,
    });
  });
}

/** One message, end to end. Errors leave it pending for a later attempt, then failed. */
export async function consumeRow(d: InboxDeps, row: InboxRow): Promise<void> {
  try {
    if (row.kind === 'message' && row.from_me) {
      await finish(d.sql, row.id);
      return;
    }
    if (row.kind === 'message') {
      const intake = await inspectWhatsAppIntake(d.sql, {
        body: row.body ?? '',
        from: row.from_jid ?? '',
        fromAlias: row.alt_jid,
        receivedAt: row.sent_at ?? new Date(),
      });
      if (intake !== 'conversation' && intake !== 'customer-help') {
        await consumeIntake(d, row, intake);
        return;
      }
      const out = await routeToDua(d, row);
      if (out.route === 'done') return;
      if (out.route === 'defer') {
        await controlTx(
          d.sql,
          (tx) => tx`
            update platform_wa_inbox set next_attempt_at = ${out.until}, attempts = attempts - 1
            where id = ${row.id} and status = 'pending'`,
        );
        return;
      }
      if (intake === 'customer-help') {
        await consumeIntake(d, row, intake);
        return;
      }
    }
    await toCrm(d, row);
    await finish(d.sql, row.id);
  } catch (err) {
    if (err instanceof AlreadyConsumed) return;
    const failed = row.attempts >= MAX_ATTEMPTS;
    inboxLog.error({ err, id: row.id, attempts: row.attempts }, 'platform inbox message failed');
    await controlTx(
      d.sql,
      (tx) => tx`
        update platform_wa_inbox
        set status = ${failed ? 'failed' : 'pending'},
            error = ${String((err as Error)?.message ?? err).slice(0, 200)},
            next_attempt_at = now() + ${30_000 * 2 ** Math.min(row.attempts, 6)} * interval '1 millisecond'
        where id = ${row.id} and status = 'pending'`,
    ).catch(() => undefined);
  }
}

export async function consumeInboxOnce(d: InboxDeps, limit = 50): Promise<number> {
  let n = 0;
  for (; n < limit; n++) {
    const row = await claimInboxRow(d.sql);
    if (!row) break;
    await consumeRow(d, row);
  }
  return n;
}

/**
 * The consumer loop: LISTEN for new rows, a tick for anything a notification missed, and the
 * platform session's cached state refreshed on the same tick (waStatus reads it).
 */
export function startPlatformInbox(d: InboxDeps, o: { tickMs?: number } = {}) {
  setProbeSql(d.sql);
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  const run = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await consumeInboxOnce(d).catch((err) => inboxLog.error({ err }, 'inbox pass failed'));
      } while (again && !stopped);
    })().finally(() => void (running = null));
  };
  const sub = d.sql.listen('vendua_platform_wa_in', run).catch((err) => {
    inboxLog.warn({ err }, 'inbox listen failed; polling');
    return null;
  });
  const timer = setInterval(() => {
    void refreshPlatformSession(d.sql);
    run();
  }, o.tickMs ?? TICK_MS);
  void refreshPlatformSession(d.sql);
  run();
  return {
    async stop() {
      stopped = true;
      setProbeSql(null);
      clearInterval(timer);
      await (await sub)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}

/**
 * Core's socket hands account replies and merchant messages to the shared inbox.
 * False means the caller should deliver the conversation to CRM.
 */
export async function socketMessageToInbox(
  sql: Sql,
  m: {
    jid: string;
    text: string;
    providerId: string | null;
    pushName?: string;
    altJid?: string;
    media?: InboundMedia;
    sentAt?: Date;
  },
): Promise<boolean> {
  const national = phoneForJid(m.jid) ?? phoneForJid(m.altJid);
  const phone = national ? `55${national}` : null;
  const sentAt = m.sentAt ?? new Date();
  const intake = await inspectWhatsAppIntake(sql, {
    body: m.text,
    from: m.jid,
    ...(m.altJid ? { fromAlias: m.altJid } : {}),
    receivedAt: sentAt,
  });
  const forDua = intake === 'conversation' || intake === 'customer-help';
  const merchant = forDua && phone && (await membershipsOf(sql, phone)).length > 0;
  if (!merchant && intake === 'conversation') return false;
  // Duá hears voice notes and reads photos (the gateway's caps): fetched only for the store's
  // people, never for a lead's media
  let file: { mime: string; bytes: Uint8Array; seconds: number | null } | null = null;
  let body = m.text;
  const f = m.media;
  const cap = f?.type === 'image' ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
  const fits =
    !!f && (f.type === 'image' || (f.seconds ?? 0) <= MAX_AUDIO_SECONDS) && (f.size ?? 0) <= cap;
  if (merchant && f && fits && !(await inboxHasProvider(sql, m.providerId))) {
    // past the minute's room a note within the caps asks to be sent again, never "too long"
    if (!mediaAllowed(phone)) {
      if (f.type === 'audio') body = AUDIO_NOT_FETCHED;
    } else
      try {
        const bytes = await f.download(cap);
        if (bytes.byteLength > 0 && bytes.byteLength <= cap)
          file = { mime: f.mime, bytes, seconds: f.seconds };
        else if (f.type === 'audio') body = AUDIO_NOT_FETCHED;
      } catch (err) {
        inboxLog.warn({ err, type: f.type }, 'media not downloaded');
        if (f.type === 'audio') body = AUDIO_NOT_FETCHED;
      }
  }
  await controlTx(sql, async (tx) => {
    const mediaId = file
      ? (
          await tx<{ id: string }[]>`
            insert into platform_wa_media (session, mime, bytes, seconds)
            values (${VENDUA_SESSION}, ${file.mime}, ${Buffer.from(file.bytes)},
                    ${file.seconds == null ? null : Math.max(0, Math.min(600, Math.round(file.seconds)))})
            returning id`
        )[0]!.id
      : null;
    const inserted = await tx`
      insert into platform_wa_inbox (session, kind, from_jid, alt_jid, phone, push_name, body,
                                     media_id, provider_id, sent_at)
      values (${VENDUA_SESSION}, 'message', ${m.jid.slice(0, 120)}, ${m.altJid?.slice(0, 120) ?? null},
              ${phone}, ${m.pushName?.slice(0, 100) ?? null}, ${waBody(body)}, ${mediaId},
              ${m.providerId?.slice(0, 128) ?? null}, ${sentAt})
      on conflict (session, kind, provider_id) where provider_id is not null do nothing
      returning id`;
    if (!inserted.length && mediaId) await tx`delete from platform_wa_media where id = ${mediaId}`;
  });
  return true;
}

/** voice notes and photos fetched per sender a minute, as the gateway allows (this process) */
const MEDIA_PER_MINUTE = 6;
const SENDERS_MAX = 20_000;
const mediaTimes = new Map<string, number[]>();
function mediaAllowed(phone: string): boolean {
  const now = Date.now();
  if (mediaTimes.size >= SENDERS_MAX) mediaTimes.clear();
  const recent = (mediaTimes.get(phone) ?? []).filter((t) => t > now - 60_000);
  if (recent.length >= MEDIA_PER_MINUTE) return false;
  recent.push(now);
  mediaTimes.set(phone, recent);
  return true;
}

/** a replay of a message already in the inbox isn't downloaded again */
async function inboxHasProvider(sql: Sql, providerId: string | null): Promise<boolean> {
  if (!providerId) return false;
  const rows = await controlTx(
    sql,
    (tx) => tx`select 1 from platform_wa_inbox
      where session = ${VENDUA_SESSION} and kind = 'message' and provider_id = ${providerId.slice(0, 128)}`,
  );
  return rows.length > 0;
}
