import type { AdminDeps } from '../../admin/context.ts';
import type { WebhookEvent } from '../payments/provider.ts';

// STUB (CORE-BILL replaces): plan events from Venduá's own MP account (t=platform) — assinatura
// status, its monthly charges, and Pix invoice payments.
export async function handleBillingWebhook(
  _d: Omit<AdminDeps, 'admin'>,
  _event: WebhookEvent,
): Promise<void> {}
