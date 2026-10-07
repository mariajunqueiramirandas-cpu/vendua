import { AUDIO_NOT_FETCHED } from '../platform-whatsapp/dua-text.ts';
import { hostname } from 'node:os';
import type { Logger } from 'pino';
import {
  extractText as waText,
  lidPnPair,
  resolveDmJid,
  type LidMapping,
} from '../agent/channels/whatsapp.ts';
import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { log as rootLog } from '../platform/log.ts';
import { LeaseLost, platformAuthStore, type Fence } from './auth-store.ts';
import { MAX_AUDIO_SECONDS, MAX_MEDIA_BYTES } from './content.ts';
import type { HistorySet } from './history.ts';
import {
  finishPlatformWipe,
  inboxHas,
  platformHousekeeping,
  platformMessageText,
  reportPlatformState,
  takePlatformPairRequest,
  wipePlatformFenced,
  writeInboxHistory,
  writeInboxMessage,
  writeLidMappings,
  type InboxEntry,
  type InboxMedia,
} from './platform-state.ts';
import {
  NotOnWhatsApp,
  SessionClosed,
  StoreSession,
  type WaInbound,
  type WaRuntime,
} from './session.ts';
import { messageIdFor, retryDelayMs } from './text.ts';

// Venduá's own numbers (platform_wa_sessions: 'vendua', a second one later) on the wa-gateway,
// next to the stores' sessions and on the same baileys stack (docs/features/dua-no-whatsapp.md
// §4). Same lease/fence model as Gateway; what differs: history at pairing, everything inbound
// lands in platform_wa_inbox for Core's consumer, and one outbox ordered otp > dua > notice > crm.

export const PLATFORM_WA_CHANNEL = 'vendua_platform_wa';

export interface PlatformGatewayOptions {
  sql: Sql;
  runtime: WaRuntime;
  sealSecret: string;
  /** the store Gateway's id: one process, one owner name */
  id?: string;
  leaseMs?: number;
  tickMs?: number;
  /** between two sends of one number, plus up to as much again in jitter; otp skips both */
  minSendGapMs?: number;
  maxAttempts?: number;
  /** false in tests: they call tick() themselves */
  listen?: boolean;
  /** only ever claim these sessions (tests); default: any */
  sessions?: string[] | null;
  reconnectDelay?: (failures: number) => number;
  log?: Logger;
}

interface LeaseRow {
  name: string;
  lease_epoch: string | number;
  wanted: boolean;
  state: string;
  history: boolean;
  pair_requested_at: Date | null;
  wipe_requested_at: Date | null;
}

interface Owned {
  fence: Fence;
  session: StoreSession;
  history: boolean;
  next: LeaseRow | null;
  reconciling: boolean;
  pumping: boolean;
  pumpAgain: boolean;
  wake: (() => void) | null;
  nextSendAt: number;
  probing: boolean;
  probeAgain: boolean;
  /** LID↔PN pairs already written, so a chatty lid-mapping.update stays one row */
  lids: Set<string>;
}

interface Claimed {
  id: string;
  purpose: string;
  to_jid: string;
  body: string;
  attempts: number;
  wa_id: string;
  expired: boolean;
}

type HistoryContact = {
  id?: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
};
type PlatformHistorySet = HistorySet & {
  contacts?: HistoryContact[];
  lidPnMappings?: { lid?: string; pn?: string }[];
};

const HOUSEKEEPING_MS = 10 * 60_000;
const SEND_LEASE = '2 minutes';
const PROBE_MAX_AGE = '30 seconds';
const LIDS_MAX = 20_000;
const PURPOSES = ['otp', 'dua', 'notice', 'crm'];

const NEEDS_SOCKET = `(
  (wanted and (state in ('connecting', 'pairing', 'open', 'error') or pair_requested_at is not null))
  or wipe_requested_at is not null
)`;

/** International digits for a pair code: any country, 10–15 digits. */
export const platformPairPhone = (phone: string) => (/^\d{10,15}$/.test(phone) ? phone : null);

