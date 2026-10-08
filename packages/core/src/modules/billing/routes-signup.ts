import type { Context, Hono } from 'hono';
import { audit } from '../../admin/audit.ts';
import {
  createSession,
  membershipsFor,
  setAdminCookie,
  validAdminPhone,
  type Membership,
} from '../../admin/auth.ts';
import { text, type AdminApp, type AdminDeps, type Merchant } from '../../admin/context.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError, bodyJson, clientIp, windowCounter } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { platformHost, storeOrigin } from '../../platform/store-origin.ts';
import { phoneVariants } from '../../store-whatsapp/text.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { mountBillingDev } from './dev-routes.ts';
import { validDocument, validEmail } from './input.ts';
import {
  heldPlans,
  openOr409,
  planRow,
  publicPlanOr422,
  publicPlans,
  type PlanRow,
} from './plans.ts';
import {
  accessCodeMatches,
  normalizeSlug,
  readSignupToken,
  RESERVED_SLUGS,
  segmentOr422,
  signupAccessCode,
  phoneHadTrial,
  phoneLockKey,
  signupToken,
  slugStatus,
  startSignupOtp,
  verifySignupOtp,
} from './signup.ts';
import {
  beginPayment,
  lockSub,
  recordBillingProblem,
  reissueOpenPix,
  startSubscription,
  startTrial,
  withEffects,
  type PayNext,
} from './subscriptions.ts';
import { FakeProvider } from '../payments/fake.ts';
import { platformPublicKey } from '../payments/index.ts';
import { ProviderError } from '../payments/provider.ts';
import { deviceIdOr } from '../payments/store-payments.ts';

const signupLog = log.child({ mod: 'signup' });

/** stores one phone may open per rolling day */
const STORES_PER_PHONE_PER_DAY = 3;

const storeRef = (m: Membership) => ({ id: m.tenant_id, slug: m.slug, name: m.name, role: m.role });

function ipFlags() {
  const hops = Number(process.env.VENDUA_PROXY_HOPS ?? '0');
  return {
    trustForwardedFor: process.env.VENDUA_TRUST_PROXY === '1',
    proxyHops: Number.isInteger(hops) && hops >= 0 ? hops : 0,
  };
}

function rateLimitByIp(max: number) {
  const flags = ipFlags();
  const allow = windowCounter({ windowMs: 60_000, max });
  return async (c: Context, next: () => Promise<void>) => {
    if (!allow(clientIp(c, flags)))
      throw new HttpError(429, 'RATE_LIMITED', 'too many attempts — wait a minute');
    await next();
  };
}

