import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import {
  discountCents,
  MAX_CENTS,
  PDV_METHODS,
  serviceCents,
  splitShares,
  type PdvDiscount,
  type PdvMethod,
} from './pricing.ts';
import { deliverTx, TAB_PAYMENT } from './orders.ts';

// The caixa and the comandas: what was taken, what is owed, and what the drawer should hold.

type ByMethod<T> = Record<PdvMethod, T>;
const perMethod = <T>(f: (m: PdvMethod) => T) =>
  Object.fromEntries(PDV_METHODS.map((m) => [m, f(m)])) as ByMethod<T>;

export interface PdvPaymentView {
  id: string;
  method: PdvMethod;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number;
  at: string;
  by: string;
  voided: boolean;
}

interface PaymentRow {
  id: string;
  method: PdvMethod;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number;
  at: Date;
  by_name: string;
  voided_at: Date | null;
}

export const paymentView = (r: PaymentRow): PdvPaymentView => ({
  id: r.id,
  method: r.method,
  amountCents: r.amount_cents,
  tenderedCents: r.tendered_cents,
  changeCents: r.change_cents,
  at: new Date(r.at).toISOString(),
  by: r.by_name,
  voided: r.voided_at !== null,
});

// ── caixa ───────────────────────────────────────────────────────────────────

export interface CashRow {
  id: string;
  opened_by: string;
  opened_at: Date;
  opening_cents: number;
  closed_by: string | null;
  closed_at: Date | null;
  counted: ByMethod<number> | null;
  expected: ByMethod<number> | null;
  notes: string | null;
}

export async function openCaixaRow(
  tx: Sql,
  tenantId: string,
  lock: 'share' | 'update' | null = null,
): Promise<CashRow | null> {
  const rows = await tx<CashRow[]>`
    select id, opened_by, opened_at, opening_cents, closed_by, closed_at, counted, expected, notes
    from cash_sessions where tenant_id = ${tenantId} and closed_at is null
    ${lock === 'share' ? tx`for share` : lock === 'update' ? tx`for update` : tx``}
  `;
  return rows[0] ?? null;
}

/** The caixa a payment goes into; held (for share) so it can't close under the payment. */
export async function requireOpenCaixa(tx: Sql, tenantId: string): Promise<CashRow> {
  const row = await openCaixaRow(tx, tenantId, 'share');
  if (!row) throw new HttpError(409, 'CAIXA_CLOSED', 'open the caixa before taking payments');
  return row;
}

export async function caixaRowById(tx: Sql, tenantId: string, id: string) {
  const rows = await tx<CashRow[]>`
    select id, opened_by, opened_at, opening_cents, closed_by, closed_at, counted, expected, notes
    from cash_sessions where tenant_id = ${tenantId} and id = ${id}
  `;
  return rows[0] ?? null;
}

export interface CaixaDetail {
  id: string;
  openedAt: string;
  openedBy: string;
  openingCents: number;
  movements: {
    id: string;
    kind: 'sangria' | 'suprimento';
    amountCents: number;
    reason: string;
    by: string;
    at: string;
  }[];
  byMethod: ByMethod<{ count: number; cents: number }>;
  salesCount: number;
  changeCents: number;
  serviceCents: number;
  expected: ByMethod<number> | null;
}

export interface CaixaReport extends CaixaDetail {
  closedAt: string;
  closedBy: string;
  counted: ByMethod<number>;
  differences: ByMethod<number>;
  notes: string | null;
}

/** What the drawer and each method should hold: Core's number, compared with the count. */
export function expectedOf(
  opening: number,
  byMethod: ByMethod<{ cents: number }>,
  movements: { kind: string; amountCents: number }[],
): ByMethod<number> {
  const moved = movements.reduce(
    (n, m) => n + (m.kind === 'suprimento' ? m.amountCents : -m.amountCents),
    0,
  );
  return perMethod((m) => byMethod[m].cents + (m === 'cash' ? opening + moved : 0));
}

