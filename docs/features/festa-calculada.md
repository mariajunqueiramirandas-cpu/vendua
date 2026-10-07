# Festa calculada: party orders with a sinal

> Status: Proposed, not planned · Started 2026-10-07 · Kind: differentiator (not a gap in
> [`competitor-parity.md`](../competitor-parity.md); none of our [competitor profiles](../competitors/README.md)
> mention it) · Builds on: encomendas (Phase 2), [ADR 0009](../adr/0009-mercado-pago-marketplace.md),
> [ADR 0026](../adr/0026-store-whatsapp-gateway.md), [ADR 0031](../adr/0031-vendedor.md),
> [ADR 0035](../adr/0035-pdv.md)

Party orders are the biggest tickets a doceria, salgaderia or confeitaria takes, and today they are
handled by hand in WhatsApp. The shopper asks "quanto fica pra 40 pessoas?". The owner works out
the quantities, quotes a price, asks for a 50% sinal by Pix, writes the date in a notebook and
collects the rest at pickup. This feature does the whole flow in Venduá:

1. A calculator on the storefront: number of guests plus the kind of party gives quantities by the
   store's own rules.
2. Core computes the quote.
3. The shopper pays a sinal by Pix to lock the date, and the date counts against that day's
   capacity.
4. The balance is paid before or at pickup, by Pix or at the caixa.
5. The store's WhatsApp sends the reminders.

Paths are under `packages/core/` unless they start with `apps/`, `packages/` or `docs/`.

## Summary

- **The calculator is a cart builder.** Its output is an ordinary cart of the store's own
  products. Checkout, stock, the kitchen, printing, order messages and reports all work unchanged.
- **The sinal is a payment plan on one order.** Each order gets two charges, the sinal and the
  balance, and their amounts always add up to the order total. Core computes both. The
  rule of one order per cart doesn't change.
- **Dates have capacity.** Today any bookable date takes unlimited encomendas. Each date gets a
  ceiling the checkout enforces under the lock it already takes.
- **Reminders before the date.** Nothing reminds a shopper about an encomenda today. Party orders
  get a reminder a few days before, one the day before, and a balance link.
- **Ship in four steps.** Capacity and reminders first, since they help every encomenda. Then the
  calculator paid in full, then the sinal, then the Vendedor quoting parties in chat.

## 1. The problem

- **Quoting takes the owner's time.** Every "quanto fica pra…" is a hand calculation, and the
  shopper often asks three stores and books one.
- **Hand math goes wrong.** Too few salgados for 40 guests is a complaint. Too many is a refund
  request or a loss.
- **No-shows cost a whole batch.** That is why the market asks for a sinal. Today Venduá's
  encomendas are paid in full or not at all (`preorder_payment_methods` defaults to `["pix"]`).
- **Saturdays overbook.** The calendar (`apps/admin/src/features/orders/Scheduled.tsx`, served by
  `GET /orders/scheduled`, `admin/routes-orders.ts:550`) counts orders per day but caps nothing.
- **The balance is tracked on paper.** Venduá has no idea of "already paid R$ 300 of R$ 600".

## 2. What it feels like

### Shoppers

On the store's "Festa" page (or a "Monte sua festa" button on the home page):

1. **Quantas pessoas?** Adults and children. Children count by a factor the store sets, for example
   half.
2. **Que festa?** One of the store's party profiles, such as "Aniversário infantil", "Coffee break"
   or "Casamento". Each profile sets how much of each group goes per guest.
3. **Escolha os sabores.** For each group (Salgados, Docinhos, Bolo), pick up to N of the store's
   products. Core splits the group's quantity across them and rounds up to the unit each product
   is sold in, such as a cento, meio cento or a cake that serves 25.
