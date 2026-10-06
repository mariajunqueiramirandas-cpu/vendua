import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, bodyJson, sessionCartId } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { OPT_OUT_FOOTER, firstName, optedOutTx } from '../store-whatsapp/messages.ts';
import {
  PROACTIVE_TTL,
  proactiveRoomTx,
  storeOpenNowTx,
  waLinkedTx,
} from '../store-whatsapp/proactive.ts';
import { phoneVariants } from '../store-whatsapp/text.ts';
import { loadAgent } from '../vendedor/settings.ts';
import { assertCartOpen } from './cart.ts';
import { createShare } from './cart-share.ts';
import { validPhone } from './customer.ts';

// The bag reminder (owner, 2026-10-06): a store WITHOUT the Vendedor may turn on one WhatsApp
// message, from its own number, to a shopper who left a full bag — only one who ticked "me lembre"
// at checkout. Off by default. The Vendedor recovers its own conversations (§4.13), so a store
// with it on never offers this. One per cart, ever; after an hour idle, inside 24 h, store open.

const remLog = log.child({ mod: 'cart-reminder' });

const IDLE_MS = 3_600_000;
const WINDOW_MS = 24 * 3_600_000;
/** a reminder per phone per week at most, however many bags they leave */
const PER_PHONE = '7 days';
/** consents are kept this long, then forgotten whatever became of them */
const RETENTION = '30 days';
const NAME_MAX = 80;

const storeDomain = () => process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br';

/** The store offers the reminder now: turned on, its WhatsApp linked, and no Vendedor. */
export async function cartReminderOffered(tx: Sql, tenantId: string): Promise<boolean> {
  const [w] = await tx<{ on: boolean }[]>`
    select cart_reminder as on from store_whatsapp where tenant_id = ${tenantId}`;
  if (!w?.on || !(await waLinkedTx(tx, tenantId))) return false;
  return !(await loadAgent(tx, tenantId)).enabled;
}

export interface ReminderLine {
  name: string;
  qty: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "2x Pizza, Coca-Cola e Pudim" / "A, B, C e mais 2 itens" */
function bagList(lines: ReminderLine[]): string {
  const names = lines
    .slice(0, 3)
    .map((l) => `${l.qty > 1 ? `${l.qty}x ` : ''}${clip(l.name.trim(), 40)}`);
  const more = lines.length - names.length;
  if (more > 0) return `${names.join(', ')} e mais ${more} ${more === 1 ? 'item' : 'itens'}`;
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0]!;
}

/** Every word the shopper reads (Core's, like the order steps), ending with how to stop. */
export function renderCartReminder(r: {
  storeName: string;
  firstName: string;
  lines: ReminderLine[];
  url: string;
}): string {
  const hi = r.firstName ? `Oi, ${r.firstName}! ` : 'Oi! ';
  return `${hi}Aqui é da ${r.storeName} 👋\nSua sacola ficou guardada: ${bagList(r.lines)}.\nQuer terminar o pedido? É só abrir: ${r.url}${OPT_OUT_FOOTER}`;
}

async function linesOf(tx: Sql, tenantId: string, cartId: string): Promise<ReminderLine[]> {
  return tx<ReminderLine[]>`
    select p.name, i.qty from cart_items i join products p on p.id = i.product_id
    where i.tenant_id = ${tenantId} and i.cart_id = ${cartId}
    order by i.created_at limit 100`;
}

// ── the shopper's consent ────────────────────────────────────────────────────

export function mountCartReminder(d: {
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
  d.checkout.post(
    '/cart/reminder',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      const body = await bodyJson(c, 4 * 1024);
      const phone = validPhone(body.phone);
      if (!phone)
        throw new HttpError(422, 'INVALID_PHONE', 'phone must be a Brazilian number with DDD', {
          field: 'phone',
        });
      if (body.name !== undefined && body.name !== null && typeof body.name !== 'string')
        throw new HttpError(422, 'BAD_REQUEST', 'name must be a string', { field: 'name' });
      // the checkout's own name field takes 200; only the first name is ever said
      if (typeof body.name === 'string' && body.name.length > 200)
        throw new HttpError(422, 'BAD_REQUEST', 'name is too long', { field: 'name' });
      const name =
        typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX).trim() || null : null;
      if (!(await cartReminderOffered(tx, tenant.id)))
        throw new HttpError(409, 'REMINDER_OFF', 'this store does not send bag reminders');
      await assertCartOpen(tx, tenant.id, cartId);
      // a bag already reminded stays reminded: ticking again never earns a second message
      await tx`
        insert into cart_reminders (cart_id, tenant_id, phone, name)
        values (${cartId}, ${tenant.id}, ${phone}, ${name})
        on conflict (cart_id) do update set phone = excluded.phone, name = excluded.name,
          consented_at = now(), withdrawn_at = null, skipped = null
        where cart_reminders.sent_at is null`;
      return { status: 200, body: { reminder: { on: true } } };
    }),
  );

  d.checkout.delete(
    '/cart/reminder',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      await withdrawTx(tx, tenant.id, cartId);
      return { status: 200, body: { reminder: { on: false } } };
    }),
  );
}

