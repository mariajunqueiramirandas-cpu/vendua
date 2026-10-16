import type { Context, Hono } from 'hono';
import { gatewayAlive } from '../admin/routes-whatsapp.ts';
import { audit } from '../admin/audit.ts';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { bodyJson, HttpError, str, uuidParam } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { wipeAuth } from '../store-whatsapp/auth-store.ts';
import { claimControl } from './control.ts';
import { ZONE_CLAIMED } from './domains/lifecycle.ts';
import type { DomainProviders } from './domains/providers.ts';
import { ProviderError, type PaymentProvider } from './payments/provider.ts';
import { recordStaffEventTx } from './staff-events.ts';

// Staff reset or delete one store from the CRM. Both are confirmed by typing the store's slug.
//
// Reset: the store comes back as signup left it — paused, blank settings, the onboarding wizard
// from its first question — and keeps what makes it an account: the owner and their sessions,
// the address and domains, the plan and its billing, the storefront it runs, and the history
// staff and the owner read (audit log, staff events). Every table holding a store's rows is named
// below as kept or wiped; a table in neither list stops the reset (test/store-reset.test.ts fails
// first), so a new table is a decision, never a silent leftover or a silent loss.
//
// Delete: the subscription stops charging at Mercado Pago and the custom domains' Cloudflare zones
// go, then delete_store() (migration 0136) removes the tenant and every FK cascades.

/** account, billing, address, fleet and history: a reset leaves these rows alone */
export const RESET_KEEPS = [
  // the owner's sign-in (other members' rows go with their merchant_users row)
  'merchant_sessions',
  'merchant_login_links',
  'push_devices',
  'push_subscriptions',
  // address, domains and the storefront the fleet runs
  'domains',
  'custom_domains',
  'domain_orders',
  'fleet_probes',
  'fleet_incidents',
  'health_checks',
  'deployments',
  'storefront_ops',
  'storefront_builds',
  'template_migration_runs',
  // the plan and what was paid for (AI conversations are its usage meter)
  'subscriptions',
  'invoices',
  'billing_credits',
  'ai_credits',
  'ai_conversations',
  'signup_coupon_redemptions',
  'store_referrals',
  'partner_commissions',
  'provisionings',
  'site_requests',
  'site_tasks',
  'site_task_events',
  // platform rows that only point at the store
  'leads',
  'agent_version_pins',
  // history
  'audit_log',
  'staff_events',
] as const;

/** the store's own content and configuration: a reset deletes every row of these */
export const RESET_WIPES = [
  'addon_stock',
  'agent_actors',
  'agent_events',
  'agent_incentives',
  'agent_mailbox',
  'agent_memory',
  'analytics_events',
  'cart_items',
  'cart_reminders',
  'cart_shares',
  'carts',
  'cash_movements',
  'cash_sessions',
  'categories',
  'combo_slot_items',
  'combo_slots',
  'copilot_actions',
  'copilot_media',
  'copilot_media_calls',
  'copilot_messages',
  'coupon_redemptions',
  'coupons',
  'customer_contacts',
  'customer_notes',
  'customer_session_failures',
  'delivery_zones',
  'freio_events',
  'idempotency_keys',
  'kitchen_marks',
  'kitchen_tickets',
  'media_objects',
  'media_variants',
  'menu_import_images',
  'menu_imports',
  'modifier_groups',
  'modifiers',
  'notify_requests',
  'order_events',
  'order_items',
  'order_late_notices',
  'orders',
  'outbox',
  'party_group_products',
  'party_groups',
  'party_profiles',
  'payment_connections',
  'payment_refunds',
  'payments',
  'pdv_payments',
  'pdv_tables',
  'pdv_tabs',
  'plan_cycles',
  'plan_subscriptions',
  'print_devices',
  'print_jobs',
  'print_pairings',
  'printers',
  'product_media',
  'products',
  'push_attempts',
  'push_deliveries',
  'shopper_media',
  'shopper_messages',
  'shopper_plans',
  'shopper_threads',
  'status_plans',
  'status_posts',
  'stock_movements',
  'store_agent',
  'store_knowledge',
  'store_wa_contacts',
  'store_wa_history_requests',
  'store_wa_messages',
  'store_wa_optouts',
  'suggestion_events',
  'users',
  'usual_reminders',
  'vendedor_demand',
  'vendedor_quick_replies',
  'vendedor_runs',
] as const;

