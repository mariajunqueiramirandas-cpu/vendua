import { hostname } from 'node:os';
import type { Logger } from 'pino';
import { emitAdminTx } from '../admin/live.ts';
import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { log as rootLog } from '../platform/log.ts';
import { authStore, LeaseLost, type Fence } from './auth-store.ts';
import {
  agentEnabled,
  recordTyping,
  storeChatMessage,
  threadAddress,
  threadForJid,
  voiceNote,
} from './chat.ts';
import { commandContent, phoneCommand } from './content.ts';
import {
  claimRequest,
  finishRequest,
  HISTORY_TIMEOUT_MS,
  pendingRequest,
  sweepRequests,
  type HistoryOutcome,
} from './history.ts';
import { contactedTx, OPT_OUT_FOOTER, optedOutTx } from './messages.ts';
import { NOTICE_KINDS, PROACTIVE_KINDS } from './proactive.ts';
import {
  HistoryTimeout,
  NotOnWhatsApp,
  SessionClosed,
  StoreSession,
  type OutContent,
  type WaInbound,
  type WaRuntime,
} from './session.ts';
import {
  finishWipe,
  handleInbound,
  housekeeping,
  messageText,
  mirrorStatusTx,
  recordReceipts,
  reportState,
  takePairRequest,
  wipeFenced,
} from './state.ts';
import { messageIdFor, phoneForJid, retryDelayMs } from './text.ts';

// The wa-gateway process (ADR 0026): holds one linked-device socket per store that wants one.
// Stores are spread across gateway processes by leases on store_whatsapp; a lease's epoch fences
// every write, so two processes never drive one store. Postgres is the only channel with Core:
// Core writes wishes and queues messages, LISTEN vendua_wa wakes us, a tick catches anything a
// notification missed.

export const WA_CHANNEL = 'vendua_wa';

export interface GatewayOptions {
  sql: Sql;
  runtime: WaRuntime;
  sealSecret: string;
  id?: string;
  version?: string;
  /** sockets this process will hold */
  maxSessions?: number;
  leaseMs?: number;
  tickMs?: number;
  /** pause between two messages of one store, plus up to as much again in jitter */
  minSendGapMs?: number;
  /** per store, a ceiling against a runaway loop ever spamming from a merchant's number */
  maxPerHour?: number;
  /** Vendedor replies (kind 'chat'): pause between two messages of one conversation */
  chatGapMs?: number;
  /** between any two messages of one store, conversations included */
  conversationGapMs?: number;
  /** how long a store's store_agent.enabled is trusted before it is read again */
  agentGateMs?: number;
  maxAttempts?: number;
  /** false in tests: they call tick() themselves */
  listen?: boolean;
  /** only ever claim these stores (a canary gateway, tests); default: any */
  tenants?: string[] | null;
  /** how long a chat's on-demand history may take to arrive */
  historyTimeoutMs?: number;
  /** tests shorten the reconnect backoff */
  reconnectDelay?: (failures: number) => number;
  log?: Logger;
}

interface Owned {
  fence: Fence;
  session: StoreSession;
  /** the latest row to reconcile against; lifecycle work runs one at a time per store */
  next: LeaseRow | null;
  reconciling: boolean;
  pumping: boolean;
  pumpAgain: boolean;
  /** cuts a pacing wait short when new work arrives */
  wake: (() => void) | null;
  /** non-chat sends of the last hour (chat rows don't count against the ceiling) */
  sentTimes: number[];
  lastSendAt: number;
  /** the store-wide gap for non-chat rows */
  nextOtherAt: number;
  /** the last send per conversation (jid, else phone), while its gap runs */
  chatLast: Map<string, number>;
  lastLane: Lane;
  /** chat jid → thread, for presence updates */
  threads: Map<string, string>;
  typedAt: Map<string, number>;
  /** inbound message id → the chat as WhatsApp delivered it, for a history request anchored on it */
  delivered: Map<string, { jid: string; alt: string | null }>;
  /** history requests being answered here */
  fetching: Set<string>;
}

type Lane = 'chat' | 'other';

interface LeaseRow {
  tenant_id: string;
  lease_epoch: string | number;
  wanted: boolean;
  state: string;
  pair_requested_at: Date | null;
  wipe_requested_at: Date | null;
}

