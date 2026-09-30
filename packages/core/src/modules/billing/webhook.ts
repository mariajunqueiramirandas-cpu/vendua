import type { AdminDeps } from '../../admin/context.ts';
import { withTenant } from '../../platform/db.ts';
import { UUID_RE } from '../../platform/http.ts';
import { controlTx } from '../control.ts';
import type { WebhookEvent } from '../payments/provider.ts';
import { billingLog } from './invoices.ts';
import {
  recordCardCharge,
  settlePixPayment,
  syncPreapproval,
  withEffects,
  type BillingCtx,
} from './subscriptions.ts';

// Plan events from Venduá's own MP account (t=platform): the assinatura's status, its monthly
// charges, and Pix invoice payments. The event is only a hint — every fact is re-read from the
// provider, its external_reference names our row, and the row must exist with that provider id.
// Replays are no-ops: a paid invoice stays paid, a known charge id is matched, not re-created.
export async function handleBillingWebhook(
  d: Omit<AdminDeps, 'admin'>,
  event: WebhookEvent,
): Promise<void> {
  const base: Omit<BillingCtx, 'later'> = {
    sql: d.sql,
    provider: d.provider,
    notify: d.notify,
    // links in owner messages; nothing here creates a charge that needs a return URL
    origin: process.env.VENDUA_ADMIN_HOST
      ? `https://${process.env.VENDUA_ADMIN_HOST.trim().toLowerCase()}`
      : null,
  };
  const now = new Date();
  if (event.kind === 'subscription') {
    const ps = await d.provider.getSubscription(event.resourceId);
    const tenantId = await tenantForPreapproval(d, ps.id, ps.externalReference);
    if (!tenantId) return;
    await withEffects(base, (ctx) =>
      withTenant(d.sql, tenantId, (tx) => syncPreapproval(ctx, tx, tenantId, ps.id, ps.status)),
    );
    return;
  }
  if (event.kind === 'subscription_payment') {
    const sp = await d.provider.getSubscriptionPayment(event.resourceId);
    if (sp.status !== 'approved' && sp.status !== 'rejected') return;
    const ps = await d.provider.getSubscription(sp.subscriptionId);
    const tenantId = await tenantForPreapproval(d, ps.id, ps.externalReference);
    if (!tenantId) return;
    await withEffects(base, (ctx) =>
      withTenant(d.sql, tenantId, (tx) =>
        recordCardCharge(
          ctx,
          tx,
          tenantId,
          {
            id: sp.id,
            status: sp.status as 'approved' | 'rejected',
            amountCents: sp.amountCents,
            date: validDate(sp.date) ?? now,
          },
          now,
        ),
      ),
    );
    return;
  }
  if (event.kind === 'payment') {
    const p = await d.provider.platformGetPayment(event.resourceId);
    const invoiceId = p.externalReference;
    if (!invoiceId || !UUID_RE.test(invoiceId)) return;
    // read back with Venduá's own token, so its external_reference is ours: the invoice id.
    // Any Pix issued for it counts — the current one or one superseded by a reissue.
    const row = (
      await controlTx(
        d.sql,
        (tx) => tx<
          { tenant_id: string; provider_payment_id: string | null; pix_superseded: string[] }[]
        >`
          select tenant_id, provider_payment_id, pix_superseded from invoices
          where id = ${invoiceId} and provider = ${d.provider.name}
        `,
      )
    )[0];
    if (!row) {
      billingLog.info({ payment: p.id }, 'platform payment matches no invoice');
      return;
    }
    if (p.id !== row.provider_payment_id && !row.pix_superseded.includes(p.id))
      billingLog.warn(
        { payment: p.id, invoice: invoiceId },
        'payment for an invoice we never recorded it on',
      );
    if (p.status !== 'approved') return;
    await withEffects(base, (ctx) =>
      withTenant(d.sql, row.tenant_id, (tx) =>
        settlePixPayment(
          ctx,
          tx,
          row.tenant_id,
          invoiceId,
          { id: p.id, amountCents: p.amountCents, approvedAt: validDate(p.approvedAt) ?? now },
          new Date(),
        ),
      ),
    );
  }
}

/** external_reference is the tenant id; the store must hold this very preapproval. */
async function tenantForPreapproval(
  d: Omit<AdminDeps, 'admin'>,
  providerId: string,
  externalReference: string | null,
): Promise<string | null> {
  if (!externalReference || !UUID_RE.test(externalReference)) return null;
  const hit = await controlTx(
    d.sql,
    (tx) => tx`
      select 1 from subscriptions
      where tenant_id = ${externalReference} and provider_subscription_id = ${providerId}
    `,
  );
  if (!hit.length) billingLog.info({ preapproval: providerId }, 'preapproval matches no store');
  return hit.length ? externalReference : null;
}

function validDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
