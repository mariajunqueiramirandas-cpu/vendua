# ADR 0029: The kitchen display (Cozinha) and the pickup display

- Status: Accepted (implemented 2026-10-02, Core migration 0079)
- Date: 2026-10-02

## Context

Every food competitor we track has a kitchen display (KDS) and we had none
([`competitor-parity.md`](../competitor-parity.md), P-016; Domínio's §2.7 lists browser screen,
stations, a timer per ticket, item-level progress, and a feed from every channel). Kitchens ran
off the Pedidos board or a printed comanda. The board is built for whoever accepts orders: money,
payment and customer contact. A cook needs other things. They need what to make, in what order,
how late it is and what to leave out, readable from a metre away and usable with wet hands.

## Decision

**One more admin screen, not another app.** `/admin/cozinha` is a route in the merchant admin
(`apps/admin/src/features/kitchen`). It uses the same session, live stream, offline queue and PWA
install. The Shell drops its rail, bars and pull-to-refresh on `/cozinha*` and keeps everything
underneath (SSE, sound, toasts). Any role can open it; only managers edit stations.

**Core owns the kitchen's state; the order's path is unchanged.** Migration 0079 adds:

- `kitchen_marks`: one row per order line the kitchen has made. Tapping an item toggles it. The
  first mark on an accepted order moves it to `preparing` through `transitionOrder`, in the same
  transaction and with the same audit row as Pedidos.
- `kitchen_tickets`: per-order kitchen flags. Today that is only `rush` ("passar na frente").
- `store_settings.kitchen` (jsonb): the stations, each a name and the menu categories it makes.

Accepting, "pronto" and the hand-off stay on `POST /orders/:id/transition`, so the shopper's
WhatsApp, printing and the board all behave exactly as when Pedidos moves an order. Both
tables have `tenant_id` and the RLS policies; the three writes go through the Idempotency-Key
claim, write `audit_log` and emit the new `kitchen` admin topic. `GET /admin/v1/kitchen` returns
tickets (first names only, no prices, no phones), stations, categories and the day's numbers in
five queries, with no per-order reads.

**The clock is the prep time chosen at "aceitar".** A ticket's fuse burns from acceptance against
that order's prep minutes (else the store's usual). It turns amber at 60% and red with crawling
stripes once late, and every state also carries a word ("no tempo", "atenção", "atrasado").
An encomenda's clock starts when the kitchen starts it. Late tickets ring once, in a tone distinct
from the new-ticket knock.

**"Pronto" waits 4.5 s with "desfazer".** The shopper is told the moment an order is ready, and
the path never goes backwards. So the bump is held on the ticket itself, with a draining bar and
the undo button where the finger is (undo beats confirm, design spec §2.2.1). Leaving or hiding
the page sends what's waiting.

**Stations are a filter, not a workflow.** A device picks its station (kept in localStorage). It
sees only that station's items, with items from categories no station claims shown everywhere.
It finishes with "minha parte pronta" while other stations still owe items. "Tudo" is the pass,
or expedição. We didn't model per-station bumps or routing rules beyond category. Small kitchens
don't need them, and the marks already tell each screen what the others have done.

**More on the screen:**

- "Tudo junto" folds every open ticket into one prep list, counting combos by their parts. Tapping
  a dish dims the tickets without it.
- A "Chegando" strip accepts waiting orders with a prep time.
- A ready rail hands off ("retirado" / "saiu para entrega") and says when to charge at the counter.
- Optionally, the device's own pt-BR voice reads new tickets aloud.
- An order cancelled mid-preparation raises an alert.
- Keys and bump bars work without touching the glass (1–9, arrows, Space, Enter, Z).

**The pickup display (`/cozinha/painel`) is the same data facing the customers.** Numbers
"preparando" and "pronto" are shown, and a newly ready number takes the screen for 7 s with a
ding-dong and a spoken call. Only numbers appear by default. First names and delivery orders are
per-device opt-ins. It never plays the new-order chime.

## Consequences

- The kitchen and the board stay consistent by construction: both read Core and move orders
  with the same transition.
- A mark is a row per line, so a busy day adds rows to `kitchen_marks`; they go with the order
  (`on delete cascade`).
- Stations route by menu category only. Per-product routing, prep-time targets per station, and
  per-station printers (Domínio's "printer per sector") are later decisions.
- Speech uses the browser's voices: quality varies by device, and Chrome needs a first tap before
  it speaks (both screens ask for one).
- Dine-in tickets (P-015) will need a table on the ticket; nothing here assumes delivery or
  pickup beyond the mode icon.
