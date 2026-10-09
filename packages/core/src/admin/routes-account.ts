import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { accountView } from '../modules/billing/account.ts';
import { validDocument, validEmail } from '../modules/billing/input.ts';
import { heldPlans, publicPlanOr422, requireFeature } from '../modules/billing/plans.ts';
import {
  buyAiPack,
  cancelSubscription,
  lockBilling,
  changeSubscription,
  openSiteRequest,
  reissuePix,
  resumeSubscription,
  runEffects,
  startSubscription,
  type BillingCtx,
} from '../modules/billing/subscriptions.ts';
import { deviceIdOr } from '../modules/payments/store-payments.ts';
import { audit } from './audit.ts';
import { oneOf, text, type AdminCtx, type AdminDeps, type Merchant, type Role } from './context.ts';
import { bodyOf, handlers, isReplay } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { buildSiteTx, reviseSiteTx } from '../modules/site-builder/admin.ts';
import { siteRequestViewTx } from '../modules/site-builder/tasks.ts';

const METHODS = ['card', 'pix'] as const;
const validPayerEmail = (v: unknown) => validEmail(v, 'payerEmail');
const payerDocumentOr = (v: unknown) =>
  v === undefined ? undefined : validDocument(v, 'payerDocument');

// Conta e plano: the plan and its subscription (card assinatura or monthly Pix), invoices,
// the Pangolim own domain and site request. Owner only; every write is idempotent (handlers.write).
export function mountAccount(d: AdminDeps) {
  const { admin } = d;
  const { read, write, named } = handlers(d);
  const queues = new WeakMap<Context, BillingCtx['later']>();
  // a billing write's effects (a superseded Pix cancelled at MP, the owner's messages) wait for
  // the claim tx to commit; a handler that throws rolls them back with its rows
  const billingWrite =
    (role: Role, fn: Parameters<typeof write>[1]) =>
    async (c: AdminCtx): Promise<Response> => {
      const effects: (() => Promise<unknown>)[] = [];
      queues.set(c, (e) => void effects.push(e));
      const res = await write(role, fn)(c);
      void runEffects(effects);
      return res;
    };

  const view = (tx: Sql, t: Tenant) =>
    accountView(tx, t, { storeDomain: d.storeDomain, provider: d.provider, domains: d.domains });
  const ctxFor = (c: Context): BillingCtx => ({
    sql: d.sql,
    provider: d.provider,
    notify: d.notify,
    origin: d.publicOrigin(c),
    later:
      queues.get(c) ??
      (() => {
        throw new Error('billing effects need billingWrite');
      }),
    deviceId: deviceIdOr(c.req.header('x-vendua-device')),
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
    named('account').read('owner', (tx, t) => view(tx, t)),
  );

  admin.post(
    '/account/subscription',
    billingWrite('owner', async (tx, t, m, c) => {
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
    billingWrite('owner', async (tx, t, m, c) => {
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
    billingWrite('owner', async (tx, t, m, c) => {
      billingOn();
      await cancelSubscription(ctxFor(c), tx, t.id);
      await log(tx, t, m, 'subscription.cancel', 'cancelou o plano (vale até o fim do período)');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/subscription/resume',
    billingWrite('owner', async (tx, t, m, c) => {
      billingOn();
      await resumeSubscription(ctxFor(c), tx, t.id, new Date());
      await log(tx, t, m, 'subscription.resume', 'desfez o cancelamento do plano');
      return { status: 200, body: await view(tx, t) };
    }),
  );

  admin.post(
    '/account/invoices/:id/pix',
    billingWrite('owner', async (tx, t, m, c) => {
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
    billingWrite('owner', async (tx, t, m, c) => {
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

  // ── Pangolim: a site made by our agent ───────────────────────────────────
  admin.post(
    '/account/site-request',
    billingWrite('owner', async (tx, t, m, c) => {
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

  // the site builder (Duá's cards replay these, and dry-run them: rows only, never HTTP)
  admin.post(
    '/account/site-request/build',
    named('site.build').write('owner', async (tx, t, m, c) => {
      const body = await bodyOf(c, 32 * 1024);
      const source = isReplay(c) ? 'copilot' : 'owner';
      const task = await buildSiteTx(tx, t.id, { spec: body.spec, source });
      await log(tx, t, m, 'site_request.build', 'aprovou o projeto do site sob medida', {
        taskId: task.id,
        source,
      });
      return { status: 201, body: await siteRequestViewTx(tx, t.id) };
    }),
  );

  admin.post(
    '/account/site-request/revision',
    named('site.revise').write('owner', async (tx, t, m, c) => {
      const body = await bodyOf(c, 32 * 1024);
      const note = text(body.note, 'note', 1000, 3);
      const source = isReplay(c) ? 'copilot' : 'owner';
      const task = await reviseSiteTx(tx, t.id, { note, spec: body.spec, source });
      await log(tx, t, m, 'site_request.revise', 'pediu o ajuste do site sob medida', {
        taskId: task.id,
        note,
        source,
      });
      return { status: 201, body: await siteRequestViewTx(tx, t.id) };
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