// PUBLIC self-serve signup under /admin/v1/signup/* (docs/merchant-admin.md): plans, slug check,
// a phone code, then one POST that provisions the store, starts its (pending) subscription and
// signs the owner in. The store opens when the first payment lands (webhook.ts).
export function mountSignup(admin: AdminApp, d: Omit<AdminDeps, 'admin'>) {
  const { sql } = d;
  const readLimit = rateLimitByIp(60);
  const codeLimit = rateLimitByIp(20);
  const createLimit = rateLimitByIp(10);
  const secure = (c: Context) =>
    c.req.url.startsWith('https://') ||
    (process.env.VENDUA_TRUST_PROXY === '1' && c.req.header('x-forwarded-proto') === 'https');

  admin.get('/signup/plans', readLimit, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({
      plans: await publicPlans(sql),
      billing: {
        available: d.provider.platformConfigured,
        accessCode: !!signupAccessCode(),
        // MercadoPago.js in the signup: its device fingerprint goes with the first Pix
        publicKey: platformPublicKey(d.provider),
      },
      // the CRM switch and what signup relies on; which part is missing is for the team (CRM)
      signup: { open: (await d.signupReady()).open },
      storeDomain: d.storeDomain,
    });
  });

  admin.get('/signup/slug', readLimit, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await slugStatus(sql, c.req.query('slug') ?? '', d.storeDomain));
  });

  admin.post('/signup/otp/start', codeLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = validAdminPhone(body.phone);
    if (!phone)
      throw new HttpError(422, 'INVALID_PHONE', 'type the phone with DDD', { field: 'phone' });
    await signupOpenOr503(d);
    const ip = clientIp(c, ipFlags());
    // 'local' = no trusted edge (dev): every client looks the same, so no per-IP day cap
    return c.json(await startSignupOtp(sql, phone, d.notify, ip === 'local' ? {} : { ip }));
  });

  admin.post('/signup/otp/verify', codeLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = validAdminPhone(body.phone);
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
    if (!phone || !(await verifySignupOtp(sql, phone, code)))
      throw new HttpError(422, 'INVALID_CODE', 'wrong or expired code', { field: 'code' });
    return c.json({
      signupToken: signupToken(d.sessionSecret, phone),
      existingStores: (await membershipsFor(sql, phone)).map(storeRef),
      // a plan with a trial starts with it, once per owner phone (ADR 0025)
      trialEligible: !(await phoneHadTrial(sql, phone)),
    });
  });

  // Idempotent by its natural key (slug + verified phone), not an Idempotency-Key: there is no
  // tenant to scope a claim to yet. The same token+slug again finds the store this phone owns
  // and returns it — provision_store() never runs twice for a slug (tenants.slug is unique),
  // and the subscription/first charge are ensured, not re-created (subscriptions PK, invoice
  // numbers, the provider idempotency keys).
  admin.post('/signup', createLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = readSignupToken(d.sessionSecret, body.signupToken);
    if (!phone) throw new HttpError(401, 'SIGNUP_EXPIRED', 'confirm your phone again');
    // an access code skips Mercado Pago: the store waits on its first invoice like any other,
    // and the team marks that invoice paid in the CRM (Lojas)
    const manual = body.accessCode !== undefined && body.accessCode !== '';
    if (manual && !accessCodeMatches(body.accessCode))
      throw new HttpError(422, 'INVALID_ACCESS_CODE', 'wrong access code', { field: 'accessCode' });
    if (!manual && !d.provider.platformConfigured)
      throw new HttpError(503, 'BILLING_UNAVAILABLE', 'plan billing is not set up on this install');
    // open or not is checked once we know this isn't a replay of a signup that went through
    const plan = await publicPlanOr422(sql, body.planId, null);
    // `trial: true` starts a plan's free trial (ADR 0025): no payment method asked
    if (body.trial !== undefined && typeof body.trial !== 'boolean')
      throw new HttpError(422, 'BAD_REQUEST', 'trial must be true or false', { field: 'trial' });
    const trial = body.trial === true;
    if (trial && (manual || plan.trial_days <= 0))
      throw new HttpError(422, 'TRIAL_UNAVAILABLE', 'this plan has no free trial', {
        field: 'trial',
      });
    if (!manual && !trial && body.method !== 'card' && body.method !== 'pix')
      throw new HttpError(422, 'BAD_REQUEST', 'method must be card or pix', { field: 'method' });
    const method: 'card' | 'pix' = manual || body.method !== 'card' ? 'pix' : 'card';
    const storeName = text(body.storeName, 'storeName', 60, 2);
    const ownerName = text(body.ownerName, 'ownerName', 80, 2);
    const email = validEmail(body.email, 'email');
    const document = validDocument(body.document, 'document');
    const segment = segmentOr422(body.segment);
    const slug = normalizeSlug(body.slug);
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(slug))
      throw new HttpError(422, 'INVALID_SLUG', 'the address needs 3–40 letters, numbers or -', {
        field: 'slug',
        reason: 'invalid',
      });
    if (RESERVED_SLUGS.has(slug))
      throw new HttpError(422, 'INVALID_SLUG', 'this address is reserved', {
        field: 'slug',
        reason: 'reserved',
      });

    let owned = await ownedStore(sql, phone, slug);
    // a replay or a resumed signup may only ask again for the plan the store already holds
    openOr409(
      plan,
      owned ? await withTenant(sql, owned.tenant_id, (tx) => heldPlans(tx, owned!.tenant_id)) : [],
    );
    // a replay of a store already made goes through even if signup closed since
    if (!owned) await signupOpenOr503(d, 'create');
    // one trial per owner phone; a replay of this very signup finds its store first
    if (!owned && trial && (await phoneHadTrial(sql, phone))) throw trialUsed();
    if (!owned) {
      if ((await slugStatus(sql, slug, d.storeDomain)).reason === 'taken')
        throw new HttpError(409, 'SLUG_TAKEN', 'this address is taken', { field: 'slug' });
      try {
        // count + create under one per-phone lock, so parallel signups can't all pass the cap
        await sql.begin(async (t) => {
          const tx = t as unknown as Sql;
          // both 9th-digit spellings are one WhatsApp: one lock, one count
          await tx`select pg_advisory_xact_lock(hashtextextended(${`signup:${phoneLockKey(phone)}`}, 0))`;
          const recent = (
            await tx<{ n: number }[]>`
              select count(distinct m.tenant_id)::int as n
              from unnest(${phoneVariants(phone)}::text[]) p
                cross join lateral merchant_memberships_for_phone(p) m
                join tenants t on t.id = m.tenant_id
              where m.role = 'owner' and t.created_at > now() - interval '24 hours'
            `
          )[0]!.n;
          if (recent >= STORES_PER_PHONE_PER_DAY)
            throw new HttpError(429, 'SIGNUP_LIMIT', 'this phone opened too many stores today');
          // the plan still open now: staff closing it in the CRM waits on this lock (and the
          // other way round), so a store is never made on a plan closed a moment ago
          await tx`select pg_advisory_xact_lock_shared(hashtextextended(${`plan-available:${plan.id}`}, 0))`;
          const fresh = (
            await tx<{ available: boolean }[]>`select available from plans where id = ${plan.id}`
          )[0];
          if (!fresh)
            throw new HttpError(422, 'UNKNOWN_PLAN', 'pick one of the plans offered', {
              field: 'planId',
            });
          openOr409({ ...plan, available: fresh.available });
          const tenantId = (
            await tx<{ id: string }[]>`
              select provision_store(${slug}, ${storeName}, ${plan.id}, ${platformHost(slug, d.storeDomain)},
                                     ${ownerName}, ${phone}, ${email}) as id
            `
          )[0]!.id;
          // as the new store: its own transaction may record an event about itself
          await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
          // the onboarding wizard opens on what signup already asked
          await tx`
            update store_settings set segment = ${segment}, onboarding = '{"from":"signup"}'::jsonb
            where tenant_id = ${tenantId}
          `;
          // under the phone's lock, so two signups at once can't both start a trial
          let trialEndsAt: string | null = null;
          if (trial) {
            if (await phoneHadTrial(tx, phone)) throw trialUsed();
            const next = await startTrial(tx, tenantId, {
              plan,
              payerEmail: email,
              payerDocument: document,
              provider: d.provider.name,
              now: new Date(),
              phone,
            });
            trialEndsAt = next.kind === 'trial' ? next.endsAt : null;
            const owner = (
              await tx<{ id: string }[]>`
                select id from merchant_users where tenant_id = ${tenantId} and role = 'owner' limit 1
              `
            )[0];
            await audit(
              tx,
              tenantId,
              { userId: owner?.id ?? null, name: ownerName },
              {
                action: 'store.signup',
                entity: 'account',
                entityId: tenantId,
                summary: `criou a loja no plano ${plan.name}, com ${plan.trial_days} dias de teste grátis`,
                after: { planId: plan.id, trialEndsAt },
              },
            );
          }
          await recordStaffEventTx(
            tx,
            'store.created',
            {
              storeName,
              slug,
              source: manual ? 'access_code' : 'signup',
              owner: ownerName,
              leadId: null,
              plan: plan.name,
              segment,
              trialEndsAt,
            },
            { tenantId, dedupeKey: `store.created:${tenantId}` },
          );
        });
      } catch (err) {
        // a concurrent signup won the slug: it's ours if this phone owns it
        if ((err as { code?: string }).code !== '23505') throw err;
      }
      owned = await ownedStore(sql, phone, slug);
      if (!owned)
        throw new HttpError(409, 'SLUG_TAKEN', 'this address is taken', { field: 'slug' });
    }

    const store = owned;
    const next = await ensureFirstCharge(d, c, store, {
      plan,
      method,
      email,
      document,
      ownerName,
      manual,
      trial,
      phone,
    }).catch(async (err: unknown) => {
      // the store exists but its first charge didn't go out: the team hears MP's own reason
      // (the owner only sees "try again"), once per store and kind — the owner's retries add nothing
      if (err instanceof HttpError && err.code === 'BILLING_PROVIDER_ERROR') {
        const why = err.cause instanceof Error ? err.cause.message : err.message;
        // keyed by MP's kind of failure: a passing outage first doesn't hide a refused token
        const kind = err.cause instanceof ProviderError ? err.cause.code : 'other';
        const how = method === 'card' ? 'cartão' : 'Pix';
        await withTenant(sql, store.tenant_id, (tx) =>
          recordBillingProblem(
            tx,
            store.tenant_id,
            'other',
            `a primeira cobrança (${how}) não saiu no Mercado Pago: ${why}`,
            `signup:${kind}`,
          ),
        ).catch((e) => signupLog.warn({ err: e }, 'signup charge problem not recorded'));
      }
      throw err;
    });
    // once per new store, and only once it went out: the send finishes before the answer, and
    // the marker is written after it, so a failed send or a restart mid-send leaves no marker
    // and the owner's next try sends it (the provider dedupes on the key if both went out)
    const welcome = await withTenant(sql, store.tenant_id, async (tx) => {
      const due = await tx`
        select 1 from tenants t where t.id = ${store.tenant_id}
          and t.created_at > now() - interval '1 day'
          and not exists (select 1 from push_deliveries p
                          where p.tenant_id = t.id and p.key = 'signup.welcome')
      `;
      return due[0] ? storeOrigin(tx, { id: store.tenant_id, slug }, d.storeDomain) : null;
    });
    if (welcome) {
      try {
        // a slow provider doesn't hold the owner's answer: no marker, the next try sends it
        await within(
          sendWelcome(d, c, {
            tenantId: store.tenant_id,
            email,
            ownerName,
            storeName,
            slug,
            storeUrl: welcome,
            planName: plan.name,
            next,
          }),
          8000,
        );
        await withTenant(
          sql,
          store.tenant_id,
          (tx) => tx`insert into push_deliveries (tenant_id, key)
                     values (${store.tenant_id}, 'signup.welcome') on conflict do nothing`,
        );
      } catch (err) {
        // never in the way of the answer: the store exists and the owner is signed in
        signupLog.warn({ err, tenantId: store.tenant_id }, 'welcome email failed');
      }
    }
    setAdminCookie(
      c,
      await createSession(sql, owned, c.req.header('user-agent'), {
        kind: 'phone',
        subject: phone,
      }),
      secure(c),
    );
    return c.json({ signedIn: true, store: storeRef(owned), next }, 201);
  });

  if (d.provider instanceof FakeProvider && process.env.NODE_ENV !== 'production')
    mountBillingDev(admin, d, d.provider);
}

