import type { Context } from 'hono';
import { withTenant, type Sql } from '../platform/db.ts';
import { storeOrigin } from '../platform/store-origin.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { tableToken } from '../modules/pdv/qr.ts';
import { HttpError, uuidParam } from '../platform/http.ts';
import { requireFeature } from '../modules/billing/plans.ts';
import { printersTx, queueJobsTx } from '../modules/printing/jobs.ts';
import { normalizePhone } from '../modules/customer.ts';
import { loadOrderView, recordOrderStep, transitionOrder } from '../modules/orders.ts';
import { pixPayload, type PixKeyType } from '../modules/pix.ts';
import {
  assertOpen,
  caixaDetail,
  caixaRowById,
  closeTabTx,
  holdsTab,
  lockTab,
  openCaixaRow,
  openTabSummaries,
  parseCounted,
  paymentView,
  reportOf,
  requireOpenCaixa,
  tabDetail,
} from '../modules/pdv/ledger.ts';
import {
  insertPdvOrderTx,
  lockOrderNumbers,
  paidPayment,
  TAB_PAYMENT,
} from '../modules/pdv/orders.ts';
import {
  changeOf,
  MAX_CENTS,
  parseDiscount,
  parseLines,
  parsePayment,
  parsePayments,
  priceLines,
  quoteOf,
  PDV_METHODS,
  subtotalOf,
  type PdvMethod,
  type PdvPaymentIn,
} from '../modules/pdv/pricing.ts';
import {
  customerByPhone,
  deliveryJson,
  parseDelivery,
  priceDelivery,
} from '../modules/pdv/delivery.ts';
import { MAX_CHANGE_CENTS } from '../modules/place-order.ts';
import { enqueueOrderMessageTx } from '../store-whatsapp/messages.ts';
import { audit } from './audit.ts';
import {
  bool,
  int,
  isObj,
  need,
  oneOf,
  optText,
  roleAtLeast,
  text,
  type AdminCtx,
  type AdminDeps,
} from './context.ts';
import type { Merchant } from './context.ts';
import { bodyOf, handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';
import { storeTz } from './routes-orders.ts';

// The PDV (ADR 0035): counter sales, comandas on tables, and the caixa. Contract:
// docs/features/pdv.md. Every route is behind the `pdv` plan feature.

const MAX_TABLES = 200;
const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

const gate = (tx: Sql, tenantId: string) => requireFeature(tx, tenantId, 'pdv');

function managerOnly(m: Merchant, what: string) {
  if (!roleAtLeast(m.role, 'manager'))
    throw new HttpError(403, 'FORBIDDEN', `${what} needs a manager`, { need: 'manager' });
}

async function settingsOf(tx: Sql, tenantId: string) {
  const [s] = await tx<
    {
      prep: number | null;
      service_bps: number;
      qr_orders: boolean;
      pix_key: string | null;
      pix_key_type: string | null;
      pix_beneficiary: string | null;
      pix_city: string | null;
      city: string | null;
    }[]
  >`
    select prep_time_minutes as prep, pdv_service_bps as service_bps, pdv_qr_orders as qr_orders,
           pix_key, pix_key_type,
           pix_beneficiary, pix_city, city
    from store_settings where tenant_id = ${tenantId}
  `;
  return s ?? null;
}

const sumOf = (ps: PdvPaymentIn[]) => ps.reduce((n, p) => n + p.amountCents, 0);

async function insertPayments(
  tx: Sql,
  tenantId: string,
  sessionId: string,
  target: { orderId: string } | { tabId: string },
  payments: PdvPaymentIn[],
  by: string,
) {
  const orderId = 'orderId' in target ? target.orderId : null;
  const tabId = 'tabId' in target ? target.tabId : null;
  const rows = [];
  for (const p of payments)
    rows.push(
      (
        await tx<
          {
            id: string;
            method: PdvPaymentIn['method'];
            amount_cents: number;
            tendered_cents: number | null;
            change_cents: number;
            at: Date;
            by_name: string;
            voided_at: Date | null;
          }[]
        >`
          insert into pdv_payments (tenant_id, session_id, order_id, tab_id, method, amount_cents,
                                    tendered_cents, change_cents, by_name)
          values (${tenantId}, ${sessionId}, ${orderId}, ${tabId}, ${p.method}, ${p.amountCents},
                  ${p.tenderedCents}, ${changeOf(p)}, ${by})
          returning id, method, amount_cents, tendered_cents, change_cents, at, by_name, voided_at
        `
      )[0]!,
    );
  return rows.map(paymentView);
}

function parsePayLater(v: unknown): { method: PdvMethod; changeForCents: number | null } {
  if (!isObj(v))
    throw new HttpError(422, 'INVALID_PAYMENT', 'payLater must be an object', {
      field: 'payLater',
    });
  const method = oneOf(v.method, 'payLater.method', PDV_METHODS);
  const change =
    v.changeForCents === undefined || v.changeForCents === null
      ? null
      : int(v.changeForCents, 'payLater.changeForCents', 1, MAX_CHANGE_CENTS);
  if (change !== null && method !== 'cash')
    throw new HttpError(422, 'INVALID_CHANGE', 'change is only for cash payments', {
      field: 'payLater.changeForCents',
    });
  return { method, changeForCents: change };
}

function parseCustomer(v: unknown): { name: string | null; phone: string | null } {
  if (v === undefined || v === null) return { name: null, phone: null };
  if (!isObj(v))
    throw new HttpError(422, 'BAD_REQUEST', 'customer must be an object', { field: 'customer' });
  const name = optText(v.name, 'customer.name', 80) ?? null;
  const raw = optText(v.phone, 'customer.phone', 40) ?? null;
  const phone = raw ? normalizePhone(raw) : null;
  if (phone !== null && !/^\d{10,11}$/.test(phone))
    throw new HttpError(422, 'INVALID_PHONE', 'phone must have DDD and number', {
      field: 'customer.phone',
    });
  return { name, phone };
}

const tableLabel = (v: unknown, name = 'label') => text(v, name, 40, 1).replace(/\s+/g, ' ');

async function tableRow(tx: Sql, tenantId: string, id: string) {
  const [row] = await tx<{ id: string; label: string; sort: number }[]>`
    select id, label, sort from pdv_tables
    where tenant_id = ${tenantId} and id = ${id} and archived_at is null
  `;
  if (!row) throw new HttpError(404, 'TABLE_NOT_FOUND', 'table not found');
  return row;
}

async function busyTab(tx: Sql, tenantId: string, tableId: string, except: string | null = null) {
  const [row] = await tx<{ id: string }[]>`
    select id from pdv_tabs
    where tenant_id = ${tenantId} and table_id = ${tableId} and status = 'open'
      ${except ? tx`and id <> ${except}` : tx``}
  `;
  if (row)
    throw new HttpError(409, 'TABLE_BUSY', 'this table has an open comanda', { tabId: row.id });
}

const archivedTables = (tx: Sql, tenantId: string) =>
  tx<{ id: string; label: string; sort: number; archivedAt: Date }[]>`
    select id, label, sort, archived_at as "archivedAt" from pdv_tables
    where tenant_id = ${tenantId} and archived_at is not null
    order by archived_at desc, id limit 200
  `;

const tablesOut = async (
  tx: Sql,
  t: Tenant,
  d: Pick<AdminDeps, 'sessionSecret' | 'storeDomain'>,
) => {
  const [active, archived] = await Promise.all([tables(tx, t.id), archivedTables(tx, t.id)]);
  return { tables: await withQr(tx, t, d, active), archived };
};

const tables = (tx: Sql, tenantId: string) =>
  tx<{ id: string; label: string; sort: number; qr_rev: number }[]>`
    select id, label, sort, qr_rev from pdv_tables
    where tenant_id = ${tenantId} and archived_at is null order by sort, label, id
  `;

/** The tables as the admin shows them: each with its QR's link (ADR 0036). */
async function withQr(
  tx: Sql,
  t: Tenant,
  d: Pick<AdminDeps, 'sessionSecret' | 'storeDomain'>,
  rows: { id: string; label: string; sort: number; qr_rev: number }[],
) {
  if (rows.length === 0) return [];
  const origin = await storeOrigin(tx, t, d.storeDomain);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    sort: r.sort,
    qrUrl: `${origin}/?mesa=${tableToken(d.sessionSecret, t.id, r.id, r.qr_rev)}`,
  }));
}