4. **Ajuste.** Each line shows why it is there ("15 salgados por pessoa · 600 no total · 6
   centos"), and the shopper can change it.
5. **Quando?** Only dates with capacity left are offered. Pickup or delivery uses the existing
   rules.
6. **Resumo.** Total, "Sinal hoje: R$ X (50%)" and "Restante: R$ Y até a retirada", with the store's
   cancellation policy in plain words. The shopper pays the sinal by Pix.

After booking, from the store's number:

- At booking: "Sua festa de sáb 14/11 está reservada · sinal pago · falta R$ Y".
- A few days before (D−3 by default): the balance with a Pix link, "ou pague na retirada".
- The day before (D−1): "amanhã às 15h".
- On the day: the existing ready message.

### Merchants

- **Cardápio → Festa.** Party profiles, and the groups with their per-guest quantities and
  products.
- **Loja → Encomendas.** Capacity per day, the sinal percentage, when the balance is due and the
  cancellation window. The API takes `preorder.paymentMethods` and `maxDays` today, but no admin
  screen sets them, so this screen covers those too.
- **Pedidos → Encomendas.** The calendar shows capacity used per day ("3 de 4 festas · 1.900 de
  2.000 salgados") and money still to collect ("a receber: R$ 1.840").
- **The order page.** "Sinal R$ 300 pago (Pix, 12/10) · Restante R$ 300" with two actions: "cobrar
  agora", which sends a Pix by WhatsApp, and "receber no caixa".
- **Production per day.** Quantities per group across that date's orders. The KDS "tudo junto" does
  this for open tickets today; this view covers a future date.

## 3. What we already have

| Piece                       | Where                                                                                                                                                                                            | What it gives us                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Encomenda dates             | `modules/preorder.ts` `bookableDates()` (:25-47): `products.preorder_lead_days`, `store_settings.preorder_max_days`, weekly hours, `special_days` (closed days and ranges skipped since 075cfaa) | The date picker and its validation (`validateSchedule`, :76-94)         |
| Pix-only encomendas         | `validateSchedule` throws 422 `PAYMENT_NOT_ALLOWED` (:95), called at `place-order.ts:144`                                                                                                        | Where the sinal rule hooks in                                           |
| One order per cart          | `placeOrderTx`: cart `for update`, `pg_advisory_xact_lock(tenant)` (`place-order.ts:61`), `orders_cart_unique`                                                                                   | A race-free place to count a date's capacity                            |
| Totals                      | `place-order.ts:214` (`subtotal + deliveryFee − discount + paymentAdjustment`), previewed by `cart.ts:336-351`                                                                                   | The quote is a cart quote; no new money math except the split           |
| Payments                    | `payments` rows (`unique(order_id, attempt)`), `orders.payment` jsonb, `syncOrderPayment` (`modules/payments/store-payments.ts:1203`), MP Pix TTL 30 min (`:35`)                                 | Attempts, webhooks, reconcile, refunds spread across payment rows       |
| Partial refunds             | `refundOrderPayments` with `amountCents`, `payment_refunds` reservations (`admin/routes-orders.ts:138`)                                                                                          | Refunding a sinal or a balance already works per payment row            |
| Comanda payments            | `pdv_payments` (0097) take partial payments until a tab is settled                                                                                                                               | The model the balance at the caixa copies                               |
| Order messages              | `store-whatsapp/messages.ts`: `placed` already says "sua encomenda #N para dd/mm"; unique per `(order_id, event)`                                                                                | Reminders are new events on the same queue                              |
| The Vendedor and encomendas | `set_fulfillment` takes `scheduled_for` (`agent-host/agents/vendedor/tools-cart.ts:325-331`); `tools-order.ts` runs the real `placeOrderTx`                                                      | A party tool slots in next to it                                        |
| Combos and modifiers        | `combo_slots`, `modifier_groups`                                                                                                                                                                 | "Kit festa" products work today; the calculator adds the per-guest math |

**Gaps this design fills** (verified 2026-10-07):

- No capacity per date.
- No partial payment on an order. A provider amount that differs from `orders.total_cents` is marked
  `amount_mismatch` (`store-payments.ts:1414`). A second settled payment is `paid_twice` (`:1345`).
- The caixa can't take a balance. `POST /pdv/orders/:id/payments` (`admin/routes-pdv.ts:500-575`)
  refuses any order paid online, settled or not (409 `PAYMENT_ONLINE`). It refuses an order that
  is already paid (409 `ALREADY_PAID`), and it requires the payments to equal the total exactly
  (422 `PAYMENT_MISMATCH`).
- No reminder before an encomenda date.
- No per-guest rule or selling unit on a product.
- Line quantity is capped at 99 (`cart-ops.ts:58-59`, `cart.ts:895`; DB checks `cart_items_qty_range` and `order_items.qty`). Party lines must be sold
  in packs (cento, meio cento) to stay under it.
- No cancellation window. Shoppers can't cancel; only the store can.

## 4. Design

### 4.1 Party profiles and the calculator

New tables, each tenant-scoped with RLS:

- `party_profiles(id, tenant_id, name, child_factor_bps, min_guests, max_guests, active, sort)`.
  `child_factor_bps` is how much a child counts, for example 5000 for half.
- `party_groups(id, tenant_id, profile_id, name, per_guest_milli, max_choices, required, sort)`.
  `per_guest_milli` is thousandths of a unit per guest, so "15 salgados" is 15000 and "uma fatia"
  is 1000. It stays an integer.
- `party_group_products(group_id, product_id, units_per_sale)`. `units_per_sale` is how many
  pieces one sale of that product holds: 100 for a cento, 25 for a cake that serves 25.

`POST /storefront/v1/party/quote` takes
`{ profileId, adults, children, choices: { groupId: productId[] } }` and returns lines
`{ productId, qty, units, reason }` and a cart-style total. It is
pure computation, so it needs no Idempotency-Key. It is bounded: guests 1..1000 (the store can
lower it), at most `max_choices` per group, at most 40 lines (the `cart-share.ts:31` cap).

The math, all in Core with integers:

1. `guests_milli = adults × 1000 + children × child_factor_bps / 10`.
2. `units = ceil(guests_milli × per_guest_milli / 1_000_000)` per group.
3. Units are split evenly across the chosen products, with the remainder going to the first ones.
4. `qty = ceil(units / units_per_sale)` per product.

`POST /storefront/v1/cart/party` builds the cart from a quote. It is a mutation, so it takes an
Idempotency-Key through `platform/http.ts` and goes through the kernel api client. From there it
is an ordinary cart, and the shopper can still edit lines.

The cart records `party: { profileId, adults, children }`, and each party line records the group it
came from (`groupId`), so a product mapped into two groups is never counted twice. At placement,
`placeOrderTx` computes a frozen snapshot from the final lines,
`orders.party = { profileId, adults, children, groups: [{ groupId, units }] }`, where `units` is
`qty × units_per_sale` at that moment. Capacity, the sinal and reminders read that snapshot, never
the live profile. Editing a profile or `party_group_products` after booking can't reopen a full day
or overbook it.

### 4.2 Capacity per date

- `store_settings.encomenda_capacity` jsonb has per-weekday defaults, and a special day can
  override them. A day can cap:
  - the number of party orders;
  - units per party group, for example 2,000 salgados a day.

  Either can be empty, meaning no cap.

- **Enforcement.** `placeOrderTx` already holds `pg_advisory_xact_lock(tenant)`. Inside it, sum
  the `orders.party` snapshots of the date's non-cancelled party orders, and refuse with 409
  `DATE_FULL` when the new order would pass a cap. No second lock is needed.
- **The date list.** `bookableDates()` gains an optional "fits" check, so the picker greys out full
  days. Checkout is the authority; the picker is only a hint.
- **Holding a date.** An order whose sinal is unpaid holds its date until the Pix expires (30 min)
  plus a short grace. The admin sweeper (`admin/workers.ts:548`, 60 s) cancels unpaid party orders
  after that, so a no-pay doesn't block a Saturday. Cancelled orders don't count.

### 4.3 The sinal: two charges on one order

New table `order_charges(id, tenant_id, order_id, kind, amount_cents, due_on, status, created_at)`:

- `kind` is `'deposit' | 'balance'`.
- `status` is `'open' | 'paid' | 'waived' | 'refunded'`.
- Unique on `(order_id, kind)`.

An order without a plan has no rows and behaves exactly as today.

- **Split.** At checkout, `deposit = round_half_up(total × deposit_bps / 10000)` and
  `balance = total − deposit`. The sum always equals the total. A test asserts it, and a deferred
  constraint trigger checks it on every write.
- **When it applies.** Store settings decide: `deposit_bps` (0 = off), and whether it applies to all
  encomendas, to party orders only, or to orders above `deposit_min_cents`.
- **Payments point at a charge.** `payments` gains `charge_id`.
  - `applyProviderPayment` compares the provider amount with the charge amount, not with
    `orders.total_cents`.
  - `flagIfPaidTwice` works per charge.
  - `syncOrderPayment` sets `paid` only when every charge is paid.
  - The MP idempotency key becomes `<orderId>:<chargeKind>:<attempt>`. Offline Pix gets one BR Code
    per charge with txids `PEDIDO<n>S` and `PEDIDO<n>R`.
- **Order payment state.** `orders.payment.status` stays `pending` until the whole is paid. A store
  whose code switches on that union (Contract 2) sees nothing new. The order view gains an additive
  `payment.plan: { depositCents, depositPaidAt, balanceCents, balanceDueOn, balancePaidAt }`, which
  goes in the Kernel `Order` type with `API.md` and a minor bump.
- **The balance at the caixa.** `POST /pdv/orders/:id/payments` accepts an order with a plan:
  - The payments must equal the open balance, not the total.
  - An online sinal no longer triggers `PAYMENT_ONLINE`, because the counter pays the balance
    charge, not the online one.
  - The rows land in `pdv_payments` with the charge id, inside the open caixa session.
- **The balance by Pix.** "Cobrar agora" in the admin, and the D−3 reminder, create the balance
  charge's Pix lazily, as `POST /orders/:id/pay` does today.
- **Payment adjustments.** `payment-adjustments.ts` prices one method per order. A Pix sinal with a
  card balance would need per-charge adjustments. v1 restricts plans to methods without an
  adjustment. Open decision 3.

### 4.4 Cancelling and refunding

- **The policy.** Store settings set `deposit_refundable_until_days`, for example 7. Before that the
  sinal is refunded in full. After it, the store keeps the sinal by default, and a manager can
  still refund through the existing `POST /orders/:id/refund`. The checkout summary shows the
  policy in words built by Core from the setting.
- **Cancelling** goes through the existing transition, which needs a reason and a manager when money
  was captured. The admin suggests the refund the policy implies.
- **Captured money is read from the charges, not the aggregate status.** Today the cancel path
  (`admin/routes-orders.ts:660-680`) asks for a manager and refunds only when `payment.status` is in
  `PAID_ONLINE`. Otherwise it cancels open attempts. With a plan, a paid sinal leaves the status
  `pending`, so as written the path would skip the manager check and strand the sinal. For an
  order with charges:
  - "money captured" means any charge is `paid`, or any `pdv_payments` row is live;
  - cancelling cancels the open charges' attempts and refunds the paid charges as the policy says;
  - money the policy keeps stays recorded on its charge, so reports and a later manual refund see
    it.

  `autoRefundIfClosed` (`routes-orders.ts:367`) gets the same per-charge reading. F2's tests cover
  cancel-after-sinal, inside and outside the refund window.

- **Shoppers can't cancel themselves** in v1, as today. They ask the store, or the Vendedor asks for
  them.
- **Legal review first.** The sinal's treatment needs a lawyer's read before launch: Código Civil
  arts. 417–420 on arras, and whether CDC art. 49 (the 7-day right of withdrawal for remote
  purchases) applies to custom food. We should not ship refund copy until that's done.

### 4.5 Reminders

- New order-message events `reminder_balance` (D−N, only while a balance is open) and
  `reminder_eve` (D−1). They use the same `store_wa_messages` queue, the `(order_id, event)` unique
  index and opt-out checks. Each event needs a new text in `messages.ts`, and the kind stays
  `order`.
- They are queued by the admin sweeper at a store-local hour (`store_settings.hours.timezone`), 9:00
  by default, and only while the store's WhatsApp is linked.
- They are order notices, so they fit ADR 0026's allowed traffic. They are not campaigns.

### 4.6 The Vendedor

A `party_quote` tool calls the same quote route and builds the same cart. The Vendedor's
cart-hash confirmation (`vendedor/gate.ts`) covers the party lines and the sinal amount. So "faz
pra 40 pessoas, festa infantil" gets a Core-computed answer in chat, and the summary says what's
due today and what's due later. It comes last because it needs F1 and F2 underneath it.

## 5. Merchant controls

| Setting                    | Default            | Who     |
| -------------------------- | ------------------ | ------- |
| Party profiles and groups  | none (off)         | manager |
| Children count as          | 50%                | manager |
| Capacity per weekday / day | no cap             | manager |
| Sinal                      | off                | owner   |
| Sinal applies to           | party orders       | owner   |
| Balance due                | on pickup          | owner   |
| Reminder days before       | 3                  | manager |
| Sinal refundable until     | after legal review | owner   |

## 6. Measuring it

- Quotes, carts built from quotes, sinais paid. This funnel says if the calculator sells.
- Party revenue and average ticket against other encomendas.
- No-shows: orders past their date with an open balance.
- Balances collected online against at the caixa.
- Dates that hit capacity. That is demand the store turned away and could plan for.

## 7. Phases

| Phase | Ships                                                                                                  | Needs                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| F0    | Capacity per date; D−1 reminder for every encomenda; admin screen for encomenda settings               | Migration, sweeper pass, `messages.ts` text                                       |
| F1    | Profiles, groups, calculator, party cart; paid in full                                                 | Kernel minor (`sdk:party` section), template migration for stores that turn it on |
| F2    | `order_charges`, the sinal, balance by Pix and at the caixa, reminders with the balance, refund policy | Legal review; invariant review of the payment changes                             |
| F3    | Vendedor `party_quote`; production per date                                                            | F1, F2                                                                            |

F2 touches money and payments: after editing, `invariant-reviewer` runs on the diff (`CLAUDE.md`).

## 8. Open decisions

1. **Which plan has it.** That's the owner's call. Don't state it in copy.
2. **Sinal scope.** Party orders only, or any encomenda above an amount?
3. **Mixed methods.** Allow a card balance on a Pix sinal (per-charge adjustments), or restrict v1 to
   methods without adjustments?
4. **The cancellation policy text** after the legal review.
5. **Quantity cap.** Keep 99 per line and require pack products for party groups (recommended), or
   raise the cap for party carts.
6. **Party order changes.** Adding ten guests after booking: rebook and move the sinal, or edit in
   place (no order edit exists today)?

## 9. Risks

- **Payment model change.** Charges change the code that decides "paid", in a module where every
  past bug was money. Mitigations: orders without a plan keep the exact current path, the sum
  check, the review, and tests per charge state.
- **Rules that miss.** If the store's per-guest numbers are off, the calculator is confidently
  wrong. Each line shows its reason, and the shopper can edit it.
- **Capacity the store doesn't maintain.** A ceiling set once and forgotten turns away real orders.
  The admin shows days at capacity on Início.

## Change log

- 2026-10-07: first proposal.
