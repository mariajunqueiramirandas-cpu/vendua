import type { AdminApp, AdminDeps } from '../../admin/context.ts';
import { withTenant, type Sql } from '../../platform/db.ts';
import { HttpError, bodyJson } from '../../platform/http.ts';
import { FakeProvider } from './fake.ts';
import type { ProviderPaymentStatus } from './provider.ts';
import { settleProviderPayment } from '../../admin/routes-orders.ts';

// Dev/CI only (fake driver, never production): play Mercado Pago's side so the admin and the
// storefront run end to end — settle a Pix, finish a hosted card checkout. Each then takes the
// exact path of a verified webhook (fetch the payment with the store's token, apply it).

const STATUSES: readonly ProviderPaymentStatus[] = [
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'pending',
  'charged_back',
  'in_mediation',
];

/** which store an MP id belongs to — dev only, so a scan over connected stores is fine */
async function tenantOf(
  sql: Sql,
  column: 'provider_payment_id' | 'provider_checkout_id',
  id: string,
) {
  const tenants = await sql.begin(async (tx) => {
    await tx`select set_config('vendua.control', '1', true)`;
    return tx<{ tenant_id: string }[]>`select tenant_id from payment_connections`;
  });
  for (const { tenant_id } of tenants) {
    const hit = await withTenant(
      sql,
      tenant_id,
      (tx) => tx`select 1 from payments where tenant_id = ${tenant_id} and ${tx(column)} = ${id}`,
    );
    if (hit.length) return tenant_id;
  }
  return null;
}

export function mountPaymentsDev(admin: AdminApp, d: Omit<AdminDeps, 'admin'>) {
  const fake = d.provider;
  if (!(fake instanceof FakeProvider)) return;
  const pay = { sql: d.sql, provider: d.provider, sessionSecret: d.sessionSecret };
  const status = (v: unknown, fallback: ProviderPaymentStatus) => {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !STATUSES.includes(v as ProviderPaymentStatus))
      throw new HttpError(422, 'BAD_REQUEST', `status must be one of ${STATUSES.join(', ')}`);
    return v as ProviderPaymentStatus;
  };
  const idOf = (v: string | undefined) => {
    if (!v || !/^[A-Za-z0-9_-]{1,120}$/.test(v)) throw new HttpError(400, 'BAD_REQUEST', 'bad id');
    return v;
  };

  admin.post('/dev/mp/payments/:providerId/settle', async (c) => {
    const id = idOf(c.req.param('providerId'));
    const s = status((await bodyJson(c)).status, 'approved');
    if (!fake.payments.has(id)) throw new HttpError(404, 'NOT_FOUND', 'no such payment');
    const tenantId = await tenantOf(d.sql, 'provider_payment_id', id);
    if (!tenantId) throw new HttpError(404, 'NOT_FOUND', 'no store has this payment');
    fake.settle(id, s);
    return c.json({ ok: true, result: await settleProviderPayment(pay, tenantId, id) });
  });

  admin.post('/dev/mp/checkouts/:id/complete', async (c) => {
    const id = idOf(c.req.param('id'));
    const s = status(
      ((await bodyJson(c).catch(() => ({}))) as Record<string, unknown>).status,
      'approved',
    );
    if (!fake.checkouts.has(id)) throw new HttpError(404, 'NOT_FOUND', 'no such checkout');
    const tenantId = await tenantOf(d.sql, 'provider_checkout_id', id);
    if (!tenantId) throw new HttpError(404, 'NOT_FOUND', 'no store has this checkout');
    const p = fake.completeCheckout(id, s);
    return c.json({
      ok: true,
      paymentId: p.id,
      result: await settleProviderPayment(pay, tenantId, p.id),
    });
  });
}
