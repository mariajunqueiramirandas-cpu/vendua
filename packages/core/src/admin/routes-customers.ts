import { emitAdminTx } from './live.ts';
import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson } from '../platform/http.ts';
import { forgetSubjectTx } from '../agent-host/forget.ts';
import { loyaltyCard } from '../modules/customer.ts';
import { jidForPhone, phoneVariants } from '../store-whatsapp/text.ts';
import { audit } from './audit.ts';
import { oneOf, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { orderListColumns, type OrderListRow } from './routes-orders.ts';
import { loadSettings } from './routes-store.ts';
import { fold } from './routes.ts';

// Customers are phones (ADR 0019): no accounts, so a customer is everything
// ordered under one normalized number.

function phoneParam(c: Context): string {
  const p = c.req.param('phone') ?? '';
  if (!/^\d{10,11}$/.test(p)) throw new HttpError(400, 'BAD_REQUEST', 'phone must be DDD + number');
  return p;
}

// What the store writes down about a customer (0091_customer_notes.sql). Tags are lowercase so
// "VIP" and "vip" are one filter.
export const NOTE_MAX = 2000;
export const TAGS_MAX = 10;
export const TAG_MAX = 24;

const tagOf = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

function readTags(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 50)
    throw new HttpError(422, 'BAD_REQUEST', 'tags must be a list', { field: 'tags' });
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string')
      throw new HttpError(422, 'BAD_REQUEST', 'a tag must be text', { field: 'tags' });
    const t = tagOf(x);
    if (t.length > TAG_MAX)
      throw new HttpError(422, 'TAG_TOO_LONG', `a tag has at most ${TAG_MAX} characters`, {
        field: 'tags',
      });
    if (t && !out.includes(t)) out.push(t);
  }
  if (out.length > TAGS_MAX)
    throw new HttpError(422, 'TOO_MANY_TAGS', `a customer has at most ${TAGS_MAX} tags`, {
      field: 'tags',
    });
  return out;
}

/** the store's tags, most used first — the list's filter and the customer page's suggestions */
async function storeTags(tx: Sql, tenantId: string) {
  return tx<{ tag: string; customers: number }[]>`
    select tag, count(*)::int as customers
    from customer_notes n, unnest(n.tags) tag
    where n.tenant_id = ${tenantId}
    group by tag order by customers desc, tag limit 30
  `;
}

async function notesOf(tx: Sql, tenantId: string, phone: string) {
  return (
    (
      await tx<
        { note: string; tags: string[]; updatedAt: Date | null; updatedBy: string | null }[]
      >`
        select n.note, n.tags, n.updated_at as "updatedAt", u.name as "updatedBy"
        from customer_notes n left join merchant_users u on u.id = n.updated_by
        where n.tenant_id = ${tenantId} and n.phone = ${phone}
      `
    )[0] ?? { note: '', tags: [], updatedAt: null, updatedBy: null }
  );
}

async function summary(tx: Sql, tenantId: string, phone: string) {
  return (
    await tx<
      {
        phone: string;
        name: string;
        orders: number;
        spentCents: number;
        avgTicketCents: number;
        firstAt: string;
        lastAt: string;
        cancelled: number;
      }[]
    >`
      select customer_phone as phone,
             (array_agg(customer ->> 'name' order by placed_at desc))[1] as name,
             count(*) filter (where state not in ('cancelled', 'refunded'))::int as orders,
             coalesce(sum(total_cents) filter (where state not in ('cancelled', 'refunded')), 0)::int as "spentCents",
             coalesce(round(avg(total_cents) filter (where state not in ('cancelled', 'refunded'))), 0)::int as "avgTicketCents",
             min(placed_at) as "firstAt", max(placed_at) as "lastAt",
             count(*) filter (where state = 'cancelled')::int as cancelled
      from orders where tenant_id = ${tenantId} and customer_phone = ${phone}
      group by customer_phone
    `
  )[0];
}