/** reset row by row in `resetStoreTx` */
export const RESET_OWN_STEPS = [
  'store_settings',
  'merchant_users',
  'storefront_templates',
  'storefront_tokens',
  'store_whatsapp',
  'store_wa_auth',
  'platform_wa_dua_senders',
] as const;

const KEEPS = new Set<string>(RESET_KEEPS);
const WIPES = new Set<string>(RESET_WIPES);
const OWN = new Set<string>(RESET_OWN_STEPS);
const IDENT = /^[a-z_][a-z0-9_]*$/;
/** the bundle every store starts on; a site sob medida's own design is kept */
const DEFAULT_BUNDLE = '_template';

const rlog = log.child({ mod: 'store-reset' });

interface StoreRow {
  id: string;
  slug: string;
  name: string;
  status: string;
}

/** Every public table with a tenant_id, and the order a reset deletes the wiped ones in: a row
 *  goes before the rows it points at with a no-action FK. */
export async function wipePlan(tx: Sql): Promise<{ tables: string[]; order: string[] }> {
  const tables = (
    await tx<{ t: string }[]>`
      select c.relname as t from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relkind in ('r', 'p') and not c.relispartition
      order by 1`
  ).map((r) => r.t);
  const edges = await tx<{ child: string; parent: string }[]>`
    select ch.relname as child, pa.relname as parent from pg_constraint k
      join pg_class ch on ch.oid = k.conrelid
      join pg_class pa on pa.oid = k.confrelid
    where k.contype = 'f' and k.confdeltype in ('a', 'r') and k.conrelid <> k.confrelid`;
  const left = new Set(tables.filter((t) => WIPES.has(t)));
  const order: string[] = [];
  while (left.size) {
    const ready = [...left].filter(
      (t) => !edges.some((e) => e.parent === t && e.child !== t && left.has(e.child)),
    );
    if (!ready.length) throw new Error(`store reset: FK cycle among ${[...left].join(', ')}`);
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  return { tables, order };
}

export function unclassified(tables: string[]): string[] {
  return tables.filter((t) => !KEEPS.has(t) && !WIPES.has(t) && !OWN.has(t));
}

/** the store's own rows too: the control scope alone doesn't open every store table */
const scopeTo = (tx: Sql, id: string) => tx`select set_config('vendua.tenant_id', ${id}, true)`;

/**
 * The reset itself, inside a control transaction (the claim's). The wipe runs in the store's own
 * scope with the control scope closed, so RLS keeps every statement inside this one store; the
 * control scope is open again when it returns.
 */
export async function resetStoreTx(
  tx: Sql,
  store: StoreRow,
): Promise<{ resetAt: string; rows: number }> {
  const plan = await wipePlan(tx);
  const loose = unclassified(plan.tables);
  if (loose.length)
    throw new Error(`store reset: tables neither kept nor wiped: ${loose.join(', ')}`);
  const id = store.id;
  const resetAt = new Date().toISOString();
  await scopeTo(tx, id);
  const owners = (
    await tx<{ id: string }[]>`
      select id from merchant_users where tenant_id = ${id} and role = 'owner'`
  ).map((r) => r.id);
  // Duá's senders are platform rows: the members leaving stop reaching the store through it
  await tx`
    delete from platform_wa_dua_senders
    where tenant_id = ${id} and (user_id is null or user_id <> all(${owners}::uuid[]))`;

  // a throw below aborts the whole transaction, so nothing needs the scope put back on the way out
  await tx`
    select set_config('vendua.control', '', true), set_config('vendua.print_pairing', '1', true)`;
  let rows = 0;
  const wa = await tx`select 1 from store_whatsapp where tenant_id = ${id}`;
  if (wa.length && (await gatewayAlive(tx))) {
    // the gateway logs out on WhatsApp's side and forgets the login (as "desconectar" does)
    await tx`
        update store_whatsapp set wanted = false, wipe_requested_at = ${resetAt},
          pair_requested_at = null, pair_phone = null, state = 'off', detail = null,
          pair_code = null, pair_code_expires_at = null, phone = null, account_name = null,
          connected_at = null, outage_since = null, events = default, cart_reminder = default,
          usual_reminder = default, usual_per_day = default, state_changed_at = now(),
          updated_at = now()
        where tenant_id = ${id}`;
  } else {
    // no gateway to log out: the phone keeps a dead entry the owner removes
    await wipeAuth(tx, id);
    await tx`delete from store_whatsapp where tenant_id = ${id}`;
  }

  for (const t of plan.order) {
    if (!IDENT.test(t)) throw new Error(`store reset: odd table name ${t}`);
    rows += (await tx.unsafe(`delete from "${t}" where tenant_id = $1`, [id])).count;
  }
  rows += (
    await tx`
        delete from storefront_templates where tenant_id = ${id} and bundle = ${DEFAULT_BUNDLE}`
  ).count;
  rows += (
    await tx`delete from storefront_tokens where tenant_id = ${id} and bundle = ${DEFAULT_BUNDLE}`
  ).count;
  rows += (await tx`delete from merchant_users where tenant_id = ${id} and role <> 'owner'`).count;

  // as provision_store() and signup leave it; email, billing hold, segment and the platform
  // fee are the account's, not the store's setup
  const [prev] = await tx<
    {
      email: string | null;
      billing_hold: boolean;
      segment: string | null;
      marketplace_fee_bp: number | null;
      onboarding: { from?: unknown } | null;
    }[]
  >`
      delete from store_settings where tenant_id = ${id}
      returning email, billing_hold, segment, marketplace_fee_bp, onboarding`;
  const onboarding = {
    ...(prev?.onboarding?.from === 'signup' ? { from: 'signup' } : {}),
    resetAt,
  };
  await tx`
      insert into store_settings (tenant_id, hours, pickup_enabled, delivery_enabled,
        status_override, pause_message, billing_hold, email, segment, marketplace_fee_bp, onboarding)
      values (${id}, '{"timezone": "America/Sao_Paulo", "windows": []}', false, false, 'paused',
        'A loja abre em breve.', ${prev?.billing_hold ?? true}, ${prev?.email ?? null},
        ${prev?.segment ?? null}, ${prev?.marketplace_fee_bp ?? null}, ${tx.json(onboarding)})`;

  await audit(
    tx,
    id,
    { userId: null, name: 'Equipe Venduá' },
    {
      action: 'store.reset',
      entity: 'account',
      entityId: id,
      summary:
        'zerou a loja: cardápio, pedidos, clientes, equipe e configurações voltaram ao começo',
    },
  );
  for (const topic of ['store', 'catalog', 'team', 'marketing'] as const)
    await emitAdminTx(tx, id, topic);
  await tx`
    select set_config('vendua.control', '1', true), set_config('vendua.print_pairing', '', true)`;
  await recordStaffEventTx(
    tx,
    'store.reset',
    { storeName: store.name, slug: store.slug },
    { tenantId: id },
  );
  return { resetAt, rows };
}

/** A preapproval Mercado Pago no longer has, or already cancelled, is not charging. Read first:
 *  a retry after a later step failed finds it cancelled, and MP may refuse to cancel it twice. */
async function stopPreapproval(provider: PaymentProvider, id: string | null) {
  if (!id) return;
  try {
    if ((await provider.getSubscription(id)).status === 'cancelled') return;
    await provider.updateSubscription(id, { status: 'cancelled' });
  } catch (err) {
    if (!(err instanceof ProviderError && err.code === 'not_found')) throw err;
  }
}

async function storeOr404(tx: Sql, id: string): Promise<StoreRow> {
  const [row] = await tx<StoreRow[]>`
    select id, slug, name, status from tenants where id = ${id} and status <> 'platform'`;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'store not found');
  return row;
}

