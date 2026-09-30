import type { AdminApp, AdminDeps } from '../../admin/context.ts';
import { HttpError, UUID_RE, boundedText } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { handleBillingWebhook } from '../billing/webhook.ts';
import { mountPaymentsDev } from './dev-routes.ts';
import { ProviderError } from './provider.ts';
import { settleProviderPayment } from '../../admin/routes-orders.ts';

const hookLog = log.child({ mod: 'mp-webhook' });

// PUBLIC routes mounted before the admin session gate.
export function mountPaymentsPublic(admin: AdminApp, d: Omit<AdminDeps, 'admin'>) {
  const pay = { sql: d.sql, provider: d.provider, sessionSecret: d.sessionSecret };

  // Mercado Pago notifications. The signature proves MP sent it; the body is only a hint — the
  // resource is fetched fresh with the right token and applied. Pre-tenant, so no
  // Idempotency-Key: replays are absorbed by natural keys (payments.provider_payment_id unique,
  // apply writes only what moved). 200 for anything we can't use, or MP retries it for days.
  admin.post('/hooks/mercadopago', async (c) => {
    const raw = await boundedText(c, 16 * 1024);
    const event = d.provider.verifyWebhook(c.req.raw.headers, raw, new URL(c.req.url));
    if (!event) throw new HttpError(401, 'INVALID_SIGNATURE', 'signature does not verify');
    const t = c.req.query('t') ?? '';
    try {
      if (t === 'platform') {
        await handleBillingWebhook(d, event);
        return c.json({ ok: true });
      }
      if (!UUID_RE.test(t) || event.kind !== 'payment') return c.json({ ok: true });
      const out = await settleProviderPayment(pay, t, event.resourceId);
      if (!out.applied) hookLog.info({ tenantId: t, reason: out.reason }, 'webhook ignored');
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'unavailable')
        throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'provider unavailable — retry');
      throw err;
    }
  });

  if (d.provider.name === 'fake' && process.env.NODE_ENV !== 'production')
    mountPaymentsDev(admin, d);
}
