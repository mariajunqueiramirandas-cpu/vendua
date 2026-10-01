import { emitAdminTx } from './live.ts';
import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson } from '../platform/http.ts';
import { loyaltyCard } from '../modules/customer.ts';
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

async function summary(tx: Sql, tenantId: string, phone: string) {
  return (
    await tx<
      {
        phone: string;
        name: string;
        orders: number;
        spentCents: number;
        firstAt: string;
        lastAt: string;
        cancelled: number;
      }[]
    >`
      select customer_phone as phone,
             (array_agg(customer ->> 'name' order by placed_at desc))[1] as name,
             count(*) filter (where state not in ('cancelled', 'refunded'))::int as orders,
             coalesce(sum(total_cents) filter (where state not in ('cancelled', 'refunded')), 0)::int as "spentCents",
             min(placed_at) as "firstAt", max(placed_at) as "lastAt",
             count(*) filter (where state = 'cancelled')::int as cancelled
      from orders where tenant_id = ${tenantId} and customer_phone = ${phone}
      group by customer_phone
    `
  )[0];
}

export function mountCustomers(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  admin.get(
    '/customers',
    read('manager', async (tx, t, _m, c) => {
      const q = fold((c.req.query('q') ?? '').trim().slice(0, 80));
      const sort = oneOf(c.req.query('sort') ?? 'recent', 'sort', [
        'recent',
        'value',
        'orders',
      ] as const);
      const offset = Math.min(10_000, Math.max(0, Number(c.req.query('offset') ?? 0) || 0));
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
      const digits = q.replace(/\D/g, '');
      const order =
        sort === 'value'
          ? tx`"spentCents" desc`
          : sort === 'orders'
            ? tx`orders desc, "lastAt" desc`
            : tx`"lastAt" desc`;
      const rows = await tx`
        select * from (
          select customer_phone as phone,
                 (array_agg(customer ->> 'name' order by placed_at desc))[1] as name,
                 count(*) filter (where state not in ('cancelled', 'refunded'))::int as orders,
                 coalesce(sum(total_cents) filter (where state not in ('cancelled', 'refunded')), 0)::int as "spentCents",
                 min(placed_at) as "firstAt", max(placed_at) as "lastAt"
          from orders where tenant_id = ${t.id} and customer_phone is not null
          group by customer_phone
        ) x
        ${
          q
            ? tx`where translate(lower(x.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${'%' + q + '%'}
                 ${digits.length >= 4 ? tx`or x.phone like ${'%' + digits + '%'}` : tx``}`
            : tx``
        }
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
      return { customers: rows, stats, next: rows.length === limit ? offset + limit : null };
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

  // LGPD access request: everything this store holds about the phone, as JSON.
  admin.get(
    '/customers/:phone/export',
    read('owner', async (tx, t, _m, c) => {
      const phone = phoneParam(c);
      const orders = await tx`
        select number, state, customer, delivery, payment, notes, subtotal_cents, delivery_fee_cents,
               discount_cents, payment_adjustment_cents, total_cents, coupon_code, scheduled_for, placed_at,
               (select json_agg(json_build_object('name', i.name, 'qty', i.qty, 'lineTotalCents', i.line_total_cents)
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
      c.header('content-disposition', `attachment; filename="cliente-${phone}.json"`);
      return {
        exportedAt: new Date().toISOString(),
        store: t.name,
        phone,
        orders,
        waitlist,
        coupons,
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
      const s = await summary(tx, t.id, phone);
      if (!s) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'no orders for this phone');
      const orders = await tx`
        update orders set
          customer = ${tx.json({ name: 'Cliente removido', phone: '' })},
          customer_phone = null,
          notes = null,
          delivery = (delivery - 'address' - 'addressParts' - 'lat' - 'lng')
        where tenant_id = ${t.id} and customer_phone = ${phone}
        returning id
      `;
      await tx`
        delete from notify_requests
        where tenant_id = ${t.id} and regexp_replace(contact, '\\D', '', 'g') in (${phone}, ${'55' + phone})
      `;
      await tx`update coupons set phone = null, active = false where tenant_id = ${t.id} and phone = ${phone}`;
      await tx`update coupon_redemptions set phone = '' where tenant_id = ${t.id} and phone = ${phone}`;
      await audit(tx, t.id, m, {
        action: 'customer.forget',
        entity: 'customer',
        // the log must not re-identify them: last digits only
        entityId: `…${phone.slice(-4)}`,
        summary: `apagou os dados de um cliente a pedido dele (${orders.length} pedidos anonimizados)`,
      });
      await emitAdminTx(tx, t.id, 'order.changed');
      return { status: 200, body: { anonymized: orders.length } };
    }),
  );
}
