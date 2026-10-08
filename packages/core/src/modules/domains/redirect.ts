import type { Sql } from '../../platform/db.ts';
import { platformHost } from '../../platform/store-origin.ts';

/**
 * A host the edge answers with a redirect instead of a store (ADR 0038): the www./root alias of
 * a live domain goes to the domain; the alias of one under repair, and a lapsed domain (and its
 * alias), to the store's platform host.
 * Called under controlTx by /edge/v1/resolve for hosts that aren't in `domains`.
 */
export async function customRedirect(
  tx: Sql,
  host: string,
  storeDomain: string,
): Promise<{
  tenant: { id: string; slug: string; status: string };
  redirect: { to: string; permanent: boolean };
} | null> {
  const r = (
    await tx<
      {
        host: string;
        alias_host: string | null;
        status: string;
        tenant_id: string;
        slug: string;
        tstatus: string;
      }[]
    >`
      select d.host, d.alias_host, d.status, d.tenant_id, t.slug, t.status as tstatus
      from custom_domains d join tenants t on t.id = d.tenant_id
      where (d.alias_host = ${host} and d.alias_ok and d.status in ('active', 'repairing'))
        or ((d.host = ${host} or d.alias_host = ${host}) and d.status = 'lapsed')
      order by (d.status = 'lapsed') limit 1
    `
  )[0];
  if (!r) return null;
  // a live domain's alias goes to it for good; under repair or lapsed, the store's own address
  // for now (the domain itself may point elsewhere)
  const live = r.status === 'active';
  const to = live ? `https://${r.host}` : `https://${platformHost(r.slug, storeDomain)}`;
  return {
    tenant: { id: r.tenant_id, slug: r.slug, status: r.tstatus },
    redirect: { to, permanent: live },
  };
}
