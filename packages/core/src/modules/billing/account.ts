import type { Sql } from '../../platform/db.ts';
import { isPublicHost, storeOrigin } from '../../platform/store-origin.ts';
import type { Tenant } from '../../platform/tenancy.ts';
import { platformPublicKey } from '../payments/index.ts';
import type { PaymentProvider } from '../payments/provider.ts';
import { latestOrder, orderView } from '../domains/orders.ts';
import type { DnsRecord, DomainProviders } from '../domains/providers.ts';
import {
  cnameTarget,
  txtName,
  txtValue,
  type CustomDomainRow,
  type CustomDomainStatus,
} from './domains.ts';
import { invoiceView, type InvoiceRow } from './invoices.ts';
import { aiAllowanceTx } from './ai-allowance.ts';
import { publicPlans, tenantPlan } from './plans.ts';
import { publicAiPacks, upgradeLive, type SubRow } from './subscriptions.ts';

/** GET /account — the store's plan, subscription, Vendedor conversations, invoices, domains and
 *  the Pangolim site request. */
export async function accountView(
  tx: Sql,
  t: Pick<Tenant, 'id' | 'slug'>,
  o: { storeDomain: string; provider: PaymentProvider; domains?: DomainProviders; now?: Date },
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
  // the last 12, plus anything still to pay however old: a plan month or the open pack
  const invoices = await tx<
    (InvoiceRow & { plan_name: string; ai_pack_name: string | null; ai_credited: boolean })[]
  >`
    select i.*, p.name as plan_name, a.name as ai_pack_name,
           exists (select 1 from ai_credits c where c.invoice_id = i.id) as ai_credited
    from invoices i
      join plans p on p.id = i.plan_id
      left join ai_packs a on a.id = i.ai_pack_id
    where i.tenant_id = ${t.id}
      and (i.id in (select id from invoices where tenant_id = ${t.id} order by number desc limit 12)
           or i.status in ('open', 'failed'))
    order by i.number desc
  `;
  const upInv = sub?.upgrade_invoice_id
    ? (
        await tx<(InvoiceRow & { plan_name: string })[]>`
          select i.*, p.name as plan_name from invoices i join plans p on p.id = i.plan_id
          where i.tenant_id = ${t.id} and i.id = ${sub.upgrade_invoice_id}
        `
      )[0]
    : undefined;
  const hosts = await tx<{ host: string; is_primary: boolean }[]>`
    select host, is_primary from domains where tenant_id = ${t.id}
    order by is_primary desc, length(host), host
  `;
  const custom = (
    await tx<CustomDomainRow[]>`
      select * from custom_domains where tenant_id = ${t.id} and status <> 'removing'
      order by created_at desc limit 1
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
    status: Exclude<CustomDomainStatus, 'removing'>;
    primary: boolean;
  }[] = hosts
    .filter((h) => isPublicHost(h.host))
    .map((h) => ({
      host: h.host,
      kind: h.host.endsWith(storeSuffix) ? 'store' : 'custom',
      status: 'active',
      primary: h.is_primary,
    }));
  for (const x of domains)
    if (custom && x.host === custom.host && custom.status !== 'removing') x.status = custom.status;
  if (custom && custom.status !== 'active' && !domains.some((x) => x.host === custom.host))
    domains.push({
      host: custom.host,
      kind: 'custom',
      status: custom.status as Exclude<CustomDomainStatus, 'removing'>,
      primary: false,
    });
  const order = await latestOrder(tx, t.id, now);
  const dp = o.domains;

  return {
    plan: { ...(await tenantPlan(tx, t.id)), since: sub?.created_at ?? tenant.created_at },
    plans: await publicPlans(tx),
    // the Vendedor's conversations this month (or trial), and the packs that add to them
    ai: await aiAllowanceTx(tx, t.id, now),
    aiPacks: await publicAiPacks(tx),
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
          // pay this invoice (its Pix, or POST /account/invoices/:id/pix) and the plan changes
          pendingUpgrade:
            upInv && upgradeLive(sub, upInv, now)
              ? {
                  planId: upInv.plan_id,
                  planName: upInv.plan_name,
                  amountCents: upInv.amount_cents,
                  until: upInv.period_end,
                  invoice: invoiceView(upInv, now),
                }
              : null,
          checkoutUrl:
            sub.method === 'card' && sub.status !== 'cancelled' ? sub.checkout_url : null,
          payerEmail: sub.payer_email,
          payerDocument: sub.payer_document,
          // the free trial's end (ADR 0025): the store's first charge, kept after it converts
          trialEndsAt: sub.trial_ends_at,
        }
      : null,
    billing: {
      available: o.provider.platformConfigured,
      publicKey: platformPublicKey(o.provider),
    },
    invoices: invoices.map((i) => invoiceView(i, now)),
    address: await storeOrigin(tx, t, o.storeDomain),
    domains,
    customDomain: custom
      ? {
          id: custom.id,
          host: custom.host,
          status: custom.status,
          source: custom.source,
          method: custom.method,
          aliasHost: custom.alias_host,
          cnameTarget: cnameTarget(t.slug, o.storeDomain),
          txtName: txtName(custom.host),
          txtValue: txtValue(custom.verify_token),
          nameServers: custom.name_servers,
          records: (custom.records ?? []) as DnsRecord[],
          recordsConfirmed: custom.records_confirmed_at !== null,
          dnssecSigned: custom.dnssec_signed,
          expiresAt: custom.expires_at,
          lastCheckedAt: custom.last_checked_at,
          lastError: custom.last_error,
        }
      : null,
    domainOrder: order ? orderView(order, dp?.providerName ?? null) : null,
    domainOptions: {
      delegation: !!(dp?.dnsHost && dp.edge),
      purchase: !!(dp?.dnsHost && dp.edge && dp.registrar),
      edgeIpv4: dp?.edge?.ipv4 ?? null,
    },
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
