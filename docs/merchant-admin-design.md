# Merchant admin — design spec

> Status: Draft for sign-off · Last reviewed: 2026-09-27
> Product plan: [`merchant-admin.md`](merchant-admin.md) · Applies to: `apps/admin`

This spec is normative for the merchant admin. Where a screen and this document
disagree, the screen is wrong until the spec is changed on purpose.

It has two jobs. The first is to make the admin **effortless**: a merchant who
has never used a dashboard runs their store on day one without help. The second
is to make it **unforgettable**: when a merchant opens it, it should feel like
their shop came alive in their hand, not like software.

---

## 1. North star

**"A loja viva na palma da mão."** (The store, alive, in the palm of your hand.)

Three words decide every tradeoff, in this order:

1. **Effortless.** If a choice makes the admin prettier but slower to use, it
   loses. Beauty that costs a tap is not beauty.
2. **Alive.** The admin reflects the store in real time. Orders arrive, the day
   fills up, the store opens with the morning. Nothing is static that the
   merchant would want to see move.
3. **Warm.** It feels like a well-made physical thing (paper, a good pen, a
   bakery counter), not a control panel. Cream and forest, soft depth, real
   type, the merchant's own photos.

Who we design for: owners of small food businesses in Brazil (doceiras,
hamburguerias, marmitarias, padarias), often 35–60, running the store from a
mid-range Android between batches, one hand floury, sometimes with glasses off.
They are experts at their craft and not at software. **We never make them
feel like beginners.**

---

## 2. UX laws (the user-friendly contract)

These are testable. A usability session that breaks one files a bug.

### 2.1 Speed of the everyday

| Task                                | Budget                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| Accept a new order                  | **1 tap** from the push notification or the order card            |
| Advance an order to its next state  | 1 tap (or 1 swipe) on the card                                    |
| Pause the store                     | **2 taps** from any screen (status pill → "pausar agora")         |
| Mark a product "esgotado hoje"      | 2 taps from Cardápio, no form opened                              |
| Change today's hours                | 3 taps from Início                                                |
| Add a product with a photo          | under **60 s** for a practiced merchant, under 3 min on first try |
| Find any order, product or customer | 1 tap to search + type; results as they type, typo-tolerant       |
| Get back to where they were         | always 1 tap (back, or swipe down on a sheet); state never lost   |

### 2.2 The rules

1. **Undo beats confirm.** Reversible actions happen immediately and show a
   toast with "desfazer" for 6 s. Confirmation dialogs are reserved for things
   that can't be undone: refunds, cancelling a paid order, removing a team
   member. Those use a hold-to-confirm or typed confirmation, never a plain
   "OK".
2. **No dead ends.** Every empty state, error and "not available yet" carries
   the next action. An error says what happened, in words, and how to fix it.
3. **Defaults are done for them.** A new store arrives with hours, zones,
   and a first page already set from signup. Every form
   field that can have a sensible default has one. The merchant edits; they
   rarely fill.
4. **Forgiving input.** Money fields accept "12", "12,5", "12.50" and
   "R$ 12,50". Phone fields accept any formatting. Times accept "9", "9h",
   "09:00". Pasting a product list from WhatsApp creates products (A2).
5. **Save is automatic.** Edits save as they are made, with a quiet "salvo"
   state per field. No "Salvar" buttons except in flows that publish to the
   storefront (the page editor), where "publicar" is the clear final step.
6. **One primary action per screen**, always in the thumb zone on phones
   (bottom action bar), top-right on desktop.
7. **Labels on every icon.** The bottom navigation and every action show text.
   Icon-only buttons are allowed only for universal symbols (close, back,
   search) and have accessible names.
