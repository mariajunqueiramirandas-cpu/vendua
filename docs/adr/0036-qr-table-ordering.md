# ADR 0036: Ordering from the table's QR code

- Status: Accepted (implemented 2026-10-07, Core migration 0099, Kernel 1.22.0)
- Date: 2026-10-07

## Context

ADR 0035 gave stores mesas and comandas that the staff run. The other half of P-015 is the
shopper's own phone: a QR code on the table opens the store's menu, and the order goes to that
table. Seven of the eight primary competitors have it. Every piece it needs already exists: the
storefront and its kernel-owned checkout, the `dine_in` order mode, comandas that sum their
rounds, and the kitchen and printers that show the table.

The owner's calls (2026-10-07):

- Staff accept every QR order before it reaches the kitchen. Someone with a photo of the QR must
  not be able to send food to a table.
- The customer chooses: pay now online, or leave it on the table's comanda and pay the staff.
- The customer gives a first name only. No phone, so no WhatsApp messages and no loyalty stamp.
- Plans: the same as the PDV (`pdv` feature: Bandeira, Pangolim, pilots).

## Decision

**The QR carries a signed table token, not a table id.** It is `vqr.<tableId>.<rev>.<sig>`, an
HMAC-SHA256 over `vqr|tenant|tableId|rev` keyed by the session secret with a `:table-qr` suffix.
The tenant binding stops a token working on another store; `pdv_tables.qr_rev` (migration 0099)
revokes a leaked or stolen QR when a manager generates a new one. The printed URL is the store's
own origin with `?mesa=<token>`, so it never expires.

**The storefront knows it is at a table.** The kernel reads `?mesa=` once at boot, like `?cupom=`,
asks Core what the token is (`GET /storefront/v1/table`), keeps it for the browser session and
strips it from the address bar. The store profile says whether the store takes table orders at
all (`dineIn.enabled`: the `pdv` plan and the store's switch). While a table is set, checkout
shows "Na mesa 5" instead of the delivery step, asks only for a name, and offers "pagar na mesa"
next to the store's online methods. Store code never sees any of it: checkout stays kernel-owned
(ADR 0004), and Kernel 1.22.0 only adds to Contract 2.

**A QR order is a storefront order on the table's comanda.** `POST /checkout/v1/checkout` takes
`delivery: { mode: 'dine_in', table: <token> }`. Core verifies the token before the transaction,
then locks the table's open comanda (or opens one when it places the order) ahead of checkout's
own locks — the same order the PDV takes its locks in. The order is born `placed`, so it rings on
Pedidos like any storefront order and waits for "aceitar"; `source = 'table_qr'`, `tab_id` is the
comanda, `delivery.table` the table's label. The store's hours and pause apply; the minimum order
and the delivery and pickup switches don't. At most five unaccepted QR orders wait per table.

**Paid on the comanda, or paid online.** "Pagar na mesa" is payment method `tab`: the order joins
the comanda's bill and is paid at the caixa (ADR 0035). An order paid online (Pix or card through
Mercado Pago) is the store's normal online payment; the comanda lists it as "pago online" and
leaves it out of what remains to pay, and closing the comanda never rewrites its payment.

**The admin prints the QR codes.** Each table in Mesas has its QR and link, a printable sheet
holds all of them, and a manager can replace one table's QR (the old one stops working). The PDV
settings get a "pedidos pelo QR" switch next to the service charge.

## Consequences

- P-015 is closed for orders placed at the table. The bill is still paid to the staff or online
  per order; paying the whole comanda from the phone is a later step.
- QR orders carry no phone: no WhatsApp step messages, no loyalty, no customer record.
- A table token in a screenshot works until a manager replaces that table's QR; the staff
  acceptance is what stops a prank reaching the kitchen.

## Alternatives considered

- **A plain table id in the URL.** Anyone could enumerate tables; revoking one table's link
  would mean renumbering it.
- **Orders straight to the kitchen while a comanda is open.** Faster for the customer, but the
  owner chose staff acceptance for every QR order.
