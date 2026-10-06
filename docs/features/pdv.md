# PDV — API contract

The decision is [ADR 0035](../adr/0035-pdv.md). Everything below is under `/admin/v1`, behind
the admin session. Every route answers 403 `PLAN_REQUIRED` (`details.feature = 'pdv'`) when the
plan lacks it. Mutations need the `Idempotency-Key` header (the admin's `useMutation` sends it).
Money is integer cents; the client formats it and never adds it up.

## Shared shapes

```ts
type PdvMethod = 'cash' | 'pix' | 'credit' | 'debit' | 'voucher';
// labels: Dinheiro, Pix, Crédito, Débito, Vale-refeição

interface PdvLineIn {
  productId: string;
  qty: number; // 1..99
  modifiers?: { id: string; qty?: number }[];
  comboSelections?: { slotId: string; productId: string; qty: number }[];
  note?: string; // ≤ 140
}
// at most 100 lines per request

interface PdvDiscountIn {
  kind: 'fixed' | 'percent';
  value: number; // cents for fixed; basis points (1000 = 10%) for percent, ≤ 10000
  reason: string; // 1..140
}

interface PdvPaymentIn {
  method: PdvMethod;
  amountCents: number; // applied to the bill, > 0
  tenderedCents?: number; // cash only: the notes handed over, ≥ amountCents
}
// at most 10 payments per sale

interface PdvQuoteLine {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiers: { name: string; qty: number; priceDeltaCents: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  note: string | null;
}

interface PdvQuote {
  lines: PdvQuoteLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

interface PdvPayment {
  id: string;
  method: PdvMethod;
  amountCents: number;
  tenderedCents: number | null;
  changeCents: number;
  at: string;
  by: string; // staff member's name
  voided: boolean;
}
```

A line error (product gone, sold out, bad options) keeps the storefront's codes (`PRODUCT_NOT_FOUND`,
`SOLD_OUT`, `OUT_OF_STOCK`, `INVALID_MODIFIER`, `INVALID_COMBO`, `INVALID_QTY`) and adds
`details.line` (the index in `lines`).

## Counter

`POST /pdv/quote` `{ lines, discount? }` → `{ quote: PdvQuote }`. Read-only (no Idempotency-Key).
A discount needs a manager (403 otherwise).

`POST /pdv/sales` → 201 `{ order: Order, sale: { orderId, number, totalCents, changeCents, payments: PdvPayment[] } }`

```ts
{
  lines: PdvLineIn[];
  discount?: PdvDiscountIn;              // manager
  mode: 'takeaway' | 'here';             // para levar (pickup) | consumo no local (dine_in, no table)
  customer?: { name?: string; phone?: string }; // optional; the phone earns loyalty stamps
  notes?: string;                        // ≤ 500
  payments: PdvPaymentIn[];              // must add up to exactly the total
  quotedTotalCents: number;              // the total the screen showed
  serveNow?: boolean;                    // "entregar agora": straight to delivered
}
```

- 409 `CAIXA_CLOSED` when no caixa is open.
- 409 `PRICES_CHANGED` `{ quote }` when the total differs from `quotedTotalCents`.
- 422 `PAYMENT_MISMATCH` `{ totalCents, paidCents }` when payments don't add up to the total.
- 422 `INVALID_PAYMENT` `{ field }` for a bad method, amount or tendered value (only cash takes
  `tenderedCents`).

`POST /pdv/pix` `{ amountCents }` → `{ copyPaste: string | null }`. Read-only. The static Pix
from the store's key for that amount (null when the store has no Pix key).

`POST /pdv/orders/:id/payments` `{ payments: PdvPaymentIn[] }` → `{ order: Order, changeCents }`.
Receives an order from the storefront at the counter. The order must not be paid online and
not paid yet (409 `ALREADY_PAID`, 409 `PAYMENT_ONLINE`), and the payments must add up to its
total (422 `PAYMENT_MISMATCH`). Needs an open caixa.

## Mesas and comandas

```ts
interface PdvTable {
  id: string;
  label: string;
  sort: number;
}

interface TabSummary {
  id: string;
  label: string; // the table's label, or the comanda's own
  tableId: string | null;
  openedAt: string;
  openedBy: string;
  customerName: string | null;
  rounds: number; // orders on it, cancelled ones excluded
  subtotalCents: number;
  totalCents: number; // subtotal - discount + service
  paidCents: number;
}

interface TabRound {
  orderId: string;
  number: number;
  state: OrderState;
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

interface TabDetail extends TabSummary {
  status: 'open' | 'closed' | 'cancelled';
  closedAt: string | null;
  serviceBps: number; // the store's rate when it opened
  serviceFee: boolean; // the customer takes it
  discount: { kind: 'fixed' | 'percent'; value: number; reason: string } | null;
  discountCents: number;
  serviceCents: number;
  remainingCents: number; // totalCents - paidCents (can go below 0 after a cancelled round)
  roundsList: TabRound[];
  payments: PdvPayment[];
  split: { ways: number; sharesCents: number[] } | null; // only with ?ways=N
}
```

