import type { Json } from '@vendua/agent-runtime';
import { getCatalogView } from '../modules/catalog.ts';
import { loadZoneRows } from '../modules/cart.ts';
import {
  offeredMethods,
  adjustmentFor,
  type PaymentMethod,
} from '../modules/payment-adjustments.ts';
import { ordersByPhone } from '../modules/customer.ts';
import { onlineOffer } from '../modules/payments/store-payments.ts';
import { upcomingSpecialDays, type StoreHours } from '../modules/store.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import type { Sql } from '../platform/db.ts';
import { brl, PAYMENT_LABEL } from './cards.ts';
import { vendedorDeps } from './deps.ts';
import { liveRules, type CompiledGuard } from './knowledge.ts';
import { introduction, loadAgent, type StoreAgentSettings } from './settings.ts';
import { loadStoreSettings, storeStatus, type Thread } from './threads.ts';

// The store pack (sales-agent.md §4.9): what the Vendedor knows about the store, built by Core
// and recorded in the log whenever its hash moves, so a turn can be replayed. The catalog goes
// in compact lines; over PACK_PRODUCTS it keeps categories and best sellers and leaves the rest
// to search_catalog.

const PACK_PRODUCTS = 250;
const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export interface StorePack {
  storeName: string;
  timezone: string;
  url: string;
  agent: Pick<
    StoreAgentSettings,
    'name' | 'disclose' | 'tone' | 'voice' | 'capabilities' | 'handoff'
  > & {
    intro: string;
    coverage: StoreAgentSettings['coverage'];
    pixOnlyAfterCancels: number | null;
  };
  status: {
    status: 'open' | 'closed' | 'paused';
    closesAt: string | null;
    resumesAt: string | null;
    message: string | null;
  };
  hours: string[];
  specialDays: string[];
  fulfilment: {
    pickup: boolean;
    delivery: boolean;
    zones: string[];
    pickupAddress: string | null;
    prepMinutes: number;
  };
  minOrder: string | null;
  freeDeliveryOver: string | null;
  payments: { id: PaymentMethod; label: string; note: string | null }[];
  onlinePayments: boolean;
  encomendas: { whileClosed: boolean; maxDays: number };
  catalog: string[];
  catalogTruncated: boolean;
  answers: { q: string; a: string }[];
  guidance: string[];
  guards: CompiledGuard[];
  version: number;
}

function hoursLines(h: StoreHours): string[] {
  const out: string[] = [];
  for (const w of h.windows ?? []) {
    const days = [...w.days]
      .sort()
      .map((d) => DAY[d])
      .join(', ');
    out.push(`${days}: ${w.open}–${w.close}`);
  }
  return out.length ? out : ['sem horário cadastrado'];
}

function adjustmentNote(a: { percentBps?: number; fixedCents?: number } | null): string | null {
  if (!a) return null;
  if (a.percentBps)
    return `${a.percentBps < 0 ? 'desconto' : 'acréscimo'} de ${Math.abs(a.percentBps) / 100}%`;
  if (a.fixedCents)
    return `${a.fixedCents < 0 ? 'desconto' : 'acréscimo'} de ${brl(Math.abs(a.fixedCents))}`;
  return null;
}

