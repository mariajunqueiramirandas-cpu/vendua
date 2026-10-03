import type { Context } from 'hono';
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
import { platformHost } from '../../platform/store-origin.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { mountBillingDev } from './dev-routes.ts';
import { validEmail } from './input.ts';
import { openOr409, publicPlanOr422, publicPlans, type PlanRow } from './plans.ts';
import {
  accessCodeMatches,
  normalizeSlug,
  readSignupToken,
  RESERVED_SLUGS,
  segmentOr422,
  signupAccessCode,
  phoneHadTrial,
  signupToken,
  slugStatus,
  startSignupOtp,
  verifySignupOtp,
} from './signup.ts';
import {
  beginPayment,
  lockSub,
  startSubscription,
  startTrial,
  withEffects,
  type PayNext,
} from './subscriptions.ts';
import { FakeProvider } from '../payments/fake.ts';

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
      billing: { available: d.provider.platformConfigured, accessCode: !!signupAccessCode() },
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
    // one trial per owner phone; a replay of this very signup finds its store first
    const trialUsed = () =>
      new HttpError(409, 'TRIAL_USED', 'this phone already had its free trial', { field: 'trial' });
    if (!owned) openOr409(plan);
    if (!owned && trial && (await phoneHadTrial(sql, phone))) throw trialUsed();
    if (!owned) {
      if ((await slugStatus(sql, slug, d.storeDomain)).reason === 'taken')
        throw new HttpError(409, 'SLUG_TAKEN', 'this address is taken', { field: 'slug' });
      try {
        // count + create under one per-phone lock, so parallel signups can't all pass the cap
        await sql.begin(async (t) => {
          const tx = t as unknown as Sql;
          await tx`select pg_advisory_xact_lock(hashtextextended(${`signup:${phone}`}, 0))`;
          const recent = (
            await tx<{ n: number }[]>`
              select count(*)::int as n from merchant_memberships_for_phone(${phone}) m
                join tenants t on t.id = m.tenant_id
              where m.role = 'owner' and t.created_at > now() - interval '24 hours'
            `
          )[0]!.n;
          if (recent >= STORES_PER_PHONE_PER_DAY)
            throw new HttpError(429, 'SIGNUP_LIMIT', 'this phone opened too many stores today');
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

    const next = await ensureFirstCharge(d, c, owned, { plan, method, email, ownerName, manual });
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
  o: { plan: PlanRow; method: 'card' | 'pix'; email: string; ownerName: string; manual: boolean },
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
  return withEffects({ sql: d.sql, provider: d.provider, notify: d.notify, origin }, (ctx) =>
    withTenant(d.sql, owner.tenant_id, async (tx) => {
      const sub = await lockSub(tx, owner.tenant_id);
      if (!sub) {
        const next = await startSubscription(ctx, tx, owner.tenant_id, {
          plan: o.plan,
          method: o.method,
          payerEmail: o.email,
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