/** One printer: the one asked for, or the store's only one; else the screen asks which. */
async function printerFor(tx: Sql, tenantId: string, raw: unknown): Promise<string> {
  const printers = (await printersTx(tx, tenantId)).filter((p) => p.present);
  if (raw !== undefined && raw !== null) {
    const id = uuidOf(raw, 'printerId');
    if (!printers.some((p) => p.id === id))
      throw new HttpError(404, 'PRINTER_NOT_FOUND', 'printer not found');
    return id;
  }
  if (printers.length === 0)
    throw new HttpError(409, 'NO_PRINTERS', 'no printer connected to this store');
  if (printers.length > 1)
    throw new HttpError(422, 'PRINTER_REQUIRED', 'pick the printer', {
      field: 'printerId',
      printers: printers.map((p) => ({ id: p.id, name: p.name })),
    });
  return printers[0]!.id;
}

const ways = (c: Context) => {
  const raw = c.req.query('ways');
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2 || n > 20)
    throw new HttpError(422, 'BAD_REQUEST', 'ways must be an integer 2–20', { field: 'ways' });
  return n;
};

export function mountPdv(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);

  // ── the screen's state ─────────────────────────────────────────────────────

  admin.get(
    '/pdv/state',
    read('attendant', async (tx, t, m) => {
      const [, caixa, tbls, tabs, s] = await Promise.all([
        gate(tx, t.id),
        openCaixaRow(tx, t.id),
        tables(tx, t.id),
        openTabSummaries(tx, t.id),
        settingsOf(tx, t.id),
      ]);
      return {
        caixa: caixa ? await caixaDetail(tx, t.id, caixa, roleAtLeast(m.role, 'manager')) : null,
        tables: await withQr(tx, t, d, tbls),
        tabs,
        serviceBps: s?.service_bps ?? 0,
        qrOrders: s?.qr_orders ?? true,
      };
    }),
  );

  // ── counter ────────────────────────────────────────────────────────────────

  admin.post(
    '/pdv/quote',
    read('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 64 * 1024);
      const lines = parseLines(body.lines);
      const discount = parseDiscount(body.discount);
      if (discount) managerOnly(m, 'a discount');
      const delivery =
        body.delivery === undefined || body.delivery === null ? null : parseDelivery(body.delivery);
      if (delivery?.feeCents != null) managerOnly(m, 'a delivery fee typed by hand');
      const [, tz] = await Promise.all([gate(tx, t.id), storeTz(tx, t.id)]);
      const priced = await priceLines(tx, t.id, lines, { tz });
      const fee = delivery
        ? (await priceDelivery(tx, t.id, delivery, subtotalOf(priced))).quote
        : null;
      return { quote: quoteOf(priced, discount, fee) };
    }),
  );

  admin.post(
    '/pdv/pix',
    read('attendant', async (tx, t, _m, c) => {
      const body = await bodyOf(c, 1024);
      const amount = int(body.amountCents, 'amountCents', 1, MAX_CENTS);
      const [, s] = await Promise.all([gate(tx, t.id), settingsOf(tx, t.id)]);
      if (!s?.pix_key || !s.pix_key_type) return { copyPaste: null };
      return {
        copyPaste: pixPayload(
          {
            key: s.pix_key,
            keyType: s.pix_key_type as PixKeyType,
            beneficiary: s.pix_beneficiary ?? '',
            city: s.pix_city ?? s.city ?? '',
          },
          { amountCents: amount, txid: 'PDV' },
        ),
      };
    }),
  );

  admin.post(
    '/pdv/sales',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 64 * 1024);
      const lines = parseLines(body.lines);
      const discount = parseDiscount(body.discount);
      if (discount) managerOnly(m, 'a discount');
      const mode = oneOf(body.mode, 'mode', ['takeaway', 'here', 'delivery'] as const);
      const customer = parseCustomer(body.customer);
      const notes = optText(body.notes, 'notes', 500) ?? null;
      const delivery = mode === 'delivery' ? parseDelivery(body.delivery) : null;
      if (delivery?.feeCents != null) managerOnly(m, 'a delivery fee typed by hand');
      if (delivery && (!customer.name || customer.name.length < 2 || !customer.phone))
        throw new HttpError(
          422,
          'CUSTOMER_REQUIRED',
          'a delivery needs the customer name and phone',
          {
            field: !customer.name || customer.name.length < 2 ? 'customer.name' : 'customer.phone',
          },
        );
      // a delivery may go out unpaid, charged at the door (and received later at the caixa)
      const later =
        body.payLater === undefined || body.payLater === null ? null : parsePayLater(body.payLater);
      if (later && !delivery)
        throw new HttpError(422, 'INVALID_PAYMENT', 'only a delivery is paid later', {
          field: 'payLater',
        });
      // paid later means nothing is paid now: part paid would leave money in the caixa on an
      // order marked unpaid, with no way to receive the rest
      if (later && Array.isArray(body.payments) && body.payments.length > 0)
        throw new HttpError(422, 'INVALID_PAYMENT', 'a sale paid later takes no payments now', {
          field: 'payments',
        });
      // none only when the total is 0: the sum check below holds every other sale to its total
      const payments: PdvPaymentIn[] = later ? [] : parsePayments(body.payments, 0);
      const quoted = int(body.quotedTotalCents, 'quotedTotalCents', 0, MAX_CENTS);
      const serveNow =
        body.serveNow === undefined || delivery ? false : bool(body.serveNow, 'serveNow');
      await gate(tx, t.id);
      // the caixa first (held for share), then checkout's lock, then the products
      const caixa = payments.length ? await requireOpenCaixa(tx, t.id) : null;
      await lockOrderNumbers(tx, t.id);
      const [tz, s] = await Promise.all([storeTz(tx, t.id), settingsOf(tx, t.id)]);
      const priced = await priceLines(tx, t.id, lines, { forUpdate: true, tz });
      const fee = delivery ? await priceDelivery(tx, t.id, delivery, subtotalOf(priced)) : null;
      const quote = quoteOf(priced, discount, fee?.quote ?? null);
      if (quote.totalCents !== quoted)
        throw new HttpError(409, 'PRICES_CHANGED', 'the total changed — review the sale', {
          quote,
        });
      const paid = sumOf(payments);
      if (!later && paid !== quote.totalCents)
        throw new HttpError(422, 'PAYMENT_MISMATCH', 'the payments must add up to the total', {
          totalCents: quote.totalCents,
          paidCents: paid,
        });
      if (later?.changeForCents != null && later.changeForCents < quote.totalCents)
        throw new HttpError(422, 'INVALID_CHANGE', 'change must be for at least the total', {
          field: 'payLater.changeForCents',
          minCents: quote.totalCents,
        });
      const prep = s?.prep ?? 30;
      const order = await insertPdvOrderTx(tx, t.id, {
        lines: priced,
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        totalCents: quote.totalCents,
        mode: delivery ? 'delivery' : mode === 'takeaway' ? 'pickup' : 'dine_in',
        ...(delivery && fee ? { delivery: deliveryJson(delivery, fee, prep) } : {}),
        table: null,
        tabId: null,
        customer: { name: customer.name ?? 'Balcão', phone: customer.phone },
        notes,
        payment: later
          ? {
              provider: 'pdv',
              method: later.method,
              status: 'pending',
              online: false,
              ...(later.changeForCents != null ? { changeForCents: later.changeForCents } : {}),
            }
          : paidPayment(payments, m.name),
        by: m.name,
        serveNow,
        prepMinutes: prep,
      });
      const views = caixa
        ? await insertPayments(tx, t.id, caixa.id, { orderId: order.id }, payments, m.name)
        : [];
      const change = views.reduce((n, p) => n + p.changeCents, 0);
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.sale',
          entity: 'order',
          entityId: order.id,
          summary: `${delivery ? 'lançou para entrega' : 'vendeu no balcão'} o pedido #${order.number} (${brl(quote.totalCents)})${later ? ', a cobrar na entrega' : ''}${discount ? ` com desconto de ${brl(quote.discountCents)}: ${discount.reason}` : ''}`,
          after: { totalCents: quote.totalCents, payments, payLater: later, discount },
        }),
        emitAdminTx(tx, t.id, 'pdv', caixa?.id ?? order.id),
      ]);
      return {
        status: 201,
        body: {
          order: await loadOrderView(tx, t.id, order.id),
          sale: {
            orderId: order.id,
            number: order.number,
            totalCents: quote.totalCents,
            changeCents: change,
            payments: views,
          },
        },
      };
    }),
  );

  // a returning customer, by the phone they're calling from
  admin.get(
    '/pdv/customer',
    read('attendant', async (tx, t, _m, c) => {
      const raw = (c.req.query('phone') ?? '').slice(0, 40);
      const phone = normalizePhone(raw);
      if (!/^\d{10,11}$/.test(phone))
        throw new HttpError(422, 'INVALID_PHONE', 'phone must have DDD and number', {
          field: 'phone',
        });
      await gate(tx, t.id);
      return { customer: await customerByPhone(tx, t.id, phone) };
    }),
  );

  // an approximate pin for a typed address — no tx around it: it's a call to the geocoder
  admin.get('/pdv/geocode', async (c) => {
    need(c as AdminCtx, 'attendant');
    const tenant = (c as AdminCtx).get('tenant');
    const q = (k: string, max: number) => {
      const v = c.req.query(k)?.trim();
      if (v && v.length > max)
        throw new HttpError(422, 'BAD_REQUEST', `${k} is too long`, { field: k });
      return v || null;
    };
    const street = q('street', 120);
    const number = q('number', 10);
    const neighborhood = q('neighborhood', 80);
    const cep = q('cep', 12);
    const store = await withTenant(d.sql, tenant.id, async (tx) => {
      await gate(tx, tenant.id);
      return settingsOf(tx, tenant.id);
    });
    const city = store?.city ?? null;
    const point =
      street || cep
        ? await d.geocode({
            text: [[street, number].filter(Boolean).join(', '), neighborhood, city]
              .filter(Boolean)
              .join(' — '),
            cep,
            street,
            number,
            city,
          })
        : null;
    c.header('cache-control', 'no-store');
    return c.json({ point });
  });

  // an order from the storefront, paid at the counter
  admin.post(
    '/pdv/orders/:id/payments',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 8 * 1024);
      const payments = parsePayments(body.payments);
      await gate(tx, t.id);
      const caixa = await requireOpenCaixa(tx, t.id);
      const [cur] = await tx<
        {
          number: number;
          state: string;
          total_cents: number;
          tab_id: string | null;
          payment: Record<string, unknown>;
        }[]
      >`
        select number, state, total_cents, tab_id, payment from orders
        where tenant_id = ${t.id} and id = ${id} for update
      `;
      if (!cur) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      if (cur.payment.online)
        throw new HttpError(409, 'PAYMENT_ONLINE', 'Mercado Pago confirms this payment');
      if (cur.tab_id)
        throw new HttpError(409, 'ORDER_ON_TAB', 'this order is paid with its comanda');
      // a payment the caixa already holds, even if Pedidos unmarked it since, is not taken twice
      const [held] = await tx<{ n: number }[]>`
        select count(*)::int as n from pdv_payments
        where tenant_id = ${t.id} and order_id = ${id} and voided_at is null`;
      if (
        cur.payment.status === 'paid' ||
        held!.n > 0 ||
        cur.state === 'cancelled' ||
        cur.state === 'refunded'
      )
        throw new HttpError(409, 'ALREADY_PAID', 'this order has nothing left to pay', {
          state: cur.state,
        });
      const paid = sumOf(payments);
      if (paid !== cur.total_cents)
        throw new HttpError(422, 'PAYMENT_MISMATCH', 'the payments must add up to the total', {
          totalCents: cur.total_cents,
          paidCents: paid,
        });
      const views = await insertPayments(tx, t.id, caixa.id, { orderId: id }, payments, m.name);
      const patch = {
        ...paidPayment(payments, m.name),
        requestedMethod: cur.payment.method ?? null,
      };
      await tx`
        update orders set payment = payment || ${tx.json(patch as never)}, rev = rev + 1, updated_at = now()
        where tenant_id = ${t.id} and id = ${id}
      `;
      await recordOrderStep(tx, t.id, { id, number: cur.number }, 'paid', 'merchant');
      // money a courier brings back after the door is no news to the customer
      if (cur.state !== 'delivered') await enqueueOrderMessageTx(tx, t.id, id, 'paid');
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.order_paid',
          entity: 'order',
          entityId: id,
          summary: `recebeu no caixa o pedido #${cur.number} (${brl(cur.total_cents)})`,
          before: { payment: cur.payment.status },
          after: { payment: 'paid', payments },
        }),
        emitAdminTx(tx, t.id, 'order.changed', id),
        emitAdminTx(tx, t.id, 'pdv', caixa.id),
      ]);
      return {
        status: 200,
        body: {
          order: await loadOrderView(tx, t.id, id),
          changeCents: views.reduce((n, p) => n + p.changeCents, 0),
        },
      };
    }),
  );

  // ── comandas ───────────────────────────────────────────────────────────────

  const tabOut = async (tx: Sql, tenantId: string, id: string) => ({
    tab: await tabDetail(tx, tenantId, id),
  });

  admin.post(
    '/pdv/tabs',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 4 * 1024);
      const tableId =
        body.tableId === undefined || body.tableId === null
          ? null
          : uuidOf(body.tableId, 'tableId');
      const own = optText(body.label, 'label', 40) ?? null;
      const customerName = optText(body.customerName, 'customerName', 80) ?? null;
      if (!tableId && !own)
        throw new HttpError(422, 'BAD_REQUEST', 'a comanda needs a table or a label', {
          field: 'tableId',
        });
      const [, s] = await Promise.all([gate(tx, t.id), settingsOf(tx, t.id)]);
      let label = own ?? '';
      if (tableId) {
        const table = await tableRow(tx, t.id, tableId);
        label = own ?? table.label;
        await busyTab(tx, t.id, tableId);
      }
      let id: string;
      try {
        id = (
          await tx<{ id: string }[]>`
          insert into pdv_tabs (tenant_id, table_id, label, customer_name, service_bps, service_fee, opened_by)
          values (${t.id}, ${tableId}, ${label}, ${customerName}, ${s?.service_bps ?? 0},
                  ${(s?.service_bps ?? 0) > 0}, ${m.name})
          returning id
        `
        )[0]!.id;
      } catch (err) {
        // two openings raced on one table: the index lets one through
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'TABLE_BUSY', 'this table has an open comanda');
        throw err;
      }
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tab_opened',
          entity: 'pdv_tab',
          entityId: id,
          summary: `abriu a comanda ${label}`,
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 201, body: await tabOut(tx, t.id, id) };
    }),
  );

  admin.get(
    '/pdv/tabs/:id',
    read('attendant', async (tx, t, _m, c) => {
      const id = uuidParam(c, 'id');
      const n = ways(c);
      await gate(tx, t.id);
      return { tab: await tabDetail(tx, t.id, id, n) };
    }),
  );

  admin.post(
    '/pdv/tabs/:id/rounds',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 64 * 1024);
      const lines = parseLines(body.lines);
      const notes = optText(body.notes, 'notes', 500) ?? null;
      const serveNow = body.serveNow === undefined ? false : bool(body.serveNow, 'serveNow');
      await gate(tx, t.id);
      // the comanda, then checkout's lock, then the products
      const tab = await lockTab(tx, t.id, id);
      assertOpen(tab);
      await lockOrderNumbers(tx, t.id);
      const [tz, s] = await Promise.all([storeTz(tx, t.id), settingsOf(tx, t.id)]);
      const priced = await priceLines(tx, t.id, lines, { forUpdate: true, tz });
      const quote = quoteOf(priced, null);
      const order = await insertPdvOrderTx(tx, t.id, {
        lines: priced,
        subtotalCents: quote.subtotalCents,
        discountCents: 0,
        totalCents: quote.totalCents,
        mode: 'dine_in',
        table: tab.label,
        tabId: tab.id,
        customer: { name: tab.customer_name ?? tab.label, phone: null },
        notes,
        payment: TAB_PAYMENT,
        by: m.name,
        serveNow,
        prepMinutes: s?.prep ?? 30,
      });
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.round',
          entity: 'pdv_tab',
          entityId: id,
          summary: `lançou o pedido #${order.number} na comanda ${tab.label} (${brl(quote.totalCents)})`,
          after: { orderId: order.id, totalCents: quote.totalCents },
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 201, body: { ...(await tabOut(tx, t.id, id)), orderId: order.id } };
    }),
  );

  admin.patch(
    '/pdv/tabs/:id',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 4 * 1024);
      await gate(tx, t.id);
      const tab = await lockTab(tx, t.id, id);
      assertOpen(tab);
      const changes: string[] = [];
      if (body.serviceFee !== undefined) {
        const on = bool(body.serviceFee, 'serviceFee');
        await tx`update pdv_tabs set service_fee = ${on} where tenant_id = ${t.id} and id = ${id}`;
        changes.push(on ? 'cobrou o serviço' : 'tirou o serviço');
      }
      if (body.discount !== undefined) {
        managerOnly(m, 'a discount');
        const discount = parseDiscount(body.discount);
        await tx`update pdv_tabs set discount = ${discount ? tx.json(discount as never) : null}
                 where tenant_id = ${t.id} and id = ${id}`;
        changes.push(discount ? `deu desconto (${discount.reason})` : 'tirou o desconto');
      }
      if (body.discount !== undefined || body.serviceFee !== undefined) {
        // a smaller bill never leaves the comanda paid beyond it
        const after = await tabDetail(tx, t.id, id);
        if (after.remainingCents < 0)
          throw new HttpError(422, 'TAB_OVERPAID', 'the comanda has been paid more than that', {
            field: body.discount !== undefined ? 'discount' : 'serviceFee',
            paidCents: after.paidCents,
            totalCents: after.totalCents,
          });
      }
      if (body.customerName !== undefined) {
        const name = optText(body.customerName, 'customerName', 80) ?? null;
        await tx`update pdv_tabs set customer_name = ${name} where tenant_id = ${t.id} and id = ${id}`;
        changes.push('mudou o nome');
      }
      let label = optText(body.label, 'label', 40) ?? undefined;
      if (body.tableId !== undefined) {
        const tableId = body.tableId === null ? null : uuidOf(body.tableId, 'tableId');
        if (tableId) {
          const table = await tableRow(tx, t.id, tableId);
          await busyTab(tx, t.id, tableId, id);
          label ??= table.label;
          changes.push(`passou para ${table.label}`);
        } else changes.push('saiu da mesa');
        try {
          await tx`update pdv_tabs set table_id = ${tableId} where tenant_id = ${t.id} and id = ${id}`;
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new HttpError(409, 'TABLE_BUSY', 'this table has an open comanda');
          throw err;
        }
      }
      if (label) {
        await tx`update pdv_tabs set label = ${label} where tenant_id = ${t.id} and id = ${id}`;
        if (body.tableId === undefined) changes.push(`renomeou para ${label}`);
      }
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tab_changed',
          entity: 'pdv_tab',
          entityId: id,
          summary: `comanda ${tab.label}: ${changes.join(', ') || 'nada mudou'}`,
          before: { serviceFee: tab.service_fee, discount: tab.discount, tableId: tab.table_id },
          after: body,
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 200, body: await tabOut(tx, t.id, id) };
    }),
  );

  admin.post(
    '/pdv/tabs/:id/payments',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const payment = parsePayment(await bodyOf(c, 2 * 1024));
      await gate(tx, t.id);
      // the comanda, then the caixa
      const tab = await lockTab(tx, t.id, id);
      assertOpen(tab);
      const caixa = await requireOpenCaixa(tx, t.id);
      const before = await tabDetail(tx, t.id, id);
      if (payment.amountCents > before.remainingCents)
        throw new HttpError(422, 'OVERPAY', 'more than what remains on the comanda', {
          remainingCents: Math.max(0, before.remainingCents),
        });
      const [view] = await insertPayments(tx, t.id, caixa.id, { tabId: id }, [payment], m.name);
      const after = await tabDetail(tx, t.id, id);
      // a QR order still waiting for the staff keeps the comanda open (ADR 0036)
      const waiting = after.roundsList.some(holdsTab);
      if (after.remainingCents === 0 && !waiting) await closeTabTx(tx, t.id, after, m.name);
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tab_payment',
          entity: 'pdv_tab',
          entityId: id,
          summary: `recebeu ${brl(payment.amountCents)} na comanda ${tab.label}${after.remainingCents === 0 && !waiting ? ' e fechou a conta' : ''}`,
          after: { payment },
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 200, body: { tab: await tabDetail(tx, t.id, id), payment: view } };
    }),
  );

  admin.post(
    '/pdv/tabs/:id/close',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      await gate(tx, t.id);
      const tab = await lockTab(tx, t.id, id);
      assertOpen(tab);
      const detail = await tabDetail(tx, t.id, id);
      // an overpaid comanda (a round cancelled after paying) gives the difference back first:
      // void a payment and take the right amount
      if (detail.roundsList.some(holdsTab))
        throw new HttpError(
          409,
          'TAB_HAS_PENDING',
          'accept or cancel its waiting QR orders, or wait for their online payment',
        );
      if (detail.remainingCents !== 0)
        throw new HttpError(
          409,
          detail.remainingCents > 0 ? 'TAB_UNPAID' : 'TAB_OVERPAID',
          detail.remainingCents > 0
            ? 'the comanda still owes'
            : 'the comanda was paid more than it owes',
          { remainingCents: detail.remainingCents },
        );
      await closeTabTx(tx, t.id, detail, m.name);
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tab_closed',
          entity: 'pdv_tab',
          entityId: id,
          summary: `fechou a comanda ${tab.label}`,
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 200, body: await tabOut(tx, t.id, id) };
    }),
  );

  admin.post(
    '/pdv/tabs/:id/cancel',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 2 * 1024);
      const reason = text(body.reason, 'reason', 200, 1);
      await gate(tx, t.id);
      const tab = await lockTab(tx, t.id, id);
      assertOpen(tab);
      const detail = await tabDetail(tx, t.id, id);
      if (detail.payments.some((p) => !p.voided))
        throw new HttpError(409, 'TAB_HAS_PAYMENTS', 'void its payments first');
      // a round paid (or being paid) online is cancelled in Pedidos, which refunds it
      if (
        detail.roundsList.some(
          (r) =>
            (r.paidOnline || r.onlinePending) && r.state !== 'cancelled' && r.state !== 'refunded',
        )
      )
        throw new HttpError(
          409,
          'TAB_HAS_ONLINE_ROUNDS',
          'cancel its online-paid orders in Pedidos first',
        );
      await tx`
        update pdv_tabs set status = 'cancelled', closed_at = now(), close_reason = ${reason}
        where tenant_id = ${t.id} and id = ${id}
      `;
      for (const r of detail.roundsList)
        if (r.state !== 'cancelled' && r.state !== 'refunded' && r.state !== 'delivered')
          await transitionOrder(tx, t.id, r.orderId, 'cancelled', 'merchant', {
            by: m.name,
            reason,
            via: 'pdv',
          });
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tab_cancelled',
          entity: 'pdv_tab',
          entityId: id,
          summary: `cancelou a comanda ${tab.label} (${reason})`,
        }),
        emitAdminTx(tx, t.id, 'pdv', id),
      ]);
      return { status: 200, body: await tabOut(tx, t.id, id) };
    }),
  );

  admin.post(
    '/pdv/payments/:id/void',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 2 * 1024);
      const reason = text(body.reason, 'reason', 200, 1);
      await gate(tx, t.id);
      const payRow = () =>
        tx<
          {
            tab_id: string | null;
            session_id: string;
            amount_cents: number;
            method: string;
            voided_at: Date | null;
          }[]
        >`
          select tab_id, session_id, amount_cents, method, voided_at from pdv_payments
          where tenant_id = ${t.id} and id = ${id}
        `.then((rows) => rows[0]);
      const first = await payRow();
      if (!first) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'payment not found');
      const locked = (why: string) => new HttpError(409, 'PAYMENT_LOCKED', why);
      if (!first.tab_id) throw locked('only a payment on a comanda can be voided');
      // the comanda, then the caixa (held so it can't close under the void), as payments do
      const tab = await lockTab(tx, t.id, first.tab_id);
      if (tab.status !== 'open') throw locked('the comanda is closed');
      const caixa = await openCaixaRow(tx, t.id, 'share');
      const pay = (await payRow())!;
      if (pay.voided_at) throw locked('this payment is already voided');
      if (!caixa) throw locked('open the caixa to give the money back');
      await tx`
        update pdv_payments set voided_at = now(), voided_by = ${m.name}, void_reason = ${reason}
        where tenant_id = ${t.id} and id = ${id}
      `;
      // taken in a caixa already counted: the cash handed back leaves this one's drawer, else a
      // comanda overpaid after a shift change could never close, cancel or be voided
      if (caixa.id !== pay.session_id && pay.method === 'cash')
        await tx`
          insert into cash_movements (tenant_id, session_id, kind, amount_cents, reason, by_name)
          values (${t.id}, ${caixa.id}, 'sangria', ${pay.amount_cents},
            ${`estorno na comanda ${tab.label}`.slice(0, 140)}, ${m.name})
        `;
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.payment_voided',
          entity: 'pdv_tab',
          entityId: tab.id,
          summary: `estornou ${brl(pay.amount_cents)} da comanda ${tab.label} (${reason})`,
        }),
        emitAdminTx(tx, t.id, 'pdv', tab.id),
      ]);
      return { status: 200, body: await tabOut(tx, t.id, tab.id) };
    }),
  );

  admin.post(
    '/pdv/tabs/:id/print',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 1024);
      const n =
        body.ways === undefined || body.ways === null ? null : int(body.ways, 'ways', 2, 20);
      await Promise.all([gate(tx, t.id), requireFeature(tx, t.id, 'printing')]);
      const tab = await tabDetail(tx, t.id, id, n);
      const printer = await printerFor(tx, t.id, body.printerId);
      const jobIds = await queueJobsTx(tx, t.id, [printer], {
        kind: 'bill',
        trigger: 'manual',
        requestedBy: m.userId,
        doc: tab,
      });
      await emitAdminTx(tx, t.id, 'printers', printer);
      return { status: 202, body: { jobIds } };
    }),
  );

  // ── caixa ──────────────────────────────────────────────────────────────────

  admin.get(
    '/pdv/caixa',
    read('attendant', async (tx, t, m) => {
      const [, row] = await Promise.all([gate(tx, t.id), openCaixaRow(tx, t.id)]);
      return {
        caixa: row ? await caixaDetail(tx, t.id, row, roleAtLeast(m.role, 'manager')) : null,
      };
    }),
  );

  admin.post(
    '/pdv/caixa/open',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 1024);
      const opening = int(body.openingCents, 'openingCents', 0, MAX_CENTS);
      await gate(tx, t.id);
      if (await openCaixaRow(tx, t.id, 'update'))
        throw new HttpError(409, 'CAIXA_OPEN', 'the caixa is already open');
      let row;
      try {
        [row] = await tx<{ id: string }[]>`
          insert into cash_sessions (tenant_id, opened_by, opening_cents)
          values (${t.id}, ${m.name}, ${opening}) returning id
        `;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'CAIXA_OPEN', 'the caixa is already open');
        throw err;
      }
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.caixa_opened',
          entity: 'cash_session',
          entityId: row!.id,
          summary: `abriu o caixa com ${brl(opening)}`,
        }),
        emitAdminTx(tx, t.id, 'pdv', row!.id),
      ]);
      const open = (await openCaixaRow(tx, t.id))!;
      return {
        status: 201,
        body: { caixa: await caixaDetail(tx, t.id, open, roleAtLeast(m.role, 'manager')) },
      };
    }),
  );

  admin.post(
    '/pdv/caixa/movements',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 2 * 1024);
      const kind = oneOf(body.kind, 'kind', ['sangria', 'suprimento'] as const);
      const amount = int(body.amountCents, 'amountCents', 1, MAX_CENTS);
      const reason = text(body.reason, 'reason', 140, 1);
      await gate(tx, t.id);
      const row = await openCaixaRow(tx, t.id, 'update');
      if (!row) throw new HttpError(409, 'CAIXA_CLOSED', 'the caixa is closed');
      // only for who sees the expected count: a refusal would let an attendant probe the blind close
      if (kind === 'sangria' && roleAtLeast(m.role, 'manager')) {
        const d0 = await caixaDetail(tx, t.id, row, true);
        if (amount > d0.expected!.cash)
          throw new HttpError(422, 'INSUFFICIENT_CASH', 'more than the drawer should hold', {
            field: 'amountCents',
          });
      }
      await tx`
        insert into cash_movements (tenant_id, session_id, kind, amount_cents, reason, by_name)
        values (${t.id}, ${row.id}, ${kind}, ${amount}, ${reason}, ${m.name})
      `;
      await Promise.all([
        audit(tx, t.id, m, {
          action: `pdv.${kind}`,
          entity: 'cash_session',
          entityId: row.id,
          summary: `${kind === 'sangria' ? 'tirou' : 'colocou'} ${brl(amount)} ${kind === 'sangria' ? 'do' : 'no'} caixa (${reason})`,
        }),
        emitAdminTx(tx, t.id, 'pdv', row.id),
      ]);
      return {
        status: 200,
        body: { caixa: await caixaDetail(tx, t.id, row, roleAtLeast(m.role, 'manager')) },
      };
    }),
  );

  admin.post(
    '/pdv/caixa/close',
    write('attendant', async (tx, t, m, c) => {
      const body = await bodyOf(c, 2 * 1024);
      const counted = parseCounted(body.counted);
      const notes = optText(body.notes, 'notes', 500) ?? null;
      await gate(tx, t.id);
      const row = await openCaixaRow(tx, t.id, 'update');
      if (!row) throw new HttpError(409, 'CAIXA_CLOSED', 'the caixa is closed');
      const detail = await caixaDetail(tx, t.id, row, true);
      // shown in full (managers' view): the open caixa's expected, computed from its ledger
      const expected = detail.expected!;
      const [closed] = await tx<{ closed_at: Date }[]>`
        update cash_sessions set closed_at = now(), closed_by = ${m.name},
          counted = ${tx.json(counted)}, expected = ${tx.json(expected)}, notes = ${notes}
        where tenant_id = ${t.id} and id = ${row.id}
        returning closed_at
      `;
      const done = {
        ...row,
        closed_at: closed!.closed_at,
        closed_by: m.name,
        counted,
        expected,
        notes,
      };
      const report = reportOf(await caixaDetail(tx, t.id, done, true), done);
      const diff = Object.values(report.differences).reduce((n, v) => n + v, 0);
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.caixa_closed',
          entity: 'cash_session',
          entityId: row.id,
          summary: `fechou o caixa${diff === 0 ? ' sem diferença' : ` com diferença de ${diff < 0 ? '-' : ''}${brl(Math.abs(diff))}`}`,
          after: { counted, expected },
        }),
        emitAdminTx(tx, t.id, 'pdv', row.id),
      ]);
      return { status: 200, body: { report } };
    }),
  );

  admin.get(
    '/pdv/caixa/history',
    read('attendant', async (tx, t, _m, c) => {
      const raw = Number(c.req.query('limit') ?? 30);
      const limit = Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 30;
      await gate(tx, t.id);
      const rows = await tx<
        {
          id: string;
          opened_at: Date;
          closed_at: Date;
          opened_by: string;
          closed_by: string | null;
          counted: Record<string, number>;
          expected: Record<string, number>;
          total: number;
        }[]
      >`
        select s.id, s.opened_at, s.closed_at, s.opened_by, s.closed_by, s.counted, s.expected,
               coalesce((select sum(p.amount_cents) from pdv_payments p
                         where p.tenant_id = s.tenant_id and p.session_id = s.id
                           and p.voided_at is null), 0)::int as total
        from cash_sessions s
        where s.tenant_id = ${t.id} and s.closed_at is not null
        order by s.closed_at desc limit ${limit}
      `;
      const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0);
      return {
        sessions: rows.map((r) => ({
          id: r.id,
          openedAt: new Date(r.opened_at).toISOString(),
          closedAt: new Date(r.closed_at).toISOString(),
          openedBy: r.opened_by,
          closedBy: r.closed_by ?? '',
          totalCents: r.total,
          differenceCents: sum(r.counted) - sum(r.expected),
        })),
      };
    }),
  );

  admin.get(
    '/pdv/caixa/:id',
    read('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      await gate(tx, t.id);
      const row = await caixaRowById(tx, t.id, id);
      if (!row) throw new HttpError(404, 'CAIXA_NOT_FOUND', 'caixa not found');
      if (!row.closed_at)
        return { caixa: await caixaDetail(tx, t.id, row, roleAtLeast(m.role, 'manager')) };
      return { report: reportOf(await caixaDetail(tx, t.id, row, true), row) };
    }),
  );

  admin.post(
    '/pdv/caixa/:id/print',
    write('attendant', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 1024);
      await Promise.all([gate(tx, t.id), requireFeature(tx, t.id, 'printing')]);
      const row = await caixaRowById(tx, t.id, id);
      if (!row) throw new HttpError(404, 'CAIXA_NOT_FOUND', 'caixa not found');
      // an open caixa's partial shows what the drawer should hold: not for a blind close
      if (!row.closed_at) managerOnly(m, 'printing an open caixa');
      const detail = await caixaDetail(tx, t.id, row, true);
      const doc = row.closed_at ? reportOf(detail, row) : detail;
      const printer = await printerFor(tx, t.id, body.printerId);
      const jobIds = await queueJobsTx(tx, t.id, [printer], {
        kind: 'caixa',
        trigger: 'manual',
        requestedBy: m.userId,
        doc,
      });
      await emitAdminTx(tx, t.id, 'printers', printer);
      return { status: 202, body: { jobIds } };
    }),
  );

  // ── tables and settings ────────────────────────────────────────────────────

  admin.get(
    '/pdv/tables',
    read('attendant', async (tx, t) => {
      await gate(tx, t.id);
      return tablesOut(tx, t, d);
    }),
  );

  admin.post(
    '/pdv/tables',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c, 16 * 1024);
      if (!Array.isArray(body.labels) || body.labels.length < 1 || body.labels.length > 100)
        throw new HttpError(422, 'BAD_REQUEST', 'labels must hold 1–100 labels', {
          field: 'labels',
        });
      const labels = [...new Set(body.labels.map((l, i) => tableLabel(l, `labels[${i}]`)))];
      await gate(tx, t.id);
      const have = await tables(tx, t.id);
      const taken = new Set(have.map((r) => r.label.toLowerCase()));
      const fresh = labels.filter((l) => !taken.has(l.toLowerCase()));
      if (have.length + fresh.length > MAX_TABLES)
        throw new HttpError(422, 'TOO_MANY_TABLES', `a store has at most ${MAX_TABLES} tables`, {
          max: MAX_TABLES,
        });
      const start = have.reduce((n, r) => Math.max(n, r.sort + 1), 0);
      if (fresh.length)
        await tx`
          insert into pdv_tables ${tx(fresh.map((label, i) => ({ tenant_id: t.id, label, sort: start + i })))}
          on conflict do nothing
        `;
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.tables_added',
          entity: 'pdv_table',
          summary: `criou ${fresh.length} ${fresh.length === 1 ? 'mesa' : 'mesas'}`,
          after: { labels: fresh },
        }),
        emitAdminTx(tx, t.id, 'pdv', 'tables'),
      ]);
      return { status: 201, body: { tables: await withQr(tx, t, d, await tables(tx, t.id)) } };
    }),
  );

  admin.patch(
    '/pdv/tables/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      const body = await bodyOf(c, 1024);
      const label = body.label === undefined ? undefined : tableLabel(body.label);
      const sort = body.sort === undefined ? undefined : int(body.sort, 'sort', 0, 100000);
      await gate(tx, t.id);
      const before = await tableRow(tx, t.id, id);
      try {
        await tx`
          update pdv_tables set label = ${label ?? before.label}, sort = ${sort ?? before.sort}
          where tenant_id = ${t.id} and id = ${id}
        `;
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'TABLE_LABEL_TAKEN', 'another table has this name', {
            field: 'label',
          });
        throw err;
      }
      // an open comanda shows its table's name
      if (label && label !== before.label)
        await tx`
          update pdv_tabs set label = ${label}
          where tenant_id = ${t.id} and table_id = ${id} and status = 'open' and label = ${before.label}
        `;
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.table_changed',
          entity: 'pdv_table',
          entityId: id,
          summary: `mesa ${before.label}${label && label !== before.label ? ` agora é ${label}` : ': nova posição'}`,
          before,
          after: { label, sort },
        }),
        emitAdminTx(tx, t.id, 'pdv', 'tables'),
      ]);
      const [one] = await withQr(
        tx,
        t,
        d,
        (await tables(tx, t.id)).filter((r) => r.id === id),
      );
      return { status: 200, body: { table: one } };
    }),
  );

  admin.delete(
    '/pdv/tables/:id',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      await gate(tx, t.id);
      const before = await tableRow(tx, t.id, id);
      await busyTab(tx, t.id, id);
      await tx`update pdv_tables set archived_at = now() where tenant_id = ${t.id} and id = ${id}`;
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.table_archived',
          entity: 'pdv_table',
          entityId: id,
          summary: `removeu a mesa ${before.label}`,
        }),
        emitAdminTx(tx, t.id, 'pdv', 'tables'),
      ]);
      return { status: 200, body: await tablesOut(tx, t, d) };
    }),
  );

  admin.post(
    '/pdv/tables/:id/restore',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      await gate(tx, t.id);
      const [row] = await tx<{ label: string; archived: boolean }[]>`
        select label, archived_at is not null as archived from pdv_tables
        where tenant_id = ${t.id} and id = ${id}
      `;
      if (!row) throw new HttpError(404, 'TABLE_NOT_FOUND', 'table not found');
      const have = await tables(tx, t.id);
      if (row.archived) {
        if (have.length >= MAX_TABLES)
          throw new HttpError(422, 'TOO_MANY_TABLES', `a store has at most ${MAX_TABLES} tables`, {
            max: MAX_TABLES,
          });
        const sort = have.reduce((n, r) => Math.max(n, r.sort + 1), 0);
        try {
          await tx`
            update pdv_tables set archived_at = null, sort = ${Math.min(sort, 100000)}
            where tenant_id = ${t.id} and id = ${id}
          `;
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new HttpError(409, 'TABLE_LABEL_TAKEN', 'another table has this name', {
              label: row.label,
            });
          throw err;
        }
        await Promise.all([
          audit(tx, t.id, m, {
            action: 'pdv.table_restored',
            entity: 'pdv_table',
            entityId: id,
            summary: `trouxe de volta a mesa ${row.label}`,
          }),
          emitAdminTx(tx, t.id, 'pdv', 'tables'),
        ]);
      }
      return { status: 200, body: await tablesOut(tx, t, d) };
    }),
  );

  admin.patch(
    '/pdv/settings',
    write('manager', async (tx, t, m, c) => {
      const body = await bodyOf(c, 1024);
      const bps =
        body.serviceBps === undefined ? undefined : int(body.serviceBps, 'serviceBps', 0, 2000);
      const qr = body.qrOrders === undefined ? undefined : bool(body.qrOrders, 'qrOrders');
      if (bps === undefined && qr === undefined)
        throw new HttpError(422, 'BAD_REQUEST', 'send serviceBps or qrOrders', {
          field: 'serviceBps',
        });
      await gate(tx, t.id);
      const [before] = await tx<{ bps: number; qr: boolean }[]>`
        select pdv_service_bps as bps, pdv_qr_orders as qr from store_settings
        where tenant_id = ${t.id} for update
      `;
      const next = { bps: bps ?? before?.bps ?? 0, qr: qr ?? before?.qr ?? true };
      await tx`
        update store_settings set pdv_service_bps = ${next.bps}, pdv_qr_orders = ${next.qr}
        where tenant_id = ${t.id}
      `;
      const said = [
        bps !== undefined ? `taxa de serviço: ${(bps / 100).toLocaleString('pt-BR')}%` : null,
        qr !== undefined ? `pedidos pelo QR da mesa ${qr ? 'ligados' : 'desligados'}` : null,
      ].filter(Boolean);
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.settings',
          entity: 'store_settings',
          summary: said.join('; '),
          before: { serviceBps: before?.bps ?? 0, qrOrders: before?.qr ?? true },
          after: { serviceBps: next.bps, qrOrders: next.qr },
        }),
        emitAdminTx(tx, t.id, 'pdv', 'settings'),
        // the storefront's profile says whether its tables take orders
        emitAdminTx(tx, t.id, 'store', 'settings'),
      ]);
      return { status: 200, body: { serviceBps: next.bps, qrOrders: next.qr } };
    }),
  );

  admin.post(
    '/pdv/tables/:id/qr',
    write('manager', async (tx, t, m, c) => {
      const id = uuidParam(c, 'id');
      await gate(tx, t.id);
      const before = await tableRow(tx, t.id, id);
      await tx`
        update pdv_tables set qr_rev = qr_rev + 1 where tenant_id = ${t.id} and id = ${id}
      `;
      const [one] = await withQr(
        tx,
        t,
        d,
        (await tables(tx, t.id)).filter((r) => r.id === id),
      );
      await Promise.all([
        audit(tx, t.id, m, {
          action: 'pdv.table_qr_replaced',
          entity: 'pdv_table',
          entityId: id,
          summary: `gerou um novo QR para a mesa ${before.label}: o anterior não funciona mais`,
        }),
        emitAdminTx(tx, t.id, 'pdv', 'tables'),
      ]);
      return { status: 200, body: { table: one } };
    }),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOf(v: unknown, field: string): string {
  if (typeof v !== 'string' || !UUID.test(v))
    throw new HttpError(422, 'BAD_REQUEST', `${field} must be a uuid`, { field });
  return v.toLowerCase();
}
