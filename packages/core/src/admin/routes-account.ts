import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { accountView } from '../modules/billing/account.ts';
import {
  checkCustomDomain,
  hostTaken,
  newVerifyToken,
  normalizeHost,
} from '../modules/billing/domains.ts';
import { validDocument, validEmail } from '../modules/billing/input.ts';
import { heldPlans, publicPlanOr422, requireFeature } from '../modules/billing/plans.ts';
import {
  afterResponse,
  buyAiPack,
  cancelSubscription,
  lockBilling,
  changeSubscription,
  openSiteRequest,
  reissuePix,
  resumeSubscription,
  startSubscription,
  type BillingCtx,
} from '../modules/billing/subscriptions.ts';
import { audit } from './audit.ts';
import { oneOf, text, type AdminDeps, type Merchant } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';

const METHODS = ['card', 'pix'] as const;
const validPayerEmail = (v: unknown) => validEmail(v, 'payerEmail');
const payerDocumentOr = (v: unknown) =>
  v === undefined ? undefined : validDocument(v, 'payerDocument');

// Conta e plano: the plan and its subscription (card assinatura or monthly Pix), invoices,
// the Pangolim own domain and site request. Owner only; every write is idempotent (handlers.write).
export function mountAccount(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  const view = (tx: Sql, t: Tenant) =>
    accountView(tx, t, { storeDomain: d.storeDomain, provider: d.provider });
  const ctxFor = (c: Context): BillingCtx => ({
    sql: d.sql,
    provider: d.provider,
    notify: d.notify,
    origin: d.publicOrigin(c),
    later: afterResponse,
  });
  const billingOn = () => {
    if (!d.provider.platformConfigured)
      throw new HttpError(503, 'BILLING_UNAVAILABLE', 'plan billing is not set up on this install');
  };
  const idemKey = (c: Context) => c.req.header('idempotency-key') ?? crypto.randomUUID();
  const log = (tx: Sql, t: Tenant, m: Merchant, action: string, summary: string, after?: unknown) =>
    audit(tx, t.id, m, { action, entity: 'account', entityId: t.id, summary, after });

  admin.get(
    '/account',
    read('owner', (tx, t) => view(tx, t)),
  );

  admin.post(
    '/account/subscription',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      const body = await bodyJson(c);
      const plan = await publicPlanOr422(tx, body.planId, await heldPlans(tx, t.id));
      const method = oneOf(body.method, 'method', METHODS);
      const payerEmail = validPayerEmail(body.payerEmail);
      // starting a plan issues its first Pix at once: it needs the document, as signup does
      const payerDocument = validDocument(body.payerDocument, 'payerDocument');
      await startSubscription(ctxFor(c), tx, t.id, {
        plan,
        method,
        payerEmail,
        payerDocument,
        key: idemKey(c),
        now: new Date(),
      });
      await log(tx, t, m, 'subscription.start', `assinou o plano ${plan.name} (${method})`, {
        planId: plan.id,
        method,
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.patch(
    '/account/subscription',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      const body = await bodyJson(c);
      const plan =
        body.planId === undefined
          ? undefined
          : await publicPlanOr422(tx, body.planId, await heldPlans(tx, t.id));
      const method = body.method === undefined ? undefined : oneOf(body.method, 'method', METHODS);
      const payerEmail =
        body.payerEmail === undefined ? undefined : validPayerEmail(body.payerEmail);
      const payerDocument = payerDocumentOr(body.payerDocument);
      const { before, after } = await changeSubscription(ctxFor(c), tx, t.id, {
        plan,
        method,
        payerEmail,
        payerDocument,
        key: idemKey(c),
        now: new Date(),
      });
      const parts = [
        plan &&
          (after.upgrade_plan_id === plan.id
            ? `pediu ${plan.name} (muda quando a diferença for paga)`
            : after.pending_plan_id === plan.id
              ? `trocou para ${plan.name} no fim do período`
              : `trocou para ${plan.name}`),
        method && `pagamento por ${method === 'card' ? 'cartão' : 'Pix'}`,
        payerEmail && 'email de cobrança',
        payerDocument && 'CPF/CNPJ de cobrança',
      ].filter(Boolean);
      await audit(tx, t.id, m, {
        action: 'subscription.change',
        entity: 'account',
        entityId: t.id,
        summary: `plano: ${parts.join(', ') || 'sem mudança'}`,
        before: {
          planId: before.plan_id,
          pendingPlanId: before.pending_plan_id,
          method: before.method,
        },
        after: {
          planId: after.plan_id,
          pendingPlanId: after.pending_plan_id,
          upgradePlanId: after.upgrade_plan_id,
          method: after.method,
        },
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/subscription/cancel',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      await cancelSubscription(ctxFor(c), tx, t.id);
      await log(tx, t, m, 'subscription.cancel', 'cancelou o plano (vale até o fim do período)');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/subscription/resume',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      await resumeSubscription(ctxFor(c), tx, t.id, new Date());
      await log(tx, t, m, 'subscription.resume', 'desfez o cancelamento do plano');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/invoices/:id/pix',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      const id = uuidParam(c, 'id');
      const inv = await reissuePix(ctxFor(c), tx, t.id, id, new Date());
      await audit(tx, t.id, m, {
        action: 'invoice.pix',
        entity: 'invoice',
        entityId: inv.id,
        summary: `gerou o Pix da fatura ${inv.number}`,
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  // the Vendedor's extra conversations (ADR 0032): a one-off Pix, credited when it is paid
  admin.post(
    '/account/ai-packs',
    write('owner', async (tx, t, m, c) => {
      billingOn();
      const body = await bodyJson(c, 1024);
      const inv = await buyAiPack(ctxFor(c), tx, t.id, body.packId, new Date(), {
        priceCents: body.priceCents,
        conversations: body.conversations,
      });
      await audit(tx, t.id, m, {
        action: 'ai_pack.buy',
        entity: 'invoice',
        entityId: inv.id,
        summary: `pediu um pacote de conversas do Duá (fatura ${inv.number})`,
        after: { packId: inv.ai_pack_id, amountCents: inv.amount_cents },
      });
      return { status: 200, body: { invoiceId: inv.id, ...(await view(tx, t)) } };
    }),
  );

  // ── Pangolim: own domain ─────────────────────────────────────────────────
  admin.post(
    '/account/domains',
    write('owner', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'customDomain');
      const body = await bodyJson(c);
      const host = normalizeHost(body.host, d.storeDomain);
      await lockBilling(tx, t.id);
      const current = (
        await tx<{ id: string; host: string; status: string }[]>`
          select id, host, status from custom_domains where tenant_id = ${t.id} for update
        `
      )[0];
      if (current?.host === host) {
        // trying again after giving up: a fresh week to set the DNS (same TXT token)
        if (current.status === 'failed' && !(await hostTaken(d.sql, host, t.id)))
          await tx`
            update custom_domains set status = 'pending_dns', created_at = now(), last_error = null
            where id = ${current.id}
          `;
        return { status: 200, body: await view(tx, t) };
      }
      if (current?.status === 'active')
        throw new HttpError(409, 'DOMAIN_ACTIVE', 'the store already serves its own domain');
      if (await hostTaken(d.sql, host, t.id))
        throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
          field: 'host',
        });
      // one own domain per store: a new one replaces one that never went live
      if (current) await tx`delete from custom_domains where id = ${current.id}`;
      let row: { id: string };
      try {
        row = (
          await tx<{ id: string }[]>`
            insert into custom_domains (tenant_id, host, verify_token)
            values (${t.id}, ${host}, ${newVerifyToken()})
            returning id
          `
        )[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'DOMAIN_TAKEN', 'this domain is in use by another store', {
            field: 'host',
          });
        throw err;
      }
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.add',
        entity: 'custom_domain',
        entityId: row.id,
        summary: `adicionou o domínio ${host}`,
        before: current ? { host: current.host } : null,
        after: { host },
      });
      return { status: 201, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/domains/:id/check',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<{ host: string }[]>`
          select host from custom_domains where tenant_id = ${t.id} and id = ${id}
        `
      )[0];
      if (!row) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
      // its own tx (DNS answers can take seconds); the result lands before we read the view
      await checkCustomDomain(d.sql, {
        tenantId: t.id,
        domainId: id,
        storeDomain: d.storeDomain,
        now: new Date(),
        manual: true,
      });
      await audit(tx, t.id, m, {
        action: 'domain.check',
        entity: 'custom_domain',
        entityId: id,
        summary: `verificou o domínio ${row.host}`,
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.delete(
    '/account/domains/:id',
    write('owner', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const row = (
        await tx<{ host: string; status: string }[]>`
          select host, status from custom_domains where tenant_id = ${t.id} and id = ${id} for update
        `
      )[0];
      if (!row) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'domain not found');
      // a live domain is the store's primary address — the team takes it down with the TLS
      if (row.status === 'active')
        throw new HttpError(409, 'DOMAIN_ACTIVE', 'a live domain is removed by the Venduá team');
      await tx`delete from custom_domains where tenant_id = ${t.id} and id = ${id}`;
      await emitAdminTx(tx, t.id, 'billing');
      await audit(tx, t.id, m, {
        action: 'domain.remove',
        entity: 'custom_domain',
        entityId: id,
        summary: `removeu o domínio ${row.host}`,
        before: row,
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );

  // ── Pangolim: a site made by our agent ───────────────────────────────────
  admin.post(
    '/account/site-request',
    write('owner', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'customSite');
      const body = await bodyJson(c);
      const brief = text(body.brief, 'brief', 2000, 3);
      const updated = await tx`
        update site_requests set brief = ${brief}, updated_at = now()
        where tenant_id = ${t.id} and status in ('requested', 'in_progress')
      `;
      if (!updated.count) await openSiteRequest(ctxFor(c), tx, t.id, brief);
      // a request opened at checkout has no brief yet — the team hears when it arrives
      else await siteBriefEventTx(tx, t, brief);
      await emitAdminTx(tx, t.id, 'billing');
      await log(tx, t, m, 'site_request.create', 'pediu o site sob medida', { brief });
      return { status: updated.count ? 200 : 201, body: await view(tx, t) };
    }),
  );

  admin.patch(
    '/account/site-request',
    write('owner', async (tx, t, m, c) => {
      await requireFeature(tx, t.id, 'customSite');
      const body = await bodyJson(c);
      const brief = text(body.brief, 'brief', 2000, 3);
      const updated = await tx`
        update site_requests set brief = ${brief}, updated_at = now()
        where tenant_id = ${t.id} and status in ('requested', 'in_progress')
      `;
      if (!updated.count)
        throw new HttpError(404, 'SITE_REQUEST_NOT_FOUND', 'there is no open site request');
      await siteBriefEventTx(tx, t, brief);
      await emitAdminTx(tx, t.id, 'billing');
      await log(tx, t, m, 'site_request.update', 'atualizou o pedido de site sob medida', {
        brief,
      });
      return { status: 200, body: await view(tx, t) };
    }),
  );
}

function siteBriefEventTx(tx: Sql, t: { id: string; name: string }, brief: string) {
  return recordStaffEventTx(
    tx,
    'store.request',
    { storeName: t.name, title: 'briefing do site sob medida', detail: brief },
    { tenantId: t.id },
  );
}