- `GET /pdv/state` → `{ caixa: CaixaDetail | null, tables: PdvTable[], tabs: TabSummary[], serviceBps: number }`.
  `tabs` are the open ones.
- `POST /pdv/tabs` `{ tableId?: string, label?: string, customerName?: string }` → 201 `{ tab: TabDetail }`.
  One of `tableId` or `label`. 409 `TABLE_BUSY` `{ tabId }` when the table has an open comanda.
- `GET /pdv/tabs/:id?ways=N` → `{ tab: TabDetail }`. N in 2..20 fills `split`: the remaining
  amount in N shares, the first shares carrying the leftover cents.
- `POST /pdv/tabs/:id/rounds` `{ lines, notes?, serveNow? }` → 201 `{ tab: TabDetail, orderId }`.
  The round goes to the kitchen and printers like any accepted order.
- `PATCH /pdv/tabs/:id` `{ serviceFee?, tableId?, label?, customerName?, discount?: PdvDiscountIn | null }`
  → `{ tab }`. Moving to a busy table is 409 `TABLE_BUSY`. `discount` needs a manager.
- `POST /pdv/tabs/:id/payments` `PdvPaymentIn` → `{ tab: TabDetail, payment: PdvPayment }`.
  422 `OVERPAY` `{ remainingCents }` above what remains. When nothing remains, the comanda
  closes (`tab.status = 'closed'`), its orders are paid and delivered, and the table frees.
  Needs an open caixa.
- `POST /pdv/tabs/:id/close` → `{ tab }`. Only when nothing remains (409 `TAB_UNPAID`
  `{ remainingCents }`); for a comanda whose rounds were all cancelled, or that a cancelled round
  left overpaid.
- `POST /pdv/tabs/:id/cancel` `{ reason }` → `{ tab }`. Manager. Only without payments (409
  `TAB_HAS_PAYMENTS`); cancels its open rounds.
- `POST /pdv/payments/:id/void` `{ reason }` → `{ tab }`. Manager. Only on an open comanda (409
  `PAYMENT_LOCKED` otherwise).

A comanda that is no longer open answers 409 `TAB_CLOSED` to every write.

A round is cancelled through the existing `POST /orders/:id/transition` `{ to: 'cancelled', reason }`.

## Caixa

```ts
interface CaixaDetail {
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
  byMethod: Record<PdvMethod, { count: number; cents: number }>; // payments taken, voids excluded
  salesCount: number; // orders and comandas paid in this caixa
  changeCents: number; // change handed out
  serviceCents: number; // service charge in comandas closed in this caixa
  expected: Record<PdvMethod, number> | null; // null for attendants (blind close)
}

interface CaixaReport extends CaixaDetail {
  closedAt: string;
  closedBy: string;
  counted: Record<PdvMethod, number>;
  differences: Record<PdvMethod, number>; // counted - expected
  notes: string | null;
}
```

- `GET /pdv/caixa` → `{ caixa: CaixaDetail | null }`.
- `POST /pdv/caixa/open` `{ openingCents }` → 201 `{ caixa }`. 409 `CAIXA_OPEN` if one is open.
- `POST /pdv/caixa/movements` `{ kind, amountCents, reason }` → `{ caixa }`. A sangria above the
  cash expected in the drawer is 422 `INSUFFICIENT_CASH`.
- `POST /pdv/caixa/close` `{ counted: Record<PdvMethod, number>, notes? }` → `{ report: CaixaReport }`.
- `GET /pdv/caixa/history?limit=30` → `{ sessions: { id, openedAt, closedAt, openedBy, closedBy,
totalCents, differenceCents }[] }` (closed ones, newest first; `differenceCents` sums every
  method's difference).
- `GET /pdv/caixa/:id` → `{ report: CaixaReport }` (closed) or `{ caixa }` (open).

## Tables and settings (manager)

- `GET /pdv/tables` → `{ tables }`.
- `POST /pdv/tables` `{ labels: string[] }` (1..100 labels, each 1..40) → 201 `{ tables }`.
  A label in use is skipped.
- `PATCH /pdv/tables/:id` `{ label?, sort? }` → `{ table }`.
- `DELETE /pdv/tables/:id` → `{ tables }`. 409 `TABLE_BUSY` with an open comanda.
- `PATCH /pdv/settings` `{ serviceBps }` (0..2000) → `{ serviceBps }`.

## Order changes

- `delivery.mode` is `'pickup' | 'delivery' | 'dine_in'`. A dine-in order has `delivery.table`
  (the table's label, or null at the counter) and `delivery.tabId`.
- These orders have `source = 'pdv'` in the database; the admin tells them apart by
  `payment.provider === 'pdv'`.
- `payment.provider` is `'pdv'`. `payment.method` is a `PdvMethod`, `'mixed'` (several
  methods; `payment.pdv` lists them as `{ method, cents }`) or `'tab'` (paid with its comanda).

## Live

Admin SSE topic `pdv` (payload: the comanda or caixa id) on every write above. Order changes
still ride `order.placed` / `order.changed`.
