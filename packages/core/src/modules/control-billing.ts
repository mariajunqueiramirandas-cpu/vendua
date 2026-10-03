import type { Context, Hono } from 'hono';
import type { MerchantNotify } from '../admin/context.ts';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { billingLog, supersedePix } from './billing/invoices.ts';
import { syncPlanPrices } from './billing/jobs.ts';
import {
  PLAN_FEATURES,
  planHas,
  planView,
  type PlanFeature,
  type PlanFeatures,
  type PlanRow,
} from './billing/plans.ts';
import type { AiPackRow } from './billing/subscriptions.ts';
import { dropPix, lockSub, markInvoicePaid, type BillingCtx } from './billing/subscriptions.ts';
import type { SignupReadiness } from './billing/signup-gate.ts';
import { claimControl, controlTx } from './control.ts';
import type { PaymentProvider } from './payments/provider.ts';

const SITE_STATUSES = ['requested', 'in_progress', 'delivered', 'cancelled'] as const;

// /control/v1 (CRM "Lojas"): every store's plan and billing health, the plan catalog, custom
// domains the team turns on, and Pangolim site requests. Cross-store reads run under controlTx.

/** an optional whole count 0–100000 (conversations); undefined when absent */
function optCount(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000)
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be an integer 0–100000`, { field });
  return v;
}

/** `{ kds: true, … }`: only the known features, each a boolean; merged into the plan's */
function optFeatures(v: unknown): Partial<PlanFeatures> | undefined {
  if (v === undefined) return undefined;
  const bad = () =>
    new HttpError(422, 'BAD_REQUEST', `features takes ${PLAN_FEATURES.join(', ')} as booleans`, {
      field: 'features',
    });
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw bad();
  const out: Partial<PlanFeatures> = {};
  for (const [k, b] of Object.entries(v)) {
    if (!PLAN_FEATURES.includes(k as PlanFeature) || typeof b !== 'boolean') throw bad();
    out[k as PlanFeature] = b;
  }
  return out;
}

export function mountControlBilling(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  provider: PaymentProvider;
  notify?: MerchantNotify;
  /** `<slug>.<storeDomain>` fallback for a store's address (default VENDUA_STORE_DOMAIN) */
  storeDomain?: string;
  signupReady: () => Promise<SignupReadiness>;
}) {
  const { app, sql, controlGate } = o;
  const storeDomain = o.storeDomain ?? process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';
  const adminHost = process.env.VENDUA_ADMIN_HOST?.trim().toLowerCase();
  const billingBase: Omit<BillingCtx, 'later'> = {
    sql,
    provider: o.provider,
    notify: o.notify ?? { whatsapp: async () => {}, email: async () => {} },
    origin: adminHost ? `https://${adminHost}` : null,
  };
  const syncPrices = () =>
    syncPlanPrices(sql, billingBase, new Date()).catch((err) =>
      billingLog.warn({ err }, 'plan price sync failed'),
    );
  const idemKey = (c: Context) => {
    const key = c.req.header('idempotency-key');
    if (!key)
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    return key;
  };

  app.get('/control/v1/billing/stores', async (c) => {
    controlGate(c);
    const stores = await controlTx(sql, async (tx) => {
      const rows = await tx<
        {
          id: string;
          slug: string;
          name: string;
          created_at: Date;
          plan: string;
          plan_name: string | null;
          sub_status: string | null;
          sub_method: string | null;
          sub_period_end: Date | null;
          sub_trial_end: Date | null;
          mp: string | null;
          cd_id: string | null;
          cd_host: string | null;
          cd_status: string | null;
          sr_id: string | null;
          sr_status: string | null;
          sr_brief: string | null;
          sr_note: string | null;
          inv_id: string | null;
          inv_number: number | null;
          inv_amount: number | null;
          inv_kind: string | null;
          inv_start: Date | null;
          inv_due: Date | null;
        }[]
      >`
        select t.id, t.slug, t.name, t.created_at, t.plan, p.name as plan_name,
               s.status as sub_status, s.method as sub_method, s.current_period_end as sub_period_end,
               s.trial_ends_at as sub_trial_end,
               pc.status as mp,
               cd.id as cd_id, cd.host as cd_host, cd.status as cd_status,
               sr.id as sr_id, sr.status as sr_status, sr.brief as sr_brief, sr.staff_note as sr_note,
               inv.id as inv_id, inv.number as inv_number, inv.amount_cents as inv_amount,
               inv.kind as inv_kind, inv.period_start as inv_start, inv.due_at as inv_due
        from tenants t
          left join plans p on p.id = t.plan
          left join subscriptions s on s.tenant_id = t.id
          left join payment_connections pc on pc.tenant_id = t.id
          left join lateral (
            select id, host, status from custom_domains where tenant_id = t.id
            order by created_at desc limit 1
          ) cd on true
          left join lateral (
            select id, status, brief, staff_note from site_requests where tenant_id = t.id
            order by (status in ('requested', 'in_progress')) desc, created_at desc limit 1
          ) sr on true
          -- the oldest plan invoice still to pay: the one "marcar como pago" settles next
          left join lateral (
            select id, number, amount_cents, kind, period_start, due_at from invoices
            where tenant_id = t.id and status in ('open', 'failed') and kind <> 'ai_pack'
            order by period_start, number limit 1
          ) inv on true
        order by t.created_at desc
        limit 500
      `;
      const out = [];
      for (const r of rows)
        out.push({
          tenantId: r.id,
          slug: r.slug,
          name: r.name,
          url: await storeOrigin(tx, r, storeDomain),
          createdAt: r.created_at,
          plan: { id: r.plan, name: r.plan_name ?? 'Plano piloto' },
          subscription: r.sub_status
            ? {
                status: r.sub_status,
                method: r.sub_method,
                currentPeriodEnd: r.sub_period_end,
                trialEndsAt: r.sub_trial_end,
              }
            : null,
          mercadoPago: r.mp,
          customDomain: r.cd_id ? { id: r.cd_id, host: r.cd_host, status: r.cd_status } : null,
          siteRequest: r.sr_id
            ? { id: r.sr_id, status: r.sr_status, brief: r.sr_brief, staffNote: r.sr_note }
            : null,
          openInvoice: r.inv_id
            ? {
                id: r.inv_id,
                number: r.inv_number,
                amountCents: r.inv_amount,
                kind: r.inv_kind,
                periodStart: r.inv_start,
                dueAt: r.inv_due,
              }
            : null,
        });
      return out;
    });
    c.header('cache-control', 'no-store');
    return c.json({ stores });
  });

  const controlPlan = (r: PlanRow) => ({ ...planView(r), public: r.public, sort: r.sort });

  // the CRM's "Cadastro de lojas": the switch (PUT /control/v1/settings/signup) and what else
  // signup waits on, so the team sees why it is closed
  app.get('/control/v1/signup', async (c) => {
    controlGate(c);
    return c.json(await o.signupReady());
  });

  app.get('/control/v1/plans', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) => tx<PlanRow[]>`select * from plans order by sort, price_cents`,
    );
    return c.json({ plans: rows.map(controlPlan) });
  });

  app.patch('/control/v1/plans/:id', async (c) => {
    controlGate(c);
    const id = c.req.param('id');
    if (!/^[a-z0-9_]{2,30}$/.test(id)) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
    const body = await bodyJson(c);
    const name = body.name === undefined ? undefined : body.name;
    if (
      name !== undefined &&
      (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'name must have 2–40 characters', { field: 'name' });
    const price = body.priceCents;
    // a plan charges through Pix/assinatura, which need a positive amount
    if (
      price !== undefined &&
      (typeof price !== 'number' || !Number.isInteger(price) || price < 100 || price > 10_000_000)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'priceCents must be an integer 100–10000000', {
        field: 'priceCents',
      });
    if (body.public !== undefined && typeof body.public !== 'boolean')
      throw new HttpError(422, 'BAD_REQUEST', 'public must be true or false', { field: 'public' });
    // a new store's free days before the first charge (ADR 0025); stores already on it keep theirs
    const trial = body.trialDays;
    if (
      trial !== undefined &&
      (typeof trial !== 'number' || !Number.isInteger(trial) || trial < 0 || trial > 60)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'trialDays must be an integer 0–60', {
        field: 'trialDays',
      });
    // the Vendedor's conversations a paid month and a trial include (ADR 0032)
    const aiMonth = optCount(body.aiConversations, 'aiConversations');
    const aiTrial = optCount(body.aiTrialConversations, 'aiTrialConversations');
    if (body.recommended !== undefined && typeof body.recommended !== 'boolean')
      throw new HttpError(422, 'BAD_REQUEST', 'recommended must be true or false', {
        field: 'recommended',
      });
    // shown but closed: stores can't pick it until staff open it (Pangolim waits on own domains)
    if (body.available !== undefined && typeof body.available !== 'boolean')
      throw new HttpError(422, 'BAD_REQUEST', 'available must be true or false', {
        field: 'available',
      });
    const features = optFeatures(body.features);
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      // a signup creating a store on this plan holds this lock shared: closing waits for it
      if (body.available !== undefined)
        await tx`select pg_advisory_xact_lock(hashtextextended(${`plan-available:${id}`}, 0))`;
      // at most one plan leads: recommending this one takes it off the other (one at a time, so
      // two staff picking different plans can't trip the unique index)
      if (body.recommended === true) {
        await tx`select pg_advisory_xact_lock(hashtextextended('plans:recommended', 0))`;
        await tx`update plans set recommended = false, updated_at = now() where recommended and id <> ${id}`;
      }
      const row = (
        await tx<PlanRow[]>`
          update plans set
            name = ${typeof name === 'string' ? name.trim() : tx`name`},
            price_cents = ${typeof price === 'number' ? price : tx`price_cents`},
            public = ${typeof body.public === 'boolean' ? body.public : tx`public`},
            trial_days = ${typeof trial === 'number' ? trial : tx`trial_days`},
            recommended = ${typeof body.recommended === 'boolean' ? body.recommended : tx`recommended`},
            ai_conversations = ${aiMonth ?? tx`ai_conversations`},
            ai_trial_conversations = ${aiTrial ?? tx`ai_trial_conversations`},
            available = ${typeof body.available === 'boolean' ? body.available : tx`available`},
            features = ${features ? tx`features || ${tx.json(features as never)}` : tx`features`},
            updated_at = now()
          where id = ${id}
          returning *
        `
      )[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'plan not found');
      // signup preselects the recommended plan, so it must be one a store can pick
      if (row.recommended && !row.available)
        throw new HttpError(409, 'RECOMMENDED_PLAN_CLOSED', 'the recommended plan must stay open', {
          field: body.available === false ? 'available' : 'recommended',
        });
      // stores on it see what is open and their Vendedor limits change: their admins refetch
      if (
        features ||
        aiMonth !== undefined ||
        aiTrial !== undefined ||
        body.available !== undefined
      ) {
        const stores = await tx<{ id: string }[]>`select id from tenants where plan = ${id}`;
        for (const s of stores) await emitAdminTx(tx, s.id, 'billing', 'plan');
      }
      return { status: 200, body: { plan: controlPlan(row) } };
    });
    // a new price applies to future charges; the billing job repeats this every tick
    if (typeof price === 'number' && !res.replayed) setTimeout(() => void syncPrices(), 0);
    return c.json(res.body, res.status as 200);
  });

  const controlPack = (r: AiPackRow) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    conversations: r.conversations,
    public: r.public,
    sort: r.sort,
  });

  app.get('/control/v1/ai-packs', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) => tx<AiPackRow[]>`select * from ai_packs order by sort, price_cents`,
    );
    return c.json({ packs: rows.map(controlPack) });
  });

  // a pack's price applies to packs bought afterwards; an open pack invoice keeps its amount
  app.patch('/control/v1/ai-packs/:id', async (c) => {
    controlGate(c);
    const id = c.req.param('id');
    if (!/^[a-z0-9_]{2,30}$/.test(id)) throw new HttpError(404, 'NOT_FOUND', 'pack not found');
    const body = await bodyJson(c);
    const name = body.name;
    if (
      name !== undefined &&
      (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 40)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'name must have 2–40 characters', { field: 'name' });
    const price = body.priceCents;
    if (
      price !== undefined &&
      (typeof price !== 'number' || !Number.isInteger(price) || price < 100 || price > 10_000_000)
    )
      throw new HttpError(422, 'BAD_REQUEST', 'priceCents must be an integer 100–10000000', {
        field: 'priceCents',
      });
    const n = optCount(body.conversations, 'conversations');
    if (n === 0)
      throw new HttpError(422, 'BAD_REQUEST', 'conversations must be 1–100000', {
        field: 'conversations',
      });
    if (body.public !== undefined && typeof body.public !== 'boolean')
      throw new HttpError(422, 'BAD_REQUEST', 'public must be true or false', { field: 'public' });
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const row = (
        await tx<AiPackRow[]>`
          update ai_packs set
            name = ${typeof name === 'string' ? name.trim() : tx`name`},
            price_cents = ${typeof price === 'number' ? price : tx`price_cents`},
            conversations = ${n ?? tx`conversations`},
            public = ${typeof body.public === 'boolean' ? body.public : tx`public`},
            updated_at = now()
          where id = ${id}
          returning *
        `
      )[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'pack not found');
      return { status: 200, body: { pack: controlPack(row) } };
    });
    return c.json(res.body, res.status as 200);
  });

  // Payment received outside Mercado Pago (access-code signups, a transfer): the invoice is paid
  // exactly as a settled Pix would be — the first one activates the plan and opens the store.
  app.post('/control/v1/billing/invoices/:id/mark-paid', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const effects: (() => Promise<unknown>)[] = [];
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const inv = (
        await tx<
          { tenant_id: string; status: string; kind: string; provider_payment_id: string | null }[]
        >`
          select tenant_id, status, kind, provider_payment_id from invoices where id = ${id}
        `
      )[0];
      if (!inv) throw new HttpError(404, 'NOT_FOUND', 'invoice not found');
      if (inv.status === 'paid') throw new HttpError(409, 'INVOICE_PAID', 'already paid');
      if (inv.status === 'void')
        throw new HttpError(409, 'INVOICE_VOID', 'this invoice was voided');
      // the store's own tables (settings, plan) are tenant-scoped: act as the store from here
      await tx`select set_config('vendua.tenant_id', ${inv.tenant_id}, true)`;
      const now = new Date();
      const ctx: BillingCtx = { ...billingBase, later: (fn) => void effects.push(fn) };
      // never two ways to pay one month: MP's card assinatura would still charge this period,
      // and a Pix already issued for it is cancelled (still matchable if paid anyway)
      const sub = await lockSub(tx, inv.tenant_id);
      if (inv.kind === 'period' && sub?.method === 'card' && sub.provider_subscription_id)
        throw new HttpError(
          409,
          'CARD_SUBSCRIPTION',
          'Mercado Pago charges this store by card — cancel that first',
        );
      if (inv.provider_payment_id) {
        dropPix(ctx)(inv.provider_payment_id);
        await tx`
          update invoices set ${supersedePix(tx)}, provider_payment_id = null,
            pix_copy_paste = null, pix_expires_at = null
          where id = ${id}
        `;
      }
      if (!(await markInvoicePaid(ctx, tx, inv.tenant_id, id, now, now, { method: 'manual' })))
        throw new HttpError(409, 'INVOICE_PAID', 'already paid');
      return { status: 200, body: { ok: true } };
    });
    for (const fn of effects)
      await fn().catch((err) => billingLog.warn({ err }, 'billing effect failed'));
    return c.json(res.body, res.status as 200);
  });

  app.post('/control/v1/custom-domains/:id/activate', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      const row = (
        await tx<{ tenant_id: string; host: string; status: string }[]>`
          select tenant_id, host, status from custom_domains where id = ${id} for update
        `
      )[0];
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'custom domain not found');
      if (row.status !== 'dns_ok' && row.status !== 'active')
        throw new HttpError(409, 'DOMAIN_NOT_VERIFIED', 'the domain DNS is not verified yet', {
          status: row.status,
        });
      const owner = (
        await tx<{ tenant_id: string }[]>`select tenant_id from domains where host = ${row.host}`
      )[0];
      if (owner && owner.tenant_id !== row.tenant_id)
        throw new HttpError(409, 'DOMAIN_TAKEN', 'another store already serves this host');
      // a store whose plan dropped the domain (or never paid for it) doesn't get it switched on
      if (!(await planHas(tx, row.tenant_id, 'customDomain')))
        throw new HttpError(403, 'PLAN_REQUIRED', "the store's plan does not include a domain", {
          feature: 'customDomain',
        });
      await tx`select activate_custom_domain(${row.tenant_id}, ${row.host})`;
      await emitAdminTx(tx, row.tenant_id, 'billing');
      await emitAdminTx(tx, row.tenant_id, 'store');
      return { status: 200, body: { ok: true } };
    });
    return c.json(res.body, res.status as 200);
  });

  app.patch('/control/v1/site-requests/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    if (typeof body.status !== 'string' || !SITE_STATUSES.includes(body.status as never))
      throw new HttpError(422, 'BAD_REQUEST', `status must be one of ${SITE_STATUSES.join(', ')}`, {
        field: 'status',
      });
    const status = body.status;
    const note = body.staffNote;
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500))
      throw new HttpError(422, 'BAD_REQUEST', 'staffNote must be text up to 500 characters', {
        field: 'staffNote',
      });
    const res = await claimControl(sql, idemKey(c), async (tx) => {
      let row: { tenant_id: string } | undefined;
      try {
        row = (
          await tx<{ tenant_id: string }[]>`
            update site_requests set status = ${status},
              staff_note = ${note === undefined ? tx`staff_note` : note === null ? null : note.trim() || null},
              updated_at = now()
            where id = ${id}
            returning tenant_id
          `
        )[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(
            409,
            'SITE_REQUEST_OPEN',
            'the store already has an open site request',
          );
        throw err;
      }
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'site request not found');
      await emitAdminTx(tx, row.tenant_id, 'billing');
      return { status: 200, body: { ok: true } };
    });
    return c.json(res.body, res.status as 200);
  });
}