/** An outbox `to_jid` as StoreSession addresses it: a jid as is; Brazilian digits as the national
 *  number (both 9th-digit forms are tried); anyone else '+' and the digits (one form). */
export function platformAddress(to: string): { jid?: string; phone?: string } {
  if (to.includes('@')) return { jid: to };
  const d = to.replace(/\D/g, '');
  if (/^55\d{10,11}$/.test(d)) return { phone: d.slice(2) };
  return { phone: `+${d}` };
}

const digitsOf = (jid: string | null | undefined) => {
  if (!jid?.endsWith('@s.whatsapp.net')) return null;
  const d = jid.split('@')[0]!.split(':')[0]!;
  return /^\d{10,15}$/.test(d) ? d : null;
};

function messageTs(ts: unknown): Date | null {
  const n =
    typeof ts === 'number'
      ? ts
      : typeof ts === 'string'
        ? Number(ts)
        : ts && typeof ts === 'object'
          ? Number(String(ts))
          : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n > 1e12 ? n : n * 1000);
}

export class PlatformGateway {
  readonly id: string;
  private owned = new Map<string, Owned>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<void> | null = null;
  private tickAgain = false;
  private stopping = false;
  private unlisten: (() => Promise<void>) | null = null;
  private lastHousekeeping = 0;
  private renewedAt = Date.now();
  private log: Logger;
  private o: Required<
    Omit<PlatformGatewayOptions, 'id' | 'log' | 'sessions' | 'reconnectDelay'>
  > & {
    sessions: string[] | null;
    reconnectDelay: ((failures: number) => number) | undefined;
  };

