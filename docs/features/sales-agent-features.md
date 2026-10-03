# Vendedor: every feature

> Status: Proposed · Started 2026-10-03 · Catalog for [`sales-agent.md`](sales-agent.md) (the
> design), [`sales-agent-ux.md`](sales-agent-ux.md) (the merchant's screens) and
> [Agent Runtime v3](../architecture/18-agent-runtime.md)

Every feature of the Vendedor, the AI that sells on a store's own WhatsApp, in one place. It
merges the design, the runtime, the team's first screen board, and the improvements made on that
board ([`sales-agent-screens.html`](sales-agent-screens.html)). Nothing here is planned until
the owner settles the design's [open decisions](sales-agent.md#10-open-decisions); no feature
states a price or a plan.

**Columns.**

- **Phase:** when it ships, per [sales-agent §8](sales-agent.md#8-phases):
  - V0 foundations;
  - V1 attendant and shadow;
  - V2 seller;
  - V3 sells more;
  - V4 everywhere.
- **From:** where the feature comes from:
  - D: the design docs;
  - B: the team's first board;
  - N: new in this pass;
  - combinations like "D+B" mean both had it, and "B+N" means the board's idea, improved.
- **★** marks a feature that none of the competitors in [sales-agent §1](sales-agent.md#1-the-bar)
  states. That is what their own pages say, not proof they lack it.

## The team's board, checked against the design

The short answer: **every feature on the board is in the plan, most were already in the design,
and the board added several good ones** that the design lacked. Those are adopted here, with
improvements.

| On the board                                                                  | Before this pass                                                        | Now                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Inbox with "assumir", pause when the owner replies from the phone, "devolver" | In the design ([§4.12](sales-agent.md#412-human-handoff-and-the-inbox)) | Kept; adds the return timer and a push that opens the thread                                 |
| Receipt "calculado pela loja" for every amount                                | In the design (Core-rendered cards)                                     | Kept                                                                                         |
| Live sacola pinned on the thread with its stage                               | Implied by the state machine                                            | Adopted as a component                                                                       |
| Action receipts with "por quê" between bubbles                                | "Por que respondeu isso" (one line)                                     | Adopted; "por quê" reads the turn's event log                                                |
| Voice note with transcript                                                    | In the design (audio in)                                                | Kept; low-confidence transcripts are read back to the shopper                                |
| One suggestion per order, never after "só isso", with its reason              | In the design (suggestions from Core)                                   | Kept                                                                                         |
| Ensaio (shadow) instead of a draft queue                                      | In the design (`shadow` mode)                                           | Gets its own report screen with the agreement score                                          |
| Cliente oculto: synthetic shoppers with hidden orders on the store's own menu | The design's sims, for the team only                                    | **New to the design:** the eval harness becomes a merchant screen, re-run after menu changes |
| Coverage modes: Ensaio, Quando eu demorar, Fora do horário, Sempre            | A single `mode` (off, shadow, attendant, seller)                        | **New to the design:** coverage replaces `mode`; the wait is a choice                        |
| Capability switches: close the order, send the Pix, suggest, offer coupons    | Implied by `mode` and `upsell`                                          | **New to the design:** "close the order" off sends a ready sacola link                       |
| "Aprendi com você": the owner's reply becomes a proposed answer               | Only unanswered questions became knowledge                              | **New to the design**; joined by a queue of unanswered questions                             |
| Rules in plain words                                                          | Free-text `instructions`                                                | **New:** each rule says whether it's guaranteed in code or followed as guidance              |
| "O que pediram e você não tem"                                                | Not in the design                                                       | **New to the design**, with "where they asked for delivery and you don't deliver"            |
| "Enquanto você dormia"                                                        | Not in the design                                                       | **New to the design**                                                                        |
| The owner's suggested replies after "assumir"                                 | Not in the design                                                       | **New to the design**; suggestions pass the same verifier                                    |
| Tone presets with a live preview, a name, "assistente virtual" always         | Free-text voice; disclosure open                                        | Adopted; disclosure stays an owner decision, the board's choice is the recommendation        |
| Masked phone, preference chips that can be forgotten                          | Customer card, LGPD forget                                              | Adopted                                                                                      |
| Deliberately absent: autonomy slider, draft queue, raw JSON, dense chrome     | The CRM console's patterns                                              | Kept, plus two more ([UX §1](sales-agent-ux.md#1-principles))                                |

What the design has that the board didn't show, now drawn on the board:

- first use;
- the Ensaio report;
- Resultados with closed and assisted revenue;
- the lock-screen push;
- handoff rules;
- unanswered questions;
- the "outros" filter for numbers that aren't customers;
- the return timer.

## A. Talking with shoppers

| #   | Feature                          | What it does                                                                                                                                               | Phase | From |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| A1  | The store's own number           | Answers on the WhatsApp the store already uses (ADR 0026), with no ceiling on replies (decided 2026-10-03); the merchant keeps the app on the phone.       | V1    | D    |
| A2  | Waits for the whole thought      | Collects a burst of messages, an audio and a pin into one turn; waits while the shopper is typing or recording.                                            | V1    | D    |
| A3  | Never answers a stale question ★ | A message that arrives mid-reply interrupts it; the next reply answers everything.                                                                         | V1    | D    |
| A4  | Understands audio                | Transcribes pt-BR voice notes; when unsure, reads back what it understood before acting.                                                                   | V1    | D+B  |
| A5  | Understands photos               | A screenshot of a product becomes catalog candidates to confirm; a photo of a problem goes to the merchant.                                                | V3    | D    |
| A6  | Understands pins                 | A location pin is the delivery point, priced by road distance (ADR 0024).                                                                                  | V2    | D    |
| A7  | Speaks back                      | Optionally answers an audio with audio; amounts and the Pix code always go as text cards.                                                                  | V3    | D    |
| A8  | Many things in one message       | "2 X-Salada, um sem cebola, e uma coca, pago no pix" builds the whole cart in one turn.                                                                    | V2    | D    |
| A9  | The shopper's language           | Replies in the shopper's language; figures stay in Core's BRL formatting.                                                                                  | V3    | D    |
| A10 | The store's voice                | A name, a tone preset (descontraído, equilibrado, formal) with a live preview, and the merchant's own words.                                               | V1    | B+D  |
| A11 | Honest about itself              | Announces itself as the store's assistente virtual when the merchant's switch is on; never claims to be a person (blocked in code) and says so when asked. | V1    | B+D  |
| A12 | Grounded answers                 | Menu, prices, hours, zones, payment methods and encomenda dates come live from the store, never from memory.                                               | V1    | D    |
| A13 | Knows what it doesn't know       | Unknown answer → "vou confirmar com a loja", and the question goes to the merchant's queue.                                                                | V1    | D    |
| A14 | Careful with allergies           | Allergen or dietary claims only from a product's attribute; otherwise it asks the store.                                                                   | V1    | D    |
| A15 | Stays on topic                   | Politely declines anything that isn't about the store, as a task-specific bot should.                                                                      | V1    | D    |
| A16 | Order status                     | "Cadê meu pedido?" answered from the live order and its promise; late orders go to the merchant.                                                           | V2    | D    |
| A17 | Hours-aware                      | Knows if the store is open, when it opens, special days; never takes an order it can't fulfil.                                                             | V1    | D    |

## B. Taking the order

| #   | Feature                           | What it does                                                                                                             | Phase | From |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----- | ---- |
| B1  | Every option right                | Halves, bordas, sizes, combos and add-ons validated by the store's own cart; Core lists what's still missing.            | V2    | D    |
| B2  | Delivery quote                    | By address, CEP or pin, with fee, time and minimum order from Core.                                                      | V2    | D    |
| B3  | Out of zone → pickup ★            | Offers pickup with the ready time instead of a dead end; the miss is counted.                                            | V2    | D    |
| B4  | Closed → encomenda ★              | Takes a dated preorder when the store allows encomendas; Domínio's agent takes no order when closed.                     | V2    | D    |
| B5  | Sold out → substitute or waitlist | Offers a similar available item, or signs the shopper up for the waitlist.                                               | V2    | D    |
| B6  | The summary is a receipt          | Items, fee, discounts and total rendered by Core as a receipt "calculado pela loja".                                     | V2    | D+B  |
| B7  | A yes binds one cart ★            | The order is tied to the exact cart and total the shopper confirmed; anything changed means a new summary and a new yes. | V2    | D    |
| B8  | Exactly one order ★               | A retried or crashed turn finds the same order; never a duplicate.                                                       | V2    | D    |
| B9  | Unusual orders double-checked     | Very large quantities or totals need a plain "sim".                                                                      | V2    | D    |
| B10 | Pix in the chat                   | The copia-e-cola as its own easy-to-copy message with its validity; a fresh code when it expires.                        | V2    | D+B  |
| B11 | Every payment method              | Card online by link, card or voucher on delivery, cash with change ("troco para R$ 100"), from Core's settings.          | V2    | D    |
| B12 | A ready sacola link               | With "fechar o pedido" off, sends a link that opens the storefront with the cart already built.                          | V2    | B+N  |
| B13 | Same kitchen, same flow           | Agent orders reach the board, KDS, printers, stock, loyalty and status messages like any order; the merchant accepts.    | V2    | D    |
| B14 | Payment proof from the provider   | Mercado Pago's confirmation, or the merchant's, never a receipt photo.                                                   | V2    | D    |

## C. Selling more

| #   | Feature                                   | What it does                                                                                                  | Phase | From |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| C1  | "O de sempre" ★                           | Rebuilds the last order at today's prices and says what changed or ran out.                                   | V3    | D    |
| C2  | One suggestion, well timed                | Computed by Core from what this store's shoppers buy together, pinned pairings, combos, the shopper's habits. | V3    | D+B  |
| C3  | Never insists                             | One offer per order, none after "só isso", none in a complaint.                                               | V3    | D+B  |
| C4  | Combo savings                             | "O combo sai R$ 4,00 mais barato", the exact difference from Core.                                            | V3    | D    |
| C5  | The best coupon already theirs            | Applies a loyalty reward or personal coupon the phone holds.                                                  | V3    | D    |
| C6  | Incentives within the merchant's budget ★ | Only coupons the merchant chose, by reason, under a monthly limit they set; minted by Core.                   | V3    | D+B  |
| C7  | Free-delivery nudge                       | "Faltam R$ 8,00 para a entrega grátis", when the store has that rule.                                         | V3    | D    |
| C8  | Recovery                                  | One nudge when a sacola stops, inside the store's hours, at most once a day, optionally with an incentive.    | V3    | D    |
| C9  | Expired Pix                               | Offers a new code once.                                                                                       | V2    | D    |
| C10 | Back in stock                             | Tells a shopper who asked when the item returns.                                                              | V3    | D    |
| C11 | "Pediram e você não tem" ★                | Counts items shoppers asked for that the menu lacks; one tap starts a product with that name.                 | V3    | B    |
| C12 | "Pediram entrega onde você não entrega" ★ | Neighbourhoods asked for outside the zones, from conversations and quotes.                                    | V3    | B+N  |
| C13 | "Enquanto você dormia"                    | What the Vendedor sold while the store was closed or the owner away, and when it's scheduled.                 | V3    | B    |

## D. Knowing the customer

| #   | Feature                                | What it does                                                                                                                                  | Phase | From |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| D1  | Customer card                          | Name, orders, usual basket, addresses with pins, payment preference, assembled by Core.                                                       | V3    | D+B  |
| D2  | WhatsApp proves the phone              | Can recall that phone's addresses; always asks before using one.                                                                              | V3    | D    |
| D3  | Remembered preferences                 | "Massa bem assada", "sem cebola": allowlisted facts the merchant sees and can forget with one tap.                                            | V3    | D+B  |
| D4  | Allergies remembered, always confirmed | Kept only after the shopper agrees, confirmed on every later order, never used to sell, erasable by shopper or merchant (decided 2026-10-03). | V3    | N    |
| D5  | Masked phone                           | Staff views show `(11) 9••••-4821`.                                                                                                           | V1    | B    |
| D6  | Forget means forget                    | The LGPD forget erases conversations, media and facts, and fixes today's gaps (cart addresses, message bodies).                               | V0    | D    |

## E. The merchant's controls

| #   | Feature                       | What it does                                                                                                                                                    | Phase | From |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| E1  | On and off                    | "Ana ligada" in one tap; off, the store's WhatsApp is the merchant's alone.                                                                                     | V1    | N    |
| E2  | Coverage modes ★              | When it answers: Ensaio (writes, never sends), Quando eu demorar (after 1, 2 or 5 min without a reply from the store, or when closed), Fora do horário, Sempre. | V1    | B+N  |
| E3  | Capabilities                  | Switches for closing the order, sending the Pix, suggesting add-ons and offering coupons.                                                                       | V2–V3 | B    |
| E4  | "Passe para mim quando"       | Handoff rules: complaint or delay, allergy, order above an amount, new customer paying cash; and when it takes back.                                            | V1–V2 | D+N  |
| E5  | Rules, honestly labelled ★    | Rules in plain words; those the system can enforce show "sempre cumprida", the rest "a Ana segue como orientação".                                              | V1    | B+N  |
| E6  | Answers                       | The store's written answers with how often each was used.                                                                                                       | V1    | B+D  |
| E7  | Not every number is a shopper | First messages that don't read as a shopper's wait under "outros"; "não é cliente" mutes a number for good.                                                     | V1    | D+N  |
| E8  | AI budget                     | A ceiling on the store's AI spend; reaching it degrades to sending the store link, never to silence.                                                            | V1    | D    |
| E9  | Roles                         | Owner turns it on and sets money; manager edits voice, rules and answers; attendant works the inbox.                                                            | V1    | D    |
| E10 | Saves as you go               | Every setting autosaves with a quiet "salvo", like the rest of the admin.                                                                                       | V1    | B    |
| E11 | Disclosure switch             | Whether it introduces itself as "assistente virtual" is the merchant's choice (decided 2026-10-03); honesty when asked is not.                                  | V1    | N    |

## F. Working alongside it

| #   | Feature                       | What it does                                                                                                                 | Phase | From  |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | ----- |
| F1  | Its home                      | Presence ("Ana está atendendo · 3 conversas"), what it sold today, conversion, reply time, suggestions taken.                | V1–V3 | B     |
| F2  | "Precisa de você"             | Who's waiting, why (alergia, reclamação, pedido grande…) and for how long, with one-tap "assumir".                           | V1    | B+N   |
| F3  | A push only when it matters ★ | The single Vendedor event that interrupts: a shopper waiting for the merchant (decided 2026-10-03). Its action is "assumir". | V1    | N     |
| F4  | Inbox                         | Phone list and thread; desktop three panes with filters (todas, precisa de você, com pedido, Ana atendendo, outros).         | V1    | B+N   |
| F5  | Live sacola                   | Pinned on the thread with its stage: montar, endereço, pagamento, confirmar, feito.                                          | V2    | B     |
| F6  | "Por quê" on every action ★   | Plain receipts of what it did ("anotou 2 itens", "entrega R$ 7,00 · ~40 min"), each explaining itself from the turn's log.   | V1    | B+D   |
| F7  | Take over, hand back          | "Assumir" or just reply from the phone; it pauses in that thread, shows when it'll return, and comes back on "devolver".     | V1    | D+B+N |
| F8  | Suggested replies for you ★   | After "assumir", tap-to-send replies the Vendedor drafts, checked by the same verifier.                                      | V1    | B     |
| F9  | Reply from the admin          | A composer in the thread, sent from the store's number.                                                                      | V1    | D     |
| F10 | Order events in the thread    | "Pedido #1284 feito · Pix enviado · aguardando pagamento", linked to the order.                                              | V2    | B     |
| F11 | Customer at the side          | On desktop, the customer card and "por que a Ana sugeriu" next to the thread.                                                | V3    | B     |
| F12 | Keyboard                      | A assumir, D devolver, J/K next and previous conversation.                                                                   | V1    | N     |
| F13 | Its first sale                | A one-time moment when it closes its first order, like the admin's first-order moment.                                       | V2    | N     |

## G. Teaching it and trusting it

| #   | Feature                         | What it does                                                                                                       | Phase | From  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----- | ----- |
| G1  | First use, not a tour           | A checklist on its home: WhatsApp connected, review what it knows, Cliente oculto, optional Ensaio, "ligar a Ana". | V1    | N     |
| G2  | Test as a customer              | Chat with it from the admin, on the real menu, before any shopper does.                                            | V0    | D+B   |
| G3  | Cliente oculto ★                | Twenty synthetic shoppers with hidden orders on this store's menu; a line-by-line score; misses become menu fixes. | V1    | B+D   |
| G4  | Re-checked after menu changes ★ | Cliente oculto re-runs on its own after the menu changes and speaks up only if the score drops.                    | V2    | N     |
| G5  | Ensaio with a score ★           | Days of silent drafting; "você mandaria 41 de 46 iguais"; disagreements to teach from or to dismiss.               | V1    | D+B+N |
| G6  | "Aprendi com você" ★            | When the merchant answers a shopper, the answer comes back as a proposed answer: ensinar, editar or ignorar.       | V1    | B     |
| G7  | Unanswered questions            | Questions it couldn't answer, with how often they were asked and an inline answer field.                           | V1    | D+N   |
| G8  | Weekly proposals                | Up to three one-tap changes a week (an answer to write, a suggestion to retire, a recovery delay to try).          | V3    | D+N   |
| G9  | Live is the merchant's call     | Scores inform; nothing blocks "ligar a Ana".                                                                       | V1    | B     |

## H. Results

| #   | Feature                        | What it does                                                                                                         | Phase | From |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| H1  | Closed and assisted, apart ★   | Revenue it closed, and revenue it helped (storefront orders within 24 h of its link), with the window said in words. | V3    | D+N  |
| H2  | The funnel                     | Conversations → sacola → summary → order.                                                                            | V3    | D+N  |
| H3  | Its ticket against the store's | Average order through the Vendedor against the storefront's.                                                         | V3    | D    |
| H4  | What selling added             | Suggestions offered, taken and their revenue; recoveries and theirs.                                                 | V3    | D    |
| H5  | Speed and handoffs             | Reply time (typical and slowest), and handoffs by reason.                                                            | V3    | D    |
| H6  | Daily line                     | A Vendedor line in the store's daily summary.                                                                        | V3    | D    |

## I. Channels

| #   | Feature                   | What it does                                                                       | Phase | From |
| --- | ------------------------- | ---------------------------------------------------------------------------------- | ----- | ---- |
| I1  | WhatsApp, every sender    | Senders whose number WhatsApp hides, and foreign numbers, are answered too.        | V0    | D    |
| I2  | Instagram DM              | The same conversation model on the store's Instagram.                              | V4    | D    |
| I3  | A storefront chat ★       | A chat on the store's site that edits the page's own cart.                         | V4    | D    |
| I4  | The official WhatsApp API | A per-store option with templates for opted-in recovery and re-engagement.         | V4    | D    |
| I5  | Phone calls               | A voice front end on WhatsApp calls, delegating to the same conversation and cart. | Later | D    |

## J. Safety and guarantees

| #   | Feature                             | What it does                                                                                                                                                    | Phase | From |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| J1  | Numbers it can't invent ★           | It cites figures by reference and Core writes them; a checker blocks any other amount, time, product or promise.                                                | V1    | D    |
| J2  | Shopper tools only                  | Bound to this conversation; no menu, price or order changes; no other customer's data.                                                                          | V1    | D    |
| J3  | Prompt-injection proof by design    | Shopper text and images are data; money and orders pass code gates, not the model's goodwill.                                                                   | V1    | D    |
| J4  | Pranks and fraud                    | Rate limits, flags for large or first cash orders, Pix only after repeated cancellations.                                                                       | V2    | D    |
| J5  | Personal data minimized             | No phone numbers to model providers; first names only; addresses only at checkout.                                                                              | V1    | D    |
| J6  | Zero data retention at AI providers | Every model, transcription and voice call goes through a zero-data-retention arrangement; nothing is stored or trained on at the provider (decided 2026-10-03). | V1    | N    |
| J7  | Never goes dark                     | Over budget, provider down or stuck: the store link and a handoff, never silence.                                                                               | V1    | D    |
| J8  | "Pare de me responder"              | Mutes it for that shopper; SAIR still stops order notices.                                                                                                      | V1    | D    |

## K. Under the hood

| #   | Feature                      | What it does                                                                                                                 | Phase | From |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| K1  | Durable conversations ★      | One actor per conversation on Postgres: a crash resumes mid-turn without a second order or message.                          | V0    | D    |
| K2  | Model gateway                | Fast and strong tiers, fallback across providers, hedged slow calls, budgets per turn, thread and store.                     | V0    | D    |
| K3  | Versions released in rings ★ | Each agent version passes its suite, goes to pilot stores first, and rolls back on its own when monitors regress.            | V1    | D    |
| K4  | Eval harness                 | Hidden-order scenarios run several times each (pass^k), on more than one simulated-user model; recorded runs replayed in CI. | V0    | D    |
| K5  | Counterfactual replay ★      | A real conversation (with consent) re-run against a candidate version to see what would change.                              | V3    | D    |
| K6  | Turn inspector               | For staff: the context, the model's output, every check and effect of any turn.                                              | V1    | D    |
| K7  | Monitors                     | A store whose blocks, handoffs or opt-outs jump becomes a staff event, without shopper data.                                 | V1    | D    |

## Change log

- 2026-10-03: first catalog, merging the design, the runtime and the team's board.
- 2026-10-03: owner decisions: disclosure switch (E11), the push (F3), the phone bar.
- 2026-10-03: owner decisions: no reply limits (A1), zero data retention (J6), allergies remembered and confirmed (D4).