8. **Plain pt-BR, no platform words.** Never "template", "seção", "slot",
   "tenant", "SKU", "webhook", "token". See [§9](#9-voice-and-copy).
9. **Everything is reachable one-handed** on a 6.1" phone: primary actions and
   navigation in the lower 60% of the screen; top of screen is for reading.
10. **Offline is a state, not an error.** If the connection drops, the admin
    keeps showing the last data with a calm "sem conexão, tentando de novo"
    banner, queues safe actions (accept, advance) and replays them on
    reconnect. Money actions wait for the connection and say so.
11. **Nothing surprising happens to the storefront.** Any change the shopper
    will see shows how it will look before it goes live (price preview on the
    product card, pause message preview, page editor preview).
12. **Teach in place, once.** No tours or walkthrough carousels. The first
    time a feature matters, a single inline hint appears beside it, and it
    never returns after it's dismissed or used.
13. **Respect attention.** Only new orders, payment problems, "store about
    to close with orders pending" and, once the Vendedor ships, a shopper
    waiting for you in a Vendedor conversation ([ADR 0031](adr/0031-vendedor.md))
    may interrupt with sound or push. Everything else waits in Início's
    "precisa de você" list.

### 2.3 Measured, continuously

- **Task success** in usability sessions: 100% on the 8 everyday tasks above
  without help; median time within budget.
- **SUS ≥ 85** (excellent) from pilot merchants at each milestone.
- **Support contacts per store per month** from "how do I…" questions → ~0.
  Each one is triaged as a design bug.
- In-product: time from push to accept, share of orders accepted from the
  notification, and searches with no result, reviewed weekly.

---

## 3. Information architecture

### 3.1 Navigation

**Phone (< 768 px): bottom bar, five items, always labelled.**

| Início | Pedidos | Cardápio | Loja | Mais |
| ------ | ------- | -------- | ---- | ---- |

While the store's Vendedor is on, the bar is Início · Pedidos · Vendedor ·
Cardápio · Mais: the Vendedor carries the "precisa de você" count as its badge,
and Loja moves to the top of "Mais"; its everyday tasks stay in the status pill ([ADR 0031](adr/0031-vendedor.md),
[sales-agent-ux §2](features/sales-agent-ux.md#2-where-it-lives)).

"Mais" opens a sheet with Pagamentos, Clientes, Marketing, Aparência,
Relatórios, Equipe, Conta e plano and Ajuda, as large tiles with a live hint
each ("3 cupons ativos", "Mercado Pago conectado"). Pedidos carries a live
badge count of orders waiting for action.

**Tablet (768–1199 px): rail** on the left with the same five plus the Mais
items expanded, icons + short labels.

**Desktop (≥ 1200 px): sidebar** with every area, the store switcher at the
top, and the status pill pinned at the bottom of the sidebar.

### 3.2 Always present

- **The status pill** (top of every phone screen, sidebar on desktop): the
  store's live state (Aberta · Pausada · Fechada · Abre às 18h). Tapping it
  opens the status sheet: pause now (15 min, 1 h, rest of day, custom), with
  the shopper-facing message and its preview; change today's hours.
- **Search**: pull down on any list or tap the search field. It searches orders
  (number, name, phone), products and customers together, grouped.
- **Create (+)**: on Cardápio (product, category, kit) and Marketing (cupom).
  Never a global "+" menu of everything.

### 3.3 Hierarchy

Phones use full-screen routes stacked left-to-right with a real back
gesture; secondary edits open as **bottom sheets** (snap points at 50% and
92%). Desktop uses a **list + detail** split: the list stays, the detail opens
on the right, and a deep link opens both.

---

## 4. Visual language

### 4.1 The idea

**Paper and light.** Surfaces are warm paper (cream) stacked with soft,
believable depth; the merchant's content (photos, numbers, names) sits on top
at full strength. Forest is the voice of the brand (primary actions, headings
on key moments); **lime is electricity**: it appears only where something is
alive or new (a new order, today's live number, the open state, focus
rings). Because lime is rare, it always means something.

The admin's tokens (`apps/admin/src/ui/theme.css`: cream, forest, sage, lime,
night; Space Grotesk and Instrument Serif) are the brand's source; the site
copies them (`site/src/lib/styles/theme.css`, drift fails its build via
`site/scripts/validate.ts`), so a merchant who found Venduá on the site
recognizes the product they're in.

### 4.2 Color

Two themes, **Creme** (light, default) and **Noite** (dark, follows the
system, switchable). Contrast ratios below are measured (WCAG 2.x).

**Creme**

| Token            | Value                | Use                                                                 | Contrast         |
| ---------------- | -------------------- | ------------------------------------------------------------------- | ---------------- |
| `bg`             | `#F7F4EA` cream-50   | app background                                                      |                  |
| `surface`        | `#FFFDF8`            | cards, sheets                                                       |                  |
| `surface-sunken` | `#EFE9D8` cream-100  | wells, inputs at rest, grouped rows                                 |                  |
| `ink`            | `#123C32` forest-900 | primary text, headings                                              | 12.0 on surface  |
| `ink-muted`      | `#4F6A5E` forest-600 | secondary text                                                      | 5.8 on surface   |
| `ink-faint`      | `#6B8177`            | **non-text only**: icons, dividers accents, placeholders at ≥ 18 px | 4.1 on surface   |
| `line`           | forest-900 @ 12%     | hairlines                                                           |                  |
| `primary`        | `#123C32`            | primary buttons                                                     | cream text 12.0  |
| `spark`          | `#D9F875` lime-300   | live/new highlights, focus ring fill                                | forest text 10.3 |
| `success`        | `#1F7A4D`            | paid, delivered, saved                                              | 5.2 on surface   |
| `warning`        | `#9A5200`            | needs you                                                           | 5.8 on surface   |
| `danger`         | `#B3261E`            | destructive, failed                                                 | 6.4 on surface   |
| `info`           | `#2456B0`            | neutral information                                                 | 6.8 on surface   |

**Noite**

| Token            | Value               | Contrast        |
| ---------------- | ------------------- | --------------- |
| `bg`             | `#0A100D` night-950 |                 |
| `surface`        | `#131D18`           |                 |
| `surface-sunken` | `#0C1410` night-900 |                 |
| `ink`            | `#F7F4EA` cream-50  | 17.5 on bg      |
| `ink-muted`      | `#9DAFA4` sage-300  | 7.5 on surface  |
| `ink-faint`      | `#7F9388`           | 5.3 on surface  |
| `primary`        | `#D9F875` lime-300  | night text 16.1 |
| `spark`          | `#D9F875`           | 14.5 on surface |
| `success`        | `#6FD39C`           | 9.4             |
| `warning`        | `#F2B45A`           | 9.4             |
| `danger`         | `#FF8A7F`           | 7.6             |
| `info`           | `#8EB4FF`           | 8.3             |

In Noite, lime becomes the primary action color. It's the one place lime is
not rare, because on night it reads as light, which is its role.

**Order states** each have a soft fill and an ink, used for chips, lane
headers and the order timeline. Every pair passes AA with room to spare.
Color is never the only signal: each state also has an icon and a word.

| State         | Fill      | Ink       | Ratio | Icon                 |
| ------------- | --------- | --------- | ----- | -------------------- |
| Novo          | `#F0FCC9` | `#2F4A00` | 9.3   | bell-ringing (moves) |
| Aceito        | `#E3EEFF` | `#1B4A8C` | 7.5   | check-circle         |
| Preparando    | `#FFF0D6` | `#7A4300` | 7.1   | cooking-pot          |
| Saiu / Pronto | `#EEE8FF` | `#4B2E91` | 8.4   | moped / bag          |
| Entregue      | `#DDF3E6` | `#0F4A33` | 8.8   | seal-check           |
| Cancelado     | `#EEEDE8` | `#5B5F5C` | 5.5   | x-circle             |

**The store's own color.** The storefront's accent token tints a few chosen
places: the store avatar ring, the home header's glow, the
active-product highlight in the editor. It never replaces semantic colors. At
runtime the admin checks the accent against `surface`; below 3:1 it's used only
as a fill behind forest ink (the same AA check the Kernel runs at build, K13).

### 4.3 Typography

Three voices, each with one job.

| Role                            | Face                            | Where                                                                         |
| ------------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| **Display numerals + headings** | Space Grotesk Variable (brand)  | today's sales, order numbers, KPI values, page titles                         |
| **Moments**                     | Instrument Serif Italic (brand) | greetings and celebrations only: "Bom dia, Maria", "Primeiro pedido!"         |
| **UI + body**                   | Figtree Variable                | everything else. Warm, round, very legible at 14–17 px, full pt-BR diacritics |

All self-hosted through `@fontsource` (no runtime font CDN), with
`font-display: swap`, `latin` + `latin-ext` subsets only. Numbers are
tabular (`tnum`) wherever they line up or change live.

Scale (rem at 16 px root; phones never go below 15 px for body):

| Token     | Size / line | Weight | Face             | Use                          |
| --------- | ----------- | ------ | ---------------- | ---------------------------- |
| `hero`    | 56 / 60     | 600    | Space Grotesk    | today's sales on Início      |
| `display` | 40 / 44     | 600    | Space Grotesk    | order number in detail       |
| `title-1` | 28 / 34     | 600    | Space Grotesk    | page titles                  |
| `title-2` | 22 / 28     | 600    | Space Grotesk    | section titles, sheet titles |
| `moment`  | 32 / 36     | 400i   | Instrument Serif | greetings, celebrations      |
| `body-lg` | 17 / 26     | 450    | Figtree          | phone body, form inputs      |
| `body`    | 15 / 22     | 450    | Figtree          | desktop body                 |
| `label`   | 14 / 20     | 600    | Figtree          | buttons, field labels        |
| `caption` | 13 / 18     | 500    | Figtree          | metadata ("há 3 min")        |

The admin follows the phone's text-size setting up to **200%** without
clipping: layouts reflow, rows grow, nothing truncates a price or an order
number.

### 4.4 Space, shape and depth

- **4 px base grid.** Steps: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72. Phone page
  gutter 16, card padding 16–20; desktop gutter 32, card padding 24.
- **Soft, generous radius**: `sm 10` (chips, inputs), `md 16` (cards,
  buttons), `lg 24` (sheets, hero cards), `xl 32` (the Início hero, device
  frame in the editor), `full` for pills and avatars. Nested radius =
  outer − padding, always, so corners stay concentric.
- **Depth is light, not lines.** Three elevations with a warm, two-layer shadow
  (tight contact shadow + wide ambient), tinted forest, never grey:
  - `e1` cards: `0 1px 2px rgb(18 60 50 / .06), 0 4px 16px rgb(18 60 50 / .05)`
  - `e2` raised/dragging: `0 2px 4px rgb(18 60 50 / .08), 0 12px 32px rgb(18 60 50 / .10)`
  - `e3` sheets/popovers: `0 8px 16px rgb(18 60 50 / .10), 0 24px 64px rgb(18 60 50 / .16)`

  In Noite, depth comes from lighter surfaces plus a 1 px top highlight
  (`rgb(255 255 255 / .06)`), not shadows.

- **Paper texture.** A barely-there grain (2–3% noise, a single inline SVG
  filter, no image download) on `bg` in Creme gives the paper feel. It's
  disabled in Noite and when the device asks for reduced transparency.
- **Glass, sparingly.** Only the bottom bar and sheet headers use a
  translucent blur (`backdrop-filter: blur(20px) saturate(1.4)` over
  `bg @ 80%`), with a solid fallback. Nowhere else.

### 4.5 Iconography

Phosphor Icons. Use **duotone** for the bottom bar and empty states, with the
second tone in `spark` for the active item, and **regular** at 20/24 px
everywhere inline. Optical size matches the text next to it; an icon never
appears without a label except for close, back and search.

### 4.6 Photography

The merchant's photos are the most beautiful thing in the admin. Treat them
that way:

- Product tiles show photos edge to edge at 4:3 with the `md` radius, on a
  sunken placeholder that uses the image's dominant color while loading (Core
  stores it at upload).
- Uploads get in-app crop with the storefront's aspect ratios shown as guides,
  and a one-tap "clarear" auto-enhance (exposure and white balance only).
- No photo yet: a warm illustrated placeholder in the product's category
  (pudim, burger, marmita…) with "adicionar foto", never a grey box.

### 4.7 Illustration

One style, commissioned once: **hand-inked line drawings of food and shop
objects in forest, with a single lime highlight**, like a menu sketched on
kraft paper. It's used for empty states, onboarding, celebrations and the "Mais"
tiles. Delivered as SVG (monochrome + one accent layer), so they re-colour in
Noite. Never stock 3D blobs or generic people.

---

## 5. Motion, sound and touch

Motion explains what happened and makes the store feel alive. It is never
decoration for its own sake.

### 5.1 System

| Token     | Value                              | Use                             |
| --------- | ---------------------------------- | ------------------------------- |
| `instant` | 100 ms, `ease-out`                 | press states, toggles           |
| `quick`   | 180 ms, `cubic-bezier(.2,.8,.2,1)` | chips, fades, small moves       |
| `smooth`  | 280 ms, `cubic-bezier(.2,.8,.2,1)` | cards, route pushes             |
| `spring`  | stiffness 380, damping 30          | sheets, drag and drop, arrivals |
| `bouncy`  | stiffness 500, damping 22          | celebrations only               |

- Everything the finger moves tracks the finger 1:1, then settles with
  `spring`. Sheets, swipes and reorder can be interrupted mid-motion.
- Route changes: shared-element transitions (an order card expands into the
  order detail; a product tile into the product editor) via the View
  Transitions API, with a crossfade fallback.
- **`prefers-reduced-motion`**: every transform becomes a 120 ms opacity fade,
  springs become `quick`, and nothing loops.
- Only `transform` and `opacity` are animated. 60 fps on a mid-range Android
  is a requirement, verified on a real device.

### 5.2 Sound

Two sounds only, designed for the brand (short, warm, marimba-like, never a
system beep):

- **"Pedido novo"**: a rising two-note chime that repeats every 20 s until
  the order is seen. It's loud enough for a kitchen, and the volume is set on
  first run with a test button.
- **"Pago"**: a soft single note when a Pix payment confirms.

Sounds are off by default on desktop, on by default in the installed PWA, and
always obey the phone's silent mode (vibration only).

### 5.3 Haptics

Where supported (`navigator.vibrate` on Android): a light tick on toggles and
reorder snap points, a double pulse on a new order, a firm tap when a swipe
action commits. Never on scroll.

---

## 6. Signature moments

This is what makes it feel like another world. Each is specified here so it
gets built exactly, not approximated.

### 6.1 The living store (Início header)

The top of Início is a hero card (radius `xl`) whose background is a soft
gradient that **follows the store's day**:

- **Before opening:** dawn cream to pale peach, with "Abre às 9h" and a
  countdown.
- **Open:** fresh cream with a slow, breathing lime halo behind the status
  (4 s loop, 6% opacity swing; static under reduced motion).
- **Paused:** desaturated, with the pause message and "voltar agora".
- **Closed:** dusk into night tones, with the day's summary.

The store's own accent adds a faint glow in one corner. Above it: "Bom dia,
Maria" in Instrument Serif italic, and the store's avatar.

### 6.2 The number that grows

Today's sales sit in the hero at `hero` size in Space Grotesk. When a paid
order lands, the value **rolls up** like an odometer, digit by digit (600 ms,
`spring`), and a small lime "+R$ 42,00" floats up and fades. Below it: order
count, average ticket and a 7-day sparkline, with today's point pulsing.

### 6.3 An order arrives

1. The card **drops in from above** into the Novo lane with a `spring`, lands
   with a soft shadow bloom (`e2` → `e1`) and a lime edge that fades out over
   3 s.
2. The chime plays, the phone vibrates twice, and the Pedidos badge ticks up
   with a scale pop.
3. The card shows what matters at a glance: the order number in
   `display`, customer first name, items as "2× Pudim tradicional", total,
   delivery or pickup, and time since placed, which turns amber after the
   store's accept target (default 5 min).
4. **Accept** is the one big button, or a swipe right on the card. The swipe
   reveals the next state's color and icon under the finger and commits past
   40% with a haptic tap. Accepting asks for prep time as three chips (15 ·
   30 · 45 min), with the store's usual time preselected.

### 6.4 The first order, and the milestones

The store's first-ever order gets a full-screen moment: an illustrated
bell, "Primeiro pedido!" in Instrument Serif, a restrained burst of lime and
cream confetti (1.2 s, `bouncy`, max 40 particles), and a card they can
share on WhatsApp. The 10th, 100th and 1000th orders get a smaller version
inside Início. Nothing else in the admin celebrates, so these land.

### 6.5 Closing the day

When the store closes, Início turns to dusk and shows **"Seu dia"**: sales,
orders, best seller with its photo, busiest hour, and a comparison with the
same weekday last week. It's a beautiful, shareable card (rendered as an
image on request) in the store's colors.

