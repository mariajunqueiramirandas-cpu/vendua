import type { AdminApp, AdminDeps } from '../../admin/context.ts';
import { HttpError, bodyJson, uuidParam } from '../../platform/http.ts';
import { controlTx } from '../control.ts';
import type { FakeProvider } from '../payments/fake.ts';
import { handleBillingWebhook } from './webhook.ts';

// Fake driver only (dev, CI screenshots, tests): play Mercado Pago's side of a plan payment,
// then run the webhook handler exactly as a verified webhook would.
export function mountBillingDev(admin: AdminApp, d: Omit<AdminDeps, 'admin'>, fake: FakeProvider) {
  admin.post('/dev/billing/subscriptions/:providerId/settle', async (c) => {
    const id = c.req.param('providerId');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !fake.subscriptions.has(id))
      throw new HttpError(404, 'NOT_FOUND', 'no such fake subscription');
    const body = await bodyJson(c);
    const status = body.status === 'rejected' ? 'rejected' : 'approved';
    const charge = fake.settleSubscription(id, status);
    const hint = { providerUserId: null, action: 'dev.settle' };
    await handleBillingWebhook(d, { kind: 'subscription', resourceId: id, ...hint });
    await handleBillingWebhook(d, {
      kind: 'subscription_payment',
      resourceId: charge.id,
      ...hint,
    });
    return c.json({ ok: true, chargeId: charge.id, status });
  });

  admin.post('/dev/billing/invoices/:id/pay', async (c) => {
    const id = uuidParam(c, 'id');
    const inv = (
      await controlTx(
        d.sql,
        (tx) => tx<{ provider_payment_id: string | null }[]>`
          select provider_payment_id from invoices where id = ${id}
        `,
      )
    )[0];
    if (!inv?.provider_payment_id || !fake.payments.has(inv.provider_payment_id))
      throw new HttpError(404, 'NOT_FOUND', 'no Pix issued for this invoice');
    fake.settle(inv.provider_payment_id, 'approved');
    await handleBillingWebhook(d, {
      kind: 'payment',
      resourceId: inv.provider_payment_id,
      providerUserId: null,
      action: 'dev.pay',
    });
    return c.json({ ok: true });
  });
}
