import { ingestInbound } from '../agent/inbound.ts';
import { controlTx } from '../modules/control.ts';
import { adoptLidMappings } from '../modules/threads.ts';
import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { AlreadyConsumed, membershipsOf, routeToDua, type DuaDeps, type InboxRow } from './dua.ts';
import { refreshPlatformSession } from './session.ts';
import { VENDUA_SESSION } from './transport.ts';

// Core's side of platform_wa_inbox: what reaches Venduá's number, from the gateway (or, before the
// cutover, merchant messages from Core's own socket). One number serves everyone, so each message
// is routed by its sender: merchant phones to Duá, everyone else (and all history) to the CRM's
// ingestInbound, unchanged — still the only path into requestAgentTx for the CRM agent.

const inboxLog = log.child({ mod: 'platform-wa-inbox' });

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;
const TICK_MS = 5_000;
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
                provider_id, from_me, sent_at, pairs, attempts`,
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

/** One message, end to end. Errors leave it pending for a later attempt, then failed. */
export async function consumeRow(d: InboxDeps, row: InboxRow): Promise<void> {
  try {
    if (row.kind === 'message' && !row.from_me) {
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
      clearInterval(timer);
      await (await sub)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}

/**
 * Before the cutover, Core's own socket hands over merchant messages here instead of dropping
 * them (agent/inbound.ts still drops any that reach it). False: not a merchant, the CRM's.
 */
export async function socketMessageToInbox(
  sql: Sql,
  m: { jid: string; text: string; providerId: string | null; pushName?: string; altJid?: string },
): Promise<boolean> {
  const phone = m.jid.endsWith('@s.whatsapp.net') ? m.jid.split('@')[0]!.split(':')[0]! : null;
  if (!phone || !/^\d{10,15}$/.test(phone)) return false;
  if (!(await membershipsOf(sql, phone)).length) return false;
  await controlTx(
    sql,
    (tx) => tx`
      insert into platform_wa_inbox (session, kind, from_jid, alt_jid, phone, push_name, body,
                                     provider_id, sent_at)
      values (${VENDUA_SESSION}, 'message', ${m.jid.slice(0, 120)}, ${m.altJid?.slice(0, 120) ?? null},
              ${phone}, ${m.pushName?.slice(0, 100) ?? null}, ${waBody(m.text)},
              ${m.providerId?.slice(0, 128) ?? null}, now())
      on conflict (session, kind, provider_id) where provider_id is not null do nothing`,
  );
  return true;
}