export async function buildPack(tx: Sql, tenantId: string, now: Date): Promise<StorePack> {
  const [tenant] = await tx<{ id: string; slug: string; name: string }[]>`
    select id, slug, name from tenants where id = ${tenantId}`;
  const settings = await loadStoreSettings(tx, tenantId);
  const agent = await loadAgent(tx, tenantId);
  const status = storeStatus(settings, now);
  const zones = await loadZoneRows(tx, tenantId);
  const catalog = await getCatalogView(tx, tenantId, now);
  const sales = await tx<{ product_id: string; n: number }[]>`
    select i.product_id, sum(i.qty)::int as n from order_items i
    join orders o on o.id = i.order_id
    where o.tenant_id = ${tenantId} and o.placed_at > now() - interval '60 days' and o.state <> 'cancelled'
    group by i.product_id`;
  const sold = new Map(sales.map((r) => [r.product_id, r.n]));

  const all = catalog.categories.flatMap((c) => c.products.map((p) => ({ c, p })));
  const keep =
    all.length <= PACK_PRODUCTS
      ? new Set(all.map((x) => x.p.id))
      : new Set(
          [...all]
            .sort((a, b) => (sold.get(b.p.id) ?? 0) - (sold.get(a.p.id) ?? 0))
            .slice(0, PACK_PRODUCTS)
            .map((x) => x.p.id),
        );
  const lines: string[] = [];
  for (const c of catalog.categories) {
    const ps = c.products.filter((p) => keep.has(p.id));
    lines.push(
      `## ${c.name}${ps.length < c.products.length ? ` (${c.products.length - ps.length} outros: use search_catalog)` : ''}`,
    );
    for (const p of ps) {
      const price = p.fromPriceCents
        ? `a partir de ${brl(p.fromPriceCents)}`
        : brl(p.basePriceCents);
      const flags = [
        p.status !== 'active'
          ? p.availabilityLabel
            ? `indisponível agora (${p.availabilityLabel})`
            : 'esgotado'
          : null,
        p.needsChoices ? 'tem opções: use get_product' : null,
        p.kind === 'combo' ? 'combo' : null,
        p.requiresPreorder ? `encomenda (${p.preorderLeadDays} dia(s) de antecedência)` : null,
        p.promoLabel ? `promoção ${p.promoLabel}` : null,
      ].filter(Boolean);
      lines.push(
        `${p.slug} · ${p.name} · ${price}${flags.length ? ` · ${flags.join(' · ')}` : ''}`,
      );
    }
  }

  const online = (await onlineOffer(tx, tenantId, vendedorDeps().provider)).online;
  const methods = offeredMethods(settings) as PaymentMethod[];
  const knowledge = await liveRules(tx, tenantId);
  const minOrder = settings?.min_order_cents ? brl(settings.min_order_cents) : null;
  const special = upcomingSpecialDays(
    settings?.special_days,
    settings?.hours?.timezone ?? 'America/Sao_Paulo',
    now,
    6,
  ).map(
    (d) =>
      `${d.date}: ${d.closed ? 'fechado' : `${d.open}–${d.close}`}${d.label ? ` (${d.label})` : ''}`,
  );

  return {
    storeName: tenant!.name,
    timezone: settings?.hours?.timezone ?? 'America/Sao_Paulo',
    url: await storeOrigin(tx, tenant!, vendedorDeps().storeDomain),
    agent: {
      name: agent.settings.name,
      disclose: agent.settings.disclose,
      tone: agent.settings.tone,
      voice: agent.settings.voice,
      capabilities: agent.settings.capabilities,
      handoff: agent.settings.handoff,
      coverage: agent.settings.coverage,
      intro: introduction(agent.settings, tenant!.name),
      pixOnlyAfterCancels: agent.settings.pixOnlyAfterCancels,
    },
    status: {
      status: status.status,
      closesAt: status.closesAt ?? null,
      resumesAt: status.resumesAt ?? null,
      message:
        status.status === 'paused'
          ? (settings?.pause_message ?? null)
          : status.status === 'closed'
            ? (settings?.closed_message ?? null)
            : null,
    },
    hours: settings ? hoursLines(settings.hours) : [],
    specialDays: special,
    fulfilment: {
      pickup: settings?.pickup_enabled ?? true,
      delivery: (settings?.delivery_enabled ?? false) && zones.length > 0,
      zones: zones
        .map((z) =>
          z.kind === 'neighborhood' ? `${z.name}: ${z.neighborhoods.join(', ')}` : z.name,
        )
        .slice(0, 40),
      pickupAddress: settings?.pickup_address ?? settings?.address ?? null,
      prepMinutes: settings?.prep_time_minutes ?? 30,
    },
    minOrder,
    freeDeliveryOver: settings?.delivery_free_over_cents
      ? brl(settings.delivery_free_over_cents)
      : null,
    payments: methods
      .filter((m) => m !== 'card_online' || online)
      .map((m) => ({
        id: m,
        label: PAYMENT_LABEL[m],
        note: adjustmentNote(adjustmentFor(settings, m)),
      })),
    onlinePayments: online,
    encomendas: {
      whileClosed: settings?.preorders_while_closed ?? false,
      maxDays: settings?.preorder_max_days ?? 30,
    },
    catalog: lines,
    catalogTruncated: all.length > PACK_PRODUCTS,
    answers: knowledge.answers,
    guidance: knowledge.guidance,
    guards: knowledge.guards,
    version: agent.packVersion,
  };
}

