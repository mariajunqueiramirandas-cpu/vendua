import { randomUUID } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { withTenant } from '../platform/db.ts';
import { log } from '../platform/log.ts';

// "Who is in the store right now": a viewer is an open storefront stream (the Kernel closes it
// while the tab is hidden, so it counts visible tabs); carts come from the database. Streams live
// in one process, so each process announces its per-tenant count on a pg channel and every
// process sums the fresh announcements — no table, and a dead process expires by silence.
// Counts are advisory (a scripted client can open streams up to the cap) — never billing input.

export const PRESENCE_CHANNEL = 'vendua_presence';
const ANNOUNCE_MS = 15_000;
const EXPIRE_MS = 45_000;
const DEBOUNCE_MS = 1000;
/** a sacola counts as "active" when someone touched it this recently */
export const ACTIVE_CART_MINUTES = 30;

const presenceLog = log.child({ mod: 'presence' });

export interface Presence {
  viewers: number;
  carts: number;
}

export class PresenceTracker {
  readonly procId = randomUUID().slice(0, 8);
  private local = new Map<string, number>();
  private remote = new Map<string, Map<string, { n: number; at: number }>>();
  private listeners = new Map<string, Set<() => void>>();
  private started: Promise<void> | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private beat: ReturnType<typeof setInterval> | null = null;

  constructor(private sql: Sql) {}

  private ensure(): Promise<void> {
    this.started ??= this.sql
      .listen(PRESENCE_CHANNEL, (payload) => {
        const [tenantId, proc, n] = payload.split('|');
        if (!tenantId || !proc || proc === this.procId) return;
        const count = Number(n);
        if (!Number.isInteger(count) || count < 0) return;
        let m = this.remote.get(tenantId);
        if (!m) this.remote.set(tenantId, (m = new Map()));
        m.set(proc, { n: count, at: Date.now() });
        this.changed(tenantId);
      })
      .then(() => {
        this.beat = setInterval(() => this.reannounce(), ANNOUNCE_MS);
        this.beat.unref?.();
      })
      .catch((err) => {
        presenceLog.error({ err }, 'presence LISTEN failed — counts stay per-process');
        this.started = null;
      });
    return this.started;
  }

  viewers(tenantId: string): number {
    const now = Date.now();
    let total = this.local.get(tenantId) ?? 0;
    for (const [proc, r] of this.remote.get(tenantId) ?? []) {
      if (now - r.at > EXPIRE_MS) this.remote.get(tenantId)!.delete(proc);
      else total += r.n;
    }
    return total;
  }

  /** A storefront stream opened; returns its close. */
  async join(tenantId: string): Promise<() => void> {
    void this.ensure();
    this.local.set(tenantId, (this.local.get(tenantId) ?? 0) + 1);
    this.announce(tenantId);
    this.changed(tenantId);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const n = (this.local.get(tenantId) ?? 1) - 1;
      if (n <= 0) this.local.delete(tenantId);
      else this.local.set(tenantId, n);
      this.announce(tenantId);
      this.changed(tenantId);
    };
  }

  /** Calls `fn` whenever this tenant's viewer count may have moved. */
  async subscribe(tenantId: string, fn: () => void): Promise<() => void> {
    await this.ensure();
    let set = this.listeners.get(tenantId);
    if (!set) this.listeners.set(tenantId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) this.listeners.delete(tenantId);
    };
  }

  private changed(tenantId: string) {
    for (const fn of this.listeners.get(tenantId) ?? []) fn();
  }

  // debounced: a rush of opens/closes is one announcement
  private announce(tenantId: string) {
    if (this.timers.has(tenantId)) return;
    this.timers.set(
      tenantId,
      setTimeout(() => {
        this.timers.delete(tenantId);
        void this
          .sql`select pg_notify(${PRESENCE_CHANNEL}, ${`${tenantId}|${this.procId}|${this.local.get(tenantId) ?? 0}`})`.catch(
          () => undefined,
        );
      }, DEBOUNCE_MS),
    );
  }

  private reannounce() {
    for (const tenantId of this.local.keys()) this.announce(tenantId);
    // expire silent processes and let watchers see the drop
    for (const tenantId of this.listeners.keys()) this.changed(tenantId);
  }

  stop() {
    if (this.beat) clearInterval(this.beat);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}

/** Open sacolas with something in them that were touched recently. */
export async function activeCarts(sql: Sql, tenantId: string): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const [row] = await tx<{ n: number }[]>`
      select count(*)::int as n from carts c
      where c.tenant_id = ${tenantId} and c.status = 'open'
        and c.updated_at > now() - make_interval(mins => ${ACTIVE_CART_MINUTES})
        and exists (select 1 from cart_items i where i.tenant_id = ${tenantId} and i.cart_id = c.id)
    `;
    return row?.n ?? 0;
  });
}
