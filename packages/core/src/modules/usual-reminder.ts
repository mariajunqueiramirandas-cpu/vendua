import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, sessionCartId } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { OPT_OUT_FOOTER, firstName, optedOutTx } from '../store-whatsapp/messages.ts';
export { USUAL_INVITE } from '../store-whatsapp/messages.ts';
import {
  PROACTIVE_TTL,
  proactiveRoomTx,
  storeOpenNowTx,
  waLinkedTx,
} from '../store-whatsapp/proactive.ts';
import { phoneVariants } from '../store-whatsapp/text.ts';
import { orderLines } from './cart-share.ts';

// "O de sempre" (the owner, 2026-10-13; migration 0122): a shopper who asked for it — the tick at
// checkout, or LEMBRAR after an order was delivered — gets their usual order back as a one-tap
// bag link from the store's own WhatsApp, at most once a week, never sooner than a week after
// they last ordered. Per store: off by default, a daily ceiling, an hourly one (proactive.ts),
// one queued per sweep pass at random so a list never goes out in a burst, and only while the
// store is open. PARAR stops it with every other notice; nothing here is a broadcast.

const usLog = log.child({ mod: 'usual-reminder' });

/** at most one per shopper in this long, counting the bag reminder too */
const PER_PHONE = '7 days';
/** a shopper who ordered this recently doesn't need reminding */
const SINCE_ORDER = '7 days';
/** a shopper gone this long without ordering has moved on: the consent lapses */
const LAPSE = '120 days';
/** each pass queues one at most, and only this often: a minute sweep spaces them ~4 min apart */
const PASS_CHANCE = 0.25;
/** how far back "the usual" looks */
const HISTORY = 30;
const NAME_MAX = 80;

const storeDomain = () => process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';

/** The store sends "o de sempre" now: turned on and its WhatsApp linked. */
export async function usualReminderOffered(tx: Sql, tenantId: string): Promise<boolean> {
  const [w] = await tx<{ on: boolean }[]>`
    select usual_reminder as on from store_whatsapp where tenant_id = ${tenantId}`;
  return !!w?.on && (await waLinkedTx(tx, tenantId));
}

/** The shopper asked; a repeat keeps the first consent's date and updates the name. */
export async function consentUsualTx(
  tx: Sql,
  tenantId: string,
  phone: string,
  name: string | null,
  source: 'checkout' | 'whatsapp',
): Promise<void> {
  await tx`
    insert into usual_reminders (tenant_id, phone, name, source)
    values (${tenantId}, ${phone}, ${name?.trim().slice(0, NAME_MAX) || null}, ${source})
    on conflict (tenant_id, phone) do update
      set name = coalesce(excluded.name, usual_reminders.name)`;
}

export async function withdrawUsualTx(tx: Sql, tenantId: string, phone: string): Promise<void> {
  const variants = phoneVariants(phone);
  await tx`delete from usual_reminders where tenant_id = ${tenantId} and phone = any(${variants})`;
  await tx`
    update store_wa_messages set status = 'skipped', error = 'withdrawn', lease_until = null
    where tenant_id = ${tenantId} and kind = 'usual_reminder' and status = 'pending'
      and phone = any(${variants})`;
}

