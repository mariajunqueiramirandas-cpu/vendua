# Freio automático: delivery promises from the real kitchen

> Status: Proposed, not planned · Started 2026-10-07 · Kind: differentiator (not a gap in
> [`competitor-parity.md`](../competitor-parity.md)) · Builds on:
> [ADR 0024](../adr/0024-distance-based-delivery-pricing.md),
> [ADR 0026](../adr/0026-store-whatsapp-gateway.md), [ADR 0029](../adr/0029-kitchen-display.md) · Related:
> P-022 (time slots)

Every platform, Venduá included, promises a delivery time from a number the owner typed once:
"entrega em 40–60 min". On a busy Friday night the kitchen is twenty orders behind, but the promise
doesn't change. Orders arrive late, shoppers ask "cadê meu pedido?", some cancel, and the store
gets the blame for the platform's number. Freio automático has three parts:

1. **Promessa viva.** The promise is computed from what the kitchen actually has in its queue,
   before checkout and when the order is accepted.
2. **O freio.** When the kitchen is overloaded, the store slows its own intake in steps, and never
   closes by itself.
3. **Atraso avisado.** An order that is going to miss its promise gets an honest message from the
   store's number before the shopper asks, with an apology coupon paid from a monthly budget the
   owner sets.

We can do this because we own the KDS, the live storefront, the road-distance quote and the store's
WhatsApp in one system. Platforms with a KDS don't control the storefront's promise, and storefront
platforms don't see the kitchen.

Paths are under `packages/core/` unless they start with `apps/`, `packages/` or `docs/`.

## Summary

- **Fix the promise math first.** Under distance pricing, accepting an order adds the prep time
  twice. Placement and acceptance also disagree on whether a zone's ETA includes prep (§3.1).
- **Queue model.** A new order's ready time is the work ahead of it divided by how many orders the
  kitchen makes at once, plus its own prep. It is computed in Core and shown everywhere the
  promise shows today.
- **Brake levels.** Four steps, Normal, Movimentado, Cheio and Só retirada, with hysteresis. The
  owner picks Desligado, Sugerir (the default) or Automático. A full pause stays the owner's
  button.
- **Late orders.** The admin sweeper predicts a missed promise and sends the existing `delayed`
  message with a new time, plus an apology coupon when the budget allows. At most one per order.
- **No new transport.** These are order notices, which ADR 0026 allows. The Kernel changes are
  additive fields.

## 1. The problem

- **The promise is static.** At placement, `delivery.promisedFrom/To` is now plus the zone's
  `eta_min_minutes`/`eta_max_minutes`, or now plus `store_settings.prep_time_minutes`
  (`modules/place-order.ts:246-289`). The storefront shows the same static range
  (`packages/kernel/src/rules/delivery.ts:36,59-60`, `packages/kernel/src/sdk/blocks.tsx:184-198`).
- **Busy signals don't change anything.** The "Muitos pedidos agora" flag (`demand_level`,
  `/store/demand`, `admin/routes-store.ts:662-689`) only shows a notice. That notice quotes the
  static prep time (`modules/notices.ts:121-135`).
- **Delays are manual.** The "Atrasou" button (`POST /orders/:id/delay`, `routes-orders.ts:803-864`)
  moves `promisedTo` and messages the shopper, but someone has to press it in the middle of the
  rush.
- **Pause is all or nothing.** `status_override` blocks every mode with a 423
  (`checkout.ts:118-122`). Delivery and pickup can be switched off separately (`pickup_enabled`,
  `delivery_enabled`), but those are settings: nothing turns them back on.
- **The kitchen's load is only displayed.** `statsTx` (`admin/routes-kitchen.ts:229-284`) returns
  `avgMakeSeconds`, `onTimeRate` and `readyLastHour`, and lateness is computed in the browser
  (`apps/admin/src/features/kitchen/model.ts:26-38`). No server-side code knows the queue.

## 2. What it feels like

### Shoppers

- **The storefront tells the truth.** On a quiet night: "Entrega em 35–45 min · Retirada em ~20
  min". On a busy one: "Movimento alto · entrega em ~70 min · retirada em ~40 min". The cart and
  checkout show the same numbers, computed for their address.
- **When delivery is braked:** "Entregas voltam às ~21h10 · retirada em ~35 min". The delivery
  option is visibly unavailable instead of failing at checkout.
- **When an order runs late**, from the store's number, before they ask: "Seu pedido #1284 vai
  atrasar uns 10 minutos, desculpa! Nova previsão: 21h25. Pra compensar, seu próximo pedido tem
  entrega grátis: cupom DESCULPA-7K2."

### Merchants

- **Início and the KDS header** show "8 pedidos na fila · ~35 min pra um novo pedido".
- **Sugerir mode:** a push and a card, "Cozinha cheia: pausar delivery por 20 min? Retirada
  continua." One tap applies it, and "voltar ao normal" undoes it.