### 6.6 The menu is a gallery

Cardápio is a grid of photo tiles, not a table. Long-press lifts a tile
(`e2`, slight scale 1.03, tilt following the drag); others part around it with
springs. Swipe left on a tile (list view) for "esgotado hoje". Sold-out tiles go
monochrome with a stamped "esgotado" label, so the state is visible across the
room.

### 6.7 Edit what you see

Aparência opens the **real storefront** in a device frame (phone by default,
toggle to desktop), laid out at a real phone's width and scaled to fit. Tapping
anything on the page selects that section with a lime outline and opens its
settings beside the preview, never over it: copy, images, show/hide, move
up/down, grouped as textos, fotos, botões e links, opções. Changes appear in the
preview as they're typed. The list of what's on the page reads top to bottom
like the page: the shared top ("em todas as páginas"), the page's own parts
(each with its own title as a second line, so two Vitrines tell apart), the
shared footer. Colors are one more entry in that list, chosen from palettes
generated from the store's logo, with the contrast check shown as one friendly
"tudo fácil de ler ✓" or the rows that aren't, never a ratio. Every edit can be
undone (desfazer/refazer, ⌘Z), "descartar" goes back to what's live, and
unpublished work is kept in the browser, so leaving the screen loses nothing.
"Publicar" shows "publicando…" and then "no ar ✓" with the live URL.

