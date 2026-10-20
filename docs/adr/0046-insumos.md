# ADR 0046: Insumos: fichas técnicas, stock drawn by each sale, and the CMV

- Status: Accepted (built 2026-10-20: migration `0137_insumos.sql`, `modules/insumos.ts`,
  `admin/routes-insumos.ts`, `/reports/cmv`, the admin's `/cardapio/insumos`)
- Date: 2026-10-20

## Context

A store's stock (`products.stock`, `addon_stock`) counts what it sells. A burger shop doesn't buy
burgers: it buys bread, meat and boxes, and its margin depends on what those cost. Before this,
the only cost a store could give was a number typed into the pricing sheet, so the margin was a
guess, nothing told it the bread was running out, and the reports had no CMV.

## Decision

**Insumos and preparos.** `ingredients` holds what the store buys (`insumo`) and what it makes
itself from other insumos (`preparo`: a sauce, a dough, with a yield and its own ficha). Every
quantity is an integer in thousandths of its unit (`*_milli`: mg-precision grams, ml, a thousandth
of a unit), and cost is `cost_per_k_cents`, cents per 1000 units (per kg, L or thousand). A
preparo has no cost of its own: Core computes it from its ficha and yield. Preparos nest up to 4
deep, and a ficha that would make a cycle is refused (`FICHA_CYCLE`, `FICHA_TOO_DEEP`).

**Fichas técnicas.** One table, `recipe_lines`, whose rows each belong to exactly one owner, as a
check constraint enforces: a product (what one unit uses), an option (what choosing it adds), a
preparo, or `per_order` (packaging every order takes). A product or order line can carry a `mode`
(delivery, pickup, dine-in), so the delivery box counts only on delivery orders.

**Each sale draws its insumos, and never waits on them.** `drawInsumos` runs inside the order
transaction, after the product and add-on stock, in both checkout and the PDV. It explodes the
order through the fichas, preparos included, and subtracts from every insumo being counted
(`stock_milli` not null). A counted preparo is drawn as itself; an uncounted one passes through to
its ingredients. Stock may go below zero. An insumo shortfall never refuses a sale (the store's
choice). It shows up as "para repor" and on the home screen instead. The rows are locked in id
order after products and `addon_stock`, so two checkouts can't deadlock. What was drawn is stored
on the order (`orders.ingredients_drawn`), and a cancel gives back exactly that, not a recomputed
ficha that may have changed since.

**The CMV is a snapshot.** Each `order_items.cost_cents` and `orders.cost_cents` is computed in
Core at sale time from the ficha, or else from the product's stated cost. A later price change on
an insumo doesn't rewrite last month's margin. A line with no cost stays null. The report counts
CMV and gross margin over costed sales only, and shows how much of the period is costed.

**Purchases move the cost.** A purchase adds stock and sets the cost to the weighted average of
what was there and what arrived (`averageCost`). If nothing was counted, or the stock was at or
below zero, it starts over from the price paid. Counts, losses, purchases, "fiz" (making a counted
preparo) and each sale write `ingredient_movements`, the insumo's history and the report's
purchases and losses.

**Every plan has it.** No plan gate.

## Consequences

- The pricing sheet's margin and suggested price use the ficha's cost (its most expensive mode)
  plus the sheet's other costs, so a store moving to fichas should remove what the ficha already
  counts from those lines. The product page says so.
- Changing an insumo's unit once a ficha uses it, or once it's counted, is refused
  (`INGREDIENT_IN_USE`): every quantity would silently mean something else.
- Orders placed before this have a null cost, so their periods read as partly costed.
- The draw adds one recursive query and one batched update per order. They're bounded by the
  ficha caps (40 lines per owner, depth 4).