async function confirmed(c: Context): Promise<string> {
  const body = await bodyJson(c);
  return str(body.confirm, 'confirm', 60).trim().toLowerCase();
}

function confirmOr422(store: StoreRow, typed: string) {
  if (typed !== store.slug)
    throw new HttpError(422, 'CONFIRM_MISMATCH', `type "${store.slug}" to confirm`, {
      field: 'confirm',
    });
}

const lockStore = (tx: Sql, id: string) =>
  tx`select pg_advisory_xact_lock(hashtextextended(${`store-reset:${id}`}, 0))`;

export function mountStoreReset(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  requireIdemKey: (c: Context) => string;
  provider: PaymentProvider;
  domains: DomainProviders;
}) {
  const { app, sql, controlGate } = o;

  app.post('/control/v1/stores/:id/reset', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const typed = await confirmed(c);
    const res = await claimControl(sql, o.requireIdemKey(c), async (tx) => {
      // locked first: a reset queued behind a delete then finds the store gone (404)
      await lockStore(tx, id);
      const store = await storeOr404(tx, id);
      confirmOr422(store, typed);
      const out = await resetStoreTx(tx, store);
      rlog.warn({ tenantId: id, slug: store.slug, rows: out.rows }, 'store reset by staff');
      return { status: 200, body: out };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  app.post('/control/v1/stores/:id/delete', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const typed = await confirmed(c);
    const res = await claimControl(sql, o.requireIdemKey(c), async (tx) => {
      await lockStore(tx, id);
      const store = await storeOr404(tx, id);
      confirmOr422(store, typed);
      await scopeTo(tx, id);
      // the subscription row goes with the store: stop Mercado Pago charging first, so a failed
      // call leaves the store (and the claim) in place for a retry
      const [sub] = await tx<{ provider_subscription_id: string | null }[]>`
        select provider_subscription_id from subscriptions where tenant_id = ${id} for update`;
      try {
        await stopPreapproval(o.provider, sub?.provider_subscription_id ?? null);
      } catch (err) {
        rlog.warn({ err, tenantId: id }, 'store delete: preapproval not cancelled');
        throw new HttpError(
          502,
          'BILLING_PROVIDER_ERROR',
          'Mercado Pago did not cancel the subscription — try again',
        );
      }
      // DNS zones Venduá hosts for the store's own domains (Cloudflare is idempotent on a gone one)
      const zones = await tx<{ host: string; zone_id: string }[]>`
        select host, zone_id from custom_domains where tenant_id = ${id} and zone_id is not null`;
      const dns = o.domains.dnsHost;
      // zones Venduá holds but can't reach now would outlive the rows that name them
      if (zones.length && !dns)
        throw new HttpError(502, 'DNS_PROVIDER_ERROR', 'Cloudflare is not configured — try again');
      if (zones.length && dns) {
        try {
          for (const z of zones) {
            const zoneId =
              z.zone_id === ZONE_CLAIMED ? (await dns.findZone(z.host))?.id : z.zone_id;
            if (zoneId) await dns.deleteZone(zoneId);
          }
        } catch (err) {
          rlog.warn({ err, tenantId: id }, 'store delete: DNS zone not removed');
          throw new HttpError(
            502,
            'DNS_PROVIDER_ERROR',
            'Cloudflare did not remove a zone — try again',
          );
        }
      }
      const owner = (
        await tx<{ name: string | null }[]>`
          select name from merchant_users where tenant_id = ${id} and role = 'owner'
          order by created_at limit 1`
      )[0];
      const [gone] = await tx<{ ok: boolean }[]>`
        select delete_store(${id}::uuid, ${store.slug}) as ok`;
      if (!gone?.ok) throw new HttpError(404, 'NOT_FOUND', 'store not found');
      // the store's own events go with it: this one is the platform's
      await recordStaffEventTx(tx, 'store.deleted', {
        storeName: store.name,
        slug: store.slug,
        owner: owner?.name ?? null,
      });
      rlog.warn({ tenantId: id, slug: store.slug }, 'store deleted by staff');
      return { status: 200, body: { deleted: true, slug: store.slug } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });
}