export async function caixaDetail(
  tx: Sql,
  tenantId: string,
  row: CashRow,
  showExpected: boolean,
): Promise<CaixaDetail> {
  const until = row.closed_at ?? new Date();
  const [movements, sums, totals, service] = await Promise.all([
    tx<
      {
        id: string;
        kind: 'sangria' | 'suprimento';
        amount_cents: number;
        reason: string;
        by_name: string;
        at: Date;
      }[]
    >`
      select id, kind, amount_cents, reason, by_name, at from cash_movements
      where tenant_id = ${tenantId} and session_id = ${row.id} order by at, id
    `,
    tx<{ method: PdvMethod; count: number; cents: number }[]>`
      select method, count(*)::int as count, coalesce(sum(amount_cents), 0)::int as cents
      from pdv_payments
      where tenant_id = ${tenantId} and session_id = ${row.id} and voided_at is null
      group by method
    `,
    tx<{ sales: number; change: number }[]>`
      select count(distinct coalesce(order_id, tab_id))::int as sales,
             coalesce(sum(change_cents), 0)::int as change
      from pdv_payments
      where tenant_id = ${tenantId} and session_id = ${row.id} and voided_at is null
    `,
    // one caixa is open at a time: a comanda closed while it was open closed into it
    tx<{ cents: number }[]>`
      select coalesce(sum(service_cents), 0)::int as cents from pdv_tabs
      where tenant_id = ${tenantId} and status = 'closed'
        and closed_at >= ${row.opened_at} and closed_at <= ${until}
    `,
  ]);
  const byMethod = perMethod((m) => {
    const s = sums.find((r) => r.method === m);
    return { count: s?.count ?? 0, cents: s?.cents ?? 0 };
  });
  const moves = movements.map((m) => ({
    id: m.id,
    kind: m.kind,
    amountCents: m.amount_cents,
    reason: m.reason,
    by: m.by_name,
    at: new Date(m.at).toISOString(),
  }));
  return {
    id: row.id,
    openedAt: new Date(row.opened_at).toISOString(),
    openedBy: row.opened_by,
    openingCents: row.opening_cents,
    movements: moves,
    byMethod,
    salesCount: totals[0]?.sales ?? 0,
    changeCents: totals[0]?.change ?? 0,
    serviceCents: service[0]?.cents ?? 0,
    expected: showExpected
      ? (row.expected ?? expectedOf(row.opening_cents, byMethod, moves))
      : null,
  };
}

export function reportOf(detail: CaixaDetail, row: CashRow): CaixaReport {
  const expected = row.expected!;
  const counted = row.counted!;
  return {
    ...detail,
    expected,
    closedAt: new Date(row.closed_at!).toISOString(),
    closedBy: row.closed_by ?? '',
    counted,
    differences: perMethod((m) => (counted[m] ?? 0) - (expected[m] ?? 0)),
    notes: row.notes,
  };
}

export function parseCounted(v: unknown): ByMethod<number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new HttpError(422, 'BAD_REQUEST', 'counted must be an object', { field: 'counted' });
  const o = v as Record<string, unknown>;
  return perMethod((m) => {
    const n = o[m] ?? 0;
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > MAX_CENTS)
      throw new HttpError(422, 'BAD_REQUEST', `counted.${m} must be an integer 0–${MAX_CENTS}`, {
        field: `counted.${m}`,
      });
    return n as number;
  });
}

// ── comandas ────────────────────────────────────────────────────────────────

export interface TabRow {
  id: string;
  table_id: string | null;
  label: string;
  customer_name: string | null;
  status: 'open' | 'closed' | 'cancelled';
  service_bps: number;
  service_fee: boolean;
  discount: PdvDiscount | null;
  service_cents: number | null;
  opened_by: string;
  opened_at: Date;
  closed_at: Date | null;
}

interface TabSumRow extends TabRow {
  subtotal: number;
  rounds: number;
  paid: number;
}

export interface TabSummary {
  id: string;
  label: string;
  tableId: string | null;
  openedAt: string;
  openedBy: string;
  customerName: string | null;
  rounds: number;
  subtotalCents: number;
  totalCents: number;
  paidCents: number;
}

export interface TabRound {
  orderId: string;
  number: number;
  state: string;
  placedAt: string;
  totalCents: number;
  items: {
    name: string;
    qty: number;
    lineTotalCents: number;
    modifiers: { name: string; qty: number }[];
    note: string | null;
  }[];
}

export interface TabDetail extends TabSummary {
  status: TabRow['status'];
  closedAt: string | null;
  serviceBps: number;
  serviceFee: boolean;
  discount: PdvDiscount | null;
  discountCents: number;
  serviceCents: number;
  remainingCents: number;
  roundsList: TabRound[];
  payments: PdvPaymentView[];
  split: { ways: number; sharesCents: number[] } | null;
}

/** The bill: rounds still standing, the manager's discount, then the service on what's left. */
export function billOf(
  t: Pick<TabRow, 'discount' | 'service_bps' | 'service_fee'>,
  subtotal: number,
) {
  const off = discountCents(t.discount, subtotal);
  const service = t.service_fee ? serviceCents(t.service_bps, subtotal - off) : 0;
  return { discountCents: off, serviceCents: service, totalCents: subtotal - off + service };
}

const tabSums = (tx: Sql, tenantId: string, where: ReturnType<Sql>) =>
  tx<TabSumRow[]>`
    select t.id, t.table_id, t.label, t.customer_name, t.status, t.service_bps, t.service_fee,
           t.discount, t.service_cents, t.opened_by, t.opened_at, t.closed_at,
           coalesce((select sum(o.total_cents) from orders o
                     where o.tenant_id = t.tenant_id and o.tab_id = t.id
                       and o.state not in ('cancelled', 'refunded')), 0)::int as subtotal,
           (select count(*) from orders o
            where o.tenant_id = t.tenant_id and o.tab_id = t.id
              and o.state not in ('cancelled', 'refunded'))::int as rounds,
           coalesce((select sum(p.amount_cents) from pdv_payments p
                     where p.tenant_id = t.tenant_id and p.tab_id = t.id
                       and p.voided_at is null), 0)::int as paid
    from pdv_tabs t where t.tenant_id = ${tenantId} ${where}
    order by t.opened_at, t.id
  `;

