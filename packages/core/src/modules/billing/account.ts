import type { Sql } from '../../platform/db.ts';
import { isPublicHost, storeOrigin } from '../../platform/store-origin.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import type { PaymentProvider } from '../payments/provider.ts';
import { cnameTarget, txtName, txtValue, type CustomDomainRow } from './domains.ts';
import { invoiceView, type InvoiceRow } from './invoices.ts';
import { publicPlans, tenantPlan } from './plans.ts';
import type { SubRow } from './subscriptions.ts';

/** GET /account — the store's plan, subscription, invoices, domains and PRO+ site request. */
export async function accountView(
  tx: Sql,
  t: Pick<Tenant, 'id' | 'slug'>,
  o: { storeDomain: string; provider: PaymentProvider; now?: Date },
) {
  const now = o.now ?? new Date();
  const tenant = (
    await tx<{ created_at: Date }[]>`select created_at from tenants where id = ${t.id}`
  )[0]!;
  const sub = (
    await tx<(SubRow & { pending_name: string | null })[]>`
      select s.*, p.name as pending_name from subscriptions s
        left join plans p on p.id = s.pending_plan_id
      where s.tenant_id = ${t.id}
    `
  )[0];
  const invoices = await tx<(InvoiceRow & { plan_name: string })[]>`
    select i.*, p.name as plan_name from invoices i join plans p on p.id = i.plan_id
    where i.tenant_id = ${t.id}
    order by i.number desc limit 12
  `;
  const hosts = await tx<{ host: string; is_primary: boolean }[]>`
    select host, is_primary from domains where tenant_id = ${t.id}
    order by is_primary desc, length(host), host
  `;
  const custom = (
    await tx<CustomDomainRow[]>`
      select * from custom_domains where tenant_id = ${t.id} order by created_at desc limit 1
    `
  )[0];
  const site = (
    await tx<
      {
        id: string;
        status: string;
        brief: string | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      select id, status, brief, created_at, updated_at from site_requests where tenant_id = ${t.id}
      order by (status in ('requested', 'in_progress')) desc, created_at desc limit 1
    `
  )[0];
  const storeSuffix = `.${o.storeDomain.toLowerCase()}`;
  const domains: {
    host: string;
    kind: 'store' | 'custom';
    status: 'active' | 'pending_dns' | 'dns_ok' | 'failed';
    primary: boolean;
  }[] = hosts
    .filter((h) => isPublicHost(h.host))
    .map((h) => ({
      host: h.host,
      kind: h.host.endsWith(storeSuffix) ? 'store' : 'custom',
      status: 'active',
      primary: h.is_primary,
    }));
  if (custom && custom.status !== 'active' && !domains.some((x) => x.host === custom.host))
    domains.push({ host: custom.host, kind: 'custom', status: custom.status, primary: false });

  return {
    plan: { ...(await tenantPlan(tx, t.id)), since: sub?.created_at ?? tenant.created_at },
    plans: await publicPlans(tx),
    subscription: sub
      ? {
          status: sub.status,
          method: sub.method,
          planId: sub.plan_id,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          pendingPlan: sub.pending_plan_id
            ? { id: sub.pending_plan_id, name: sub.pending_name ?? sub.pending_plan_id }
            : null,
          checkoutUrl:
            sub.method === 'card' && sub.status !== 'cancelled' ? sub.checkout_url : null,
          payerEmail: sub.payer_email,
        }
      : null,
    billing: { available: o.provider.platformConfigured },
    invoices: invoices.map((i) => invoiceView(i, now)),
    address: await storeOrigin(tx, t, o.storeDomain),
    domains,
    customDomain: custom
      ? {
          id: custom.id,
          host: custom.host,
          status: custom.status,
          cnameTarget: cnameTarget(t.slug, o.storeDomain),
          txtName: txtName(custom.host),
          txtValue: txtValue(custom.verify_token),
          lastCheckedAt: custom.last_checked_at,
          lastError: custom.last_error,
        }
      : null,
    siteRequest: site
      ? {
          id: site.id,
          status: site.status,
          brief: site.brief,
          createdAt: site.created_at,
          updatedAt: site.updated_at,
        }
      : null,
  };
}
