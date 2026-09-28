import type { Sql } from './db.ts';

// The only place a store's public address is built (docs/architecture/01-core.md#multi-tenancy).
// Order: the primary domains row, any other public row, then `<slug>.<storeDomain>` — which
// TenantResolver also routes, so even the fallback is a link that opens the store.

/** dev and loopback hosts (quero-pudim.localhost, localhost:5174, 127.0.0.1:5174) */
export function isPublicHost(host: string) {
  return !/(^|\.)localhost(:|$)/.test(host) && !/^127\./.test(host) && !host.includes(':');
}

export async function storeOrigin(
  tx: Sql,
  tenant: { id: string; slug: string },
  storeDomain: string,
): Promise<string> {
  const rows = await tx<{ host: string }[]>`
    select host from domains where tenant_id = ${tenant.id}
    order by is_primary desc, length(host), host
  `;
  const host = rows.map((r) => r.host).find(isPublicHost) ?? `${tenant.slug}.${storeDomain}`;
  return `https://${host}`;
}

/** `<slug>` when host is a single label under storeDomain, else null */
export function slugFromStoreHost(hostname: string, storeDomain: string | undefined) {
  if (!storeDomain) return null;
  const suffix = `.${storeDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(label) ? label : null;
}