/** Consent withdrawn: the number goes, and a reminder still in the queue stays there. */
async function withdrawTx(tx: Sql, tenantId: string, cartId: string) {
  await tx`
    update cart_reminders set withdrawn_at = now(), phone = null, name = null
    where tenant_id = ${tenantId} and cart_id = ${cartId} and withdrawn_at is null`;
  await tx`
    update store_wa_messages set status = 'skipped', error = 'withdrawn', lease_until = null
    where tenant_id = ${tenantId} and cart_id = ${cartId} and kind = 'cart_reminder'
      and status = 'pending'`;
}

// ── the sweep ────────────────────────────────────────────────────────────────

interface Due {
  cart_id: string;
  phone: string;
  name: string | null;
  consented_at: Date;
}

async function skipReasonTx(tx: Sql, tenantId: string, d: Due): Promise<string | null> {
  const variants = phoneVariants(d.phone);
  // two sweeps holding two of one number's bags must not both pass the weekly check; the one
  // that loses the lock leaves the bag for the next pass (a wait could deadlock the two sweeps)
  const [lock] = await tx<{ got: boolean }[]>`
    select pg_try_advisory_xact_lock(hashtext(${`cart-reminder:${tenantId}:${[...variants].sort()[0]}`})) as got`;
  if (!lock!.got) return 'busy';
  const [r] = await tx<{ empty: boolean; thread: boolean; ordered: boolean; recent: boolean }[]>`
    select
      not exists (select 1 from cart_items where tenant_id = ${tenantId} and cart_id = ${d.cart_id}) as empty,
      exists (select 1 from shopper_threads where tenant_id = ${tenantId} and cart_id = ${d.cart_id}) as thread,
      exists (select 1 from orders where tenant_id = ${tenantId} and customer_phone = any(${variants})
              and placed_at > ${d.consented_at}) as ordered,
      exists (select 1 from store_wa_messages where tenant_id = ${tenantId} and kind = 'cart_reminder'
              and phone = any(${variants}) and created_at > now() - ${PER_PHONE}::interval) as recent`;
  if (r!.empty) return 'empty';
  // a bag a conversation built is that conversation's to follow up
  if (r!.thread) return 'vendedor_thread';
  // bought it some other way since (another device, another bag)
  if (r!.ordered) return 'ordered';
  if (r!.recent) return 'recent';
  if (await optedOutTx(tx, tenantId, d.phone)) return 'opted_out';
  return null;
}

async function queueTx(
  tx: Sql,
  tenantId: string,
  d: Due,
  storeName: string,
  origin: string,
): Promise<number> {
  // opens the same bag on any device; the device that still holds it isn't given a second
  const share = await createShare(tx, tenantId, d.cart_id);
  await tx`update cart_shares set source_cart_id = ${d.cart_id}
           where tenant_id = ${tenantId} and code = ${share.code}`;
  const body = renderCartReminder({
    storeName,
    firstName: firstName(d.name ?? ''),
    lines: await linesOf(tx, tenantId, d.cart_id),
    url: `${origin}/?cart=${share.code}`,
  });
  const rows = await tx`
    insert into store_wa_messages (tenant_id, kind, cart_id, phone, body, expires_at)
    values (${tenantId}, 'cart_reminder', ${d.cart_id}, ${d.phone}, ${body},
            now() + ${PROACTIVE_TTL}::interval)
    on conflict (cart_id) where kind = 'cart_reminder' and cart_id is not null do nothing
    returning id`;
  await tx`update cart_reminders set sent_at = now(), phone = null, name = null
           where cart_id = ${d.cart_id}`;
  return rows.length;
}

/**
 * Once a minute per store (admin sweep): queue the reminders that are due. Rows are claimed
 * with `skip locked` and marked in the transaction that queues, and the queue holds one per
 * cart, so Core replicas sweeping together still send one. Returns how many were queued.
 */
