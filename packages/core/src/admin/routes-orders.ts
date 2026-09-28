import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import {
  ORDER_STATES,
  loadOrderView,
  transitionOrder,
  type OrderState,
  type OrderView,
} from '../modules/orders.ts';
import { audit } from './audit.ts';
import { DATE_RE, int, need, oneOf, optText, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

const ACTIVE = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
const DONE = ['delivered', 'cancelled', 'refunded'];

export const STATE_LABEL: Record<OrderState, string> = {
  placed: 'novo',
  confirmed: 'aceito',
  preparing: 'preparando',
  ready: 'pronto',
  out_for_delivery: 'saiu para entrega',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export async function storeTz(tx: Sql, tenantId: string): Promise<string> {
  const row = (
    await tx<{ tz: string | null }[]>`
      select hours ->> 'timezone' as tz from store_settings where tenant_id = ${tenantId}
    `
  )[0];
  return row?.tz || 'America/Sao_Paulo';
}

export interface OrderListRow {
  id: string;
  number: number;
  state: OrderState;
  name: string;
  phone: string | null;
  totalCents: number;
  placedAt: string;
  mode: 'pickup' | 'delivery';
  neighborhood: string | null;
  paymentMethod: string;
  paymentStatus: string;
  itemCount: number;
  scheduledFor: string | null;
}

export function orderListColumns(tx: Sql) {
  return tx`
    o.id, o.number, o.state, o.customer ->> 'name' as name, o.customer_phone as phone,
    o.total_cents as "totalCents", o.placed_at as "placedAt", o.delivery ->> 'mode' as mode,
    o.delivery ->> 'neighborhood' as neighborhood,
    o.payment ->> 'method' as "paymentMethod", o.payment ->> 'status' as "paymentStatus",
    (select coalesce(sum(qty), 0)::int from order_items i where i.order_id = o.id) as "itemCount",
    o.scheduled_for::text as "scheduledFor"
  `;
}

async function views(tx: Sql, tenantId: string, ids: { id: string }[]): Promise<OrderView[]> {
  const out: OrderView[] = [];
  for (const { id } of ids) out.push(await loadOrderView(tx, tenantId, id));
  return out;
}

export function mountOrders(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  // The live board: everything still moving, plus what finished today, plus
  // encomendas due today. Future encomendas live in /orders/scheduled.
  admin.get(
    '/orders/board',
    read('attendant', async (tx, t) => {
      const tz = await storeTz(tx, t.id);
      const ids = await tx<{ id: string }[]>`
        select id from orders
        where tenant_id = ${t.id} and (
          (state = any(${ACTIVE}) and (scheduled_for is null or scheduled_for <= (now() at time zone ${tz})::date))
          or (state = any(${DONE}) and (updated_at at time zone ${tz})::date = (now() at time zone ${tz})::date)
        )
        order by placed_at
        limit 200
      `;
      const upcoming = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from orders
          where tenant_id = ${t.id} and state = any(${ACTIVE})
            and scheduled_for > (now() at time zone ${tz})::date
        `
      )[0]!.n;
      const target = (
        await tx<{ m: number }[]>`
          select coalesce(accept_target_minutes, 5) as m from store_settings where tenant_id = ${t.id}
        `
      )[0]?.m;
      return {
        orders: await views(tx, t.id, ids),
        scheduledUpcoming: upcoming,
        acceptTargetMinutes: target ?? 5,
        now: new Date().toISOString(),
      };
    }),
  );

  // History with search + filters; keyset on placed_at so paging is stable while orders arrive.
  admin.get(
    '/orders',
    read('attendant', async (tx, t, _m, c) => {
      const q = (c.req.query('q') ?? '').trim().slice(0, 80);
      const state = c.req.query('state');
      if (state && state !== 'active' && !(ORDER_STATES as readonly string[]).includes(state))
        throw new HttpError(400, 'BAD_REQUEST', 'unknown state');
      const from = c.req.query('from');
      const to = c.req.query('to');
      if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to)))
        throw new HttpError(400, 'BAD_REQUEST', 'from/to must be YYYY-MM-DD');
      const before = c.req.query('before');
      if (before && Number.isNaN(Date.parse(before)))
        throw new HttpError(400, 'BAD_REQUEST', 'before must be a timestamp');
      const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 40) || 40));
      const tz = await storeTz(tx, t.id);
      const digits = q.replace(/\D/g, '');
      const like = `%${q.toLowerCase().replace(/[%_\\]/g, '')}%`;
      const rows = await tx<OrderListRow[]>`
        select ${orderListColumns(tx)} from orders o
        where o.tenant_id = ${t.id}
          ${state === 'active' ? tx`and o.state = any(${ACTIVE})` : state ? tx`and o.state = ${state}` : tx``}
          ${from ? tx`and (o.placed_at at time zone ${tz})::date >= ${from}::date` : tx``}
          ${to ? tx`and (o.placed_at at time zone ${tz})::date <= ${to}::date` : tx``}
          ${before ? tx`and o.placed_at < ${new Date(before)}` : tx``}
          ${
            q
              ? tx`and (${/^#?\d{1,8}$/.test(q) ? tx`o.number = ${Number(q.replace('#', ''))} or` : tx``}
                  lower(o.customer ->> 'name') like ${like}
                  ${digits.length >= 4 ? tx`or o.customer_phone like ${'%' + digits + '%'}` : tx``})`
              : tx``
          }
        order by o.placed_at desc
        limit ${limit + 1}
      `;
      const more = rows.length > limit;
      const page = rows.slice(0, limit);
      return { orders: page, next: more ? page.at(-1)!.placedAt : null };
    }),
  );

  // Encomendas calendar (scheduled_for is a local date).
  admin.get(
    '/orders/scheduled',
    read('attendant', async (tx, t, _m, c) => {
      const from = c.req.query('from');
      const to = c.req.query('to');
      if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to))
        throw new HttpError(400, 'BAD_REQUEST', 'from and to are required (YYYY-MM-DD)');
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (!(days >= 0 && days <= 62))
        throw new HttpError(400, 'BAD_REQUEST', 'the range must be 0–62 days');
      const rows = await tx<OrderListRow[]>`
        select ${orderListColumns(tx)} from orders o
        where o.tenant_id = ${t.id} and o.scheduled_for between ${from}::date and ${to}::date
          and o.state not in ('cancelled', 'refunded')
        order by o.scheduled_for, o.placed_at
        limit 500
      `;
      return { orders: rows };
    }),
  );

  admin.get(
    '/orders/:id',
    read('attendant', async (tx, t, _m, c) => {
      const id = uuidParam(c, 'id');
      const order = await loadOrderView(tx, t.id, id);
      const phone = (
        await tx<{ customer_phone: string | null }[]>`
          select customer_phone from orders where tenant_id = ${t.id} and id = ${id}
        `
      )[0]?.customer_phone;
      const customer = phone
        ? (
            await tx<{ orders: number; firstAt: string; spentCents: number }[]>`
              select count(*)::int as orders, min(placed_at) as "firstAt",
                     coalesce(sum(total_cents) filter (where state not in ('cancelled', 'refunded')), 0)::int as "spentCents"
              from orders where tenant_id = ${t.id} and customer_phone = ${phone}
            `
          )[0]
        : null;
      return { order, customer: customer ? { phone, ...customer } : null };
    }),
  );

  admin.post(
    '/orders/:id/transition',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      const to = oneOf(body.to, 'to', ORDER_STATES);
      if (to === 'refunded') need(c, 'manager');
      const reason = optText(body.reason, 'reason', 200) ?? null;
      if (to === 'cancelled' && !reason)
        throw new HttpError(422, 'REASON_REQUIRED', 'tell the customer why', { field: 'reason' });
      const prep =
        body.prepMinutes === undefined || body.prepMinutes === null
          ? null
          : int(body.prepMinutes, 'prepMinutes', 1, 600);
      const meta: Record<string, unknown> = { by: m.name };
      if (reason) meta.reason = reason;
      if (prep) meta.prepMinutes = prep;
      const before = await loadOrderView(tx, t.id, id);
      await transitionOrder(tx, t.id, id, to, 'merchant', meta);
      if (to === 'confirmed' && prep) {
        // accepting with a prep time re-promises the window the customer sees
        const dl = before.delivery;
        const now = Date.now();
        const at = (min: number) => new Date(now + min * 60_000).toISOString();
        const from = dl.mode === 'delivery' ? prep + (dl.etaMin ?? 0) : prep;
        const until = dl.mode === 'delivery' ? prep + (dl.etaMax ?? dl.etaMin ?? 0) : prep;
        if (!before.scheduledFor)
          await tx`
            update orders set delivery = delivery || ${tx.json({ promisedFrom: at(from), promisedTo: at(until) })}
            where tenant_id = ${t.id} and id = ${id}
          `;
      }
      await audit(tx, t.id, m, {
        action: `order.${to}`,
        entity: 'order',
        entityId: id,
        summary: `pedido #${before.number}: ${STATE_LABEL[before.state]} → ${STATE_LABEL[to]}${reason ? ` (${reason})` : ''}`,
        before: { state: before.state },
        after: { state: to, ...meta },
      });
      return { status: 200, body: { order: await loadOrderView(tx, t.id, id) } };
    }),
  );

  // Pix without a PSP: the merchant confirms the money arrived. Mercado Pago (A3)
  // replaces this with a webhook; the button stays for cash and card on delivery.
  admin.post(
    '/orders/:id/payment',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      const status = oneOf(body.status, 'status', ['paid', 'pending'] as const);
      const cur = (
        await tx<{ number: number; payment: Record<string, unknown> }[]>`
          select number, payment from orders where tenant_id = ${t.id} and id = ${id} for update
        `
      )[0];
      if (!cur) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      const patch =
        status === 'paid'
          ? { status, paidAt: new Date().toISOString(), confirmedBy: m.name }
          : { status, paidAt: null, confirmedBy: null };
      await tx`
        update orders set payment = payment || ${tx.json(patch as never)}, updated_at = now()
        where tenant_id = ${t.id} and id = ${id}
      `;
      await audit(tx, t.id, m, {
        action: `order.payment.${status}`,
        entity: 'order',
        entityId: id,
        summary:
          status === 'paid'
            ? `marcou o pedido #${cur.number} como pago`
            : `desmarcou o pagamento do pedido #${cur.number}`,
        before: { payment: cur.payment.status },
        after: { payment: status },
      });
      await emitAdminTx(tx, t.id, 'order.changed', id);
      return { status: 200, body: { order: await loadOrderView(tx, t.id, id) } };
    }),
  );
}
