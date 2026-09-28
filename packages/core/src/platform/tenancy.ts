import type { Sql } from './db.ts';
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
export class TenantResolver {
  private cache = new Map<string, { tenant: Tenant | null; at: number }>();

  constructor(
    private sql: Sql,
    private ttlMs = 30_000,
    private storeDomain?: string,
    /** hosts under storeDomain that are never a store (the admin's own domain) */
    private reserved: string[] = [],
  ) {}

  async resolve(hostHeader: string): Promise<Tenant | null> {
    const host = hostHeader.trim().toLowerCase();
    const cached = this.cache.get(host);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.tenant;

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
    this.cache.set(host, { tenant, at: Date.now() });
    return tenant;
  }

  async resolveBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.sql<Tenant[]>`
      select id, slug, name, status from tenants where slug = ${slug} limit 1
    `;
    return rows[0] ?? null;
  }
}