### 6.8 The store builds itself (onboarding)

Signup and onboarding are **one journey in three parts** — Cadastro, Sua loja, No ar — and
both wear the same header (`JourneyBar`) and the same phone preview, which starts in signup
with the store's name and address and keeps filling in. Signup asks what the store sells (ten
big tiles, one tap); that answer tunes everything after it: the hours preset ("Terça a domingo,
18h–23h30" for a pizzaria), example products, tagline ideas and the menu's first category.

After signup, onboarding is a conversation: **one question per screen**, told by a friendly
guide (Duá in a speech bubble that praises each answer), with 56 px buttons, presets instead of
blank fields and plain pt-BR. The questions come in four parts, named above each title ("Atendimento · 2 de 5"):

- **A cara da loja**: what it sells (only if nobody asked), import from another menu app, the
  name (only if signup didn't ask), logo, the store's colour (swatches, the logo's first),
  a phrase.
- **Atendimento**: the store's WhatsApp (prefilled with the number signup verified), hours,
  pickup and/or delivery, where to pick up, and how delivery is priced — by bairro, or by
  distance from the store's pin (ADR 0024).
- **Pagamentos** (owner): the methods it accepts, the Pix key (prefilled with the verified
  phone and the owner's name), and Mercado Pago for card on the site, which comes back to the
  wizard.
- **Cardápio**: the first products with a photo each, or a WhatsApp list pasted in.

Each answer **visibly assembles their storefront** in the phone beside the questions (behind
"Espiar minha loja" on phones): name → header, logo → avatar, colour → buttons, hours → the
status, products → the grid. Everything saves on "Continuar"; every optional question has a
quiet "pular". Where the merchant stopped is kept by Core, so another device opens a
welcome-back map with what's ready ticked and "Continuar: os horários". "Continuar depois"
leaves without nagging (Core remembers it). A store nobody has touched, or one fresh from
signup that never chose to leave, opens Início straight into it.

While the plan's first payment is pending the wizard says so in a slim line under the header,
with the Pix one tap away, and notices by itself when it lands. The last step is "sua loja está
no ar" — or "sua loja está pronta", with the payment that opens it right there — with the URL,
a QR code to print, "avisar no WhatsApp", the Instagram bio text and what was left for later,
each item a short detour back into its question.

The Vendedor, the store's AI seller, has **its own onboarding**, separate from this journey and
never folded into it ([ADR 0031](adr/0031-vendedor.md),
[sales-agent-ux §3.12](features/sales-agent-ux.md#312-treinar-a-ana-vendedorcomecar-new)). Once
this journey's finale is behind the merchant, Início offers it once.

---

## 7. Components

Built once in `apps/admin/src/ui`, documented live at `/_ui` with every state
over realistic data. No screen uses a raw element where a component exists.

| Component                                 | Notes                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `StatusPill`                              | store state + live dot; opens the status sheet                                                                               |
| `HeroCard`                                | the living Início header (6.1); time-of-day gradient engine                                                                  |
| `Odometer`                                | rolling tabular numerals with a delta float (6.2)                                                                            |
| `OrderCard`                               | arrival animation, swipe-to-advance, age timer, compact and full variants                                                    |
| `OrderTimeline`                           | state history with times and who acted                                                                                       |
| `Lane` / `Board`                          | kanban on tablet/desktop; on phones, a segmented control of lanes with counts and swipe between them                         |
| `ProductTile`                             | photo-first, sold-out stamp, drag handle, price, stock badge                                                                 |
| `PhotoField`                              | upload, crop with aspect guides, auto-enhance, reorder gallery                                                               |
| `MoneyField`                              | forgiving parse (2.2.4), `R$` prefix, numeric keypad, shows the storefront preview of the price                              |
| `TimeRangeField`                          | hours per weekday as draggable bars; "copiar para todos os dias"                                                             |
| `ZoneMap`                                 | map with radius rings or bairro polygons, fee per zone inline                                                                |
| `Sheet`                                   | bottom sheet on phones (snap 50/92%), side panel on desktop; drag to dismiss; focus trapped                                  |
| `ActionBar`                               | sticky bottom primary action on phones, safe-area aware                                                                      |
| `Toggle`, `Segmented`, `Chips`, `Stepper` | 48 px min height on touch; haptic tick                                                                                       |
| `Field` family                            | label above, helper below, inline validation after blur, per-field "salvo" state                                             |
| `Toast`                                   | bottom on phones, bottom-right on desktop; undo action; stacks max 2                                                         |
| `EmptyState`                              | illustration + one sentence + one action                                                                                     |
| `Skeleton`                                | shaped like the real content; shimmer disabled under reduced motion                                                          |
| `Hint`                                    | the one-time inline teaching bubble (2.2.12)                                                                                 |
| `Celebration`                             | the milestone overlay (6.4); rate-limited to one per session                                                                 |
| `DevicePreview`                           | framed live storefront for Aparência and onboarding                                                                          |
| `Chart` family                            | sparkline, bars, funnel; follows the repo's dataviz rules; tabular labels; every chart has a text summary for screen readers |
| `PersonaAvatar`                           | the Vendedor's spark disc with its initial; the ring breathes (3.2 s) only while it answers                                  |
| `Bubble`                                  | three voices: `in` paper, `seller` spark-soft signed "Ana · Vendedor", `you` forest; "sugestão" tag; Ensaio draft dashed     |
| `VoiceNote`                               | play, waveform, duration, transcript in italics; the transcript is its accessible name                                       |
| `ActionReceipt`                           | one past-tense line of what she did ("anotou 2 itens na sacola") with "por quê"                                              |
| `CoreReceipt`                             | Core's receipt paper: dashed tear, lines, fee, total, ETA, "calculado pela loja" shield; a table to screen readers           |
| `SacolaBar`                               | the pinned sacola: count, Core's total, the five-step stepper (a list, current step marked); opens its sheet                 |
| `Floor`                                   | who answers: "Ana está atendendo" + assumir + phone hint; the owner's with "devolver", suggestions, composer                 |
| `ReasonChip`, `FloorChip`                 | warning chip with icon and word (alergia, reclamação…); who holds the conversation ("Ana atendendo", "você")                 |
| `ScoreRing`                               | "19 de 20" in display numerals around a ring; the number is the accessible label; a running state                            |
| `GuaranteeChip`                           | "sempre cumprida" (shield, success) for enforced rules, "orientação" (quiet) for the rest                                    |
| `ChecklistRow`                            | step or check with state in colour, icon and word (done, now, to do, optional, miss), a figure or an action                  |
| `Discordance`                             | an Ensaio disagreement: the shopper, her dashed draft, your reply, "ensinar como eu fiz" / "estava certa"                    |
| `SalesFunnel`                             | conversas → sacola → resumo → fecharam as centred bars with counts; one sentence for screen readers                          |
| `AgentJourney`, `AgentGuide`              | the Vendedor onboarding's journey bar (Conhecer · Ensinar · Testar · Começar) and her speech bubble                          |
| `MiniChat`                                | the onboarding's live WhatsApp preview (`MiniStore`'s counterpart) and the frame of the owner's test chat                    |
| `ProposalCard`                            | a Resposta or Regra she proposes, with its guarantee chip; nothing kept until "está certo"                                   |

States every interactive component ships with: rest, hover (pointer only),
pressed, focus-visible (2 px lime ring + 2 px offset forest ring, visible on
both themes), disabled (with a reason on tap), loading, error.

---

## 8. Key screens

Each gets high-fidelity mockups at 375 / 820 / 1440 in Creme and Noite before
implementation. These are the layout requirements.

### Início

Phone, top to bottom: status pill → **HeroCard** (greeting, odometer,
count/ticket/sparkline) → **"Precisa de você"** (at most 3 actionable rows:
orders waiting, low stock, MP token expiring, unanswered waitlist; each with
its action button inline) → **setup checklist** until the store is complete,
shown as a progress ring and a list of next steps → **"Agora na loja"** (live
feed: orders, visits, carts, which makes the store feel alive) → a quick
peek at the best sellers today.
Desktop: hero spans two thirds with "precisa de você" beside it; feed and best
sellers below in two columns.

### Pedidos

Phone: a segmented control across the top (Novos · Em preparo · Prontos/Saiu ·
Concluídos) with counts; Novos is default when anything waits. Cards stack;
swipe right advances, swipe left opens more (cancel, contact, print).
Tablet/desktop: a four-lane board with drag between lanes, and the detail as a
side panel. Encomendas appear in a separate "agendados" view as a calendar.
Order detail: number in `display`, state timeline, items with modifiers,
notes highlighted in a warm callout, customer with a WhatsApp button, delivery
with a map snippet, payment status, and the actions in the ActionBar.

### Cardápio

Categories as horizontal chips (drag to reorder); grid of ProductTiles
(2 columns on phones, 4–6 on desktop) with a list-view toggle for bulk work.
Bulk mode: select, then change availability, category or price by a percent.
Product editor: photo first (big), then name, price and description, then
collapsible "opções" (modifiers), "estoque", "encomenda" and "disponibilidade",
each with a one-line summary when collapsed ("2 grupos, 7 opções").

### Loja

Grouped cards: Horários (TimeRangeField week view + special days
calendar), Entrega e retirada (ZoneMap, fees, minimum order), Perfil (logo,
name, contacts, address), Mensagens (pause and closed copy with previews).

### Aparência

The edit-what-you-see editor (6.7). From tablets up it fits the screen and each
column scrolls on its own. Wide screens (1400 px and up) show the outline left,
preview center, settings right, with a "what do you want to change?" start in
place of an empty panel. Tablets and laptops show the preview beside one panel:
the outline, or what was picked from it, with a back arrow. Phones show the
preview without a device frame and the panel under it; while something is
selected the preview pins under the top bar, so each change stays in view.
Publish and undo sit in the action bar.

### Relatórios

Period chips (hoje · 7 dias · 30 dias · personalizado) → headline KPIs with
comparison deltas → sales chart → funnel → top products (with photos) → peak
hours heatmap → zones. Every number explains itself on tap in one sentence.

---

## 9. Voice and copy

**Warm, direct, brief, like a helpful friend who runs a shop.** "Você", present
tense, active voice. Lowercase-first for buttons and labels, following the CRM
("pausar loja"); sentence case for titles.

| Don't                               | Do                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------- |
| "Erro 422: validação falhou"        | "O preço precisa ser maior que zero."                                       |
| "Template atualizado com sucesso"   | "Sua página inicial está no ar ✓"                                           |
| "Nenhum registro encontrado"        | "Nenhum pedido hoje ainda. Que tal divulgar a loja?" + botão "compartilhar" |
| "Tem certeza que deseja continuar?" | (just do it, and offer "desfazer")                                          |
| "Webhook do Mercado Pago falhou"    | "Não conseguimos confirmar um pagamento. Estamos tentando de novo."         |
| "SKU", "slug", "tenant"             | "código", "endereço da loja", "loja"                                        |

Formatting: `R$ 1.234,56`; "há 3 min", "hoje às 14h30", "ontem"; phone as
`(31) 99876-5432`; dates as "sáb, 27 set". Errors always say how to fix.
Celebrations use at most one exclamation mark.

---

## 10. Accessibility

Not a checklist at the end; it's part of "user friendly" for this audience.

- WCAG 2.2 AA everywhere; **body text ≥ 7:1** in both themes (AAA), since
  merchants read in bright kitchens and sometimes without glasses.
- Touch targets ≥ **48 × 48 px**, with ≥ 8 px between targets.
- Text size up to 200% without loss of content or function (4.3).
- Every state has color + icon + word. Charts have text summaries.
- Full keyboard support on desktop with visible focus; shortcuts for the order
  board (A accept, → advance, / search) listed under "?".
- Screen readers: landmarks per page; live regions announce new orders
  ("Pedido 128 chegou, R$ 42,00") and saves; sheets trap and restore focus.
- Reduced motion (5.1), reduced transparency (no glass, no grain), and
  forced-colors mode tested.
- Sessions with at least one merchant over 55 and one who uses large text at
  every milestone.

---

## 11. Performance is part of the design

| Budget (mid-range Android, 4G)            | Target                             |
| ----------------------------------------- | ---------------------------------- |
| First load, LCP                           | < 2.0 s                            |
| Installed PWA, cold open to usable Início | < 1.0 s (cached shell + last data) |
| Tap → visual response                     | < 100 ms (INP < 200 ms)            |
| Route JS (gzip), per route                | < 60 KB; shell < 420 KB            |
| Fonts                                     | 3 files, subset, < 90 KB total     |
| New order push → card on screen           | < 2 s                              |

Optimistic updates everywhere Core allows. Skeletons appear only after
150 ms, so fast loads don't flash.

---

## 12. Definition of done for a screen

A screen ships only when all of these hold:

1. It matches its signed-off mockup at 375 / 820 / 1440 in Creme and Noite.
2. Every state is designed and implemented: empty, loading, error, offline,
   first-run, full, and very long content (a 40-character product name, a
   R$ 10.000,00 order, 60 items).
3. CI gates pass: screenshots with no horizontal overflow, axe with zero
   serious violations, the Lighthouse mobile budget, the route bundle budget.
4. It works at 200% text, with reduced motion, and in forced colors.
5. It's been used by a real merchant in a usability session, and every task
   they struggled with has been fixed or filed.
6. **The wow test:** shown to someone who's never seen it, their first
   reaction is about how it feels, not about what's confusing.

---

## Appendix — tokens

The source of truth once `apps/admin` exists is its Tailwind v4 theme; this is
the starting set.

```css
@theme {
  --font-display: 'Space Grotesk Variable', system-ui, sans-serif;
  --font-moment: 'Instrument Serif', Georgia, serif;
  --font-sans: 'Figtree Variable', system-ui, sans-serif;

  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-xl: 32px;

  --ease-out-soft: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration-instant: 100ms;
  --duration-quick: 180ms;
  --duration-smooth: 280ms;
}

:root {
  --bg: #f7f4ea;
  --surface: #fffdf8;
  --surface-sunken: #efe9d8;
  --ink: #123c32;
  --ink-muted: #4f6a5e;
  --ink-faint: #6b8177; /* non-text only */
  --line: rgb(18 60 50 / 0.12);
  --primary: #123c32;
  --on-primary: #fffdf8;
  --spark: #d9f875;
  --on-spark: #123c32;
  --success: #1f7a4d;
  --warning: #9a5200;
  --danger: #b3261e;
  --info: #2456b0;
  --shadow-e1: 0 1px 2px rgb(18 60 50 / 0.06), 0 4px 16px rgb(18 60 50 / 0.05);
  --shadow-e2: 0 2px 4px rgb(18 60 50 / 0.08), 0 12px 32px rgb(18 60 50 / 0.1);
  --shadow-e3: 0 8px 16px rgb(18 60 50 / 0.1), 0 24px 64px rgb(18 60 50 / 0.16);
}

:root[data-theme='noite'] {
  --bg: #0a100d;
  --surface: #131d18;
  --surface-sunken: #0c1410;
  --ink: #f7f4ea;
  --ink-muted: #9dafa4;
  --ink-faint: #7f9388;
  --line: rgb(247 244 234 / 0.1);
  --primary: #d9f875;
  --on-primary: #0a100d;
  --spark: #d9f875;
  --on-spark: #0a100d;
  --success: #6fd39c;
  --warning: #f2b45a;
  --danger: #ff8a7f;
  --info: #8eb4ff;
}
```

`data-theme='noite'` is set from the system preference unless the merchant
picked a theme; `apps/admin` owns that logic.