function summaryOf(r: TabSumRow): TabSummary & { bill: ReturnType<typeof billOf> } {
  const bill = billOf(r, r.subtotal);
  return {
    id: r.id,
    label: r.label,
    tableId: r.table_id,
    openedAt: new Date(r.opened_at).toISOString(),
    openedBy: r.opened_by,
    customerName: r.customer_name,
    rounds: r.rounds,
    subtotalCents: r.subtotal,
    totalCents: bill.totalCents,
    paidCents: r.paid,
    bill,
  };
}

export async function openTabSummaries(tx: Sql, tenantId: string): Promise<TabSummary[]> {
  const rows = await tabSums(tx, tenantId, tx`and t.status = 'open'`);
  return rows.map((r) => {
    const { bill: _, ...s } = summaryOf(r);
    return s;
  });
}

/** 404 for a comanda that isn't this store's; `lock` holds it for the write that follows. */
export async function lockTab(tx: Sql, tenantId: string, id: string): Promise<TabRow> {
  const rows = await tx<TabRow[]>`
    select id, table_id, label, customer_name, status, service_bps, service_fee, discount,
           service_cents, opened_by, opened_at, closed_at
    from pdv_tabs where tenant_id = ${tenantId} and id = ${id} for update
  `;
  const tab = rows[0];
  if (!tab) throw new HttpError(404, 'TAB_NOT_FOUND', 'comanda not found');
  return tab;
}

export function assertOpen(tab: TabRow) {
  if (tab.status !== 'open')
    throw new HttpError(409, 'TAB_CLOSED', 'this comanda is no longer open', {
      status: tab.status,
    });
}

export async function tabDetail(
  tx: Sql,
  tenantId: string,
  id: string,
  ways: number | null = null,
): Promise<TabDetail> {
  const [rows, rounds, payments] = await Promise.all([
    tabSums(tx, tenantId, tx`and t.id = ${id}`),
    tx<
      {
        id: string;
        number: number;
        state: string;
        placed_at: Date;
        total_cents: number;
        items: {
          name: string;
          qty: number;
          line_total_cents: number;
          modifiers: { name: string; qty?: number }[];
          note: string | null;
        }[];
      }[]
    >`
      select o.id, o.number, o.state, o.placed_at, o.total_cents,
             (select coalesce(json_agg(i order by i.sort), '[]')
              from (select sort, name, qty, line_total_cents, modifiers, note from order_items
                    where tenant_id = o.tenant_id and order_id = o.id) i) as items
      from orders o where o.tenant_id = ${tenantId} and o.tab_id = ${id}
      order by o.placed_at, o.number
    `,
    tx<PaymentRow[]>`
      select id, method, amount_cents, tendered_cents, change_cents, at, by_name, voided_at
      from pdv_payments where tenant_id = ${tenantId} and tab_id = ${id} order by at, id
    `,
  ]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'TAB_NOT_FOUND', 'comanda not found');
  const { bill, ...summary } = summaryOf(row);
  // a closed comanda keeps the service it was charged
  const service =
    row.status === 'closed' && row.service_cents !== null ? row.service_cents : bill.serviceCents;
  const total = summary.subtotalCents - bill.discountCents + service;
  const remaining = total - summary.paidCents;
  return {
    ...summary,
    totalCents: total,
    status: row.status,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    serviceBps: row.service_bps,
    serviceFee: row.service_fee,
    discount: row.discount,
    discountCents: bill.discountCents,
    serviceCents: service,
    remainingCents: remaining,
    roundsList: rounds.map((r) => ({
      orderId: r.id,
      number: r.number,
      state: r.state,
      placedAt: new Date(r.placed_at).toISOString(),
      totalCents: r.total_cents,
      items: r.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        lineTotalCents: i.line_total_cents,
        modifiers: i.modifiers.map((m) => ({ name: m.name, qty: m.qty ?? 1 })),
        note: i.note,
      })),
    })),
    payments: payments.map(paymentView),
    split: ways ? { ways, sharesCents: splitShares(Math.max(0, remaining), ways) } : null,
  };
}

/**
 * Closes a comanda that owes nothing: the service it was charged is frozen, its rounds are paid
 * and handed over, and its table frees (the open-per-table index only holds open ones).
 */
export async function closeTabTx(
  tx: Sql,
  tenantId: string,
  tab: TabDetail,
  by: string,
  now = new Date(),
) {
  await tx`
    update pdv_tabs set status = 'closed', closed_at = ${now}, service_cents = ${tab.serviceCents}
    where tenant_id = ${tenantId} and id = ${tab.id}
  `;
  const live = tab.roundsList.filter((r) => r.state !== 'cancelled' && r.state !== 'refunded');
  if (live.length)
    await tx`
      update orders set payment = ${tx.json({ ...TAB_PAYMENT, status: 'paid', paidAt: now.toISOString(), confirmedBy: by } as never)},
        rev = rev + 1, updated_at = now()
      where tenant_id = ${tenantId} and id = any(${live.map((r) => r.orderId)}::uuid[])
    `;
  for (const r of live) await deliverTx(tx, tenantId, r.orderId, by);
}
