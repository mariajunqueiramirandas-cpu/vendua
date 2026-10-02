import { hostname } from 'node:os';
import type { Logger } from 'pino';
import { emitAdminTx } from '../admin/live.ts';
import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { log as rootLog } from '../platform/log.ts';
import { authStore, LeaseLost, type Fence } from './auth-store.ts';
import { contactedTx, OPT_OUT_FOOTER, optedOutTx } from './messages.ts';
import { NotOnWhatsApp, SessionClosed, StoreSession, type WaRuntime } from './session.ts';
import {
  finishWipe,
  handleInbound,
  housekeeping,
  messageText,
  recordReceipts,
  reportState,
  takePairRequest,
  wipeFenced,
} from './state.ts';
import { messageIdFor, retryDelayMs } from './text.ts';

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
  maxAttempts?: number;
  /** false in tests: they call tick() themselves */
  listen?: boolean;
  /** only ever claim these stores (a canary gateway, tests); default: any */
  tenants?: string[] | null;
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
  sentTimes: number[];
}

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
    const [tenantId, kind] = payload.split('|');
    if (!tenantId) return;
    if (kind === 'send') {
      if (this.owned.has(tenantId)) this.pump(tenantId);
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
      sentTimes: [],
      session: null as unknown as StoreSession,
    };
    const lost = () => {
      if (this.owned.get(tenantId) === owned) this.drop(tenantId, owned);
    };
    // state writes keep their order: a late "connecting" must not land after "open"
    let stateTail = Promise.resolve();
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
        onInbound: (m) => {
          void handleInbound(this.o.sql, tenantId, m)
            .then(() => this.pump(tenantId))
            .catch((e) => log.warn({ err: e }, 'inbound not handled'));
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

  private drop(tenantId: string, o: Owned) {
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

  /** Drain this store's due messages, one at a time, paced. Re-entrant calls fold into one. */
  pump(tenantId: string): void {
    const o = this.owned.get(tenantId);
    if (!o) return;
    if (o.pumping) {
      o.pumpAgain = true;
      return;
    }
    o.pumping = true;
    void (async () => {
      try {
        do {
          o.pumpAgain = false;
          while (this.owned.get(tenantId) === o && o.session.state === 'open' && !this.stopping) {
            const hourAgo = Date.now() - 3_600_000;
            o.sentTimes = o.sentTimes.filter((t) => t > hourAgo);
            if (o.sentTimes.length >= this.o.maxPerHour) {
              this.log.warn({ tenantId }, 'hourly send ceiling reached — holding the queue');
              break;
            }
            const sent = await this.sendOne(tenantId, o);
            if (sent === 'none') break;
            if (sent === 'closed') break;
            if (sent === 'sent') {
              o.sentTimes.push(Date.now());
              const gap = this.o.minSendGapMs * (1 + Math.random());
              await new Promise((r) => setTimeout(r, gap));
            }
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

  private async sendOne(
    tenantId: string,
    o: Owned,
  ): Promise<'sent' | 'settled' | 'none' | 'closed'> {
    const { sql } = this.o;
    const row = await withTenant(sql, tenantId, async (tx) => {
      const held = await tx`
        select wanted from store_whatsapp
        where tenant_id = ${tenantId} and owner = ${this.id} and lease_epoch = ${o.fence.epoch}`;
      if (!held.length) throw new LeaseLost(tenantId);
      // a store the merchant just disconnected sends nothing more, whatever is queued
      if (!held[0]!.wanted) return null;
      const next = (
        await tx<{ id: string; wa_id: string | null }[]>`
          select id, wa_id from store_wa_messages
          where tenant_id = ${tenantId}
            and ((status = 'pending' and next_attempt_at <= now())
              or (status = 'sending' and lease_until < now()))
          order by created_at
          limit 1
          for update skip locked`
      )[0];
      if (!next) return null;
      const claimed = await tx<
        {
          id: string;
          kind: string;
          phone: string;
          body: string;
          attempts: number;
          wa_id: string;
          expired: boolean;
        }[]
      >`
        update store_wa_messages set status = 'sending', attempts = attempts + 1,
          lease_until = now() + ${SEND_LEASE}::interval, wa_id = ${next.wa_id ?? messageIdFor(next.id)}
        where id = ${next.id}
        returning id, kind, phone, body, attempts, wa_id, expires_at < now() as expired`;
      const r = claimed[0]!;
      if (r.expired) {
        await tx`update store_wa_messages set status = 'expired', lease_until = null where id = ${r.id}`;
        return { ...r, settled: true };
      }
      if (r.kind === 'order' && (await optedOutTx(tx, tenantId, r.phone))) {
        await tx`update store_wa_messages set status = 'skipped', error = 'opted_out', lease_until = null
                 where id = ${r.id}`;
        return { ...r, settled: true };
      }
      // sends are one at a time per store, so "first message that went out" is decided here;
      // the stored body becomes what was sent, for WhatsApp's resend-on-retry
      if (
        r.kind === 'order' &&
        !r.body.endsWith(OPT_OUT_FOOTER) &&
        !(await contactedTx(tx, tenantId, r.phone))
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
        await import('../admin/live.ts').then((m) =>
          m.emitAdminTx(tx, tenantId, 'whatsapp', 'message'),
        );
      });
    };
    try {
      await o.session.send(row.phone, row.body, row.wa_id);
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