export function mountCustomers(d: AdminDeps) {
  const { admin } = d;
  const { read, write, named } = handlers(d);

  admin.get(
    '/customers',
    named('customers').read('manager', async (tx, t, _m, c) => {
      const q = fold((c.req.query('q') ?? '').trim().slice(0, 80));
      const sort = oneOf(c.req.query('sort') ?? 'recent', 'sort', [
        'recent',
        'value',
        'orders',
      ] as const);
      const offset = Math.min(10_000, Math.max(0, Number(c.req.query('offset') ?? 0) || 0));
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
      const tag = tagOf(c.req.query('tag') ?? '');
      if (tag.length > TAG_MAX) throw new HttpError(400, 'BAD_REQUEST', 'tag is too long');
      const digits = q.replace(/\D/g, '');
      const order =
        sort === 'value'
          ? tx`"spentCents" desc`
          : sort === 'orders'
            ? tx`orders desc, "lastAt" desc`
            : tx`"lastAt" desc`;
      const rows = await tx`
        select x.*, coalesce(n.tags, '{}') as tags from (
          select customer_phone as phone,
                 (array_agg(customer ->> 'name' order by placed_at desc))[1] as name,
                 count(*) filter (where state not in ('cancelled', 'refunded'))::int as orders,
                 coalesce(sum(total_cents) filter (where state not in ('cancelled', 'refunded')), 0)::int as "spentCents",
                 min(placed_at) as "firstAt", max(placed_at) as "lastAt"
          from orders where tenant_id = ${t.id} and customer_phone is not null
          group by customer_phone
        ) x
        left join customer_notes n on n.tenant_id = ${t.id} and n.phone = x.phone
        where true
        ${
          q
            ? tx`and (translate(lower(x.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${'%' + q + '%'}
                 ${digits.length >= 4 ? tx`or x.phone like ${'%' + digits + '%'}` : tx``})`
            : tx``
        }
        ${tag ? tx`and ${tag} = any(n.tags)` : tx``}
        order by ${order}
        limit ${limit} offset ${offset}
      `;
      const stats = (
        await tx<{ customers: number; repeat: number; newThisMonth: number }[]>`
          select count(*)::int as customers,
                 count(*) filter (where n >= 2)::int as repeat,
                 count(*) filter (where first_at > now() - interval '30 days')::int as "newThisMonth"
          from (
            select customer_phone, count(*) filter (where state not in ('cancelled', 'refunded')) as n,
                   min(placed_at) as first_at
            from orders where tenant_id = ${t.id} and customer_phone is not null group by customer_phone
          ) s
        `
      )[0]!;
      return {
        customers: rows,
        stats,
        tags: await storeTags(tx, t.id),
        next: rows.length === limit ? offset + limit : null,
      };
    }),
  );

  admin.get(
    '/customers/:phone',
    read('manager', async (tx, t, _m, c) => {
      const phone = phoneParam(c);
      const s = await summary(tx, t.id, phone);
      if (!s) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'no orders for this phone');
      const orders = await tx<OrderListRow[]>`
        select ${orderListColumns(tx)} from orders o
        where o.tenant_id = ${t.id} and o.customer_phone = ${phone}
        order by o.placed_at desc limit 100
      `;
      const favorites = await tx`
        select i.name, sum(i.qty)::int as qty from order_items i join orders o on o.id = i.order_id
        where o.tenant_id = ${t.id} and o.customer_phone = ${phone} and o.state not in ('cancelled', 'refunded')
        group by i.name order by qty desc limit 5
      `;
      const settings = await loadSettings(tx, t.id);
      return {
        customer: s,
        notes: await notesOf(tx, t.id, phone),
        knownTags: (await storeTags(tx, t.id)).map((r) => r.tag),
        orders,
        favorites,
        loyalty: await loyaltyCard(tx, t.id, phone, settings),
        lastAddress:
          (
            await tx<{ address: string | null; neighborhood: string | null }[]>`
            select delivery ->> 'address' as address, delivery ->> 'neighborhood' as neighborhood
            from orders where tenant_id = ${t.id} and customer_phone = ${phone} and delivery ->> 'mode' = 'delivery'
            order by placed_at desc limit 1
          `
          )[0] ?? null,
      };
    }),
  );

  // Autosaved from the customer page: either field alone, the other stays.
  admin.put(
    '/customers/:phone/notes',
    write('manager', async (tx, t, m, c) => {
      const phone = phoneParam(c);
      const body = await bodyJson(c);
      const note = body.note === undefined ? undefined : text(body.note, 'note', NOTE_MAX);
      const tags = body.tags === undefined ? undefined : readTags(body.tags);
      if (note === undefined && tags === undefined)
        throw new HttpError(422, 'BAD_REQUEST', 'nothing to change');
      const known = await tx`
        select 1 from orders where tenant_id = ${t.id} and customer_phone = ${phone} limit 1
      `;
      if (!known.length) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'no orders for this phone');
      await tx`
        insert into customer_notes (tenant_id, phone, note, tags, updated_by)
        values (${t.id}, ${phone}, ${note ?? ''}, ${tags ?? []}::text[], ${m.userId})
        on conflict (tenant_id, phone) do update set
          note = ${note === undefined ? tx`customer_notes.note` : note},
          tags = ${tags === undefined ? tx`customer_notes.tags` : tx`${tags}::text[]`},
          updated_by = excluded.updated_by, updated_at = now()
      `;
      // the words stay out of the log: it outlives a forget, and a note is about a person
      const summary =
        note !== undefined && tags !== undefined
          ? 'atualizou a anotação e as etiquetas de um cliente'
          : note !== undefined
            ? 'atualizou a anotação de um cliente'
            : 'mudou as etiquetas de um cliente';
      const entityId = `…${phone.slice(-4)}`;
      // autosave sends a burst of saves: one line per person and customer every 10 minutes
      const recent = (
        await tx<{ id: string }[]>`
          select id from audit_log
          where tenant_id = ${t.id} and actor_user_id = ${m.userId} and action = 'customer.notes'
            and entity_id = ${entityId} and at > now() - interval '10 minutes'
          order by id desc limit 1
        `
      )[0];
      if (recent)
        await tx`update audit_log set at = now(), summary = ${summary} where id = ${recent.id}`;
      else
        await audit(tx, t.id, m, {
          action: 'customer.notes',
          entity: 'customer',
          entityId,
          summary,
        });
      return {
        status: 200,
        body: {
          notes: await notesOf(tx, t.id, phone),
          knownTags: (await storeTags(tx, t.id)).map((r) => r.tag),
        },
      };
    }),
  );

  // LGPD access request: everything this store holds about the phone, as JSON.
  admin.get(
    '/customers/:phone/export',
    read('owner', async (tx, t, _m, c) => {
      const phone = phoneParam(c);
      const orders = await tx`
        select number, state, customer, delivery, payment, notes, subtotal_cents, delivery_fee_cents,
               discount_cents, payment_adjustment_cents, total_cents, coupon_code, scheduled_for, placed_at,
               (select json_agg(json_build_object('name', i.name, 'qty', i.qty, 'lineTotalCents', i.line_total_cents,
                                                  'note', i.note)
                                order by i.sort) from order_items i where i.order_id = orders.id) as items
        from orders where tenant_id = ${t.id} and customer_phone = ${phone} order by placed_at
      `;
      if (!orders.length)
        throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'no orders for this phone');
      const waitlist = await tx`
        select n.subject, p.name as product, n.created_at, n.notified_at from notify_requests n
          left join products p on p.id = n.product_id
        where n.tenant_id = ${t.id} and regexp_replace(n.contact, '\\D', '', 'g') in (${phone}, ${'55' + phone})
      `;
      const coupons = await tx`
        select code, label, kind, value, source, ends_at, created_at from coupons
        where tenant_id = ${t.id} and phone = ${phone}
      `;
      const cartReminders = await tx`
        select name, consented_at, withdrawn_at, sent_at from cart_reminders
        where tenant_id = ${t.id} and phone = any(${phoneVariants(phone)}::text[])
      `;
      const notes = (
        await tx`
          select note, tags, updated_at from customer_notes where tenant_id = ${t.id} and phone = ${phone}
        `
      )[0];
      // what the Vendedor remembers from their conversations, the store's own notes included
      const variants = phoneVariants(phone);
      const agentMemory = await tx`
        select key, value, provenance, created_at, updated_at from agent_memory
        where tenant_id = ${t.id} and scope in (
          select 'shopper_thread:' || id from shopper_threads
          where tenant_id = ${t.id} and (phone = any(${variants}::text[])
            or address = any(${variants.flatMap((v) => jidForPhone(v) ?? [])}::text[])
            or checkout ->> 'phone' = any(${variants}::text[])))
        order by scope, key
      `;
      c.header('content-disposition', `attachment; filename="cliente-${phone}.json"`);
      return {
        exportedAt: new Date().toISOString(),
        store: t.name,
        phone,
        orders,
        waitlist,
        coupons,
        cartReminders,
        notes: notes ?? null,
        agentMemory,
      };
    }),
  );

  // LGPD deletion request: orders stay (the store's books) but lose the person.
  admin.post(
    '/customers/:phone/forget',
    write('owner', async (tx, t, m, c) => {
      const phone = phoneParam(c);
      const body = await bodyJson(c);
      // typed confirmation: the last 4 digits, like the UI asks
      if (text(body.confirm, 'confirm', 11) !== phone.slice(-4))
        throw new HttpError(422, 'CONFIRMATION_MISMATCH', 'type the last 4 digits of the phone', {
          field: 'confirm',
        });
      const variants = phoneVariants(phone);
      const jids = variants.flatMap((v) => jidForPhone(v) ?? []);
      const threads = await tx<{ id: string; cart_id: string | null }[]>`
        select id, cart_id from shopper_threads
        where tenant_id = ${t.id} and (phone = any(${variants}::text[]) or address = any(${jids}::text[])
          or checkout ->> 'phone' = any(${variants}::text[]))
      `;
      const s = await summary(tx, t.id, phone);
      if (!s && !threads.length)
        throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'no orders for this phone');
      const orders = await tx<{ id: string; cart_id: string | null }[]>`
        update orders set
          customer = ${tx.json({ name: 'Cliente removido', phone: '' })},
          customer_phone = null,
          notes = null,
          delivery = (delivery - 'address' - 'addressParts' - 'lat' - 'lng')
        where tenant_id = ${t.id} and customer_phone = ${phone}
        returning id, cart_id
      `;
      // the address a cart held for those orders and conversations goes with them
      const carts = [...orders, ...threads].flatMap((r) => r.cart_id ?? []);
      if (carts.length)
        await tx`
          update carts set delivery = null, delivery_route = null
          where tenant_id = ${t.id} and id = any(${carts}::uuid[])
        `;
      // their words on each line ("sem cebola"); a cart line's note is part of its identity, so
      // a line that held one goes (the order keeps its own copy of the line)
      if (orders.length)
        await tx`
          update order_items set note = null
          where tenant_id = ${t.id} and order_id = any(${orders.map((o) => o.id)}::uuid[])
            and note is not null
        `;
      // a bag they asked to be reminded of was never ordered, and its reminder link snapshots it
      const reminded = (
        await tx<{ cart_id: string }[]>`
          select cart_id from cart_reminders
          where tenant_id = ${t.id} and phone = any(${variants}::text[])
          union
          select cart_id from store_wa_messages
          where tenant_id = ${t.id} and kind = 'cart_reminder' and cart_id is not null
            and phone = any(${variants}::text[])
        `
      ).map((r) => r.cart_id);
      const noted = [...new Set([...carts, ...reminded])];
      if (noted.length) {
        await tx`
          delete from cart_items
          where tenant_id = ${t.id} and cart_id = any(${noted}::uuid[]) and note <> ''
        `;
        await tx`
          delete from cart_shares where tenant_id = ${t.id} and source_cart_id = any(${noted}::uuid[])
        `;
      }
      // each conversation: its messages and media cascade; its agent actor and memory go too
      for (const th of threads)
        await forgetSubjectTx(
          tx,
          t.id,
          { kind: 'shopper_thread', id: th.id },
          `shopper_thread:${th.id}`,
        );
      // a question still waiting for the store is the shopper's own words; an answered one is the store's
      if (threads.length)
        await tx`delete from store_knowledge where tenant_id = ${t.id} and source = 'unanswered'
          and status <> 'live' and thread_id = any(${threads.map((th) => th.id)}::uuid[])`;
      if (threads.length)
        await tx`delete from shopper_threads where tenant_id = ${t.id} and id = any(${threads.map((th) => th.id)}::uuid[])`;
      await tx`update agent_incentives set phone = null where tenant_id = ${t.id} and phone = any(${variants}::text[])`;
      // the opt-out stays: it is their wish not to be texted
      await tx`
        delete from store_wa_messages
        where tenant_id = ${t.id} and (phone = any(${variants}::text[]) or jid = any(${jids}::text[]))
      `;
      await tx`
        delete from notify_requests
        where tenant_id = ${t.id} and regexp_replace(contact, '\\D', '', 'g') in (${phone}, ${'55' + phone})
      `;
      // a bag reminder they asked for: withdrawn, and the number and name go
      await tx`
        update cart_reminders set phone = null, name = null, withdrawn_at = coalesce(withdrawn_at, now())
        where tenant_id = ${t.id} and phone = any(${variants}::text[])
      `;
      await tx`update coupons set phone = null, active = false where tenant_id = ${t.id} and phone = ${phone}`;
      await tx`delete from customer_notes where tenant_id = ${t.id} and phone = ${phone}`;
      await tx`update coupon_redemptions set phone = '' where tenant_id = ${t.id} and phone = ${phone}`;
      await audit(tx, t.id, m, {
        action: 'customer.forget',
        entity: 'customer',
        // the log must not re-identify them: last digits only
        entityId: `…${phone.slice(-4)}`,
        summary: `apagou os dados de um cliente a pedido dele (${orders.length} pedidos anonimizados, ${threads.length} conversas apagadas)`,
      });
      await emitAdminTx(tx, t.id, 'order.changed');
      return { status: 200, body: { anonymized: orders.length, conversations: threads.length } };
    }),
  );
}