// ── the customer card (§4.10) ────────────────────────────────────────────────

export interface CustomerCard {
  firstName: string | null;
  orders: number;
  lastOrder: { number: number; placedAt: string; items: string; state: string } | null;
  usual: string | null;
  addresses: { label: string; hasPin: boolean }[];
  preferredPayment: string | null;
  cancelledRecently: number;
}

const firstName = (n: string | null | undefined) => {
  const f = (n ?? '').trim().split(/\s+/)[0] ?? '';
  return f.length >= 2 && f.length <= 30 && f !== 'Cliente' ? f : null;
};

export async function customerCard(
  tx: Sql,
  tenantId: string,
  phone: string | null,
): Promise<CustomerCard | null> {
  if (!phone || phone.startsWith('+')) return null;
  const orders = await ordersByPhone(tx, tenantId, phone, 30);
  if (!orders.length) return null;
  const rows = await tx<
    {
      customer: { name?: string } | null;
      delivery: Record<string, unknown> | null;
      method: string | null;
      state: string;
      placed_at: Date;
    }[]
  >`select customer, delivery, payment ->> 'method' as method, state, placed_at from orders
    where tenant_id = ${tenantId} and customer_phone = ${phone} order by placed_at desc limit 30`;
  const baskets = new Map<string, number>();
  for (const o of orders) {
    const key = o.items
      .map((i) => `${i.qty}× ${i.name}`)
      .sort()
      .join(', ');
    if (key) baskets.set(key, (baskets.get(key) ?? 0) + 1);
  }
  const usual =
    [...baskets.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const pays = new Map<string, number>();
  for (const r of rows) if (r.method) pays.set(r.method, (pays.get(r.method) ?? 0) + 1);
  const pay = [...pays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as PaymentMethod | undefined;
  const seen = new Set<string>();
  const addresses: CustomerCard['addresses'] = [];
  for (const r of rows) {
    const d = r.delivery;
    if (!d || d.mode !== 'delivery') continue;
    const label = [
      d.street && d.number ? `${String(d.street)}, ${String(d.number)}` : d.address,
      d.neighborhood,
    ]
      .filter(Boolean)
      .join(' · ');
    if (!label || seen.has(label)) continue;
    seen.add(label);
    addresses.push({ label: String(label).slice(0, 120), hasPin: typeof d.lat === 'number' });
    if (addresses.length >= 3) break;
  }
  const last = orders[0]!;
  return {
    firstName: firstName(rows[0]?.customer?.name),
    orders: orders.length,
    lastOrder: {
      number: last.number,
      placedAt: last.placedAt,
      items: last.items
        .map((i) => `${i.qty}× ${i.name}`)
        .join(', ')
        .slice(0, 300),
      state: last.state,
    },
    usual,
    addresses,
    preferredPayment: pay ? PAYMENT_LABEL[pay] : null,
    cancelledRecently: rows.filter(
      (r) => r.state === 'cancelled' && r.placed_at.getTime() > Date.now() - 30 * 86400_000,
    ).length,
  };
}

export interface SubjectContext {
  threadId: string;
  channel: Thread['channel'];
  test: boolean;
  stage: Thread['stage'];
  floor: string;
  floorUntil: string | null;
  ownerReason: string | null;
  knownPhone: boolean;
  profileName: string | null;
  customer: CustomerCard | null;
  order: { number: number; state: string } | null;
  language: string | null;
}

export function packJson(p: StorePack): Json {
  return p as unknown as Json;
}