- **Automático mode:** the same change is applied, then reported: "Freio: só retirada até 21h10".
- **Late orders in Sugerir mode:** "#1284 vai atrasar ~10 min · avisar o cliente (com cupom)?" In
  Automático the message has already gone, and the order shows it.
- **Loja → Freio automático:** mode, how many orders the kitchen makes at once, thresholds, the
  apology and its monthly budget.

## 3. What we already have

| Piece                | Where                                                                                                                                      | Use                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Promise on the order | `orders.delivery` jsonb: `promisedFrom`, `promisedTo`, `etaMin`, `etaMax`, `delayMinutes` (`modules/orders.ts:56-75`)                      | Where the live promise is written                 |
| Accept with prep     | `POST /orders/:id/transition` with `prepMinutes` re-promises (`admin/routes-orders.ts:690-702`)                                            | The second point where the promise is set         |
| Road duration        | `routing.ts` `RouteLeg {meters, seconds}`; kept on `carts.delivery_route` (0073), not on the order                                         | Drive time for the delivery promise               |
| Kitchen tickets      | `GET /admin/v1/kitchen` (`routes-kitchen.ts:358`): `acceptedAt`, `startedAt`, `readyAt`, `prepMinutes` per ticket; `order_events` per step | The queue and its history                         |
| Live storefront      | `emitAdminTx(…, 'store')` → `GET /storefront/v1/events` topics `store`/`surfaces` (`modules/storefront-live.ts:21-38`)                     | Brake changes reach every open storefront at once |
| Demand flag + notice | `demand_level`, `demand_until` (0093), the `high_demand` notice                                                                            | Becomes the visible Movimentado level             |
| Delay message        | Event `delayed:<epoch>` in `store-whatsapp/messages.ts:27,298-304`, opt-outs, 6 h expiry                                                   | The late-order message, unchanged as a transport  |
| Personal coupons     | `mintCouponTx` (`modules/coupons.ts:188`): `phone`, `maxRedemptions: 1`, `perPhoneLimit: 1`, `validDays`                                   | The apology coupon                                |
| A budget pattern     | The Vendedor's `incentives.monthlyBudgetCents`, `budgetLeft` (`vendedor/incentives.ts:57-69`), São Paulo month, per-store advisory lock    | Same shape for the apology budget                 |
| Due-time work        | `startAdminSweeper` (`admin/workers.ts:610`), 60 s over active tenants, polling due columns (`resumes_at`, `demand_until`, …)              | Where brake expiry and late detection run         |
| Merchant push        | `admin/webpush.ts`, `startPushNotifier` (`workers.ts:49`), dedupe in `push_deliveries`                                                     | Sugerir-mode prompts                              |

### 3.1 Promise bugs to fix first

These need fixing whatever we decide about the rest. Both verified 2026-10-07:

- **Prep counted twice under distance pricing.** `priceByDistance` sets
  `eta_min_minutes = prepMinutes + drive` (`modules/geo.ts:177-209`). On accept, the transition
  computes `from = prep + dl.etaMin` (`admin/routes-orders.ts:695`), which adds prep again. A store
  with a 30-minute prep and a 12-minute drive promises 42 minutes at checkout and 72 after the
  owner accepts.
- **Zone ETA means two things.** At placement, a zone's ETA is the whole promise (now + `eta_min`,
  no prep). On accept it becomes travel time (`prep + etaMin`).

**The fix:** store `driveMinutes` (from the route) on `orders.delivery` at placement. The accept
path uses `prep + driveMinutes` for distance orders. For zone orders, decide what a zone's ETA
means (open decision 1).

## 4. Design

### 4.1 The queue model (Promessa viva)

Inputs, read in one query per store:

- **Open tickets.** Orders in `placed`, `confirmed` or `preparing`, not scheduled for another day.
- **Each ticket's prep `p_i`.** The `prepMinutes` given on accept, otherwise the store default.
- **Elapsed time.** How long since each ticket's `startedAt`.
- **Capacity `c`.** How many orders the kitchen makes at once. A new setting, 1–20, default 3.
  Phase F4 suggests it from history.

The model:

1. **Lanes, not an average.** The kitchen is `c` lanes. Each ticket **ahead** of the order being
   promised is placed, oldest first, on the lane that frees soonest. A started ticket holds its
   lane for its remaining `max(0, p_i − elapsed_i)`, and a waiting one takes the next free lane
   for its full `p_i`. For a quote or a new order, "ahead" is every open ticket. For an order
   already in the queue (on accept, or when the sweeper re-predicts it), it is the tickets placed
   before it, never the order itself, otherwise its own prep counts twice.
