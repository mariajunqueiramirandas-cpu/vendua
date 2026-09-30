import type { Sql } from './db.ts';
import { log } from './log.ts';
import { slugFromStoreHost } from './store-origin.ts';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
}

// Host → tenant (docs/architecture/01-core.md#multi-tenancy). The public API
// never accepts a client tenant id — identity comes from Host/X-Forwarded-Host.
// Full host matches first (dev can pin a tenant via `localhost:5174`), then bare hostname,
// then `<slug>.<storeDomain>` — the address storeOrigin falls back to must always resolve.
const CACHE_MAX = 10_000;
// a miss is cached briefly — enough to absorb a burst, short enough that random Hosts churn out
const MISS_TTL_MS = 5_000;
// a hit past its TTL is still served for this long while one lookup refreshes it behind the
// request — no storefront request waits on the tenant query once a host has been seen
const STALE_MAX_MS = 5 * 60_000;
// RFC 1035 name (≤253) or a bracketed IPv6 literal, optional port
const HOST_RE = /^(?:[a-z0-9_](?:[a-z0-9_.-]{0,252})|\[[0-9a-f:.]{2,45}\])(?::\d{1,5})?$/;

/** A Host header we'll look up at all: bounded length and hostname characters only. */
export function validHost(host: string): boolean {
  return host.length <= 253 + 6 && HOST_RE.test(host);
}

export class TenantResolver {
  private cache = new Map<string, { tenant: Tenant | null; at: number }>();
  // one lookup per host at a time: a burst on a cold or expiring host shares it
  private inflight = new Map<string, Promise<Tenant | null>>();

  constructor(
    private sql: Sql,
    private ttlMs = 30_000,
    private storeDomain?: string,
    /** hosts under storeDomain that are never a store (the admin's own domain) */
    private reserved: string[] = [],
  ) {}

  async resolve(hostHeader: string): Promise<Tenant | null> {
    const host = hostHeader.trim().toLowerCase();
    if (!validHost(host)) return null;
    const cached = this.cache.get(host);
    if (cached) {
      const age = Date.now() - cached.at;
      if (age < (cached.tenant ? this.ttlMs : Math.min(this.ttlMs, MISS_TTL_MS))) {
        return cached.tenant;
      }
      if (cached.tenant && age < STALE_MAX_MS) {
        this.lookup(host).catch((err) =>
          log.warn({ mod: 'tenancy', err, host }, 'tenant refresh failed'),
        );
        return cached.tenant;
      }
    }
    return this.lookup(host);
  }

  private lookup(host: string): Promise<Tenant | null> {
    let pending = this.inflight.get(host);
    if (!pending) {
      pending = this.query(host).finally(() => this.inflight.delete(host));
      this.inflight.set(host, pending);
    }
    return pending;
  }

  private async query(host: string): Promise<Tenant | null> {
    const hostname = host.split(':')[0] ?? host;
    const rows = await this.sql<Tenant[]>`
      select t.id, t.slug, t.name, t.status
      from domains d join tenants t on t.id = d.tenant_id
      where d.host in (${host}, ${hostname})
      order by (d.host = ${host}) desc
      limit 1
    `;
    let tenant = rows[0] ?? null;
    const slug =
      tenant || this.reserved.includes(hostname)
        ? null
        : slugFromStoreHost(hostname, this.storeDomain);
    if (slug) tenant = await this.resolveBySlug(slug);
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(host, { tenant, at: Date.now() });
    return tenant;
  }

  /** a store this host resolved to recently, without querying — for sync callers */
  peek(hostHeader: string): Tenant | null {
    const hit = this.cache.get(hostHeader.trim().toLowerCase());
    return hit && Date.now() - hit.at < this.ttlMs ? hit.tenant : null;
  }

  /** entries held — exposed for the bound's regression test */
  get cacheSize(): number {
    return this.cache.size;
  }

  async resolveBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.sql<Tenant[]>`
      select id, slug, name, status from tenants where slug = ${slug} limit 1
    `;
    return rows[0] ?? null;
  }
}