/** Closed: no phone code, no new store. Creating one doesn't recheck the WhatsApp, which only
 *  sends the code (already delivered), so a reconnect blip can't fail a verified owner. */
/**
 * The marketing site's prices (site/src/lib/plans/live.svelte.ts): the public catalog, read by
 * the visitor's browser through the site's own nginx (/precos.json), so a price changed in the
 * CRM shows without a new build. Outside /admin, which only the admin host serves.
 */
export function mountSiteCatalog(app: Hono<any>, sql: Sql) {
  const allow = windowCounter({ windowMs: 60_000, max: 120 });
  const flags = ipFlags();
  app.get('/site/v1/plans', async (c) => {
    if (!allow(clientIp(c, flags)))
      throw new HttpError(429, 'RATE_LIMITED', 'too many requests — wait a minute');
    c.header('cache-control', 'public, max-age=60');
    return c.json({ plans: await publicPlans(sql) });
  });
}

/** `p`, or a rejection after `ms` (the timer is cleared either way) */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => {
    timer = setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

async function signupOpenOr503(d: Omit<AdminDeps, 'admin'>, step: 'code' | 'create' = 'code') {
  const r = await d.signupReady();
  if (!(step === 'create' ? r.on && r.email && r.billing : r.open))
    throw new HttpError(503, 'SIGNUP_CLOSED', 'self-serve signup is not open right now');
}

/** The owner's welcome (ADR 0032): where the store is, how to get in, and what happens next. */
async function sendWelcome(
  d: Omit<AdminDeps, 'admin'>,
  c: Context,
  o: {
    tenantId: string;
    email: string;
    ownerName: string;
    storeName: string;
    slug: string;
    storeUrl: string;
    planName: string;
    next: PayNext;
  },
) {
  const first = o.ownerName.trim().split(/\s+/)[0] ?? o.ownerName;
  const panel = `${d.publicOrigin(c)}/admin/`;
  const next =
    o.next.kind === 'trial'
      ? `Seu teste grátis vai até ${new Date(o.next.endsAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' })}. A loja já pode receber pedidos.`
      : o.next.kind === 'manual'
        ? 'A loja abre para pedidos assim que a equipe da Venduá confirmar o pagamento do plano.'
        : 'A loja abre para pedidos assim que o primeiro pagamento do plano for confirmado. O Pix e a fatura ficam em Conta e plano, no painel.';
  await d.notify.email(
    o.email,
    `${o.storeName} está criada na Venduá`,
    [
      `Oi, ${first}!`,
      `A ${o.storeName} foi criada no plano ${o.planName}.`,
      next,
      `Painel da loja: ${panel}`,
      `Endereço da loja: ${o.storeUrl}`,
      'Para entrar no painel, use o número de WhatsApp que você confirmou no cadastro.',
      'Se precisar de ajuda, toque em Ajuda no painel.',
    ].join('\n\n'),
    // per store, not per slug: a slug freed and taken again within the provider's 24h dedupe
    // window would replay the old store's key with a new body, and the send is refused
    `signup-welcome:${o.tenantId}`,
  );
}

const trialUsed = () =>
  new HttpError(409, 'TRIAL_USED', 'this phone already had its free trial', { field: 'trial' });

async function ownedStore(sql: Sql, phone: string, slug: string) {
  return (
    (await membershipsFor(sql, phone)).find((m) => m.slug === slug && m.role === 'owner') ?? null
  );
}

/** The new store's subscription and its first charge — created once, found on a replay. */
async function ensureFirstCharge(
  d: Omit<AdminDeps, 'admin'>,
  c: Context,
  owner: Membership,
  o: {
    plan: PlanRow;
    method: 'card' | 'pix';
    email: string;
    document: string;
    ownerName: string;
    manual: boolean;
    trial: boolean;
    /** the verified owner phone */
    phone: string;
  },
): Promise<PayNext> {
  const origin = d.publicOrigin(c);
  const now = new Date();
  const actor: Merchant = {
    userId: owner.user_id,
    sessionId: '',
    name: o.ownerName,
    phone: '',
    role: 'owner',
  };
  const deviceId = deviceIdOr(c.req.header('x-vendua-device'));
  return withEffects(
    { sql: d.sql, provider: d.provider, notify: d.notify, origin, deviceId },
    (ctx) =>
      withTenant(d.sql, owner.tenant_id, async (tx) => {
        // the order the first try took (phone, then plan): two signups can't both start a trial
        if (o.trial)
          await tx`select pg_advisory_xact_lock(hashtextextended(${`signup:${phoneLockKey(o.phone)}`}, 0))`;
        const sub = await lockSub(tx, owner.tenant_id);
        if (!sub) {
          // a resumed signup (its first charge failed before): the plan is reread under the
          // availability lock, so one closed meanwhile can't start a subscription unless held
          await tx`select pg_advisory_xact_lock_shared(hashtextextended(${`plan-available:${o.plan.id}`}, 0))`;
          const plan = await planRow(tx, o.plan.id);
          if (!plan || !plan.public)
            throw new HttpError(422, 'UNKNOWN_PLAN', 'pick one of the plans offered', {
              field: 'planId',
            });
          openOr409(plan, await heldPlans(tx, owner.tenant_id));
          // a store whose first charge failed, tried again as a trial, gets the trial
          if (o.trial) {
            if (plan.trial_days <= 0)
              throw new HttpError(422, 'TRIAL_UNAVAILABLE', 'this plan has no free trial', {
                field: 'trial',
              });
            if (await phoneHadTrial(tx, o.phone)) throw trialUsed();
            const next = await startTrial(tx, owner.tenant_id, {
              plan,
              payerEmail: o.email,
              payerDocument: o.document,
              provider: d.provider.name,
              now,
              phone: o.phone,
            });
            await audit(tx, owner.tenant_id, actor, {
              action: 'store.signup',
              entity: 'account',
              entityId: owner.tenant_id,
              summary: `criou a loja no plano ${plan.name}, com ${plan.trial_days} dias de teste grátis`,
              after: { planId: plan.id, trialEndsAt: next.kind === 'trial' ? next.endsAt : null },
            });
            return next;
          }
          const next = await startSubscription(ctx, tx, owner.tenant_id, {
            plan,
            method: o.method,
            payerEmail: o.email,
            payerDocument: o.document,
            key: `signup:${owner.tenant_id}`,
            now,
            manual: o.manual,
          });
          await audit(tx, owner.tenant_id, actor, {
            action: 'store.signup',
            entity: 'account',
            entityId: owner.tenant_id,
            summary: `criou a loja no plano ${o.plan.name} (${o.manual ? 'código de acesso, pagamento confirmado pela equipe' : o.method === 'card' ? 'cartão' : 'Pix'})`,
            after: { planId: o.plan.id, method: o.manual ? 'manual' : o.method },
          });
          return next;
        }
        // a signup resumed from before it asked for the CPF/CNPJ: fill it in, never overwrite one
        // (the owner may have changed it in Conta since)
        if (!sub.payer_document) {
          await tx`
          update subscriptions set payer_document = ${o.document}, updated_at = now()
          where tenant_id = ${owner.tenant_id} and payer_document is null
        `;
          // its first Pix went out without one: the owner gets a new Pix that carries it
          if (sub.status === 'pending') await reissueOpenPix(ctx, tx, owner.tenant_id, now);
        }
        if (sub.status === 'trialing' && sub.trial_ends_at)
          return { kind: 'trial', endsAt: sub.trial_ends_at.toISOString() };
        if (sub.status === 'pending')
          return beginPayment(ctx, tx, sub, `signup:${owner.tenant_id}`, now, {
            manual: o.manual && sub.method === 'pix',
          });
        // already paid (a late replay): point at what was paid
        if (sub.method === 'pix') {
          const inv = (
            await tx<{ id: string }[]>`
            select id from invoices where tenant_id = ${owner.tenant_id} order by number desc limit 1
          `
          )[0];
          if (inv) return { kind: 'pix', invoiceId: inv.id };
        }
        return { kind: 'card', url: `${origin}/admin/` };
      }),
  );
}
