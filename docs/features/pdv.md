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

### Delivery from the counter (phone orders)

```ts
interface PdvDeliveryIn {
  street: string; // 1..120
  number?: string; // ≤ 10
  complement?: string; // ≤ 80
  neighborhood: string; // 1..80 — matches neighborhood zones
  reference?: string; // ≤ 120
  cep?: string; // 8 digits
  lat?: number; // the pin, for distance pricing and polygon zones
  lng?: number;
  feeCents?: number; // manager: a fee typed by hand, skips the zones (0..100000)
}

interface PdvDeliveryQuote {
  feeCents: number;
  zoneName: string | null; // null with a hand-typed fee
  etaMin: number | null;
  etaMax: number | null;
  distanceKm: number | null;
}
```

- `POST /pdv/quote` also takes `delivery?: PdvDeliveryIn`; the quote then carries
  `deliveryFeeCents` and `delivery: PdvDeliveryQuote` (both 0 / null without it), and
  `totalCents = subtotal - discount + deliveryFee`. The fee follows the store's zones (a zone's
  free-delivery threshold included). 422 `OUT_OF_ZONE` when no zone takes the address (a manager
  can type the fee). The store's minimum order and its "delivery on/off" switch are the
  storefront's and don't apply here.
- `POST /pdv/sales` takes `mode: 'delivery'` with `delivery: PdvDeliveryIn`; then
  `customer.name` (2..80) and `customer.phone` are required (422 `CUSTOMER_REQUIRED`).
  `payments` must be `[]` (422 `INVALID_PAYMENT` otherwise) with `payLater: { method: PdvMethod; changeForCents?: number }`: the
  order goes out unpaid ("cobrar na entrega"; `changeForCents` is cash only, ≥ the total) and is
  received later through `POST /pdv/orders/:id/payments`. With payments, they add up to the
  total as for any sale. The order is accepted at once and goes to the kitchen and printers; the
  customer gets the store's WhatsApp order messages (counter orders without delivery don't).
- `GET /pdv/customer?phone=` → `{ customer: { name, phone, orders, lastDelivery: PdvDeliveryIn | null } | null }`.
  The last name and address this phone ordered with, to fill a returning customer's order.
- `GET /pdv/geocode?street=&number=&neighborhood=&cep=` → `{ point: { lat, lng, precision } | null }`.
  The admin's geocoder, for attendants: an approximate pin for a typed address (a store that
  prices by distance needs one).

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
  → `{ tab }`. Moving to a busy table is 409 `TABLE_BUSY`. `discount` needs a manager. A discount
  or dropping the service that would leave the comanda paid beyond its total is 422 `TAB_OVERPAID`.
- `POST /pdv/tabs/:id/payments` `PdvPaymentIn` → `{ tab: TabDetail, payment: PdvPayment }`.
  422 `OVERPAY` `{ remainingCents }` above what remains. When nothing remains, the comanda
  closes (`tab.status = 'closed'`), its orders are paid and delivered, and the table frees.
  Needs an open caixa.
- `POST /pdv/tabs/:id/close` → `{ tab }`. Only when exactly nothing remains: 409 `TAB_UNPAID`
  `{ remainingCents }` while it owes, 409 `TAB_OVERPAID` when a round cancelled after paying left
  it paid beyond its total (void a payment and take the right amount). For a comanda whose
  rounds were all cancelled before any payment.
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
  // payments taken, voids excluded; cents null for attendants while it is open (blind close)
  byMethod: Record<PdvMethod, { count: number; cents: number | null }>;
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

## Printing

Both need the `printing` plan feature too (403 `PLAN_REQUIRED`). `printerId` picks the printer;
without it, a store with one connected printer uses it, else 422 `PRINTER_REQUIRED`
`{ printers: { id, name }[] }` (the screen asks once and remembers per device). 409
`NO_PRINTERS` when none is connected.

- `POST /pdv/tabs/:id/print` `{ printerId? }` → 202 `{ jobIds }`. The bill ("conferência"):
  rounds and items, subtotal, discount, service, total, what was paid and what remains, the
  split when `ways` (2..20) is sent. Marked "não é documento fiscal".
- `POST /pdv/caixa/:id/print` `{ printerId? }` → 202 `{ jobIds }`. A closed caixa's report (any
  role), or an open caixa's partial (managers only: it shows the expected amounts).

## Tables and settings (manager)

- `GET /pdv/tables` → `{ tables, archived }`; `archived` lists archived tables
  (`{ id, label, sort, archivedAt }`, newest first, at most 200).
- `POST /pdv/tables` `{ labels: string[] }` (1..100 labels, each 1..40) → 201 `{ tables }`.
  A label in use is skipped.
