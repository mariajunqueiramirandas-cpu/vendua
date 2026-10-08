import type { Sql } from '../platform/db.ts';
import { deriveStatus, type StoreSettingsRow } from '../modules/store.ts';
import { OPT_OUT_FOOTER } from './messages.ts';

// Messages a store starts that no order step asked for, each one a shopper did ask for: the bag
// reminder (modules/cart-reminder.ts) and "a loja abriu" (wakeStoreWaitlist). ADR 0026 keeps the
// store's number to narrow, paced sends; these ride the same queue behind order notices, under a
// ceiling of their own, only while the store is open, and always say how to stop.

export const PROACTIVE_KINDS = ['cart_reminder', 'store_open'] as const;
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number];

/** kinds that come from the store unasked-in-the-moment: a SAIR from their recipients counts */
export const NOTICE_KINDS: readonly string[] = ['order', ...PROACTIVE_KINDS];

/** per store and hour, each kind; well under the gateway's 200 (WA_MAX_PER_HOUR) */
export const PROACTIVE_PER_HOUR: Record<ProactiveKind, number> = {
  cart_reminder: 20,
  store_open: 60,
};
/** a store already this busy in the hour keeps the rest of the gateway's ceiling for orders */
const BUSY_PER_HOUR = 100;

/** a proactive message that couldn't go out within the hour says something no longer true */
export const PROACTIVE_TTL = '1 hour';

/** The store's WhatsApp can deliver: linked and wanted (a reconnect catches up). */
export async function waLinkedTx(tx: Sql, tenantId: string): Promise<boolean> {
  const [row] = await tx<{ ok: boolean }[]>`
    select wanted and state in ('open', 'connecting', 'error') as ok
    from store_whatsapp where tenant_id = ${tenantId}`;
  return !!row?.ok;
}

/** How many more of this kind may be queued now. Holds the store's proactive lock until the
 *  caller's transaction ends, so it must queue in that same transaction: two sweeps (replicas)
 *  computing the room together would each fill the whole ceiling. */
export async function proactiveRoomTx(
  tx: Sql,
  tenantId: string,
  kind: ProactiveKind,
): Promise<number> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`proactive:${tenantId}`}, 0))`;
  const [r] = await tx<{ same: number; busy: number }[]>`
    select count(*) filter (where kind = ${kind})::int as same,
           count(*) filter (where kind <> 'chat')::int as busy
    from store_wa_messages
    where tenant_id = ${tenantId} and created_at > now() - interval '1 hour'`;
  return Math.max(0, Math.min(PROACTIVE_PER_HOUR[kind] - r!.same, BUSY_PER_HOUR - r!.busy));
}

/** Open right now by its hours, pause or close, and not waiting for its first plan payment. */
export async function storeOpenNowTx(tx: Sql, tenantId: string, now: Date): Promise<boolean> {
  const [s] = await tx<
    Pick<
      StoreSettingsRow,
      'hours' | 'status_override' | 'resumes_at' | 'special_days' | 'billing_hold'
    >[]
  >`
    select hours, status_override, resumes_at, special_days, billing_hold
    from store_settings where tenant_id = ${tenantId}`;
  if (!s || s.billing_hold) return false;
  return (
    deriveStatus(
      s.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
      s.status_override ?? null,
      s.resumes_at ?? null,
      now,
      s.special_days ?? [],
    ).status === 'open'
  );
}

/** A contact as the queue stores it: national digits of a Brazilian number, else null. */
export function nationalPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  const n = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  return /^\d{10,11}$/.test(n) ? n : null;
}

/** "Avise-me quando abrir". */
export function storeOpenMessage(storeName: string, url: string): string {
  return `Oi! Aqui é da ${storeName} 👋\nAbrimos agora, como você pediu para avisar. É só fazer seu pedido: ${url}${OPT_OUT_FOOTER}`;
}
