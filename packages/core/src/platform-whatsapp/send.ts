import { sendWhatsApp } from '../agent/channels/whatsapp.ts';
import type { IntegrationRow } from '../modules/integrations.ts';
import type { Sql } from '../platform/db.ts';
import { enqueuePlatformWa, type OutboxPurpose } from './outbox.ts';
import { platformTransport } from './transport.ts';

/**
 * A message from Venduá's number through whoever holds it. Before the cutover that is Core's
 * socket, sent now; after it, an outbox row the gateway sends (`queued`). The log driver only
 * prints, as before.
 */
export async function sendPlatformText(
  sql: Sql,
  wa: IntegrationRow,
  m: { to: string; text: string; purpose: OutboxPurpose; dedupeKey?: string; ref?: string },
): Promise<{ id: string | null; queued: boolean }> {
  if (wa.driver === 'log' || platformTransport() === 'socket')
    return { id: await sendWhatsApp(sql, wa, m.to, m.text), queued: false };
  const { id } = await enqueuePlatformWa(sql, {
    to: m.to,
    body: m.text,
    purpose: m.purpose,
    dedupeKey: m.dedupeKey ?? `${m.purpose}:${crypto.randomUUID()}`,
    ref: m.ref ?? null,
  });
  return { id, queued: true };
}
