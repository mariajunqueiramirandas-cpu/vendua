import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { deriveStatus, type DerivedStatus, type StoreSettingsRow } from '../modules/store.ts';
import type { CheckoutDraft } from './gate.ts';
import { floorOf, type FloorResult } from './floor.ts';
import type { StoreAgentRow } from './settings.ts';

export const AGENT_ID = 'vendedor';
export const SUBJECT_KIND = 'shopper_thread';

export type Channel = 'whatsapp' | 'test' | 'web' | 'instagram';
export type Stage =
  'browsing' | 'building' | 'checkout' | 'confirming' | 'paying' | 'ordered' | 'after';

export interface SummaryRef {
  id: string;
  hash: string;
  totalCents: number;
  /** the shopper message the card went out in, once sent */
  messageId: string | null;
  sentAt: string | null;
  unusual: boolean;
}

export interface Thread {
  id: string;
  tenantId: string;
  channel: Channel;
  address: string;
  phone: string | null;
  profileName: string | null;
  owner: 'open' | 'agent' | 'human' | 'muted';
  ownerReason: string | null;
  humanUntil: Date | null;
  waitingSince: Date | null;
  class: 'unknown' | 'shopper' | 'other';
  cartId: string | null;
  stage: Stage;
  summary: SummaryRef | null;
  orderId: string | null;
  checkout: CheckoutDraft;
  testKind: 'owner' | 'cliente_oculto' | null;
  testOrder: unknown;
  language: string | null;
  lastInAt: Date | null;
  lastOutAt: Date | null;
  lastMerchantAt: Date | null;
  pendingSince: Date | null;
  typingAt: Date | null;
  recoveryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ThreadDbRow {
  id: string;
  tenant_id: string;
  channel: Channel;
  address: string;
  phone: string | null;
  profile_name: string | null;
  owner: Thread['owner'];
  owner_reason: string | null;
  human_until: Date | null;
  waiting_since: Date | null;
  class: Thread['class'];
  cart_id: string | null;
  stage: Stage;
  summary: SummaryRef | null;
  order_id: string | null;
  checkout: CheckoutDraft | null;
  test_kind: Thread['testKind'];
  test_order: unknown;
  language: string | null;
  last_in_at: Date | null;
  last_out_at: Date | null;
  last_merchant_at: Date | null;
  pending_since: Date | null;
  typing_at: Date | null;
  recovery_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function threadOf(r: ThreadDbRow): Thread {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    channel: r.channel,
    address: r.address,
    phone: r.phone,
    profileName: r.profile_name,
    owner: r.owner,
    ownerReason: r.owner_reason,
    humanUntil: r.human_until,
    waitingSince: r.waiting_since,
    class: r.class,
    cartId: r.cart_id,
    stage: r.stage,
    summary: r.summary,
    orderId: r.order_id,
    checkout: r.checkout ?? {},
    testKind: r.test_kind,
    testOrder: r.test_order,
    language: r.language,
    lastInAt: r.last_in_at,
    lastOutAt: r.last_out_at,
    lastMerchantAt: r.last_merchant_at,
    pendingSince: r.pending_since,
    typingAt: r.typing_at,
    recoveryAt: r.recovery_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function loadThread(
  tx: Sql,
  tenantId: string,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<Thread | null> {
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const [row] = await tx<ThreadDbRow[]>`
    select * from shopper_threads where tenant_id = ${tenantId} and id = ${id} ${lock}`;
  return row ? threadOf(row) : null;
}

export async function mustThread(
  tx: Sql,
  tenantId: string,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<Thread> {
  const t = await loadThread(tx, tenantId, id, opts);
  if (!t) throw new HttpError(404, 'THREAD_NOT_FOUND', 'conversation not found');
  return t;
}

export async function loadStoreSettings(
  tx: Sql,
  tenantId: string,
): Promise<StoreSettingsRow | null> {
  const [row] = await tx<
    StoreSettingsRow[]
  >`select * from store_settings where tenant_id = ${tenantId}`;
  return row ?? null;
}

export function storeStatus(settings: StoreSettingsRow | null, now: Date): DerivedStatus {
  return deriveStatus(
    settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    settings?.status_override ?? null,
    settings?.resumes_at ?? null,
    now,
    settings?.special_days ?? [],
  );
}

export function threadFloor(
  t: Thread,
  agent: Pick<StoreAgentRow, 'enabled' | 'settings'>,
  status: DerivedStatus,
  now: Date,
): FloorResult {
  return floorOf(t, agent, status.status === 'open', now);
}

/** `(11) 9••••-4821`: staff and merchant lists never show a whole number by default. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.startsWith('+')) return `${phone.slice(0, 4)}••••${phone.slice(-4)}`;
  if (phone.length < 10) return '••••';
  const ddd = phone.slice(0, 2);
  const rest = phone.slice(2);
  return `(${ddd}) ${rest[0]}••••-${rest.slice(-4)}`;
}
