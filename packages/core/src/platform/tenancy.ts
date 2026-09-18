import type { Sql } from './db.ts';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
}

/**
 * Host → tenant resolution, the same lookup the edge performs
 * (docs/architecture/01-core.md#multi-tenancy). The public API never accepts a
 * tenant id from the client — identity comes from `Host` / `X-Forwarded-Host`.
 *
 * Matches the full host header first (so `localhost:5174` can pin a tenant in
 * dev), then the bare hostname (`quero-pudim.localhost`, `slug.vendua.com.br`).
 */
export class TenantResolver {
  private cache = new Map<string, { tenant: Tenant | null; at: number }>();

  constructor(
    private sql: Sql,
    private ttlMs = 30_000,
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
      limit 1
    `;
    const tenant = rows[0] ?? null;
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