2. `start` is the earliest moment any lane is free (now, if one is idle), and
   `ready_new = start + p_new`. With `c = 3` and one 30-minute ticket ahead, a new order starts now. With four equal
   tickets it waits for the first lane, 30 minutes, not 40. Dividing total work by `c` gets both
   wrong. `backlogMinutes` in the API is `start − now`.
3. **Delivery promise:** `ready_new + driveMinutes + dispatch_buffer`. The buffer is a store
   setting, 5 minutes by default.
4. **The window:** `[t, t + max(10, ceil(drive/2))]`, the spread `priceByDistance` already uses.

`fulfillmentNowTx(tx, tenantId)` returns
`{ queue, backlogMinutes, pickupMinutes, level, deliveryPausedUntil }`, and these use it:

- `GET /storefront/v1/store`, as additive `fulfillment` fields. The Kernel's delivery rule prefers
  them over the static range.
- The cart quote (`cart.ts:848-849`): `etaMin`/`etaMax` for the cart's address are computed with
  the backlog.
- `placeOrderTx`: the promise is written with the backlog included.
- Accept with prep: the merchant's prep replaces `p_new`, and the backlog is the work ahead of this
  order, excluding the order itself.
- The `high_demand` notice: real numbers instead of the static prep.
- The Vendedor's delivery quote (sales-agent B2), which reads the cart quote and so gets it for
  free.

**Stale tickets.** The model only works if the kitchen marks orders ready. A ticket older than
twice its promise, or left untouched for 90 minutes, drops out of the backlog and appears on the
KDS as "parado?". Automático mode stays locked until the store has marked at least 80% of its
orders ready through the board or the KDS over the last 7 days. Sugerir mode works from day one.

### 4.2 The brake (O freio)

The level comes from `extra = ready_new − (now + prep)`, the minutes beyond a normal promise. The
default thresholds can be edited:

| Level       | Enters when                                                             | What changes                                                                                                                   |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Normal      | —                                                                       | Nothing                                                                                                                        |
| Movimentado | `extra ≥ 10`                                                            | Promises lengthen (they already do, by the model); the `high_demand` notice shows the live time                                |
| Cheio       | `extra ≥ 30` or delivery promise > the store's ceiling (default 90 min) | Delivery shows "volta às ~HH:MM" and is refused at checkout with 409 `DELIVERY_PAUSED`; pickup stays open with its honest time |
| Só retirada | Cheio for 20 min without recovering                                     | Delivery paused until the backlog clears below Movimentado; the owner is told every time                                       |

- **A new column**, `store_settings.delivery_paused_until`. It is temporary and separate from
  `delivery_enabled`, so the setting the owner chose is never rewritten. Checkout enforces it next
  to `delivery_enabled` (`checkout.ts:133,186`). The sweeper clears it when it expires or when the
  level drops.
- **Hysteresis.** A level holds for at least 10 minutes and steps down only when `extra` falls 5
  minutes below its entry threshold. There are at most 4 level changes per hour. Past that, the
  level holds and the owner is asked.
- **Modes.**
  - Desligado: no brake at all.
  - Sugerir (default): the sweeper writes a proposal, sends a push, and shows a card on Início and
    the KDS. One tap applies it, through the same route and audit row as a manual change. The
    proposal expires when the level drops.
  - Automático: the sweeper applies the change itself with actor `freio`, then pushes what it did
    with an "desfazer" action. Undoing it holds the level for 30 minutes.
- **Never closes.** The ladder ends at pickup only. A full pause (`/store/pause`) stays a human
  decision. A store with pickup off has a ladder that ends at Cheio's longer promise.
- **Every change:** an `audit_log` row, `emitAdminTx(…, 'store')` so open storefronts refetch, an
  admin live event and a push to managers.
- **Later, F4:** "agende para HH:MM". Same-day time-of-day scheduling doesn't exist
  (`orders.scheduled_for` is a date). It shares the work with P-022 time slots, and when it lands,
  Cheio offers a later delivery time instead of only pickup.

### 4.3 Late orders (Atraso avisado)

- **Detection.** On every sweep, each open, non-scheduled order whose `promisedTo` is less than
  15 minutes away (or past) is re-predicted: its ready time from its lane position and remaining
  prep, plus drive and buffer for delivery. Being near the deadline only starts the evaluation.
  The order counts as late only when the predicted ready time (pickup) or delivery time passes
  `promisedTo` by 5 minutes or more. An order still not ready at `promisedTo` is predicted no
  earlier than now plus its remaining prep, so it gets there on its own. A pickup promised for
  21:00 and predicted ready at 20:58 sends nothing.