export async function cartReminderPass(
  sql: Sql,
  tenantId: string,
  now = new Date(),
): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const [any] = await tx`select 1 from cart_reminders where tenant_id = ${tenantId} limit 1`;
    if (!any) return 0;
    // what can no longer go is closed, and its number forgotten
    await tx`
      update cart_reminders r set phone = null, name = null,
        skipped = case when c.status = 'completed' then 'ordered' else 'expired' end
      from carts c
      where r.tenant_id = ${tenantId} and c.id = r.cart_id
        and r.sent_at is null and r.withdrawn_at is null and r.skipped is null
        and (c.status <> 'open' or greatest(c.updated_at, r.consented_at) <= ${new Date(now.getTime() - WINDOW_MS)})`;
    await tx`
      delete from cart_reminders
      where tenant_id = ${tenantId} and created_at < ${now}::timestamptz - ${RETENTION}::interval`;
    if (!(await cartReminderOffered(tx, tenantId))) return 0;
    // never at night: a bag left after closing waits for the opening, still inside the 24 h
    if (!(await storeOpenNowTx(tx, tenantId, now))) return 0;
    const room = await proactiveRoomTx(tx, tenantId, 'cart_reminder');
    if (room <= 0) return 0;
    const due = await tx<Due[]>`
      select r.cart_id, r.phone, r.name, r.consented_at
      from cart_reminders r join carts c on c.id = r.cart_id
      where r.tenant_id = ${tenantId} and r.sent_at is null and r.withdrawn_at is null
        and r.skipped is null and r.phone is not null and c.status = 'open'
        and greatest(c.updated_at, r.consented_at) <= ${new Date(now.getTime() - IDLE_MS)}
      order by r.consented_at
      limit ${room}
      for update of r skip locked`;
    if (!due.length) return 0;
    const [store] = await tx<{ name: string; slug: string }[]>`
      select name, slug from tenants where id = ${tenantId}`;
    const origin = await storeOrigin(tx, { id: tenantId, slug: store!.slug }, storeDomain());
    let queued = 0;
    for (const d of due) {
      const skip = await skipReasonTx(tx, tenantId, d);
      if (skip === 'busy') continue;
      if (skip) {
        await tx`update cart_reminders set skipped = ${skip}, phone = null, name = null
                 where cart_id = ${d.cart_id}`;
        continue;
      }
      // one bag that can't be rendered (emptied by a concurrent edit) mustn't hold the others
      try {
        queued += await (
          tx as unknown as { savepoint<T>(fn: (s: Sql) => Promise<T>): Promise<T> }
        ).savepoint((sp) => queueTx(sp, tenantId, d, store!.name, origin));
      } catch (err) {
        remLog.warn({ err, tenantId, cartId: d.cart_id }, 'bag reminder not queued');
        await tx`update cart_reminders set skipped = 'failed', phone = null, name = null
                 where cart_id = ${d.cart_id}`;
      }
    }
    if (queued) remLog.info({ tenantId, queued }, 'bag reminders queued');
    return queued;
  });
}

// ── the merchant's view ──────────────────────────────────────────────────────

const SAMPLE_LINES: ReminderLine[] = [
  { name: 'Bolo de cenoura', qty: 2 },
  { name: 'Brigadeiro', qty: 1 },
  { name: 'Café coado', qty: 1 },
  { name: 'Pão de queijo', qty: 1 },
];

/** The WhatsApp screen's part: the switch, why it can't be on, what the shopper reads (the
 *  store's own first products in a sample bag) and what it did this week. */
export async function cartReminderViewTx(tx: Sql, tenantId: string, storeName: string) {
  const [[w], agent, products, [store], [week]] = await Promise.all([
    tx<
      { on: boolean }[]
    >`select cart_reminder as on from store_whatsapp where tenant_id = ${tenantId}`,
    loadAgent(tx, tenantId),
    tx<{ name: string }[]>`
      select name from products where tenant_id = ${tenantId} and status = 'active'
        and deleted_at is null
      order by created_at limit 4`,
    tx<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`,
    tx<{ sent: number; ordered: number }[]>`
      select count(*)::int as sent, count(*) filter (where c.status = 'completed')::int as ordered
      from cart_reminders r join carts c on c.id = r.cart_id
      where r.tenant_id = ${tenantId} and r.sent_at > now() - interval '7 days'`,
  ]);
  const origin = await storeOrigin(tx, { id: tenantId, slug: store?.slug ?? '' }, storeDomain());
  const lines =
    products.length >= 2
      ? products.map((p, i) => ({ name: p.name, qty: i === 0 ? 2 : 1 }))
      : SAMPLE_LINES;
  return {
    on: !!w?.on,
    /** the Vendedor is on: it follows up its own conversations, so this stays off */
    vendedor: agent.enabled,
    preview: renderCartReminder({
      storeName,
      firstName: 'Ana',
      lines,
      url: `${origin}/?cart=K7m2Qx9p`,
    }),
    week: { sent: week?.sent ?? 0, ordered: week?.ordered ?? 0 },
  };
}

export type CartReminderView = Awaited<ReturnType<typeof cartReminderViewTx>>;