const HOUSEKEEPING_MS = 10 * 60_000;
const SEND_LEASE = '2 minutes';
const TYPING_EVERY_MS = 3_000;
const THREAD_CACHE_MAX = 2_000;
const VOICE_MIME = 'audio/ogg; codecs=opus';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** wanted-and-active, a pairing to start, or a disconnect to finish — anything else is idle */
const NEEDS_SOCKET = `(
  (wanted and (state in ('connecting', 'pairing', 'open', 'error') or pair_requested_at is not null))
  or wipe_requested_at is not null
)`;

export class Gateway {
  readonly id: string;
  private owned = new Map<string, Owned>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<void> | null = null;
  private tickAgain = false;
  private stopping = false;
  private unlisten: (() => Promise<void>) | null = null;
  private lastHousekeeping = 0;
  private agentGate = new Map<string, { on: boolean; at: number }>();
  /** local clock of the last renew that reached the database */
  private renewedAt = Date.now();
  private log: Logger;
  private o: Required<
    Omit<GatewayOptions, 'id' | 'log' | 'version' | 'tenants' | 'reconnectDelay'>
  > & {
    version: string;
    tenants: string[] | null;
    reconnectDelay: ((failures: number) => number) | undefined;
  };

  constructor(opts: GatewayOptions) {
    this.id = opts.id ?? `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.log = (opts.log ?? rootLog).child({ mod: 'wa-gateway', gw: this.id });
    this.o = {
      sql: opts.sql,
      runtime: opts.runtime,
      sealSecret: opts.sealSecret,
      maxSessions: opts.maxSessions ?? 300,
      leaseMs: opts.leaseMs ?? 45_000,
      tickMs: opts.tickMs ?? 5_000,
      minSendGapMs: opts.minSendGapMs ?? 1_500,
      maxPerHour: opts.maxPerHour ?? 200,
      chatGapMs: opts.chatGapMs ?? 1_500,
      conversationGapMs: opts.conversationGapMs ?? 250,
      agentGateMs: opts.agentGateMs ?? 30_000,
      historyTimeoutMs: opts.historyTimeoutMs ?? HISTORY_TIMEOUT_MS,
      maxAttempts: opts.maxAttempts ?? 5,
      listen: opts.listen ?? true,
      tenants: opts.tenants ?? null,
      reconnectDelay: opts.reconnectDelay,
      version: opts.version ?? 'dev',
    };
  }

  /** what /healthz reports */
  health() {
    let open = 0;
    for (const o of this.owned.values()) if (o.session.state === 'open') open++;
    return { id: this.id, sessions: this.owned.size, open, stopping: this.stopping };
  }

  sessionOf(tenantId: string): StoreSession | null {
    return this.owned.get(tenantId)?.session ?? null;
  }

  async start(): Promise<void> {
    if (this.o.listen) {
      const sub = await this.o.sql.listen(WA_CHANNEL, (payload) => this.onNotify(payload));
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
    const [tenantId, kind, arg] = payload.split('|');
    if (!tenantId) return;
    if (kind === 'send') {
      if (this.owned.has(tenantId)) this.pump(tenantId);
      return;
    }
    if (kind === 'typing') {
      if (arg) this.typing(tenantId, arg);
      return;
    }
    if (kind === 'history') {
      if (arg) this.history(tenantId, arg);
      return;
    }
    // a wish changed (pair, disconnect) — reconcile now rather than at the next tick
    void this.tick().catch((e) => this.log.error({ err: e }, 'tick failed'));
  }

  /** One pass: heartbeat, renew, claim, reconcile. Overlapping calls coalesce into one rerun. */
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
      // can't renew: before the leases can lapse and another gateway take these stores, let them
      // go here, or two sockets on one login would keep knocking each other off
      if (Date.now() - this.renewedAt > this.o.leaseMs - Math.min(15_000, this.o.leaseMs / 3)) {
        this.log.error({ err: e, stores: this.owned.size }, 'leases unrenewable — dropping stores');
        for (const [tenantId, o] of this.owned) this.drop(tenantId, o);
      }
      throw e;
    }
    for (const row of rows) this.reconcile(row);
    await this.heartbeat();
    for (const tenantId of this.owned.keys()) this.pump(tenantId);
    // history requests a notification missed, and those of stores nobody holds
    const missed = await sweepRequests(this.o.sql, [...this.owned.keys()], this.o.tenants).catch(
      (e) => {
        this.log.warn({ err: e }, 'history sweep failed');
        return [];
      },
    );
    for (const r of missed) this.history(r.tenant_id, r.id);
    if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_MS) {
      this.lastHousekeeping = Date.now();
      const r = await housekeeping(this.o.sql).catch((e) => {
        this.log.warn({ err: e }, 'housekeeping failed');
        return null;
      });
      if (r && (r.expired || r.deleted)) this.log.info(r, 'queue housekeeping');
    }
  }

  private async renewAndClaim(): Promise<LeaseRow[]> {
    const lease = `${Math.ceil(this.o.leaseMs / 1000)} seconds`;
    const { renewed, claimed } = await controlTx(this.o.sql, async (tx) => {
      const mine = [...this.owned.keys()];
      // a store this process let go (a safety drop, a failed start) still names it as owner: hand
      // it back now rather than renew a lease nothing here is running
      await tx`
        update store_whatsapp set owner = null, lease_until = null
        where owner = ${this.id} and not (tenant_id = any(${mine}::uuid[]))`;
      const renewed = await tx<LeaseRow[]>`
        update store_whatsapp set lease_until = now() + ${lease}::interval
        where owner = ${this.id} and lease_until > now() and tenant_id = any(${mine}::uuid[])
        returning tenant_id, lease_epoch, wanted, state, pair_requested_at, wipe_requested_at`;
      const free = this.o.maxSessions - renewed.length;
      const claimed =
        free > 0
          ? await tx<LeaseRow[]>`
              update store_whatsapp set owner = ${this.id}, lease_epoch = lease_epoch + 1,
                lease_until = now() + ${lease}::interval
              where tenant_id in (
                select tenant_id from store_whatsapp
                where ${tx.unsafe(NEEDS_SOCKET)}
                  and (owner is null or lease_until is null or lease_until < now())
                  and (${this.o.tenants}::uuid[] is null or tenant_id = any(${this.o.tenants}::uuid[]))
                order by lease_until nulls first
                limit ${free}
                for update skip locked
              )
              returning tenant_id, lease_epoch, wanted, state, pair_requested_at, wipe_requested_at`
          : [];
      return { renewed, claimed };
    });
    // a store we drove but didn't renew moved on (expired, stolen): drop it without a logout
    const kept = new Set([...renewed, ...claimed].map((r) => r.tenant_id));
    for (const [tenantId, o] of this.owned)
      if (!kept.has(tenantId)) {
        this.log.warn({ tenantId }, 'lease lost — dropping store');
        this.drop(tenantId, o);
      }
    for (const r of claimed) {
      const prev = this.owned.get(r.tenant_id);
      // re-claimed after a lapse: the old fence is dead, start over with the new epoch
      if (prev) this.drop(r.tenant_id, prev);
      this.adopt(r);
    }
    return [...renewed, ...claimed];
  }

  private adopt(r: LeaseRow) {
    const fence = { owner: this.id, epoch: Number(r.lease_epoch) };
    const tenantId = r.tenant_id;
    const log = this.log.child({ tenantId });
    const store = authStore(this.o.sql, tenantId, fence, this.o.runtime.codec, this.o.sealSecret);
    const owned: Owned = {
      fence,
      next: null,
      reconciling: false,
      pumping: false,
      pumpAgain: false,
      wake: null,
      sentTimes: [],
      lastSendAt: 0,
      nextOtherAt: 0,
      chatLast: new Map(),
      lastLane: 'other',
      threads: new Map(),
      typedAt: new Map(),
      delivered: new Map(),
      fetching: new Set(),
      session: null as unknown as StoreSession,
    };
    const lost = () => {
      if (this.owned.get(tenantId) === owned) this.drop(tenantId, owned);
    };
    // state writes keep their order: a late "connecting" must not land after "open"
    let stateTail = Promise.resolve();
    let inboundTail = Promise.resolve();
    owned.session = new StoreSession(
      tenantId,
      this.o.runtime,
      store,
      {
        onState: (u) => {
          stateTail = stateTail
            .then(() => reportState(this.o.sql, tenantId, fence, u))
            .then(() => {
              if (u.state === 'open') this.pump(tenantId);
            })
            .catch((e) => {
              if (e instanceof LeaseLost) lost();
              else log.error({ err: e, state: u.state }, 'state not saved');
            });
        },
        onMessage: (m) => {
          // SAIR then VOLTAR delivered together must apply in that order, and a conversation
          // keeps the order its messages arrived in
          inboundTail = inboundTail
            .then(() => this.inbound(tenantId, owned, m))
            .catch((e) => {
              if (e instanceof LeaseLost) lost();
              else log.warn({ err: e }, 'inbound not handled');
            });
        },
        onTyping: (jid) => {
          void this.shopperTyping(tenantId, owned, jid).catch((e) => {
            if (e instanceof LeaseLost) lost();
            else log.warn({ err: e }, 'presence not saved');
          });
        },
        onReceipts: (rs) => {
          void recordReceipts(this.o.sql, tenantId, rs).catch((e) =>
            log.warn({ err: e }, 'receipts not saved'),
          );
        },
        onLeaseLost: lost,
        messageText: (waId) => messageText(this.o.sql, tenantId, waId),
        wipe: () => wipeFenced(this.o.sql, tenantId, fence),
      },
      log,
      this.o.reconnectDelay,
    );
    this.owned.set(tenantId, owned);
  }

  /** store_agent.enabled, trusted for agentGateMs: off, the store behaves as before the Vendedor */
  private async agentOn(tenantId: string): Promise<boolean> {
    const c = this.agentGate.get(tenantId);
    if (c && Date.now() - c.at < this.o.agentGateMs) return c.on;
    try {
      const on = await agentEnabled(this.o.sql, tenantId);
      this.agentGate.set(tenantId, { on, at: Date.now() });
      return on;
    } catch (e) {
      this.log.warn({ err: e, tenantId }, 'store_agent unreadable');
      return c?.on ?? false;
    }
  }

  private async inbound(tenantId: string, o: Owned, m: WaInbound): Promise<void> {
    const { sql } = this.o;
    const isPn = (j: string | null) => !!j?.endsWith('@s.whatsapp.net');
    if (!(await this.agentOn(tenantId))) {
      // as before the Vendedor: only a shopper's text, for SAIR / VOLTAR
      if (m.fromMe || !m.text) return;
      const phone =
        phoneForJid(m.jid) ??
        phoneForJid(m.alt) ??
        (m.jid.endsWith('@lid') ? phoneForJid(await m.pnForLid(m.jid)) : null);
      await handleInbound(sql, tenantId, { phone, text: m.text, id: m.id });
      this.pump(tenantId);
      return;
    }
    if (!m.fromMe) {
      if (o.delivered.size >= THREAD_CACHE_MAX) o.delivered.clear();
      o.delivered.set(m.id, { jid: m.jid, alt: m.alt });
    }
    const pn = isPn(m.jid) ? m.jid : isPn(m.alt) ? m.alt : await m.pnForLid(m.jid);
    const lid = m.jid.endsWith('@lid') ? m.jid : m.alt?.endsWith('@lid') ? m.alt : null;
    const command = m.fromMe ? phoneCommand(m.text) : null;
    const content = command ? commandContent(command) : m.content;
    if (content) {
      try {
        const r = await storeChatMessage(
          sql,
          tenantId,
          o.fence,
          { id: m.id, fromMe: m.fromMe, pn, lid, pushName: m.pushName, content },
          m.download,
        );
        // the owner's command is for us, not for the contact: gone from the chat at once
        if (r.stored && command)
          void o.session
            .revoke(m.jid, m.id)
            .catch((e) => this.log.warn({ err: e, tenantId }, 'command not revoked'));
        if (r.stored) {
          if (o.threads.size >= THREAD_CACHE_MAX) o.threads.clear();
          for (const j of [m.jid, m.alt, pn, lid]) if (j) o.threads.set(j, r.threadId);
          if (!m.fromMe)
            void o.session
              .subscribePresence(m.jid)
              .catch((e) => this.log.debug({ err: e, tenantId }, 'presence subscribe failed'));
        }
      } catch (e) {
        if (e instanceof LeaseLost) throw e;
        this.log.warn({ err: e, tenantId }, 'conversation message not stored');
      }
    }
    if (m.fromMe || !m.text) return;
    await handleInbound(sql, tenantId, { phone: phoneForJid(pn), text: m.text, id: m.id });
    this.pump(tenantId);
  }

  /** Core asks for one chat's latest messages (a new contact's check): answer it if this
   *  gateway holds the store. */
  private history(tenantId: string, requestId: string) {
    const o = this.owned.get(tenantId);
    if (!o || !UUID.test(requestId) || o.fetching.has(requestId)) return;
    o.fetching.add(requestId);
    void this.answerHistory(tenantId, o, requestId)
      .catch((e) => {
        if (e instanceof LeaseLost) {
          if (this.owned.get(tenantId) === o) this.drop(tenantId, o);
        } else this.log.warn({ err: e, tenantId }, 'history request not answered');
      })
      .finally(() => o.fetching.delete(requestId));
  }

  private async answerHistory(tenantId: string, o: Owned, requestId: string): Promise<void> {
    const { sql } = this.o;
    const req = await pendingRequest(sql, tenantId, requestId);
    if (!req || this.owned.get(tenantId) !== o) return;
    const finish = (out: HistoryOutcome) => finishRequest(sql, tenantId, o.fence, requestId, out);
    if (o.session.state !== 'open') {
      // a socket coming back gets a moment; the tick asks again
      const young = Date.now() - req.createdAt.getTime() < this.o.historyTimeoutMs;
      if (young && ['connecting', 'error'].includes(o.session.state) && o.session.running) return;
      await finish({ status: 'failed', failure: 'offline' });
      return;
    }
    if (!(await claimRequest(sql, tenantId, o.fence, requestId))) return;
    const seen = o.delivered.get(req.anchorWaId);
    let out: HistoryOutcome;
    try {
      const messages = await o.session.fetchHistory(
        {
          // the anchor's chat as WhatsApp delivered it is the form the phone files it under
          chatJid: seen?.jid ?? req.address,
          jids: [req.address, ...(seen?.alt ? [seen.alt] : [])],
          anchorId: req.anchorWaId,
          anchorAt: req.anchorAt,
        },
        this.o.historyTimeoutMs,
      );
      out = messages.length ? { status: 'done', messages } : { status: 'empty' };
    } catch (e) {
      if (e instanceof HistoryTimeout) out = { status: 'failed', failure: 'timeout' };
      else if (e instanceof SessionClosed) out = { status: 'failed', failure: 'offline' };
      else {
        this.log.warn({ err: e, tenantId }, 'history fetch failed');
        out = { status: 'failed', failure: 'error' };
      }
    }
    await finish(out);
  }

  private async shopperTyping(tenantId: string, o: Owned, jid: string): Promise<void> {
    if (!(await this.agentOn(tenantId))) return;
    const threadId = o.threads.get(jid) ?? (await threadForJid(this.o.sql, tenantId, jid));
    if (!threadId || this.owned.get(tenantId) !== o) return;
    const now = Date.now();
    if (now - (o.typedAt.get(threadId) ?? 0) < TYPING_EVERY_MS) return;
    if (o.typedAt.size >= THREAD_CACHE_MAX) o.typedAt.clear();
    o.typedAt.set(threadId, now);
    await recordTyping(this.o.sql, tenantId, o.fence, threadId);
  }

  /** Core is writing a reply: "digitando…" in the shopper's chat. */
  private typing(tenantId: string, threadId: string) {
    const o = this.owned.get(tenantId);
    if (!o || o.session.state !== 'open' || !UUID.test(threadId)) return;
    void (async () => {
      const jid = await threadAddress(this.o.sql, tenantId, threadId);
      if (jid) await o.session.typing(jid);
    })().catch((e) => this.log.debug({ err: e, tenantId }, 'typing not shown'));
  }

  private drop(tenantId: string, o: Owned) {
    this.agentGate.delete(tenantId);
    this.owned.delete(tenantId);
    void o.session.stop().catch(() => undefined);
  }

  /** Lifecycle work for one store, one pass at a time; ticks that arrive meanwhile fold into
   *  one more pass against the newest row. */
  private reconcile(row: LeaseRow) {
    const o = this.owned.get(row.tenant_id);
    if (!o) return;
    o.next = row;
    if (o.reconciling) return;
    o.reconciling = true;
    const tenantId = row.tenant_id;
    void (async () => {
      try {
        while (o.next && this.owned.get(tenantId) === o && !this.stopping) {
          const r = o.next;
          o.next = null;
          await this.reconcileOnce(tenantId, o, r);
        }
      } catch (e) {
        if (e instanceof LeaseLost) {
          if (this.owned.get(tenantId) === o) this.drop(tenantId, o);
        } else this.log.error({ err: e, tenantId }, 'store work failed');
      } finally {
        o.reconciling = false;
      }
    })();
  }

  private async reconcileOnce(tenantId: string, o: Owned, row: LeaseRow) {
    if (row.wipe_requested_at) {
      await o.session.logout();
      await finishWipe(this.o.sql, tenantId, o.fence, row.wipe_requested_at);
    }
    if (!row.wanted) {
      await this.release(tenantId, o);
      return;
    }
    if (row.pair_requested_at) {
      const phone = await takePairRequest(this.o.sql, tenantId, o.fence, row.pair_requested_at);
      if (phone) {
        await o.session.pair(phone);
        return;
      }
    }
    if (o.session.running) return;
    if (['open', 'connecting', 'error'].includes(row.state)) {
      if (await o.session.start()) return;
      // wanted on, but there's no login to bring up (wiped, never confirmed)
      await reportState(this.o.sql, tenantId, o.fence, {
        state: 'off',
        detail: 'not_paired',
        pairCode: null,
      });
    } else if (row.state === 'pairing') {
      // the pairing socket died with its process: the code is dead too
      await reportState(this.o.sql, tenantId, o.fence, {
        state: 'off',
        detail: 'pair_expired',
        pairCode: null,
      });
    }
    // logged_out, banned, off: nothing to run until the merchant pairs again
    await this.release(tenantId, o);
  }

  /** Nothing to run for this store: let the lease go so it costs no capacity. */
  private async release(tenantId: string, o: Owned) {
    await o.session.stop();
    if (this.owned.get(tenantId) === o) this.owned.delete(tenantId);
    await controlTx(
      this.o.sql,
      (tx) => tx`
        update store_whatsapp set owner = null, lease_until = null
        where tenant_id = ${tenantId} and owner = ${this.id} and lease_epoch = ${o.fence.epoch}`,
    );
  }

  private async heartbeat() {
    const h = this.health();
    await controlTx(
      this.o.sql,
      (tx) => tx`
        insert into wa_gateways (id, version, sessions, open_sessions)
        values (${this.id}, ${this.o.version}, ${h.sessions}, ${h.open})
        on conflict (id) do update set seen_at = now(), sessions = excluded.sessions,
          open_sessions = excluded.open_sessions`,
    ).catch((e) => this.log.warn({ err: e }, 'heartbeat failed'));
  }

  /** Drain this store's due messages, one at a time, paced. Re-entrant calls fold into one.
   *  Two lanes: notices (orders, acks, tests) keep the hourly ceiling and the store-wide gap;
   *  Vendedor replies are paced per conversation. When both have work they take turns, so a
   *  burst of either can't hold the other back. */
  pump(tenantId: string): void {
    const o = this.owned.get(tenantId);
    if (!o) return;
    if (o.pumping) {
      o.pumpAgain = true;
      o.wake?.();
      return;
    }
    o.pumping = true;
    void (async () => {
      let warned = false;
      try {
        do {
          o.pumpAgain = false;
          while (this.owned.get(tenantId) === o && o.session.state === 'open' && !this.stopping) {
            const now = Date.now();
            o.sentTimes = o.sentTimes.filter((t) => t > now - 3_600_000);
            const capped = o.sentTimes.length >= this.o.maxPerHour;
            if (capped && !warned) {
              warned = true;
              this.log.warn({ tenantId }, 'hourly send ceiling reached — holding the notices');
            }
            for (const [k, t] of o.chatLast) if (now - t >= this.o.chatGapMs) o.chatLast.delete(k);
            const busy = [...o.chatLast.keys()];
            const floor = o.lastSendAt + this.o.conversationGapMs;
            const lanes: Lane[] = o.lastLane === 'chat' ? ['other', 'chat'] : ['chat', 'other'];
            let wake = Infinity;
            let res: 'sent' | 'settled' | 'none' | 'closed' = 'none';
            for (const lane of lanes) {
              if (lane === 'other' && capped) continue;
              const readyAt = Math.max(floor, lane === 'other' ? o.nextOtherAt : 0);
              if (readyAt > now) {
                wake = Math.min(wake, readyAt);
                continue;
              }
              res = await this.sendOne(tenantId, o, lane, busy);
              if (res !== 'none') break;
              // the only due replies may be in a conversation whose gap is still running
              if (lane === 'chat' && busy.length)
                wake = Math.min(wake, Math.min(...o.chatLast.values()) + this.o.chatGapMs);
            }
            if (res === 'closed') break;
            if (res !== 'none') continue;
            if (wake === Infinity) break;
            await new Promise<void>((r) => {
              o.wake = r;
              setTimeout(r, Math.max(1, wake - Date.now()));
            });
            o.wake = null;
          }
        } while (o.pumpAgain && this.owned.get(tenantId) === o);
      } catch (e) {
        if (e instanceof LeaseLost) {
          if (this.owned.get(tenantId) === o) this.drop(tenantId, o);
        } else this.log.error({ err: e, tenantId }, 'send loop failed');
      } finally {
        o.pumping = false;
      }
    })();
  }

  private sentNow(o: Owned, lane: Lane, to: string) {
    const now = Date.now();
    o.lastSendAt = now;
    o.lastLane = lane;
    if (lane === 'chat') o.chatLast.set(to, now);
    else {
      o.sentTimes.push(now);
      o.nextOtherAt = now + this.o.minSendGapMs * (1 + Math.random());
    }
  }

  private async sendOne(
    tenantId: string,
    o: Owned,
    lane: Lane,
    busy: string[],
  ): Promise<'sent' | 'settled' | 'none' | 'closed'> {
    const { sql } = this.o;
    const row = await withTenant(sql, tenantId, async (tx) => {
      const held = await tx`
        select wanted from store_whatsapp
        where tenant_id = ${tenantId} and owner = ${this.id} and lease_epoch = ${o.fence.epoch}
          and lease_until > now()`;
      if (!held.length) throw new LeaseLost(tenantId);
      // a store the merchant just disconnected sends nothing more, whatever is queued
      if (!held[0]!.wanted) return null;
      const next = (
        await tx<{ id: string; wa_id: string | null }[]>`
          select id, wa_id from store_wa_messages
          where tenant_id = ${tenantId}
            and ((status = 'pending' and next_attempt_at <= now())
              or (status = 'sending' and lease_until < now()))
            and (kind = 'chat') = ${lane === 'chat'}
            and not (coalesce(jid, phone) = any(${busy}::text[]))
          -- what the store starts (a bag reminder, "abrimos") waits behind every order notice
          order by kind = any(${PROACTIVE_KINDS as unknown as string[]}::text[]), created_at
          limit 1
          for update skip locked`
      )[0];
      if (!next) return null;
      const claimed = await tx<
        {
          id: string;
          kind: string;
          phone: string | null;
          jid: string | null;
          body: string;
          media_id: string | null;
          shopper_message_id: string | null;
          attempts: number;
          wa_id: string;
          expired: boolean;
          superseded: boolean;
          bag_done: boolean;
        }[]
      >`
        update store_wa_messages set status = 'sending', attempts = attempts + 1,
          lease_until = now() + ${SEND_LEASE}::interval, wa_id = ${next.wa_id ?? messageIdFor(next.id)}
        where id = ${next.id}
        returning id, kind, phone, jid, body, media_id, shopper_message_id, attempts, wa_id,
          expires_at < now() as expired,
          -- money given back is never stale news
          coalesce(event, '') not like 'refunded:%' and exists (select 1 from store_wa_messages later
                  where later.tenant_id = store_wa_messages.tenant_id
                    and later.order_id = store_wa_messages.order_id
                    and later.created_at > store_wa_messages.created_at
                    and later.status = 'sent') as superseded,
          -- a bag reminder whose bag was ordered while it waited in line
          kind = 'cart_reminder' and not exists (select 1 from carts c
                  where c.id = store_wa_messages.cart_id and c.status = 'open') as bag_done`;
      const r = claimed[0]!;
      if (r.expired) {
        await tx`update store_wa_messages set status = 'expired', lease_until = null where id = ${r.id}`;
        if (r.shopper_message_id)
          await mirrorStatusTx(tx, tenantId, r.shopper_message_id, 'failed', null);
        return { ...r, settled: true };
      }
      // a retry that a later step of the same order already overtook would arrive out of
      // order ("saiu para entrega" after "entregue"): drop it
      if (r.superseded) {
        await tx`update store_wa_messages set status = 'skipped', error = 'superseded', lease_until = null
                 where id = ${r.id}`;
        return { ...r, settled: true };
      }
      if (r.bag_done) {
        await tx`update store_wa_messages set status = 'skipped', error = 'ordered', lease_until = null
                 where id = ${r.id}`;
        return { ...r, settled: true };
      }
      const notice = NOTICE_KINDS.includes(r.kind);
      if (notice && (await optedOutTx(tx, tenantId, r.phone!))) {
        await tx`update store_wa_messages set status = 'skipped', error = 'opted_out', lease_until = null
                 where id = ${r.id}`;
        return { ...r, settled: true };
      }
      // sends are one at a time per store, so "first message that went out" is decided here;
      // the stored body becomes what was sent, for WhatsApp's resend-on-retry. What the store
      // starts on its own always says how to stop.
      if (
        notice &&
        !r.body.endsWith(OPT_OUT_FOOTER) &&
        (r.kind !== 'order' || !(await contactedTx(tx, tenantId, r.phone!)))
      ) {
        r.body += OPT_OUT_FOOTER;
        await tx`update store_wa_messages set body = ${r.body} where id = ${r.id}`;
      }
      return { ...r, settled: false };
    });
    if (!row) return 'none';
    if (row.settled) {
      await this.touch(tenantId);
      return 'settled';
    }
    const settle = async (
      status: 'sent' | 'failed' | 'pending',
      error: string | null,
      extra: { retryMs?: number; refund?: boolean } = {},
    ) => {
      await withTenant(sql, tenantId, async (tx) => {
        if (status === 'sent')
          await tx`update store_wa_messages set status = 'sent', sent_at = now(), lease_until = null,
                   error = null where id = ${row.id} and status = 'sending'`;
        else if (status === 'failed')
          await tx`update store_wa_messages set status = 'failed', lease_until = null, error = ${error}
                   where id = ${row.id} and status = 'sending'`;
        else
          await tx`update store_wa_messages set status = 'pending', lease_until = null, error = ${error},
                   attempts = greatest(attempts - ${extra.refund ? 1 : 0}, 0),
                   next_attempt_at = now() + ${`${Math.round((extra.retryMs ?? 0) / 1000)} seconds`}::interval
                   where id = ${row.id} and status = 'sending'`;
        if (row.shopper_message_id && status !== 'pending')
          await mirrorStatusTx(tx, tenantId, row.shopper_message_id, status, row.wa_id);
        await emitAdminTx(tx, tenantId, 'whatsapp', 'message');
      });
    };
    try {
      let content: OutContent = { text: row.body };
      if (row.kind === 'chat' && row.media_id) {
        const voice = await voiceNote(sql, tenantId, row.media_id);
        if (!voice) {
          await settle('failed', 'media_missing');
          return 'settled';
        }
        content = {
          audio: voice.bytes,
          ptt: true,
          mimetype: VOICE_MIME,
          ...(voice.seconds != null ? { seconds: voice.seconds } : {}),
        };
      }
      await o.session.sendTo({ jid: row.jid, phone: row.phone }, content, row.wa_id);
      this.sentNow(o, lane, row.jid ?? row.phone ?? '');
      await settle('sent', null);
      return 'sent';
    } catch (e) {
      if (e instanceof NotOnWhatsApp) {
        await settle('failed', 'not_on_whatsapp');
        return 'settled';
      }
      if (e instanceof SessionClosed) {
        // not this message's fault: back in line without spending an attempt
        await settle('pending', null, { refund: true });
        return 'closed';
      }
      const msg = (e as Error)?.message?.slice(0, 200) ?? 'send failed';
      this.log.warn({ err: e, tenantId, attempts: row.attempts }, 'send failed');
      if (row.attempts >= this.o.maxAttempts) await settle('failed', msg);
      else await settle('pending', msg, { retryMs: retryDelayMs(row.attempts) });
      return 'settled';
    }
  }

  private async touch(tenantId: string) {
    await withTenant(this.o.sql, tenantId, (tx) =>
      emitAdminTx(tx, tenantId, 'whatsapp', 'message'),
    );
  }

  /** Graceful: close every socket (keeping its login) and hand the leases back at once. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.unlisten?.().catch(() => undefined);
    await this.ticking?.catch(() => undefined);
    const all = [...this.owned.values()];
    this.owned.clear();
    await Promise.all(all.map((o) => o.session.stop().catch(() => undefined)));
    await controlTx(this.o.sql, async (tx) => {
      await tx`update store_whatsapp set owner = null, lease_until = null where owner = ${this.id}`;
      await tx`delete from wa_gateways where id = ${this.id}`;
    }).catch((e) => this.log.warn({ err: e }, 'lease release failed'));
  }
}
