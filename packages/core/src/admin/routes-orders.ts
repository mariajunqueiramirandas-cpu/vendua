import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import {
  ORDER_STATES,
  canTransition,
  loadOrderView,
  recordOrderStep,
  transitionOrder,
  type OrderState,
  type OrderView,
} from '../modules/orders.ts';
import { tokenFor, type StoreToken } from '../modules/payments/connections.ts';
import { ProviderError } from '../modules/payments/provider.ts';
import {
  applyProviderPayment,
  cancelOpenAttempts,
  forward,
  markConnectionLater,
  markReview,
  orderPayments,
  processStorePayment,
  syncOrderPayment,
  type ApplyResult,
  type PayDeps,
  type PaymentRow,
} from '../modules/payments/store-payments.ts';
import { log } from '../platform/log.ts';
import { audit } from './audit.ts';
import { DATE_RE, int, need, oneOf, optInt, optText, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

const refundLog = log.child({ mod: 'refunds' });

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

/** An admin request (or an automatic one) to give money back; `key` makes it replayable. */
export interface RefundRequest {
  amountCents: number | null;
  reason: string | null;
  requestedBy: string | null;
  /** the request's Idempotency-Key (or `auto:<payment>`): one reservation per payment per key */
  key: string;
  /** only these attempts (auto-refund of one payment) */
  paymentIds?: string[];
  /** closing the order: every refund of this request must be approved, not just accepted */
  requireApproved?: boolean;
}

interface Reservation {
  id: string;
  payment_id: string;
  amount_cents: number;
  status: string;
  provider_refund_id: string | null;
  provider_payment_id: string;
}

const refundFailed = (reason: string) =>
  new HttpError(409, 'REFUND_FAILED', 'Mercado Pago refused the refund', { reason });

/**
 * Refunds captured money through the provider, newest attempt first. Three steps, and Mercado
 * Pago is never called inside a DB transaction:
 *   1. reserve: `payment_refunds` rows keyed by (payment, request key) commit before MP is called;
 *   2. MP refund with idempotency key `refund:<reservation id>` — a retry of the same request
 *      re-sends the same reservation, so MP answers with the refund it already made;
 *   3. record MP's refund id and the amount MP says it refunded. A refund id we already hold, or
 *      a different amount, is never counted twice: refunded_cents only follows approved rows.
 * Reservations another request left unsent are settled against MP's refunded total first.
 */
export async function refundOrderPayments(
  d: PayDeps,
  tenantId: string,
  orderId: string,
  o: RefundRequest,
): Promise<{ refundedCents: number; remainingCents: number }> {
  await releaseUnsent(d, tenantId, orderId, o.key);
  const plan = await withTenant(d.sql, tenantId, async (tx) => {
    await tx`select id from orders where tenant_id = ${tenantId} and id = ${orderId} for update`;
    const mine = (key: string) => tx<Reservation[]>`
      select r.id, r.payment_id, r.amount_cents, r.status, r.provider_refund_id, p.provider_payment_id
      from payment_refunds r join payments p on p.id = r.payment_id
      where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and r.request_key = ${key}
      order by r.created_at, r.id
    `;
    let rows = await mine(o.key);
    const tok = await tokenFor(tx, tenantId, d.sessionSecret, { read: true });
    const usable = !!tok && tok.provider === d.provider.name;
    if (!rows.length) {
      const pays = await tx<(PaymentRow & { left: number })[]>`
        select p.*, (p.amount_cents - greatest(p.refunded_cents,
                coalesce((select sum(r.amount_cents) from payment_refunds r
                          where r.payment_id = p.id and r.status <> 'rejected'), 0)))::int as left
        from payments p
        where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and p.review is distinct from 'amount_mismatch'
          and p.status in ('approved', 'partially_refunded') and p.provider_payment_id is not null
          ${o.paymentIds ? tx`and p.id = any(${o.paymentIds})` : tx``}
        order by p.attempt desc for update of p
      `;
      const total = pays.reduce((s, r) => s + Math.max(0, r.left), 0);
      if (total <= 0) throw new HttpError(409, 'NOTHING_TO_REFUND', 'nothing left to refund');
      const want = o.amountCents ?? total;
      if (want > total)
        throw new HttpError(422, 'REFUND_TOO_LARGE', 'the refund is larger than what was paid', {
          field: 'amountCents',
          maxCents: total,
        });
      if (!usable) throw new HttpError(409, 'MP_NOT_CONNECTED', 'reconnect Mercado Pago to refund');
      let rest = want;
      for (const r of pays) {
        const amt = Math.min(rest, Math.max(0, r.left));
        if (amt <= 0) continue;
        await tx`
          insert into payment_refunds (tenant_id, payment_id, amount_cents, status, reason, requested_by, request_key)
          values (${tenantId}, ${r.id}, ${amt}, 'pending', ${o.reason?.slice(0, 200) ?? null},
                  ${o.requestedBy}, ${o.key})
        `;
        rest -= amt;
        if (rest <= 0) break;
      }
      rows = await mine(o.key);
    }
    const send = rows.filter((r) => r.status === 'pending' && !r.provider_refund_id);
    if (send.length && !usable)
      throw new HttpError(409, 'MP_NOT_CONNECTED', 'reconnect Mercado Pago to refund');
    return { tok: tok!, send };
  });

  for (const r of plan.send) {
    let refund;
    try {
      refund = await d.provider.refund(
        plan.tok.token,
        r.provider_payment_id,
        r.amount_cents,
        `refund:${r.id}`,
      );
    } catch (err) {
      markConnectionLater(d, tenantId, err, plan.tok);
      const code = err instanceof ProviderError ? err.code : 'unavailable';
      // unavailable: MP may or may not have done it — the reservation stays for this key's retry
      if (code === 'unavailable')
        throw new HttpError(503, 'PAYMENT_UNAVAILABLE', 'Mercado Pago is unavailable — try again', {
          reason: code,
        });
      await withTenant(
        d.sql,
        tenantId,
        (tx) =>
          tx`update payment_refunds set status = 'rejected', updated_at = now() where id = ${r.id} and provider_refund_id is null`,
      );
      if (err instanceof ProviderError && /insufficient|saldo|balance/i.test(err.message))
        throw new HttpError(
          409,
          'INSUFFICIENT_FUNDS',
          'not enough balance in Mercado Pago to refund',
        );
      throw refundFailed(code);
    }
    const outcome = await withTenant(d.sql, tenantId, (tx) =>
      recordRefund(tx, tenantId, r, refund),
    );
    if (outcome === 'amount') await resyncPayment(d, tenantId, plan.tok, r.provider_payment_id);
    if (outcome === 'duplicate') throw refundFailed('duplicate');
    if (refund.status === 'rejected') throw refundFailed('rejected');
  }

  return withTenant(d.sql, tenantId, async (tx) => {
    // a retry of a refused request fails the same way: it never passes as "refunded 0"
    const statuses = await tx<{ status: string }[]>`
      select r.status from payment_refunds r join payments p on p.id = r.payment_id
      where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and r.request_key = ${o.key}
    `;
    if (statuses.some((r) => r.status === 'rejected')) throw refundFailed('rejected');
    if (o.requireApproved && statuses.some((r) => r.status !== 'approved'))
      throw refundFailed('pending');
    const done = (
      await tx<{ n: number }[]>`
        select coalesce(sum(r.amount_cents), 0)::int as n
        from payment_refunds r join payments p on p.id = r.payment_id
        where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and r.request_key = ${o.key}
          and r.status <> 'rejected'
      `
    )[0]!.n;
    const left = (
      await tx<{ n: number }[]>`
        select coalesce(sum(greatest(0, p.amount_cents - greatest(p.refunded_cents,
          coalesce((select sum(r.amount_cents) from payment_refunds r
                    where r.payment_id = p.id and r.status <> 'rejected'), 0)))), 0)::int as n
        from payments p
        where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and p.review is distinct from 'amount_mismatch'
          and p.status in ('approved', 'partially_refunded')
      `
    )[0]!.n;
    return { refundedCents: done, remainingCents: left };
  });
}

/** Step 3: MP's answer onto the reservation; money is counted from approved rows only. */
async function recordRefund(
  tx: Sql,
  tenantId: string,
  r: Reservation,
  refund: { id: string; amountCents: number; status: 'pending' | 'approved' | 'rejected' },
): Promise<'ok' | 'duplicate' | 'amount'> {
  const pay = (
    await tx<PaymentRow[]>`select * from payments where id = ${r.payment_id} for update`
  )[0]!;
  const refundId = refund.id ? refund.id.slice(0, 64) : null;
  if (refundId) {
    const dup = await tx`
      select 1 from payment_refunds where provider_refund_id = ${refundId} and id <> ${r.id}
    `;
    if (dup.length) {
      refundLog.error(
        { tenantId, refundId, reservation: r.id },
        'provider returned a refund we already hold',
      );
      await tx`update payment_refunds set status = 'rejected', updated_at = now() where id = ${r.id}`;
      await markReview(tx, tenantId, pay, 'refund_duplicate');
      return 'duplicate';
    }
  }
  const amount = refund.amountCents > 0 ? refund.amountCents : r.amount_cents;
  await tx`
    update payment_refunds set provider_refund_id = ${refundId}, amount_cents = ${amount},
      status = ${refund.status}, updated_at = now()
    where id = ${r.id} and provider_refund_id is null
  `;
  const approved = (
    await tx<{ n: number }[]>`
      select coalesce(sum(amount_cents), 0)::int as n from payment_refunds
      where payment_id = ${pay.id} and status = 'approved'
    `
  )[0]!.n;
  const refunded = Math.min(pay.amount_cents, Math.max(pay.refunded_cents, approved));
  if (refunded !== pay.refunded_cents) {
    const status = forward(
      pay.status,
      refunded >= pay.amount_cents ? 'refunded' : 'partially_refunded',
    );
    await tx`
      update payments set refunded_cents = ${refunded}, status = ${status}, updated_at = now()
      where id = ${pay.id}
    `;
  }
  await syncOrderPayment(tx, tenantId, pay.order_id);
  if (amount !== r.amount_cents) {
    refundLog.error(
      { tenantId, reservation: r.id, asked: r.amount_cents, got: amount },
      'refund amount differs',
    );
    await markReview(tx, tenantId, pay, 'refund_amount_mismatch');
    return 'amount';
  }
  return 'ok';
}

/** Provider truth for one payment, applied (outside any tx for the fetch). */
async function resyncPayment(
  d: PayDeps,
  tenantId: string,
  tok: StoreToken,
  providerPaymentId: string,
  release?: { exceptKey: string },
) {
  try {
    const p = await d.provider.getPayment(tok.token, providerPaymentId);
    await withTenant(d.sql, tenantId, (tx) =>
      applyProviderPayment(tx, tenantId, p, release ? { release } : {}),
    );
  } catch (err) {
    refundLog.warn({ err, tenantId, providerPaymentId }, 'refund resync failed');
  }
}

/** Reservations other requests never got to MP: MP's refunded total decides what they were. */
async function releaseUnsent(d: PayDeps, tenantId: string, orderId: string, key: string) {
  const { tok, ids } = await withTenant(d.sql, tenantId, async (tx) => ({
    tok: await tokenFor(tx, tenantId, d.sessionSecret, { read: true }),
    ids: await tx<{ id: string }[]>`
      select distinct p.provider_payment_id as id
      from payment_refunds r join payments p on p.id = r.payment_id
      where p.tenant_id = ${tenantId} and p.order_id = ${orderId} and r.status = 'pending'
        and r.provider_refund_id is null and r.request_key is distinct from ${key}
        and p.provider_payment_id is not null
        -- one whose MP call may still be in flight is left alone
        and r.created_at < now() - interval '5 minutes'
    `,
  }));
  if (!tok || tok.provider !== d.provider.name) return;
  for (const { id } of ids) await resyncPayment(d, tenantId, tok, id, { exceptKey: key });
}

/** Money that landed on a cancelled/refunded order goes straight back (or waits for a person). */
export async function autoRefundIfClosed(d: PayDeps, tenantId: string, r: ApplyResult) {
  if (!r.applied || !r.closed) return;
  const refundable = await withTenant(
    d.sql,
    tenantId,
    async (tx) =>
      (await orderPayments(tx, tenantId, r.orderId)).find((p) => p.id === r.paymentRowId)
        ?.refundableCents ?? 0,
  );
  if (refundable <= 0) return;
  try {
    await refundOrderPayments(d, tenantId, r.orderId, {
      amountCents: null,
      reason: 'pagamento de um pedido já encerrado',
      requestedBy: null,
      key: `auto:${r.paymentRowId}`,
      paymentIds: [r.paymentRowId],
    });
  } catch (err) {
    refundLog.error({ err, tenantId, paymentId: r.paymentRowId }, 'auto-refund failed');
    await withTenant(d.sql, tenantId, async (tx) => {
      const row = (await tx<PaymentRow[]>`select * from payments where id = ${r.paymentRowId}`)[0];
      if (row) await markReview(tx, tenantId, row, 'refund_failed');
    });
  }
}

/** Webhook / dev / job entry: fetch + apply, then send back money a closed order can't keep. */
export async function settleProviderPayment(
  d: PayDeps,
  tenantId: string,
  providerPaymentId: string,
) {
  const r = await processStorePayment(d, tenantId, providerPaymentId);
  if (r.applied) await autoRefundIfClosed(d, tenantId, r);
  return r;
}

/**
 * After an order closes: anything still captured on it (a payment approved between our pre-read
 * and the transition) goes back too.
 */
export async function refundLeftovers(d: PayDeps, tenantId: string, orderId: string) {
  const rows = await withTenant(d.sql, tenantId, (tx) => orderPayments(tx, tenantId, orderId));
  for (const r of rows)
    if (r.refundableCents > 0)
      await autoRefundIfClosed(d, tenantId, {
        applied: true,
        orderId,
        changed: false,
        paymentRowId: r.id,
        closed: true,
      });
}

const requestKey = (c: Context) => {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return key;
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PAID_ONLINE = ['paid', 'partially_refunded'];

export function mountOrders(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const pay = { sql: d.sql, provider: d.provider, sessionSecret: d.sessionSecret };
  const lockPayment = async (tx: Sql, tenantId: string, id: string) =>
    (
      await tx<
        {
          number: number;
          state: OrderState;
          total_cents: number;
          payment: { online?: boolean; status?: string } & Record<string, unknown>;
        }[]
      >`
        select number, state, total_cents, payment from orders
        where tenant_id = ${tenantId} and id = ${id} for update
      `
    )[0];

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
      return {
        order,
        customer: customer ? { phone, ...customer } : null,
        payments: await orderPayments(tx, t.id, id),
      };
    }),
  );

  admin.post('/orders/:id/transition', async (c) => {
    const m0 = need(c, 'attendant');
    const t0 = c.get('tenant');
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
    const key = requestKey(c);
    // Before the recorded tx, and outside any tx: money captured online goes back to the shopper
    // (if MP refuses, the order is untouched and the code says why), unpaid attempts stop.
    // A replay finds the order already moved (no refund) or its own reservation (no second one).
    const pre = await withTenant(
      d.sql,
      t0.id,
      async (tx) =>
        (
          await tx<{ state: OrderState; payment: { online?: boolean; status?: string } }[]>`
            select state, payment from orders where tenant_id = ${t0.id} and id = ${id}
          `
        )[0],
    );
    if (!pre) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
    // cancelling money captured online refunds it: the same role as an explicit refund
    if (
      to === 'cancelled' &&
      pre.payment.online &&
      PAID_ONLINE.includes(String(pre.payment.status))
    )
      need(c, 'manager');
    let refunded = 0;
    if (canTransition(pre.state, to) && pre.payment.online) {
      if (
        (to === 'cancelled' || to === 'refunded') &&
        PAID_ONLINE.includes(String(pre.payment.status))
      )
        refunded = (
          await refundOrderPayments(pay, t0.id, id, {
            amountCents: null,
            reason: reason ?? (to === 'cancelled' ? 'pedido cancelado' : 'pedido estornado'),
            requestedBy: m0.userId,
            key,
            requireApproved: true,
          })
        ).refundedCents;
      else if (to === 'cancelled') await cancelOpenAttempts(pay, t0.id, id);
    }
    const res = await write('attendant', async (tx, t, m) => {
      const meta: Record<string, unknown> = { by: m.name };
      if (reason) meta.reason = reason;
      if (prep) meta.prepMinutes = prep;
      if (refunded) meta.refundedCents = refunded;
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
        summary: `pedido #${before.number}: ${STATE_LABEL[before.state]} → ${STATE_LABEL[to]}${reason ? ` (${reason})` : ''}${refunded ? ` · estornou ${brl(refunded)} no Mercado Pago` : ''}`,
        before: { state: before.state },
        after: { state: to, ...meta },
      });
      return { status: 200, body: { order: await loadOrderView(tx, t.id, id) } };
    })(c);
    if (res.status === 200 && (to === 'cancelled' || to === 'refunded'))
      await refundLeftovers(pay, t0.id, id);
    return res;
  });

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
      if (cur.payment.online)
        throw new HttpError(409, 'PAYMENT_ONLINE', 'Mercado Pago confirms this payment');
      const patch =
        status === 'paid'
          ? { status, paidAt: new Date().toISOString(), confirmedBy: m.name }
          : { status, paidAt: null, confirmedBy: null };
      await tx`
        update orders set payment = payment || ${tx.json(patch as never)}, updated_at = now()
        where tenant_id = ${t.id} and id = ${id}
      `;
      if (status === 'paid')
        await recordOrderStep(tx, t.id, { id, number: cur.number }, 'paid', 'merchant');
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

  // Estornar. Online: through Mercado Pago (partial allowed; a delivered order refunded in full
  // becomes `refunded`), with MP called before the recorded tx. Offline: record-only — the store
  // gave the money back itself.
  admin.post('/orders/:id/refund', async (c) => {
    const m0 = need(c, 'manager');
    const t0 = c.get('tenant');
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    const amountCents = optInt(body.amountCents, 'amountCents', 1, 100_000_000) ?? null;
    const reason = optText(body.reason, 'reason', 200) ?? null;
    const key = requestKey(c);
    const pre = await withTenant(
      d.sql,
      t0.id,
      async (tx) =>
        (
          await tx<{ payment: { online?: boolean } }[]>`
            select payment from orders where tenant_id = ${t0.id} and id = ${id}
          `
        )[0],
    );
    if (!pre) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
    const out = pre.payment.online
      ? await refundOrderPayments(pay, t0.id, id, {
          amountCents,
          reason,
          requestedBy: m0.userId,
          key,
        })
      : null;
    return write('manager', async (tx, t, m) => {
      const cur = await lockPayment(tx, t.id, id);
      if (!cur) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      if (!out) {
        if (!canTransition(cur.state, 'refunded'))
          throw new HttpError(
            409,
            'INVALID_ORDER_TRANSITION',
            `cannot move ${cur.state} → refunded`,
          );
        await transitionOrder(tx, t.id, id, 'refunded', 'merchant', {
          by: m.name,
          ...(reason ? { reason } : {}),
        });
        await audit(tx, t.id, m, {
          action: 'order.refunded',
          entity: 'order',
          entityId: id,
          summary: `pedido #${cur.number}: estorno registrado${reason ? ` (${reason})` : ''}`,
          before: { state: cur.state },
          after: { state: 'refunded' },
        });
      } else {
        if (out.remainingCents === 0 && canTransition(cur.state, 'refunded'))
          await transitionOrder(tx, t.id, id, 'refunded', 'merchant', {
            by: m.name,
            refundedCents: out.refundedCents,
            ...(reason ? { reason } : {}),
          });
        await audit(tx, t.id, m, {
          action: 'order.payment.refund',
          entity: 'order',
          entityId: id,
          summary: `pedido #${cur.number}: estornou ${brl(out.refundedCents)} no Mercado Pago${reason ? ` (${reason})` : ''}`,
          before: { payment: cur.payment.status, state: cur.state },
          after: { refundedCents: out.refundedCents, remainingCents: out.remainingCents },
        });
      }
      await emitAdminTx(tx, t.id, 'order.changed', id);
      return {
        status: 200,
        body: {
          order: await loadOrderView(tx, t.id, id),
          payments: await orderPayments(tx, t.id, id),
        },
      };
    })(c);
  });
}
