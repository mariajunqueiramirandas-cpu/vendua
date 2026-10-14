# Plano semanal: a basket the shopper gets every week

> Status: shipped (2026-10-13, migration 0127, Kernel 1.26) · Kind: differentiator (no competitor
> profile in [`competitors/`](../competitors/README.md) offers shopper subscriptions to a small
> store) · Builds on: encomendas (Phase 2), [ADR 0026](../adr/0026-store-whatsapp-gateway.md)

A hortifruti's weekly basket, the bakery's Saturday bread, Monday's marmitas: a regular customer
orders the same thing every week, by hand, in the store's WhatsApp. Plano semanal makes that a
plan. The store sets the basket once. The shopper says yes once. From then on Core places the order
every week, and the store's own WhatsApp tells the shopper.

## How it works

1. **The store** (admin, Cardápio › Planos) creates a plan: a name, up to 20 lines of its own
   products (a product that asks for a choice can't be a line), an optional weekday and how many
   days ahead the week's order is placed (`lead_days`, 1–6, default 2). Plans are offered only
   while the store's WhatsApp is connected, because that is how the shopper hears of each week,
   and while it takes Pix (its own key, or Mercado Pago), because that is how each week is paid.
   Without one, the admin says which is missing.
2. **The shopper** opens `/planos` (or the `sdk:plans-cta` block), picks a plan and the bag becomes
   its basket. Checkout treats it as an encomenda: a date is required (only the plan's weekday,
   when it has one) and the only payment method is Pix (`PAYMENT_NOT_ALLOWED` for any other). A ticked box on the
   payment step ("Receber este pedido toda sexta…") sends `subscribe: true`.
3. **The first order** is an ordinary order. In the same transaction Core writes the subscription
   (`plan_subscriptions`): the name, phone, delivery and payment the shopper chose, the weekday of
   the first date and `next_on` = that date + 7. A number already proven by a customer token starts
   `active`. Any other number starts `pending`, and the store's WhatsApp asks it to reply
   **ASSINAR**, so nobody can subscribe someone else's phone. A pending plan that nobody confirms is
   let go after 7 days.
4. **Each week** the admin sweeper's `planCyclePass` (`modules/shopper-plan-cycles.ts`), while the
   store is open, takes each active subscription whose `next_on − lead_days` has come. It builds a
   fresh cart of the plan's lines and checks it out through `placeOrderTx` (source `plan`, the
   week's date as `scheduledFor`). It inserts the `plan_cycles` row for that date in the same
   transaction: at most one order a week. The shopper gets the order, its date, Core's total and how
   to skip in one message, and the Pix copia-e-cola code alone in the next, so it copies in one
   tap (with Mercado Pago, the first message links the order page, which makes the Pix). The usual
   "pedido recebido" message is not sent.
5. **A week that can't be placed** (a closed or full date, a sold-out basket, an address out of
   the zone, a payment method turned off) is a `failed` row. The shopper hears why, the next week
   goes on, and the admin shows the reason on the subscriber.

## The shopper's words (store WhatsApp)

| Reply            | What happens                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASSINAR`        | A pending plan becomes active.                                                                                                                                                           |
| `PULAR`          | This week's order is cancelled if the store hasn't taken it and nothing was paid. If nothing has been placed yet, the next date is skipped. A taken order stays, and the answer says so. |
| `CANCELAR PLANO` | The plan ends, and an untaken, unpaid order of the week is cancelled.                                                                                                                    |
| `SAIR`           | As before, no more automatic messages. The next week finds the number opted out and pauses the plan, since an order nobody hears about isn't placed.                                     |

Each keyword answers only a number the store texted lately (the same 90-day window as SAIR), and
only when that number has a plan the word applies to. Anything else stays the store's conversation.

## Money and payment

Money stays Core's: each week is priced when it is placed, at that day's prices plus delivery. The
plans page shows Core's sum at today's prices, labelled as such.

Each week is paid by Pix, by hand. Nothing is kept and nothing is charged automatically (Pix
Automático is an open question below).

- **The week's code.** With the store's own key, the code (EMV copia e cola, the week's total) is
  its own WhatsApp message right after the order, and the order page shows it too. With Mercado
  Pago connected, the order page makes the Pix and confirms it by itself, from the link in the
  message too (a Pix order's link can pay it).
- **Not paid by the day before.** `planPaymentPass` (admin sweeper, from 09:00 store time, once
  the order is 6 h old) sends one reminder for a week due tomorrow or today and still unpaid: the
  total, the date, the code again in its own message. The store's managers get one push ("Pix do
  plano não chegou") that opens the scheduled orders. The usual eve reminder skips an unpaid plan
  week, so the shopper hears about it once.
- **Paid.** A manager marks the order paid when the Pix lands (or Mercado Pago does), and the
  shopper always gets "Pagamento confirmado" for a plan order, even when the store turned that
  message off for other orders.
- **Never paid.** Nothing is cancelled automatically: the store decides, in the order, whether to
  make it or cancel it, and the shopper can still answer PULAR. The admin shows each subscriber's
  last order as "Pix recebido" or "Pix pendente".

## The store's side

Cardápio › Planos says how each week is paid, and lists the plans, their subscriber counts and the plans link to share. It lists
each subscriber: state, next date, weeks placed, the last order and the last failure in plain
words. A manager can pause, resume (the next date lands on the subscriber's weekday, past the lead)
or end a subscription. A plan with subscribers can be paused but not deleted. Pausing it skips its
weeks, and the subscribers hear why. LGPD: the customer export lists their plans, and "esquecer
cliente" deletes them.

## Open questions

- **Pix Automático** (recurring Pix authorised once) would charge each week without the shopper
  paying by hand. Mercado Pago's support for it as a receiver is unconfirmed. Today's flow works
  without it.
- **A discount for subscribers** is a pricing decision for each store. Today a store can create a
  coupon by hand. A per-plan discount needs the owner's call on how it shows.