- **Action, once per order.** A new table `order_late_notices` makes it idempotent: `order_id`
  (primary key), `tenant_id`, `predicted_minutes`, `coupon_id`, `mode`, `created_at`.
  - Sugerir: an admin card and a push to the attendants on shift.
  - Automático: the same code path as `POST /orders/:id/delay`. It moves `promisedTo`, bumps
    `delayMinutes` and `rev`, and queues `delayed:<epoch>`.
- **The apology coupon.** It is minted with `mintCouponTx`: personal to the order's phone, single
  use, valid 30 days. Its form is the owner's choice: free delivery on the next order, or a fixed
  amount. New CHECK value `coupons.source = 'apology'`.
  - **Budget.** A monthly ceiling, `apology.monthlyBudgetCents`, counted at mint time by face value
    (free delivery counts as the order's own delivery fee) in the São Paulo calendar month. It takes
    a per-store advisory lock, as `grantIncentiveTx` does.
  - **Limits.** No coupon once the budget is spent (the message still goes), none for a phone that
    got one in the last 14 days, and none when the order is cancelled.
- **The message.** The `delayed` text gains an optional coupon line. It stays an order event, so
  ADR 0026's opt-out, pacing and 6-hour expiry apply.

### 4.4 Kernel and storefront

- **Store profile.** `StoreProfile` (`packages/kernel/src/api.ts:26`, served by `GET /storefront/v1/store`) gains an optional
  `fulfillment?: { pickupMinutes, deliveryExtraMinutes, level, deliveryPausedUntil }`. These are
  type-only fields: `API.md`, a minor bump and a `CHANGELOG.md` line.
- **The delivery rule** (`rules/delivery.ts`) uses them when present and falls back to today's
  static range.
- **The default block** (`ui-defaults`) renders "volta às" and the disabled delivery option.
- **The brake is data, not code.** No store code changes, and stores on older Kernels keep working
  because checkout is the authority.

## 5. Merchant controls

| Setting                                 | Default          | Who     |
| --------------------------------------- | ---------------- | ------- |
| Mode (Desligado · Sugerir · Automático) | Sugerir          | owner   |
| Pedidos ao mesmo tempo                  | 3                | manager |
| Folga para o motoboy                    | 5 min            | manager |
| Longest promise before Cheio            | 90 min           | manager |
| Late-order message                      | Sugerir          | owner   |
| Apology                                 | entrega grátis   | owner   |
| Apology monthly budget                  | none (no coupon) | owner   |

## 6. Measuring it

- **On-time rate** before and after (`statsTx.onTimeRate`). This is the headline number.
- **Promise error**, predicted against actual ready time, by level. It tunes the model and the
  capacity suggestion.
- **"Cadê meu pedido?" messages** per 100 orders on the Vendedor, and shopper cancellations during
  peaks.
- **Orders taken while braked,** mostly pickup, against what a full pause would have turned away.
- **Apology coupons** minted, redeemed, and the revenue of the orders that redeemed them.

## 7. Phases

| Phase | Ships                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| F0    | The §3.1 fixes; `driveMinutes` on the order                                                                                           |
| F1    | Promessa viva: `fulfillmentNowTx`, live promise at quote/placement/accept, queue on Início/KDS, live `high_demand` text, Kernel minor |
| F2    | O freio: levels, `delivery_paused_until`, Sugerir and Automático, hysteresis, audit, push                                             |
| F3    | Atraso avisado: detection, `order_late_notices`, apology coupons and budget                                                           |
| F4    | Capacity and prep learned from `order_events`; "agende para HH:MM" with P-022                                                         |

F3 mints coupons, which is money: after editing, `invariant-reviewer` runs on the diff
(`CLAUDE.md`).

## 8. Open decisions

1. **What a zone's ETA means:** travel only, which changes how merchants read the zone screen, or
   the whole promise, so the model uses `max(zone eta, ready + buffer)`.
2. **The default mode** for new stores: Sugerir (recommended) or Automático.
3. **Showing the queue to shoppers.** "8 pedidos na frente" is honest, but it may scare them off.
   Recommended: show times, not counts.
4. **Apology defaults,** and whether the budget is shared with the Vendedor's incentive budget or
   kept apart (recommended: apart, so they are explained apart).
5. **Which plan has it.** That's the owner's call. Don't state it in copy.

## 9. Risks

- **Garbage in.** A kitchen that never marks orders ready makes the model see a permanent backlog.
  Mitigations: stale-ticket exclusion, the Automático gate on board usage, and Sugerir by default.
- **Flapping.** A storefront that switches delivery on and off every few minutes is worse than a
  static promise. Hysteresis and the hourly change cap handle it.
- **Lost sales from honesty.** Longer promises convert worse. The measure is net: orders kept plus
  cancellations avoided. We report both to the owner.
- **Coupon abuse.** One coupon per order, one per phone every 14 days, a monthly ceiling, and none
  on cancelled orders.

## Change log

- 2026-10-07: first proposal.