  constructor(opts: PlatformGatewayOptions) {
    this.id = opts.id ?? `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.log = (opts.log ?? rootLog).child({ mod: 'wa-platform', gw: this.id });
    this.o = {
      sql: opts.sql,
      runtime: opts.runtime,
      sealSecret: opts.sealSecret,
      leaseMs: opts.leaseMs ?? 45_000,
      tickMs: opts.tickMs ?? 5_000,
      minSendGapMs: opts.minSendGapMs ?? 1_500,
      maxAttempts: opts.maxAttempts ?? 5,
      listen: opts.listen ?? true,
      sessions: opts.sessions ?? null,
      reconnectDelay: opts.reconnectDelay,
    };
  }

  health() {
    let open = 0;
    for (const o of this.owned.values()) if (o.session.state === 'open') open++;
    return { sessions: this.owned.size, open };
  }

  sessionOf(name: string): StoreSession | null {
    return this.owned.get(name)?.session ?? null;
  }

  async start(): Promise<void> {
    if (this.o.listen) {
      const sub = await this.o.sql.listen(PLATFORM_WA_CHANNEL, (p) => this.onNotify(p));
      this.unlisten = () => sub.unlisten();
    }
    await this.tick();
    this.schedule();
  }

  private schedule() {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.tick()
        .catch((e) => this.log.error({ err: e }, 'tick failed'))
        .finally(() => this.schedule());
    }, this.o.tickMs);
    this.timer.unref?.();
  }

  private onNotify(payload: string) {
    const [name, kind] = payload.split('|');
    if (!name) return;
    if (kind === 'send') return this.pump(name);
    if (kind === 'probe') return this.probe(name);
    void this.tick().catch((e) => this.log.error({ err: e }, 'tick failed'));
  }

  tick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      do {
        this.tickAgain = false;
        await this.tickOnce();
      } while (this.tickAgain && !this.stopping);
    })().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async tickOnce(): Promise<void> {
    if (this.stopping) return;
    let rows: LeaseRow[];
    try {
      rows = await this.renewAndClaim();
      this.renewedAt = Date.now();
    } catch (e) {
      // as Gateway: let go before the leases lapse, or two sockets on one login fight
      if (Date.now() - this.renewedAt > this.o.leaseMs - Math.min(15_000, this.o.leaseMs / 3)) {
        this.log.error({ err: e, sessions: this.owned.size }, 'leases unrenewable — dropping');
        for (const [name, o] of this.owned) this.drop(name, o);
      }
      throw e;
    }
    for (const row of rows) this.reconcile(row);
    for (const name of this.owned.keys()) {
      this.pump(name);
      this.probe(name);
    }
    if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_MS) {
      this.lastHousekeeping = Date.now();
      const r = await platformHousekeeping(this.o.sql).catch((e) => {
        this.log.warn({ err: e }, 'housekeeping failed');
        return null;
      });
      if (r && (r.expired || r.deleted)) this.log.info(r, 'platform queue housekeeping');
    }
  }

  private async renewAndClaim(): Promise<LeaseRow[]> {
    const lease = `${Math.ceil(this.o.leaseMs / 1000)} seconds`;
    const only = this.o.sessions;
    const { renewed, claimed } = await controlTx(this.o.sql, async (tx) => {
      const mine = [...this.owned.keys()];
      await tx`
        update platform_wa_sessions set owner = null, lease_until = null
        where owner = ${this.id} and not (name = any(${mine}::text[]))`;
      const renewed = await tx<LeaseRow[]>`
        update platform_wa_sessions set lease_until = now() + ${lease}::interval
        where owner = ${this.id} and lease_until > now() and name = any(${mine}::text[])
        returning name, lease_epoch, wanted, state, history, pair_requested_at, wipe_requested_at`;
      const claimed = await tx<LeaseRow[]>`
        update platform_wa_sessions set owner = ${this.id}, lease_epoch = lease_epoch + 1,
          lease_until = now() + ${lease}::interval
        where name in (
          select name from platform_wa_sessions
          where ${tx.unsafe(NEEDS_SOCKET)}
            and (owner is null or lease_until is null or lease_until < now())
            and (${only}::text[] is null or name = any(${only}::text[]))
          order by lease_until nulls first
          for update skip locked
        )
        returning name, lease_epoch, wanted, state, history, pair_requested_at, wipe_requested_at`;
      return { renewed, claimed };
    });
    const kept = new Set([...renewed, ...claimed].map((r) => r.name));
    for (const [name, o] of this.owned)
      if (!kept.has(name)) {
        this.log.warn({ session: name }, 'lease lost — dropping session');
        this.drop(name, o);
      }
    for (const r of claimed) {
      const prev = this.owned.get(r.name);
      if (prev) this.drop(r.name, prev);
      this.adopt(r);
    }
    return [...renewed, ...claimed];
  }

  private adopt(r: LeaseRow) {
    const name = r.name;
    const fence = { owner: this.id, epoch: Number(r.lease_epoch) };
    const log = this.log.child({ session: name });
    const { sql, runtime, sealSecret } = this.o;
    const owned: Owned = {
      fence,
      history: r.history,
      next: null,
      reconciling: false,
      pumping: false,
      pumpAgain: false,
      wake: null,
      nextSendAt: 0,
      probing: false,
      probeAgain: false,
      lids: new Set(),
      session: null as unknown as StoreSession,
    };
    const lost = () => {
      if (this.owned.get(name) === owned) this.drop(name, owned);
    };
    const failed = (what: string) => (e: unknown) => {
      if (e instanceof LeaseLost) lost();
      else log.warn({ err: e }, what);
    };
    let stateTail = Promise.resolve();
    let inboundTail = Promise.resolve();
    let historyTail = Promise.resolve();
    owned.session = new StoreSession(
      name,
      runtime,
      platformAuthStore(sql, name, fence, runtime.codec, sealSecret),
      {
        onState: (u) => {
          stateTail = stateTail
            .then(() => reportPlatformState(sql, name, fence, u))
            .then(() => {
              if (u.state !== 'open') return;
              this.pump(name);
              this.probe(name);
            })
            .catch(failed('state not saved'));
        },
        onMessage: (m) => {
          inboundTail = inboundTail
            .then(() => this.inbound(name, owned, m))
            .catch(failed('inbound not saved'));
        },
        onTyping: () => undefined,
        onReceipts: () => undefined,
        onLeaseLost: lost,
        messageText: (waId) => platformMessageText(sql, name, waId),
        wipe: () => wipePlatformFenced(sql, name, fence),
        onHistory: (h, ctx) => {
          historyTail = historyTail
            .then(() => this.history(name, owned, h as PlatformHistorySet, ctx))
            .catch(failed('history not saved'));
        },
        onLidMapping: ({ lid, pn }) => {
          const pair = lid && pn ? lidPnPair(lid, pn) : null;
          if (!pair) return;
          historyTail = historyTail
            .then(() => this.lidPairs(name, owned, [pair]))
            .catch(failed('lid mapping not saved'));
        },
      },
      log,
      this.o.reconnectDelay,
      { pairPhone: platformPairPhone, syncHistory: () => owned.history },
    );
    this.owned.set(name, owned);
  }

  private async inbound(name: string, o: Owned, m: WaInbound): Promise<void> {
    if (m.fromMe) return;
    const body = waText(m.message ?? null);
    if (!body) return;
    const dm = await resolveDmJid(m.jid, m.alt ?? undefined, m.pnForLid);
    if (!dm) return;
    let media: InboxMedia | null = null;
    let fetchFailed = false;
    const audio = m.content?.kind === 'audio' ? m.content.media : null;
    if (
      audio?.type === 'audio' &&
      (audio.seconds ?? 0) <= MAX_AUDIO_SECONDS &&
      (audio.size ?? 0) <= MAX_MEDIA_BYTES &&
      // an 'append' replay of a note already stored is not downloaded again
      !(await inboxHas(this.o.sql, name, 'message', m.id))
    ) {
      try {
        const got = await m.download();
        if (got.byteLength > 0 && got.byteLength <= MAX_MEDIA_BYTES)
          media = { mime: audio.mime, bytes: got, seconds: audio.seconds };
        else fetchFailed = true;
      } catch (e) {
        fetchFailed = true;
        this.log.warn({ err: e, session: name }, 'voice note not downloaded');
      }
    }
    await writeInboxMessage(
      this.o.sql,
      name,
      o.fence,
      {
        kind: 'message',
        from_jid: dm.jid,
        alt_jid: dm.alias ?? null,
        phone: digitsOf(dm.jid),
        push_name: m.pushName,
        // WhatsApp won't deliver it again: Core asks for it instead of reading it as too long
        body: fetchFailed ? AUDIO_NOT_FETCHED : body,
        provider_id: m.id,
        from_me: false,
        sent_at: messageTs(m.timestamp),
      },
      media,
    );
  }

  private async lidPairs(name: string, o: Owned, pairs: LidMapping[]): Promise<void> {
    const fresh = pairs.filter((p) => !o.lids.has(`${p.lid}|${p.pn}`));
    if (!fresh.length) return;
    await writeLidMappings(this.o.sql, name, o.fence, fresh);
    if (o.lids.size + fresh.length > LIDS_MAX) o.lids.clear();
    for (const p of fresh) o.lids.add(`${p.lid}|${p.pn}`);
  }

  /** A sync chunk, read as Core's socket read it (agent/channels/whatsapp.ts): LID pairs first,
   *  so Core re-keys LID leads before this chunk's messages arrive by number. */
  private async history(
    name: string,
    o: Owned,
    h: PlatformHistorySet,
    ctx: { pnForLid(lid: string): Promise<string | null>; ownPhone: string | null },
  ): Promise<void> {
    const names = new Map<string, string>();
    for (const c of h.contacts ?? []) {
      const n = c.name ?? c.notify ?? c.verifiedName;
      if (c.id && n) names.set(c.id, n);
    }
    const pairs = new Map<string, LidMapping>();
    const addPair = (a?: string, b?: string) => {
      const pair = a && b ? lidPnPair(a, b) : null;
      if (pair) pairs.set(pair.lid, pair);
    };
    for (const m of h.lidPnMappings ?? []) addPair(m.lid, m.pn);
    for (const c of h.contacts ?? []) {
      addPair(c.lid, c.phoneNumber);
      addPair(c.id, c.phoneNumber);
      addPair(c.id, c.lid);
      const n = c.name ?? c.notify ?? c.verifiedName;
      for (const j of [c.lid, c.phoneNumber]) if (j && n && !names.has(j)) names.set(j, n);
    }
    await this.lidPairs(name, o, [...pairs.values()]);
    if (!o.history) return;
    const chunkPn = new Map([...pairs.values()].map((p) => [p.lid, p.pn]));
    const lookup = async (lid: string) => chunkPn.get(lid) ?? ctx.pnForLid(lid);
    const entries: InboxEntry[] = [];
    for (const m of h.messages ?? []) {
      const key = m.key;
      if (!key?.id) continue;
      const dm = await resolveDmJid(
        key.remoteJid ?? undefined,
        key.remoteJidAlt ?? undefined,
        lookup,
      );
      if (!dm) continue;
      if (ctx.ownPhone && dm.jid.replace(/\D/g, '') === ctx.ownPhone) continue;
      const body = waText(this.o.runtime.normalize(m.message) ?? m.message);
      if (!body) continue;
      // pushName on our own message is the account's name: the contact's comes from the map
      const contactName = names.get(key.remoteJid ?? '') ?? names.get(dm.jid);
      entries.push({
        kind: 'history',
        from_jid: dm.jid,
        alt_jid: dm.alias ?? null,
        phone: digitsOf(dm.jid),
        push_name: (key.fromMe ? contactName : (m.pushName ?? contactName)) ?? null,
        body,
        provider_id: key.id,
        from_me: !!key.fromMe,
        sent_at: messageTs(m.messageTimestamp),
      });
    }
    const n = await writeInboxHistory(this.o.sql, name, o.fence, entries);
    this.log.info({ session: name, chunk: entries.length, written: n }, 'history chunk saved');
  }

  private drop(name: string, o: Owned) {
    this.owned.delete(name);
    o.wake?.();
    void o.session.stop().catch(() => undefined);
  }

  private reconcile(row: LeaseRow) {
    const o = this.owned.get(row.name);
    if (!o) return;
    o.next = row;
    o.history = row.history;
    if (o.reconciling) return;
    o.reconciling = true;
    const name = row.name;
    void (async () => {
      try {
        while (o.next && this.owned.get(name) === o && !this.stopping) {
          const r = o.next;
          o.next = null;
          await this.reconcileOnce(name, o, r);
        }
      } catch (e) {
        if (e instanceof LeaseLost) {
          if (this.owned.get(name) === o) this.drop(name, o);
        } else this.log.error({ err: e, session: name }, 'session work failed');
      } finally {
        o.reconciling = false;
      }
    })();
  }

  private async reconcileOnce(name: string, o: Owned, row: LeaseRow) {
    const { sql } = this.o;
    if (row.wipe_requested_at) {
      await o.session.logout();
      await finishPlatformWipe(sql, name, o.fence, row.wipe_requested_at);
    }
    if (!row.wanted) {
      await this.release(name, o);
      return;
    }
    if (row.pair_requested_at) {
      const phone = await takePlatformPairRequest(sql, name, o.fence, row.pair_requested_at);
      if (phone) {
        await o.session.pair(phone);
        return;
      }
    }
    if (o.session.running) return;
    if (['open', 'connecting', 'error'].includes(row.state)) {
      if (await o.session.start()) return;
      await reportPlatformState(sql, name, o.fence, {
        state: 'off',
        detail: 'not_paired',
        pairCode: null,
      });
    } else if (row.state === 'pairing') {
      await reportPlatformState(sql, name, o.fence, {
        state: 'off',
        detail: 'pair_expired',
        pairCode: null,
      });
    }
    await this.release(name, o);
  }

  private async release(name: string, o: Owned) {
    await o.session.stop();
    if (this.owned.get(name) === o) this.owned.delete(name);
    await controlTx(
      this.o.sql,
      (tx) => tx`
        update platform_wa_sessions set owner = null, lease_until = null,
          -- let go because nobody wants it (the integration was turned off): not 'open' any more
          state = case when wanted then state else 'off' end,
          detail = case when wanted then detail else 'released' end,
          state_changed_at = case when wanted or state = 'off' then state_changed_at else now() end
        where name = ${name} and owner = ${this.id} and lease_epoch = ${o.fence.epoch}`,
    );
  }

  /** Drain the session's due messages one at a time: by purpose, then age; paced, except otp. */
  pump(name: string): void {
    const o = this.owned.get(name);
    if (!o) return;
    if (o.pumping) {
      o.pumpAgain = true;
      o.wake?.();
      return;
    }
    o.pumping = true;
    void (async () => {
      try {
        do {
          o.pumpAgain = false;
          while (this.owned.get(name) === o && o.session.state === 'open' && !this.stopping) {
            const gapOpen = Date.now() >= o.nextSendAt;
            const res = await this.sendOne(name, o, gapOpen);
            if (res === 'closed') break;
            if (res !== 'none') continue;
            if (gapOpen) break;
            // only otp may go before the gap ends: wait for it, or for a new row to look at
            await new Promise<void>((r) => {
              o.wake = r;
              setTimeout(r, Math.max(1, o.nextSendAt - Date.now()));
            });
            o.wake = null;
          }
        } while (o.pumpAgain && this.owned.get(name) === o);
      } catch (e) {
        if (e instanceof LeaseLost) {
          if (this.owned.get(name) === o) this.drop(name, o);
        } else this.log.error({ err: e, session: name }, 'send loop failed');
      } finally {
        o.pumping = false;
      }
    })();
  }

  private async sendOne(
    name: string,
    o: Owned,
    gapOpen: boolean,
  ): Promise<'sent' | 'settled' | 'none' | 'closed'> {
    const { sql } = this.o;
    const row = await controlTx(sql, async (tx): Promise<Claimed | null> => {
      const held = await tx<{ wanted: boolean }[]>`
        select wanted from platform_wa_sessions
        where name = ${name} and owner = ${this.id} and lease_epoch = ${o.fence.epoch}
          and lease_until > now()`;
      if (!held.length) throw new LeaseLost(`platform:${name}`);
      if (!held[0]!.wanted) return null;
      const next = (
        await tx<{ id: string; wa_id: string | null }[]>`
          select id, wa_id from platform_wa_outbox
          where session = ${name}
            and ((status = 'pending' and next_attempt_at <= now())
              or (status = 'sending' and lease_until < now()))
            and (${gapOpen}::boolean or purpose = 'otp')
          order by array_position(${PURPOSES}::text[], purpose), created_at
          limit 1
          for update skip locked`
      )[0];
      if (!next) return null;
      const r = (
        await tx<Claimed[]>`
          update platform_wa_outbox set status = 'sending', attempts = attempts + 1,
            lease_until = now() + ${SEND_LEASE}::interval,
            wa_id = ${next.wa_id ?? messageIdFor(next.id)}
          where id = ${next.id}
          returning id, purpose, to_jid, body, attempts, wa_id, expires_at < now() as expired`
      )[0]!;
      if (r.expired)
        await tx`update platform_wa_outbox set status = 'expired', lease_until = null
                 where id = ${r.id}`;
      return r;
    });
    if (!row) return 'none';
    if (row.expired) return 'settled';
    const settle = (
      status: 'sent' | 'failed' | 'pending',
      error: string | null,
      extra: { retryMs?: number; refund?: boolean } = {},
    ) =>
      controlTx(sql, async (tx) => {
        if (status === 'sent')
          await tx`update platform_wa_outbox set status = 'sent', sent_at = now(), lease_until = null,
                   error = null where id = ${row.id} and status = 'sending'`;
        else if (status === 'failed')
          await tx`update platform_wa_outbox set status = 'failed', lease_until = null, error = ${error}
                   where id = ${row.id} and status = 'sending'`;
        else
          await tx`update platform_wa_outbox set status = 'pending', lease_until = null, error = ${error},
                   attempts = greatest(attempts - ${extra.refund ? 1 : 0}, 0),
                   next_attempt_at = now() + ${`${Math.round((extra.retryMs ?? 0) / 1000)} seconds`}::interval
                   where id = ${row.id} and status = 'sending'`;
      });
    try {
      await o.session.sendTo(platformAddress(row.to_jid), { text: row.body }, row.wa_id);
      const now = Date.now();
      const gap = this.o.minSendGapMs;
      o.nextSendAt =
        row.purpose === 'otp' ? Math.max(o.nextSendAt, now + gap) : now + gap * (1 + Math.random());
      await settle('sent', null);
      return 'sent';
    } catch (e) {
      if (e instanceof NotOnWhatsApp) {
        await settle('failed', 'not_on_whatsapp');
        return 'settled';
      }
      if (e instanceof SessionClosed) {
        await settle('pending', null, { refund: true });
        return 'closed';
      }
      const msg = (e as Error)?.message?.slice(0, 200) || 'send failed';
      this.log.warn({ err: e, session: name, attempts: row.attempts }, 'send failed');
      if (row.attempts >= this.o.maxAttempts) await settle('failed', msg);
      else await settle('pending', msg, { retryMs: retryDelayMs(row.attempts) });
      return 'settled';
    }
  }

  /** Core's "is this number on WhatsApp?" for the sessions held here and open. */
  probe(name: string): void {
    const o = this.owned.get(name);
    if (!o || o.session.state !== 'open') return;
    if (o.probing) {
      o.probeAgain = true;
      return;
    }
    o.probing = true;
    void (async () => {
      try {
        do {
          o.probeAgain = false;
          await this.probeOnce(name, o);
        } while (o.probeAgain && this.owned.get(name) === o);
      } catch (e) {
        this.log.warn({ err: e, session: name }, 'probes not answered');
      } finally {
        o.probing = false;
      }
    })();
  }

  private async probeOnce(name: string, o: Owned) {
    const { sql } = this.o;
    const asks = await controlTx(
      sql,
      (tx) => tx<{ id: string; phone: string }[]>`
        select id, phone from platform_wa_probes
        where session = ${name} and answered_at is null
          and created_at > now() - ${PROBE_MAX_AGE}::interval
        order by created_at
        limit 20`,
    );
    for (const a of asks) {
      if (this.owned.get(name) !== o) return;
      let result: boolean;
      try {
        result = !!(await o.session.resolveJid(platformAddress(a.phone).phone!));
      } catch (e) {
        if (e instanceof SessionClosed) return;
        // unanswered: Core's wait ends in null, as with the socket down
        this.log.warn({ err: e, session: name }, 'probe failed');
        continue;
      }
      await controlTx(
        sql,
        (tx) => tx`update platform_wa_probes set result = ${result}, answered_at = now()
                   where id = ${a.id} and answered_at is null`,
      );
    }
  }

  /** Close every socket (keeping its login) and hand the leases back. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.unlisten?.().catch(() => undefined);
    await this.ticking?.catch(() => undefined);
    const all = [...this.owned.values()];
    this.owned.clear();
    for (const o of all) o.wake?.();
    await Promise.all(all.map((o) => o.session.stop().catch(() => undefined)));
    await controlTx(
      this.o.sql,
      (tx) =>
        tx`update platform_wa_sessions set owner = null, lease_until = null where owner = ${this.id}`,
    ).catch((e) => this.log.warn({ err: e }, 'platform lease release failed'));
  }
}