- `PATCH /pdv/tables/:id` `{ label?, sort? }` → `{ table }`.
- `DELETE /pdv/tables/:id` → `{ tables, archived }`. 409 `TABLE_BUSY` with an open comanda.
- `POST /pdv/tables/:id/restore` → `{ tables, archived }`. Brings an archived table back at the
  end. 409 `TABLE_LABEL_TAKEN` when an active table has its name, 422 `TOO_MANY_TABLES`.
- `PATCH /pdv/settings` `{ serviceBps }` (0..2000) → `{ serviceBps }`.

## QR ordering at the table (ADR 0036)

### Storefront (the Kernel)

- `GET /storefront/v1/store` gains `dineIn: { enabled: boolean }`: the `pdv` plan and the
  store's "pedidos pelo QR" switch.
- `GET /storefront/v1/table?t=<token>` →
  `{ table: { label: string; ordering: boolean; reason: null | 'off' | 'closed' | 'paused' } }`.
  404 `TABLE_NOT_FOUND` for a bad, replaced or removed table's token. `ordering: false` means
  the menu can be browsed but checkout will refuse (`off`: the store turned QR orders off or its
  plan lacks them; `closed` / `paused`: the store's status).
- The QR's URL is the store's origin with `?mesa=<token>`.
- `POST /checkout/v1/cart/delivery` accepts `{ mode: 'dine_in' }`: no fee and no minimum order
  in the cart's totals.
- `POST /checkout/v1/checkout` with `delivery: { mode: 'dine_in', table: <token> }`:
  - `customer.name` 2..80 is required; `customer.phone` is optional (not asked).
  - `payment.method`: `'tab'` (pay at the table, on the comanda), or `'pix'` / `'card_online'`
    when the store takes online payments (`store.online`), paid on the order page as today.
    Anything else is 422 `PAYMENT_METHOD_UNAVAILABLE`. No `changeForCents`, no `scheduledFor`.
  - 404 `TABLE_NOT_FOUND`; 423 `TABLE_ORDERS_OFF`; 423 `STORE_CLOSED` / `STORE_PAUSED` (no
    encomenda escape at a table); 429 `TABLE_ORDERS_PENDING` when five of this table's QR orders
    still wait for the staff.
  - The order comes back `placed` (staff accept it), with `delivery: { mode: 'dine_in',
table: 'Mesa 5', feeCents: 0, … }`; with `tab` its payment is
    `{ provider: 'pdv', method: 'tab', status: 'pending', online: false }`.
- Tracking (`GET /checkout/v1/orders/:id`, the status view) carries `delivery.table`. A dine-in
  order walks placed → confirmed → preparing → ready → delivered ("servido"); it never goes out
  for delivery.

### Admin

- `PdvTable` gains `qrUrl: string` (in `GET /pdv/state`, `GET /pdv/tables` and every reply that
  lists tables).
- `POST /pdv/tables/:id/qr` (manager) → `{ table: PdvTable }` with a new `qrUrl`; the old QR
  stops working at once.
- `GET /pdv/state` gains `qrOrders: boolean`; `PATCH /pdv/settings` takes `qrOrders?: boolean`
  (with or without `serviceBps`) and answers `{ serviceBps, qrOrders }`.
- `TabRound` gains `source: 'pdv' | 'table_qr'` and `paidOnline: boolean`. A round paid online
  is listed but left out of the comanda's `subtotalCents`, service, total and remaining.
- QR orders land on Pedidos as `placed` dine-in orders with the table, like a storefront order;
  accepting them sends them to the kitchen and the printers.
- A QR order still `placed` is listed on its comanda but not owed until the staff accept it;
  `POST /pdv/tabs/:id/close` answers 409 `TAB_HAS_PENDING` while one waits, and a payment that
  reaches zero then doesn't close the comanda by itself.

## Order changes

- `delivery.mode` is `'pickup' | 'delivery' | 'dine_in'`. A dine-in order has `delivery.table`
  (the table's label, or null at the counter) and `delivery.tabId`.
- These orders have `source = 'pdv'` in the database; the admin tells them apart by
  `payment.provider === 'pdv'`.
- `POST /orders/:id/payment` (mark paid/unpaid by hand) answers 409 `PAYMENT_PDV` for these: the
  caixa holds the payment.
- `payment.provider` is `'pdv'`. `payment.method` is a `PdvMethod`, `'mixed'` (several
  methods; `payment.pdv` lists them as `{ method, cents }`) or `'tab'` (paid with its comanda).

## Live

Admin SSE topic `pdv` (payload: the comanda or caixa id) on every write above. Order changes
still ride `order.placed` / `order.changed`.