export interface UsualLine {
  name: string;
  qty: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function list(lines: UsualLine[]): string {
  const names = lines
    .slice(0, 3)
    .map((l) => `${l.qty > 1 ? `${l.qty}x ` : ''}${clip(l.name.trim(), 40)}`);
  const more = lines.length - names.length;
  if (more > 0) return `${names.join(', ')} e mais ${more} ${more === 1 ? 'item' : 'itens'}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0]!;
}

/** Every word the shopper reads, ending with how to stop. */
export function renderUsualReminder(r: {
  storeName: string;
  firstName: string;
  lines: UsualLine[];
  url: string;
}): string {
  const hi = r.firstName ? `Oi, ${r.firstName}! ` : 'Oi! ';
  return `${hi}Aqui é da ${r.storeName} 👋\nBateu vontade do de sempre? ${list(r.lines)}.\nDeixamos a sacola pronta, com os preços de hoje: ${r.url}${OPT_OUT_FOOTER}`;
}

/**
 * "The usual": the basket the shopper ordered most among their last orders (seen at least
 * twice), else their latest one. Cancelled and refunded orders don't count.
 */
export async function usualOrderTx(
  tx: Sql,
  tenantId: string,
  phone: string,
): Promise<{ orderId: string; lines: UsualLine[] } | null> {
  const orders = await tx<{ id: string; basket: string; lines: UsualLine[] }[]>`
    select o.id,
           string_agg(i.qty || 'x' || coalesce(i.product_id::text, i.slug), ',' order by coalesce(i.product_id::text, i.slug)) as basket,
           json_agg(json_build_object('name', i.name, 'qty', i.qty) order by i.sort) as lines
    from orders o join order_items i on i.order_id = o.id
    where o.tenant_id = ${tenantId} and o.customer_phone = any(${phoneVariants(phone)})
      and o.state not in ('cancelled', 'refunded')
    group by o.id, o.placed_at
    order by o.placed_at desc
    limit ${HISTORY}`;
  if (!orders.length) return null;
  const seen = new Map<string, number>();
  for (const o of orders) seen.set(o.basket, (seen.get(o.basket) ?? 0) + 1);
  const [best, n] = [...seen].sort((a, b) => b[1] - a[1])[0]!;
  // the most recent order of the favourite basket (orders run newest first)
  const pick = n >= 2 ? orders.find((o) => o.basket === best)! : orders[0]!;
  return { orderId: pick.id, lines: pick.lines };
}

// ── the shopper's consent at checkout ────────────────────────────────────────

/**
 * The tick at checkout is sent after the order is placed, by the session that placed it: the
 * number is the one on that order, never one typed into this call, so nobody can sign up
 * someone else's phone.
 */
export function mountUsualReminder(d: {
  checkout: {
    post: (p: string, h: (c: Context) => Promise<Response>) => unknown;
    delete: (p: string, h: (c: Context) => Promise<Response>) => unknown;
  };
  sql: Sql;
  sessionSecret: string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
}) {
  const placedBy = async (c: Context, tx: Sql) => {
    const tenant = c.get('tenant') as Tenant;
    const cartId = await sessionCartId(c, d.sessionSecret);
    const [o] = await tx<{ phone: string | null; name: string | null }[]>`
      select customer_phone as phone, customer ->> 'name' as name from orders
      where tenant_id = ${tenant.id} and cart_id = ${cartId}`;
    if (!o) throw new HttpError(409, 'ORDER_REQUIRED', 'place the order first');
    if (!o.phone || !/^\d{10,11}$/.test(o.phone))
      throw new HttpError(422, 'INVALID_PHONE', 'the order has no Brazilian phone', {
        field: 'phone',
      });
    return { tenant, phone: o.phone, name: o.name };
  };
  d.checkout.post(
    '/usual-reminder',
    d.idempotency(d.sql, async (c, tx) => {
      const { tenant, phone, name } = await placedBy(c, tx);
      if (!(await usualReminderOffered(tx, tenant.id)))
        throw new HttpError(409, 'REMINDER_OFF', 'this store does not send usual-order reminders');
      // a number that said SAIR stays out until it says VOLTAR on WhatsApp
      if (await optedOutTx(tx, tenant.id, phone))
        return { status: 200, body: { reminder: { on: false } } };
      await consentUsualTx(tx, tenant.id, phone, name, 'checkout');
      return { status: 200, body: { reminder: { on: true } } };
    }),
  );
  d.checkout.delete(
    '/usual-reminder',
    d.idempotency(d.sql, async (c, tx) => {
      const { tenant, phone } = await placedBy(c, tx);
      await withdrawUsualTx(tx, tenant.id, phone);
      return { status: 200, body: { reminder: { on: false } } };
    }),
  );
}

// ── the sweep ────────────────────────────────────────────────────────────────

/** A store's day in its own timezone: the daily ceiling counts from local midnight. */
async function sentTodayTx(tx: Sql, tenantId: string): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    with tz as (
      select coalesce(s.hours ->> 'timezone', 'America/Sao_Paulo') as z
      from tenants t left join store_settings s on s.tenant_id = t.id where t.id = ${tenantId}
    )
    select count(*)::int as n from store_wa_messages, tz
    where tenant_id = ${tenantId} and kind = 'usual_reminder'
      and created_at >= (date_trunc('day', now() at time zone tz.z) at time zone tz.z)`;
  return r?.n ?? 0;
}

/**
 * Once a minute per store (admin sweep): maybe queue one reminder. `rand` lets tests decide the
 * coin. Returns how many were queued (0 or 1).
 */
export async function usualReminderPass(
  sql: Sql,
  tenantId: string,
  now = new Date(),
  rand = Math.random,
): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const [any] = await tx`select 1 from usual_reminders where tenant_id = ${tenantId} limit 1`;
    if (!any) return 0;
    // a consent whose shopper hasn't ordered in months lapses on its own
    await tx`
      delete from usual_reminders r
      where r.tenant_id = ${tenantId} and r.consented_at < ${now}::timestamptz - ${LAPSE}::interval
        and not exists (select 1 from orders o where o.tenant_id = ${tenantId}
                          and o.customer_phone = r.phone
                          and o.placed_at > ${now}::timestamptz - ${LAPSE}::interval)`;
    if (rand() >= PASS_CHANCE) return 0;
    if (!(await usualReminderOffered(tx, tenantId))) return 0;
    if (!(await storeOpenNowTx(tx, tenantId, now))) return 0;
    if ((await proactiveRoomTx(tx, tenantId, 'usual_reminder')) <= 0) return 0;
    const [w] = await tx<{ cap: number }[]>`
      select usual_per_day as cap from store_whatsapp where tenant_id = ${tenantId}`;
    if ((await sentTodayTx(tx, tenantId)) >= (w?.cap ?? 0)) return 0;
    // due: asked, last ordered a week or more ago, and nothing proactive from the store this week
    const due = await tx<{ phone: string; name: string | null }[]>`
      select r.phone, r.name from usual_reminders r
      where r.tenant_id = ${tenantId}
        and (r.last_sent_at is null or r.last_sent_at < ${now}::timestamptz - ${PER_PHONE}::interval)
        and exists (select 1 from orders o where o.tenant_id = ${tenantId}
                      and o.customer_phone = r.phone and o.state not in ('cancelled', 'refunded'))
        and not exists (select 1 from orders o where o.tenant_id = ${tenantId}
                          and o.customer_phone = r.phone
                          and o.placed_at > ${now}::timestamptz - ${SINCE_ORDER}::interval)
        and not exists (select 1 from store_wa_messages m where m.tenant_id = ${tenantId}
                          and m.kind in ('usual_reminder', 'cart_reminder')
                          and m.phone = r.phone
                          and m.created_at > ${now}::timestamptz - ${PER_PHONE}::interval)
      order by r.last_sent_at nulls first, r.consented_at
      limit 5
      for update of r skip locked`;
    const [store] = await tx<{ name: string; slug: string }[]>`
      select name, slug from tenants where id = ${tenantId}`;
    for (const d of due) {
      if (await optedOutTx(tx, tenantId, d.phone)) {
        await tx`delete from usual_reminders where tenant_id = ${tenantId} and phone = ${d.phone}`;
        continue;
      }
      const usual = await usualOrderTx(tx, tenantId, d.phone);
      if (!usual?.lines.length) continue;
      const items = await orderLines(tx, tenantId, usual.orderId);
      if (!items.length) continue;
      // the storefront's ?cart= link: re-added at today's prices, unavailable lines reported there
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      await tx`
        insert into cart_shares (tenant_id, code, items, expires_at)
        values (${tenantId}, ${code}, ${tx.json(items as never)}, now() + interval '3 days')`;
      const origin = await storeOrigin(tx, { id: tenantId, slug: store!.slug }, storeDomain());
      const body = renderUsualReminder({
        storeName: store!.name,
        firstName: firstName(d.name ?? ''),
        lines: usual.lines,
        url: `${origin}/?cart=${code}`,
      });
      await tx`
        insert into store_wa_messages (tenant_id, kind, phone, body, expires_at)
        values (${tenantId}, 'usual_reminder', ${d.phone}, ${body},
                now() + ${PROACTIVE_TTL}::interval)`;
      await tx`update usual_reminders set last_sent_at = ${now}
               where tenant_id = ${tenantId} and phone = ${d.phone}`;
      usLog.info({ tenantId }, 'usual reminder queued');
      return 1;
    }
    return 0;
  });
}

