import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';

// One LISTEN per Core process fans tenant-scoped changes out to every open admin
// stream of that tenant (docs/merchant-admin.md — live admin stream). Payloads are
// `tenantId|topic|id`; streams send the topic and the client refetches what it shows.

export const ADMIN_CHANNEL = 'vendua_admin';

export type AdminTopic =
  | 'order.placed'
  | 'order.changed'
  | 'catalog'
  | 'store'
  | 'marketing'
  | 'team'
  | 'appearance'
  // loader/maintenance state — storefront-facing only
  | 'surfaces'
  // an online payment landed on an order (id = order id)
  | 'payment.received'
  // Mercado Pago connection, plan, invoices, domains
  | 'billing'
  // an alert attempt was recorded (devices, missed alerts)
  | 'alerts'
  // a menu import moved: read, applied, photos re-hosted (id = import id)
  | 'import'
  // the store's own WhatsApp: connection state, pairing code, opt-outs (id = state)
  | 'whatsapp'
  // print agents and their printers: paired, online, a job printed or failed
  | 'printers'
  // the kitchen display: lines marked done, a rush flag, the stations (id = order id | 'stations')
  | 'kitchen'
  // the Vendedor: a conversation moved (id = thread id), its settings or knowledge (id = 'settings' | 'knowledge')
  | 'vendedor'
  // a shopper is waiting for the store in a Vendedor conversation (id = thread id): may push (law 13)
  | 'vendedor.waiting'
  // Duá ran out of conversations (id = the period: its month's reset date, or 'trial'): may push
  | 'vendedor.exhausted';

const liveLog = log.child({ mod: 'admin-live' });

const LISTEN_RETRY_MIN_MS = 1_000;
const LISTEN_RETRY_MAX_MS = 30_000;

/** Delivered on commit — a rolled-back change never wakes a stream. */
export async function emitAdminTx(tx: Sql, tenantId: string, topic: AdminTopic, id = '') {
  await tx`select pg_notify(${ADMIN_CHANNEL}, ${`${tenantId}|${topic}|${id}`})`;
}

export interface AdminEvent {
  topic: AdminTopic;
  id: string;
}

export class AdminHub {
  private listeners = new Map<string, Set<(e: AdminEvent) => void>>();
  private global = new Set<(tenantId: string, e: AdminEvent) => void>();
  private started: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = LISTEN_RETRY_MIN_MS;

  constructor(private sql: Sql) {}

  private ensure(): Promise<void> {
    this.started ??= this.sql
      .listen(
        ADMIN_CHANNEL,
        (payload) => {
          const [tenantId, topic, id] = payload.split('|');
          if (!tenantId || !topic) return;
          const e = { topic: topic as AdminTopic, id: id ?? '' };
          for (const fn of this.listeners.get(tenantId) ?? []) fn(e);
          for (const fn of this.global) fn(tenantId, e);
        },
        // (re)subscribed: anything sent meanwhile is lost — tell every stream to resync
        () => {
          for (const set of this.listeners.values())
            for (const fn of set) fn({ topic: 'store', id: 'resync' });
        },
      )
      .then(() => {
        this.retryMs = LISTEN_RETRY_MIN_MS;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
      })
      .catch((err) => {
        liveLog.error({ err }, 'admin LISTEN failed — streams fall back to their recheck');
        this.started = null;
        this.scheduleRetry();
      });
    return this.started;
  }

  // onAny listeners (push) have no later subscribe() to retry for them
  private scheduleRetry() {
    if (this.retryTimer) return;
    const ms = this.retryMs;
    this.retryMs = Math.min(ms * 2, LISTEN_RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensure();
    }, ms);
    this.retryTimer.unref?.();
  }

  /** Every tenant's events — background workers (push), never request handlers. */
  async onAny(fn: (tenantId: string, e: AdminEvent) => void): Promise<() => void> {
    await this.ensure();
    this.global.add(fn);
    return () => this.global.delete(fn);
  }

  async subscribe(tenantId: string, fn: (e: AdminEvent) => void): Promise<() => void> {
    await this.ensure();
    let set = this.listeners.get(tenantId);
    if (!set) this.listeners.set(tenantId, (set = new Set()));
    set.add(fn);
    return () => {
      const cur = this.listeners.get(tenantId);
      cur?.delete(fn);
      if (cur?.size === 0) this.listeners.delete(tenantId);
    };
  }
}