// ── the merchant's view ──────────────────────────────────────────────────────

export async function usualReminderViewTx(tx: Sql, tenantId: string, storeName: string) {
  const [[w], [counts], products, [store]] = await Promise.all([
    tx<{ on: boolean; perDay: number }[]>`
      select usual_reminder as on, usual_per_day as "perDay" from store_whatsapp
      where tenant_id = ${tenantId}`,
    tx<{ asked: number; sent: number; ordered: number }[]>`
      select (select count(*)::int from usual_reminders where tenant_id = ${tenantId}) as asked,
             count(*)::int as sent,
             count(*) filter (where exists (
               select 1 from orders o where o.tenant_id = ${tenantId} and o.customer_phone = m.phone
                 and o.placed_at between m.created_at and m.created_at + interval '3 days'))::int as ordered
      from store_wa_messages m
      where m.tenant_id = ${tenantId} and m.kind = 'usual_reminder'
        and m.created_at > now() - interval '7 days'`,
    tx<{ name: string }[]>`
      select name from products where tenant_id = ${tenantId} and status = 'active'
        and deleted_at is null order by created_at limit 2`,
    tx<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`,
  ]);
  const origin = await storeOrigin(tx, { id: tenantId, slug: store?.slug ?? '' }, storeDomain());
  const lines =
    products.length >= 2
      ? [
          { name: products[0]!.name, qty: 2 },
          { name: products[1]!.name, qty: 1 },
        ]
      : [
          { name: 'Marmita de frango', qty: 2 },
          { name: 'Suco de laranja', qty: 1 },
        ];
  return {
    on: !!w?.on,
    perDay: w?.perDay ?? 20,
    asked: counts?.asked ?? 0,
    week: { sent: counts?.sent ?? 0, ordered: counts?.ordered ?? 0 },
    preview: renderUsualReminder({
      storeName,
      firstName: 'Ana',
      lines,
      url: `${origin}/?cart=K7m2Qx9pW3aB`,
    }),
  };
}

export type UsualReminderView = Awaited<ReturnType<typeof usualReminderViewTx>>;
