import type { StorefrontTokens, TemplateSet } from '@vendua/templates';
import { formatCents } from './rules/format.ts';
import { digitsOf, phoneKey } from './rules/phone.ts';

export { formatCents, phoneKey };

// The only supported path from a storefront to Core (no fetch/axios in storefront
// code). Mutations send a fresh Idempotency-Key (checkout reuses its own while an attempt's
// outcome is unknown); the session token rides as Bearer.

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface StoreProfile {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  whatsapp: string | null;
  instagram: string | null;
  city: string | null;
  address: string | null;
  status: 'open' | 'closed' | 'paused';
  resumesAt?: string;
  /** Kernel 1.14 — while open by its hours: when the current window ends (Core's clock) */
  closesAt?: string;
  hours: {
    timezone: string;
    windows: { days: number[]; open: string; close: string }[];
    /** Kernel 1.14 — holidays and short days, today (store zone) and later, sorted */
    specialDays?: SpecialDay[];
  };
  prepTimeMinutes: number;
  minOrderCents: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  /** ISO 4217 — pt-BR storefronts today get 'BRL'. */
  currency: string;
  /** Per-tenant copy deck — e.g. { itemSingular: 'doce', bag: 'sacola' }. */
  vocabulary: Record<string, string>;
  /** Kernel 1.2 — the store's Pix: key + an amount-less copia e cola (null = none). */
  pix?: PixInfo | null;
  /** Kernel 1.2 — the stamp card, when the store runs one. */
  loyalty?: { stampsRequired: number; minOrderCents: number; rewardLabel: string } | null;
  /** Kernel 1.2 — encomenda rules. Kernel 1.16: `whileClosed` — a closed store still takes a
   *  cart made only of encomendas (false = no orders while closed; see `takesOrders`). */
  preorder?: { paymentMethods: string[]; maxDays: number; whileClosed?: boolean };
  /** Kernel 1.4 — methods the store accepts at checkout (the merchant admin toggles them). */
  paymentMethods?: string[];
  /** Kernel 1.4 — the store's uploaded logo, when it has one. */
  logoUrl?: string | null;
  /** Kernel 1.7 — where and how to pick an order up (null = not set) */
  pickup?: { address: string | null; instructions: string | null };
  /** Kernel 1.7 — which methods Mercado Pago takes online right now */
  onlinePayments?: { pix: boolean; card: boolean };
  /** Kernel 1.12 — discount/surcharge per offered method (only methods that have one), for
   *  labels; Core computes the cents (`CartTotals.paymentAdjustmentCents`) */
  paymentAdjustments?: Record<string, PaymentAdjustment>;
  /** Kernel 1.14 — the store's canonical origin (`https://host`, no trailing slash), for
   *  share links, QR codes and JSON-LD */
  publicUrl?: string;
  /** Kernel 1.15 — set when the store prices delivery by road distance from a pin the
   *  shopper confirms on a map (ADR 0024); null/absent = zones price every address */
  distancePricing?: DistancePricing | null;
  /** Kernel 1.18 — the store's own assistant (the Vendedor) chats on the site: its name and how
   *  it introduces itself, in Core's words. null/absent = the merchant didn't turn it on. */
  chat?: { name: string; intro: string } | null;
  /** Kernel 1.21 — the store sends one WhatsApp reminder about a bag left full, to a shopper who
   *  ticked it at checkout (`api.cartReminder`). Absent = false. */
  cartReminder?: boolean;
  /** Kernel 1.22 — the store takes orders from its tables' QR codes (ADR 0036): its plan and its
   *  switch. Absent = false. */
  dineIn?: { enabled: boolean };
}

/** Kernel 1.22 — the table a QR code names (`GET /storefront/v1/table`). `ordering: false` =
 *  the menu can be browsed but checkout refuses: `off` (the store turned QR orders off),
 *  `closed` / `paused` (the store's status). New reasons may appear. */
export interface TableInfo {
  label: string;
  ordering: boolean;
  reason: 'off' | 'closed' | 'paused' | null;
}

/** Kernel 1.18 — one message of the storefront chat. `core` = a card Core wrote (a summary, a
 *  link to the sacola: `card` names it); `merchant` = the store's people, by hand. */
export interface StoreChatMessage {
  id: string;
  author: 'shopper' | 'agent' | 'core' | 'merchant';
  body: string;
  at: string;
  card: string | null;
}

/** Kernel 1.18 — the chat bound to this tab's cart session (`GET /checkout/v1/chat`). */
export interface StoreChat {
  /** false = the store turned the chat off since the page loaded */
  available: boolean;
  name: string | null;
  intro: string | null;
  /** oldest first, the latest 60 */
  messages: StoreChatMessage[];
  /** a reply is on its way */
  pending: boolean;
}

/** Kernel 1.15 — a point on the map. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Kernel 1.15 — raster XYZ tiles for the pin map (`{z}/{x}/{y}` template). */
export interface MapTiles {
  url: string;
  attribution: string;
  maxZoom: number;
}

/** Kernel 1.15 — the store's distance pricing, for labels; Core computes every fee. */
export interface DistancePricing {
  baseFeeCents: number;
  feePerKmCents: number;
  minFeeCents: number;
  maxKm: number;
  freeOverCents: number | null;
  /** the least an address pays (Core's formula at 0 km), for "a partir de" */
  fromFeeCents: number;
  /** where the pin map opens when the address can't be placed (the store, ~100 m off) */
  center: LatLng;
  tiles: MapTiles;
}

/** Kernel 1.15 — where an address roughly is, to open the pin map there. */
export interface GeoPoint extends LatLng {
  precision: 'address' | 'street' | 'postcode' | 'area';
}

/** Kernel 1.14 — a date with its own hours (`closed`, or one `open`–`close` window). */
export interface SpecialDay {
  /** the store's local date, YYYY-MM-DD */
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
  label?: string;
}

/** Kernel 1.12 — a payment method's rule, signed: negative = discount, positive = surcharge.
 *  Applied by Core to subtotal minus the coupon discount (never to delivery). */
export interface PaymentAdjustment {
  /** basis points of the base (−500 = −5%) */
  percentBps?: number;
  fixedCents?: number;
}

/** Kernel 1.12 — how a modifier group prices several picks (Core applies it):
 *  sum = every unit's delta; average = the mean delta over the picked units;
 *  most_expensive = the highest delta once (pizza halves) */
export type ModifierPricingRule = 'sum' | 'average' | 'most_expensive';

export interface PixInfo {
  key: string;
  keyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  beneficiary: string;
  /** BR Code "copia e cola" — render as a QR or a copy button */
  copyPaste: string;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  status: 'active' | 'sold_out' | 'archived';
  /** Decorative figure slot — storefronts map variants to artwork. */
  figureVariant: 'default' | 'alt';
  tags: string[];
  /** Additive Core fields (03 — semantics pinned in v1): absent until Core serves them. */
  imageUrl?: string | null;
  stockQuantity?: number | null;
  /** Kernel 1.2 fields (Core Phase 2). */
  kind?: 'simple' | 'combo';
  lowStockThreshold?: number | null;
  /** Core's call: tracked stock at/below the threshold */
  lowStock?: boolean;
  requiresPreorder?: boolean;
  preorderLeadDays?: number;
  /** Kernel 1.5 — a combo or a product with modifier groups: only the product page can add it */
  needsChoices?: boolean;
  /** Kernel 1.7 — a `sold_out` product outside its schedule says when it comes back
   *  (Core's copy, e.g. "Só sábados, 9h–13h") */
  availabilityLabel?: string | null;
  /** Kernel 1.12 — the "de" price, display-only (struck through when above `basePriceCents`,
   *  which stays what the shopper pays) */
  compareAtPriceCents?: number | null;
  /** Kernel 1.13 — display-only "a partir de": the cheapest configured unit, set only when it is
   *  above `basePriceCents` (a product priced by a required list) */
  fromPriceCents?: number | null;
  /** Kernel 1.13 — the product has a timed promotion: its days and hours (Core's copy, e.g.
   *  "Seg a sex, 18h–20h"). Inside them `basePriceCents` is already the promotion's price and
   *  `compareAtPriceCents` the regular one */
  promoLabel?: string | null;
  /** Kernel 1.21 — what the merchant states about allergens and diets (`DIETARY_TAGS`, e.g.
   *  `sem_gluten`, `vegano`); [] or absent = nothing stated. Unknown tags may appear: skip them */
  dietary?: string[];
}

export interface ComboSlot {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  /** how many of the same item the slot takes */
  qtyPerItem: number;
  items: {
    productId: string;
    slug: string;
    name: string;
    priceDeltaCents: number;
    status: string;
    stockQuantity: number | null;
    imageUrl: string | null;
    /** Kernel 1.7 — why a scheduled pick is unavailable now ("Só sábados, 9h–13h") */
    availabilityLabel?: string | null;
    /** Kernel 1.9 — set by the Kernel for `catalog.ComboPicker`: how many one kit can still
     *  take at the chosen qty, after the cart (absent = stock not tracked) */
    stockLeft?: number;
  }[];
}

export interface ComboSelection {
  slotId: string;
  productId: string;
  qty: number;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
  sort: number;
  products: CatalogProduct[];
  /** Kernel 1.12 — a line under the category heading */
  description?: string | null;
}

export interface ProductDetail extends CatalogProduct {
  modifierGroups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: {
      id: string;
      name: string;
      priceDeltaCents: number;
      status: string;
      /** Kernel 1.12 — how many units of this option one item may take (1 = a toggle) */
      maxQty?: number;
      description?: string | null;
      imageUrl?: string | null;
    }[];
    /** Kernel 1.12 — absent = 'sum' */
    pricingRule?: ModifierPricingRule;
  }[];
  /** Kernel 1.2 */
  gallery?: { url: string; alt: string | null; width: number | null; height: number | null }[];
  comboSlots?: ComboSlot[];
  /** people waiting on a restock (sold-out products) */
  waitlistCount?: number;
  /** first bookable date for an encomenda (YYYY-MM-DD), Core-computed */
  preorderEarliestDate?: string | null;
}

export type NoticeSeverity = 'info' | 'warning' | 'blocking';

export type NoticeAction =
  | { type: 'link'; label: string; href: string }
  | { type: 'notify'; label: string; channel: 'whatsapp' | 'push' }
  | { type: 'dismiss'; label: string }
  | ({ type: string; label: string } & Record<string, unknown>);

export interface Notice {
  id: string;
  kind: string;
  severity: NoticeSeverity | string;
  title: string;
  body?: string;
  actions?: NoticeAction[];
  payload?: Record<string, unknown>;
  dismissible: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
}

export interface SurfacesEnvelope {
  version: 1;
  /** Kernel 1.14 adds `closesAt` (see `StoreProfile.closesAt`) */
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string; closesAt?: string };
  notices: Notice[];
  /** Kernel 1.10: only in the edge-injected `window.__VENDUA_STATE__` — the store's live design */
  templates?: TemplateSet;
  tokens?: StorefrontTokens | null;
  /** Kernel 1.14 — with `?design=1` (the edge): the store's head meta */
  meta?: StoreMeta;
}

/** Kernel 1.14 — `<head>` meta Core derives from the store (`title` = name — tagline). */
export interface StoreMeta {
  title: string;
  description: string | null;
  /** absolute logo URL */
  image: string | null;
  /** the store's public URL */
  url: string;
  siteName: string;
}

/** `/storefront/v1/state` — the loader's snapshot; `templates` when asked for. */
export interface StateEnvelope {
  version: 1;
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string; closesAt?: string };
  notices: Notice[];
  loader: { state: 'normal' | 'maintenance'; title?: string; message?: string; href?: string };
  templates?: TemplateSet;
  /** Kernel 1.8: the merchant admin's origin, with `templates` — the editor preview's only parent */
  adminOrigin?: string | null;
}

export interface CartItem {
  id: string;
  productId: string;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  /** Live product availability — 'active' | 'sold_out' | 'archived'. */
  productStatus: string;
  /** Kernel 1.12: `qty` = units of the option (priceDeltaCents is per unit) */
  modifiers: { id: string; name: string; priceDeltaCents: number; status: string; qty?: number }[];
  lineTotalCents: number;
  /** Kernel 1.2 */
  combo?: {
    slotId: string;
    slotName: string;
    productId: string;
    name: string;
    qty: number;
    priceDeltaCents: number;
    status: string;
    /** Kernel 1.9 — the picked item's tracked stock (null = not tracked) */
    stockQuantity?: number | null;
  }[];
  comboSelections?: ComboSelection[];
  imageUrl?: string | null;
  stockQuantity?: number | null;
  requiresPreorder?: boolean;
  preorderLeadDays?: number;
  /** Kernel 1.12 — option quantities above 1, by modifier id */
  modifierQty?: Record<string, number>;
  /** Kernel 1.21 — the shopper's note for this line ("sem cebola"); part of the line: the same
   *  product with another note is another line. null/absent = none */
  note?: string | null;
}

/** Kernel 1.21 — the longest note a line takes (Core's cap) */
export const ITEM_NOTE_MAX = 140;

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  itemCount: number;
  minOrderCents: number;
  /** Cents short of the minimum order — Core-computed so storefronts never
   *  subtract money themselves. 0 once the minimum is met. */
  remainingMinOrderCents: number;
  belowMinOrder: boolean;
  /** Kernel 1.2 — coupon discount (Core-computed); total already has it off */
  discountCents?: number;
  freeDeliveryThresholdCents?: number | null;
  /** cents short of free delivery; 0 once reached */
  freeDeliveryRemainingCents?: number | null;
  /** Kernel 1.12 — the chosen payment method's discount (<0) or surcharge (>0), already in
   *  `totalCents`; 0 without one. Priced for a method by `api.cart(method)` / `quote` */
  paymentAdjustmentCents?: number;
}

export interface CartCoupon {
  code: string;
  label: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  /** false = kept on the cart but not discounting now; `reason` is an error code */
  applies: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface CartSchedule {
  /** a line is an encomenda — checkout needs `scheduledFor` */
  required: boolean;
  leadDays: number;
  /** bookable YYYY-MM-DD dates, earliest first */
  dates: string[];
  paymentMethods: string[];
}

export interface DeliveryAddress {
  neighborhood?: string;
  address?: string;
  street?: string;
  number?: string;
  complement?: string;
  reference?: string;
  cep?: string;
  lat?: number;
  lng?: number;
}

export interface Cart {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: CartItem[];
  totals: CartTotals;
  delivery:
    | ({
        /** Kernel 1.22 adds 'dine_in' (an order from a table's QR code: no fee, no minimum) */
        mode: 'pickup' | 'delivery' | 'dine_in';
        neighborhood?: string;
        zoneId?: string | null;
        zoneName?: string | null;
        distanceKm?: number | null;
        /** Kernel 1.15 — distance pricing: a road route, or 'estimate' (straight line × 1.3) */
        distanceSource?: 'route' | 'estimate' | null;
        etaMin?: number | null;
        etaMax?: number | null;
      } & Omit<DeliveryAddress, 'neighborhood'>)
    | null;
  /** Kernel 1.2 */
  coupon?: CartCoupon | null;
  schedule?: CartSchedule;
}

export interface CheckoutInput {
  /** Kernel 1.22: `phone` is left out for an order at a table (only the name is asked) */
  customer: { name: string; phone?: string };
  /** Kernel 1.22 — `{ mode: 'dine_in', table: <the QR's token> }`: an order at a table */
  delivery: { mode: 'pickup' | 'delivery' | 'dine_in'; table?: string } & DeliveryAddress;
  /** Kernel 1.7 adds 'card_online' (Mercado Pago's hosted checkout), 1.11 'meal_voucher',
   *  1.22 'tab' (at a table: paid with the table's comanda) */
  payment: {
    method: 'pix' | 'card_online' | 'card_on_delivery' | 'cash' | 'meal_voucher' | 'tab';
    /** Kernel 1.17 — cash only: the note the shopper pays with ("troco para R$ 100,00"),
     *  integer cents. Core answers `INVALID_CHANGE` (`details.minCents`) below the total. */
    changeForCents?: number;
  };
  /** Kernel 1.2 — "Alguma observação?" (≤500) */
  notes?: string;
  /** Kernel 1.2 — encomenda date, YYYY-MM-DD */
  scheduledFor?: string;
  /** Kernel 1.23 — the total the shopper saw, integer cents, as Core priced it for this payment
   *  method (never a client sum). Core answers 409 `PRICES_CHANGED` when its total differs. */
  expectedTotalCents?: number;
}

export interface DeliveryZone {
  id: string;
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents: number;
  etaMin: number;
  etaMax: number;
  /** Kernel 1.12 adds 'polygon' (an area drawn on the map; needs the shopper's location).
   *  Kernel 1.15: a quote priced by distance answers `zoneKind: 'distance'` (never listed) */
  kind?: 'neighborhood' | 'radius' | 'polygon' | 'distance';
  /** Kernel 1.12 — the drawn area, `[lat, lng]` vertices (kind 'polygon') */
  polygon?: [number, number][] | null;
  maxDistanceKm?: number | null;
  feePerKmCents?: number;
  freeDeliveryOverCents?: number | null;
  /** Kernel 1.14 — the least any address in the zone pays, before free-delivery thresholds
   *  (Core's fee formula; a per-km zone charges at least its first km) */
  minFeeCents?: number;
}

export interface QuoteResult {
  eligible: boolean;
  reason?: 'OUT_OF_ZONE';
  zoneId?: string;
  feeCents?: number;
  etaMin?: number;
  etaMax?: number;
  zoneName?: string;
  distanceKm?: number | null;
  minOrderCents?: number;
  freeDeliveryOverCents?: number | null;
  /** Kernel 1.12 — the matched zone's kind (a polygon match has `distanceKm: null`) */
  zoneKind?: DeliveryZone['kind'];
  /** Kernel 1.15 — distance pricing: a road route, or 'estimate' (straight line × 1.3) */
  distanceSource?: 'route' | 'estimate' | null;
  /** Kernel 1.12 — with a cart session: its totals delivered here (and paid with
   *  `paymentMethod`, when sent) */
  totals?: CartTotals;
}

export interface CepResult {
  address: {
    cep: string;
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
  };
  zone: QuoteResult;
}

export interface CouponCheck {
  valid: boolean;
  code: string;
  label?: string;
  kind?: CartCoupon['kind'];
  discountCents?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ImportReport {
  added: number;
  skipped: { productId: string | null; slug: string | null; code: string; message: string }[];
}

export interface ImportLine {
  productId?: string;
  slug?: string;
  qty: number;
  modifierIds?: string[];
  /** Kernel 1.12 — option quantities (ids in `modifierIds` count as 1) */
  modifiers?: { id: string; qty?: number }[];
  comboSelections?: ComboSelection[];
  /** Kernel 1.21 — the line's note (≤ 140) */
  note?: string;
}

/** A phone's order, as `useOrders` sees it — no address, no other PII. */
export interface OrderSummary {
  id: string;
  number: number;
  state: string;
  placedAt: string;
  scheduledFor: string | null;
  /** Kernel 1.22 adds 'dine_in' */
  mode: 'pickup' | 'delivery' | 'dine_in';
  totalCents: number;
  items: { name: string; qty: number }[];
}

export interface LoyaltyCard {
  enabled: boolean;
  stampsRequired: number;
  stamps: number;
  minOrderCents: number;
  rewardLabel: string;
  /** personal coupon codes ready to use */
  rewards: { code: string; label: string; expiresAt: string | null }[];
}

export interface Order {
  id: string;
  number: number;
  state: string;
  customer: { name: string; phone: string };
  delivery: {
    /** Kernel 1.22 adds 'dine_in' (placed → … → ready → delivered, "servido") */
    mode: 'pickup' | 'delivery' | 'dine_in';
    /** Kernel 1.22 — dine_in: the table's label ("Mesa 5"); null at the counter */
    table?: string | null;
    etaMin: number | null;
    etaMax: number | null;
    address: unknown;
    feeCents: number;
    neighborhood: string | null;
    /** Kernel 1.2 */
    addressParts?: {
      street: string | null;
      number: string | null;
      complement: string | null;
      neighborhood: string | null;
      reference: string | null;
      cep: string | null;
    };
    zoneName?: string | null;
    distanceKm?: number | null;
    /** when Core promised it (null for scheduled orders) */
    promisedFrom?: string | null;
    promisedTo?: string | null;
  };
  payment: {
    method: string;
    /** pending | paid | failed | expired | refunded | partially_refunded | charged_back | in_mediation */
    status: string;
    /** 'sandbox' (offline methods) | 'mercadopago' | 'fake' — branch on `online`, not on this */
    provider: string;
    instructions: string | null;
    /** Kernel 1.2 — copia e cola with this order's amount. Kernel 1.7: an online Pix
     *  (Mercado Pago's dynamic QR) carries `expiresAt`; Core may leave key/beneficiary
     *  empty for it, so read them defensively (typed as before — no retype in Contract 2). */
    pix?: (Omit<PixInfo, 'keyType'> & { keyType?: string; expiresAt?: string | null }) | null;
    /** Kernel 1.7 — paid through the provider (webhook-confirmed), not by hand */
    online?: boolean;
    paidAt?: string | null;
    refundedCents?: number;
    /** Kernel 1.7 — the hosted card checkout of the current attempt */
    redirectUrl?: string | null;
    /** Kernel 1.17 — cash: the amount the shopper asked change for (null = no change) */
    changeForCents?: number | null;
  };
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: string;
  timeline: { at: string; from: string | null; to: string; actor: string; meta: unknown }[];
  /** Kernel 1.2 */
  items?: OrderItem[];
  notes?: string | null;
  scheduledFor?: string | null;
  discountCents?: number;
  /** Kernel 1.12 — the payment method's discount (<0) or surcharge (>0), in `totalCents` */
  paymentAdjustmentCents?: number;
  coupon?: { code: string } | null;
  updatedAt?: string;
  /** bumps on every state change — the live wait's cursor */
  version?: number;
}

/** Kernel 1.14 — Core's price for one configured line (`GET /products/:slug/quote`), the
 *  same pricing as add-to-cart. */
export interface LineQuote {
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

/** Kernel 1.14 — what one add-to-cart call added (Core-priced; absent from an older Core). */
export interface AddedLine {
  itemId: string;
  /** the units this call added */
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

/** Kernel 1.14 — a line's configuration for `api.quoteLine` / `useLineQuote`. */
export interface LinePicks {
  /** picked options with their units (absent qty = 1) */
  modifiers?: { id: string; qty?: number }[];
  comboSelections?: ComboSelection[];
}

/** Kernel 1.7 — what `POST /orders/:id/pay` asks the shopper to do next. Kernel 1.19 adds
 *  the in-page card: `card` (mount the card form), and from `POST /orders/:id/card`
 *  `challenge` (the bank's 3-D Secure, in an iframe) and `declined`. `redirect` is what a Core
 *  asked without `{ card: 'form' }` answers. */
export type PaymentNext =
  | { kind: 'pix'; copyPaste: string; expiresAt: string | null }
  | { kind: 'redirect'; url: string }
  | { kind: 'none' }
  | {
      kind: 'card';
      provider: 'mercadopago' | 'fake';
      publicKey: string;
      amountCents: number;
      /** why the last attempt was refused (shown above a fresh form) */
      declined: DeclineReason | null;
    }
  | { kind: 'challenge'; url: string; creq: string }
  | { kind: 'declined'; reason: DeclineReason };

/** Kernel 1.19 — why the card was refused, in the shopper's terms (Core maps the provider's
 *  status detail). New reasons may appear: treat an unknown one as `'other'`. */
export type DeclineReason =
  | 'card_data'
  | 'insufficient_funds'
  | 'call_for_authorize'
  | 'card_disabled'
  | 'duplicated'
  | 'high_risk'
  | 'max_attempts'
  | 'installments'
  | 'challenge_failed'
  | 'other';

/** Kernel 1.19 — `api.payCard`'s body: the card form's single-use token and choices. Never
 *  an amount — Core charges the order's total. */
export interface CardPaymentInput {
  token: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: { email: string; identification: { type: string; number: string } | null };
  /** Mercado Pago's device fingerprint (`window.MP_DEVICE_SESSION_ID`), when its SDK set one */
  deviceId: string | null;
}

export interface OrderItem {
  productId: string | null;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  /** Kernel 1.12: `qty` = units of the option */
  modifiers: { name: string; priceDeltaCents: number; qty?: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  lineTotalCents: number;
  /** Kernel 1.21 — the shopper's note for this line */
  note?: string | null;
}

/** Kernel 1.21 — an order read through the link in the store's WhatsApp updates
 *  (`/pedido/:id?t=…`): where it stands and what was ordered. No customer, address, payment,
 *  money or order notes — the device that placed it reads those (`Order`). */
export interface OrderTracking {
  statusOnly: true;
  id: string;
  number: number;
  state: string;
  storeName: string;
  delivery: {
    /** Kernel 1.22 adds 'dine_in' */
    mode: 'pickup' | 'delivery' | 'dine_in';
    /** Kernel 1.22 — dine_in: the table's label */
    table?: string | null;
    promisedFrom: string | null;
    promisedTo: string | null;
    etaMin: number | null;
    etaMax: number | null;
  };
  scheduledFor: string | null;
  placedAt: string;
  updatedAt: string;
  /** the live cursor, as on `Order` */
  version: number;
  timeline: { at: string; to: string }[];
  items: {
    name: string;
    qty: number;
    modifiers: { name: string; qty: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    note: string | null;
  }[];
}

const SESSION_KEY = 'vendua.session';
const ORDER_TOKENS_KEY = 'vendua.orderTokens';
const ORDER_TOKENS_MAX = 20;

// Kernel 1.21: the cart session and the order tokens live in localStorage, so the bag and past
// orders survive closing the tab (Instagram's browser handing off to Safari, the next day). A
// tab from an older Kernel kept them in sessionStorage: they are still read there and move over
// on the next write. A blocked storage (private mode, a sandbox) throws on access.
function storageOf(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return globalThis[kind] ?? undefined;
  } catch {
    return undefined;
  }
}

function parseTokens(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v).filter(([, t]) => typeof t === 'string' && t.length <= 400),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// The checkout-time token stays authorized to read that order even after the
// session rotates onto a fresh cart. Oldest first.
function readOrderTokens(): Record<string, string> {
  try {
    return {
      ...parseTokens(storageOf('sessionStorage')?.getItem(ORDER_TOKENS_KEY)),
      ...parseTokens(storageOf('localStorage')?.getItem(ORDER_TOKENS_KEY)),
    };
  } catch {
    return {};
  }
}

function writeOrderTokens(m: Record<string, string>) {
  // bounded: the newest ORDER_TOKENS_MAX orders stay reopenable on this device
  for (const k of Object.keys(m).slice(0, -ORDER_TOKENS_MAX)) delete m[k];
  const json = JSON.stringify(m);
  try {
    storageOf('localStorage')!.setItem(ORDER_TOKENS_KEY, json);
    storageOf('sessionStorage')?.removeItem(ORDER_TOKENS_KEY);
  } catch {
    try {
      storageOf('sessionStorage')?.setItem(ORDER_TOKENS_KEY, json);
    } catch {
      /* private mode — order tracking lives in memory only */
    }
  }
}

function storeOrderToken(orderId: string, t: string) {
  const m = readOrderTokens();
  delete m[orderId];
  m[orderId] = t;
  writeOrderTokens(m);
}

/** A token Core no longer honours (the order is gone, or never was this device's): dropped. */
function dropOrderToken(orderId: string) {
  const m = readOrderTokens();
  if (!(orderId in m)) return;
  delete m[orderId];
  writeOrderTokens(m);
}

// Kernel 1.21: the status-only link credential of an order (`?t=` on the link the store's
// WhatsApp sends), kept like the order tokens so a reload after the param is stripped still reads
const TRACK_TOKENS_KEY = 'vendua.trackTokens';
const TRACK_TOKEN_RE = /^vot\.[0-9a-f-]{36}\.\d{1,12}\.[A-Za-z0-9_-]{20,100}$/;

function readTrackTokens(): Record<string, string> {
  try {
    return parseTokens(storageOf('localStorage')?.getItem(TRACK_TOKENS_KEY));
  } catch {
    return {};
  }
}

function storeTrackToken(orderId: string, t: string) {
  const m = readTrackTokens();
  delete m[orderId];
  m[orderId] = t;
  for (const k of Object.keys(m).slice(0, -ORDER_TOKENS_MAX)) delete m[k];
  try {
    storageOf('localStorage')?.setItem(TRACK_TOKENS_KEY, JSON.stringify(m));
  } catch {
    /* private mode — the link works for this page */
  }
}

function dropTrackToken(orderId: string) {
  const m = readTrackTokens();
  if (!(orderId in m)) return;
  delete m[orderId];
  try {
    storageOf('localStorage')?.setItem(TRACK_TOKENS_KEY, JSON.stringify(m));
  } catch {
    /* private mode */
  }
}

const CUSTOMER_TOKENS_KEY = 'vendua.customerTokens';

// customer tokens (phone → token) outlive the tab: "meus pedidos" on this device
// keeps working across visits without asking the order number again
interface CustomerTokens {
  last?: string;
  byPhone: Record<string, { token: string; expiresAt: string }>;
}

function readCustomerTokens(): CustomerTokens {
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(CUSTOMER_TOKENS_KEY) ?? 'null',
    ) as CustomerTokens | null;
    if (!raw || typeof raw.byPhone !== 'object') return { byPhone: {} };
    const now = Date.now();
    for (const [phone, t] of Object.entries(raw.byPhone))
      if (!t?.token || Date.parse(t.expiresAt) < now) delete raw.byPhone[phone];
    return raw;
  } catch {
    return { byPhone: {} };
  }
}

function writeCustomerTokens(t: CustomerTokens) {
  try {
    globalThis.localStorage?.setItem(CUSTOMER_TOKENS_KEY, JSON.stringify(t));
  } catch {
    /* private mode — verification lasts for this page */
  }
}

/** The device's cart session (shared by its tabs); undefined = storage can't be read. */
function readStoredToken(): string | null | undefined {
  const local = storageOf('localStorage');
  try {
    return (
      local?.getItem(SESSION_KEY) ||
      storageOf('sessionStorage')?.getItem(SESSION_KEY) ||
      (local ? null : undefined)
    );
  } catch {
    return undefined;
  }
}

/** false = not stored (private mode): the session lives in this page's memory only */
function storeToken(token: string): boolean {
  try {
    storageOf('localStorage')!.setItem(SESSION_KEY, token);
    storageOf('sessionStorage')?.removeItem(SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

// The checkout's Idempotency-Key, kept in this tab while an attempt's outcome is unknown: a
// reload after a lost response retries the same cart + body with the same key, so Core replays
// the order it placed. `of` is a hash of (session token, body) — the body holds the shopper's data.
const CHECKOUT_KEY = 'vendua.checkoutKey';

function hashOf(text: string): string {
  // cyrb53: 53 bits, enough to tell one tab's checkout bodies apart
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function readCheckoutKey(): { of: string; key: string } | null {
  try {
    const v = JSON.parse(storageOf('sessionStorage')?.getItem(CHECKOUT_KEY) ?? 'null') as unknown;
    if (!v || typeof v !== 'object') return null;
    const { of, key } = v as Record<string, unknown>;
    return typeof of === 'string' && typeof key === 'string' && key.length <= 100
      ? { of, key }
      : null;
  } catch {
    return null;
  }
}

function storeCheckoutKey(k: { of: string; key: string } | null) {
  try {
    const s = storageOf('sessionStorage');
    if (k) s?.setItem(CHECKOUT_KEY, JSON.stringify(k));
    else s?.removeItem(CHECKOUT_KEY);
  } catch {
    /* private mode — the key lives in this page's memory only */
  }
}

function forgetStoredToken() {
  for (const kind of ['localStorage', 'sessionStorage'] as const)
    try {
      storageOf(kind)?.removeItem(SESSION_KEY);
    } catch {
      /* private mode */
    }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Wrap transport failures so callers always get a `code`, never a bare TypeError.
    throw new ApiError(0, 'NETWORK_ERROR', 'could not reach the store backend');
  }
  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL',
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return body;
}

export function idemKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

/** Core's shape for Mercado Pago's device id: it ignores any other, and an oversized one would
 *  push /pay past its body cap and lose the Pix. */
const DEVICE_ID_RE = /^[A-Za-z0-9_:.-]{1,200}$/;

export function createApi(baseUrl = '') {
  const sf = (path: string) => `${baseUrl}/storefront/v1${path}`;
  const co = (path: string) => `${baseUrl}/checkout/v1${path}`;
  // the page navigates to a redirect and posts the shopper's bank challenge into a frame:
  // https only, whatever Core sent; a relative challenge (the dev fake) is Core's own origin
  const safeNext = (next: PaymentNext): PaymentNext => {
    if (next.kind === 'redirect' && !isHttps(next.url))
      throw new ApiError(503, 'PAYMENT_UNAVAILABLE', 'unsafe payment redirect');
    if (next.kind === 'challenge') {
      const relative = !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(next.url);
      const url = resolveUrl(next.url, baseUrl);
      if (!url || (!relative && !isHttps(url)))
        throw new ApiError(503, 'PAYMENT_UNAVAILABLE', 'unsafe payment challenge');
      return { ...next, url };
    }
    return next;
  };
  // the stored copy wins (another tab may have started or rotated the device's cart); memory
  // only while storage is unreadable or refused the write
  let memToken: string | null = readStoredToken() ?? null;
  let memOnly = false;
  const current = (): string | null => {
    if (memOnly) return memToken;
    const stored = readStoredToken();
    if (stored !== undefined) memToken = stored;
    return memToken;
  };
  const setToken = (t: string) => {
    memToken = t;
    memOnly = !storeToken(t);
  };
  let sessionPromise: Promise<{ cart: Cart }> | null = null;
  // Memory first (survives storage failures); the persisted copy covers refresh and later visits.
  const orderTokenMem = new Map<string, string>();
  // Serial delivery writes — a slower earlier write must not overwrite the newer cart.
  let deliveryQueue: Promise<unknown> = Promise.resolve();
  // Core's claim fingerprints the caller, not the body: one key per (cart, body), kept across
  // attempts whose outcome is unknown so a committed order replays instead of 409 CART_NOT_OPEN.
  let checkoutKey: { of: string; key: string } | null = null;
  const auth = (): Record<string, string> => {
    const t = current();
    return t ? { authorization: `Bearer ${t}` } : {};
  };
  const orderBearer = (id: string) => orderTokenMem.get(id) ?? readOrderTokens()[id] ?? current();
  const trackTokenMem = new Map<string, string>();
  const trackBearer = (id: string) => trackTokenMem.get(id) ?? readTrackTokens()[id];
  const forgetTrack = (id: string) => (err: unknown) => {
    if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
      trackTokenMem.delete(id);
      dropTrackToken(id);
    }
    throw err;
  };
  // a token Core refuses for this order (gone, or not this device's) is dropped quietly
  const forgetRefused = (id: string) => (err: unknown) => {
    if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) {
      orderTokenMem.delete(id);
      dropOrderToken(id);
    }
    throw err;
  };
  let customerTokens: CustomerTokens = readCustomerTokens();
  const rememberCustomer = (phone: string, t: { token: string; expiresAt: string }) => {
    const key = phoneKey(phone);
    customerTokens = {
      last: key,
      byPhone: { ...customerTokens.byPhone, [key]: t },
    };
    writeCustomerTokens(customerTokens);
  };
  const customerHeader = (phone?: string): Record<string, string> => {
    const key = phone ? phoneKey(phone) : customerTokens.last;
    const t = key ? customerTokens.byPhone[key] : undefined;
    return t ? { 'x-vendua-customer': t.token } : {};
  };
  const cartPost = async <T>(path: string, body?: unknown, method = 'POST'): Promise<T> => {
    await ensureSessionNow();
    return apiFetch<T>(co(path), {
      method,
      headers: { ...auth(), ...customerHeader(), 'idempotency-key': idemKey() },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  // Closure-scoped so a destructured `checkout` behaves identically to `api.checkout()`.
  // Kernel 1.12: with a payment method, Core prices its discount/surcharge into the totals.
  const cartGet = (paymentMethod?: string) =>
    apiFetch<{ cart: Cart }>(
      co(`/cart${paymentMethod ? `?paymentMethod=${encodeURIComponent(paymentMethod)}` : ''}`),
      { headers: auth() },
    );

  const clearSessionNow = () => {
    memToken = null;
    memOnly = false;
    forgetStoredToken();
  };

  const ensureSessionNow = async (): Promise<{ cart: Cart }> => {
    // Single-flight: concurrent first mutations share ONE session creation,
    // or each would mint its own cart and only the last token would survive.
    sessionPromise ??= (async () => {
      // An open cart reuses its token; a spent token rotates through POST /session.
      if (current()) {
        try {
          const { cart } = await cartGet();
          if (cart.status === 'open') return { cart };
        } catch (err) {
          // a token Core no longer knows (its cart is gone): start a fresh one quietly
          if (!(err instanceof ApiError) || (err.status !== 401 && err.status !== 404)) throw err;
          clearSessionNow();
        }
      }
      const res = await apiFetch<{ sessionToken: string; cart: Cart }>(co('/session'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
      });
      setToken(res.sessionToken);
      return { cart: res.cart };
    })().finally(() => {
      sessionPromise = null;
    });
    return sessionPromise;
  };

  const addLine = async (
    productId: string,
    qty = 1,
    modifierIds: string[] = [],
    comboSelections?: ComboSelection[],
    modifierQty?: Record<string, number>,
    /** Kernel 1.21 — the line's note ("sem cebola"), ≤ 140 */
    note?: string,
  ): Promise<{ cart: Cart; added?: AddedLine }> => {
    await ensureSessionNow();
    const modifiers = modifierIds
      .filter((id) => (modifierQty?.[id] ?? 1) > 1)
      .map((id) => ({ id, qty: modifierQty![id]! }));
    const res = await apiFetch<{ cart: Cart; added?: AddedLine }>(co('/cart/items'), {
      method: 'POST',
      headers: { ...auth(), 'idempotency-key': idemKey() },
      body: JSON.stringify({
        productId,
        qty,
        modifierIds,
        ...(modifiers.length ? { modifiers } : {}),
        ...(comboSelections?.length ? { comboSelections } : {}),
        ...(note?.trim() ? { note: note.trim().slice(0, ITEM_NOTE_MAX) } : {}),
      }),
    });
    return res.added ? { cart: res.cart, added: res.added } : { cart: res.cart };
  };

  // Kernel 1.3 — SSE over fetch (the token rides as Bearer, which EventSource can't send)
  const orderEvents = async <T>(
    id: string,
    bearer: string | null | undefined,
    since: number,
    onOrder: (order: T) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(co(`/orders/${id}/events`), {
        headers: {
          accept: 'text/event-stream',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(since > 0 ? { 'last-event-id': String(since) } : {}),
        },
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ApiError(0, 'NETWORK_ERROR', 'could not reach the store backend');
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !res.body || !type.includes('text/event-stream')) {
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
      // a Core without the route answers the generic NOT_FOUND — same as "no stream here"
      const code = body?.error?.code;
      throw new ApiError(
        res.status,
        res.ok || !code || code === 'NOT_FOUND' ? 'STREAM_UNAVAILABLE' : code,
        body?.error?.message ?? 'no event stream',
      );
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const at = line.indexOf(':');
          const field = at < 0 ? line : line.slice(0, at);
          const v = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
          if (field === 'event') event = v;
          else if (field === 'data') data.push(v);
        }
        if (event === 'order' && data.length) onOrder(JSON.parse(data.join('\n')) as T);
      }
    }
  };

  return {
    get sessionToken() {
      return current();
    },

    store: () => apiFetch<StoreProfile>(sf('/store')),
    /** Kernel 1.22 — what a table's QR token names (404 TABLE_NOT_FOUND: bad, replaced or
     *  removed). `VenduaProvider` reads `?mesa=` itself; see `useTable` */
    table: (token: string) =>
      apiFetch<{ table: TableInfo }>(sf(`/table?t=${encodeURIComponent(token.slice(0, 400))}`)),
    catalog: () =>
      apiFetch<{ categories: CatalogCategory[]; nextChangeAt?: string }>(sf('/catalog')),
    product: (slug: string) =>
      apiFetch<{ product: ProductDetail }>(sf(`/products/${encodeURIComponent(slug)}`)),
    surfaces: (zoneMatched?: boolean) =>
      apiFetch<SurfacesEnvelope>(
        sf(`/surfaces${zoneMatched === undefined ? '' : `?zoneMatched=${zoneMatched}`}`),
      ),
    zones: () => apiFetch<{ zones: DeliveryZone[] }>(sf('/zones')),
    state: (templates = false) =>
      apiFetch<StateEnvelope>(sf(`/state${templates ? '?templates=1' : ''}`)),
    notifyMe: (body: { subject: 'store' | 'product'; productId?: string; phone: string }) =>
      apiFetch<{ subscribed: true }>(co('/notify-me'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify(body),
      }),
    /** order ids this browser placed (their tracking tokens are kept) — newest first */
    orderIds: (): string[] => {
      const ids = new Set<string>([...Object.keys(readOrderTokens()), ...orderTokenMem.keys()]);
      return [...ids].reverse();
    },
    /** a bairro name, or Kernel 1.2: `{ lat, lng }` from the device / `{ neighborhood }`.
     *  Kernel 1.12: with `paymentMethod` the quote rides the cart session and `totals` come
     *  back priced for that method. Kernel 1.21: `withCart` rides the session without a method
     *  (the sacola's "calcular entrega": Core's totals with that delivery) */
    quote: (
      where:
        | string
        | {
            neighborhood?: string;
            lat?: number;
            lng?: number;
            paymentMethod?: string;
            withCart?: boolean;
          },
    ) => {
      const { withCart, ...body } = typeof where === 'string' ? { neighborhood: where } : where;
      return apiFetch<QuoteResult>(co('/quote'), {
        method: 'POST',
        headers: {
          ...(withCart || body.paymentMethod ? auth() : {}),
          'idempotency-key': idemKey(),
        },
        body: JSON.stringify(body),
      });
    },
    /** Kernel 1.2 — address + zone for a CEP (Core calls the CEP service) */
    cep: (cep: string) =>
      apiFetch<CepResult>(sf(`/cep/${encodeURIComponent(digitsOf(cep).slice(0, 8))}`)),
    /** Kernel 1.15 — roughly where an address is, to open the pin map there (`point: null` =
     *  not found; the map then opens on the store) */
    geocode: (q: {
      cep?: string;
      street?: string;
      number?: string;
      city?: string;
      state?: string;
    }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v?.trim()) params.set(k, v.trim().slice(0, 120));
      return apiFetch<{ point: GeoPoint | null }>(sf(`/geocode?${params}`));
    },
    /** Kernel 1.2 — restock waitlist; answers how many are waiting */
    waitlist: (productId: string, phone: string) =>
      apiFetch<{ subscribed: true; waiting: number }>(sf('/waitlist'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify({ productId, phone }),
      }),
    validateCoupon: (code: string) =>
      apiFetch<CouponCheck>(co('/coupons/validate'), {
        method: 'POST',
        headers: { ...auth(), ...customerHeader(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ code }),
      }),
    applyCoupon: (code: string) =>
      cartPost<{ cart: Cart }>('/cart/coupon', { code }).then((r) => r.cart),
    removeCoupon: () =>
      cartPost<{ cart: Cart }>('/cart/coupon', undefined, 'DELETE').then((r) => r.cart),
    importCart: (items: ImportLine[]) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/import', { items }),
    importShare: (shareCode: string) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/import', { shareCode }),
    shareCart: () => cartPost<{ code: string; expiresAt: string }>('/cart/share'),
    reorder: (orderId: string) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/reorder', {
        orderId,
        ...((orderTokenMem.get(orderId) ?? readOrderTokens()[orderId])
          ? { orderToken: orderTokenMem.get(orderId) ?? readOrderTokens()[orderId] }
          : {}),
      }),
    /** phones this device can read history for (verified or checked out here) */
    customerPhones: (): string[] => {
      customerTokens = readCustomerTokens();
      const phones = Object.keys(customerTokens.byPhone);
      const last = customerTokens.last;
      return last && phones.includes(last) ? [last, ...phones.filter((p) => p !== last)] : phones;
    },
    verifyCustomer: async (phone: string, orderNumber: number) => {
      const r = await apiFetch<{ customerToken: string; expiresAt: string; phone: string }>(
        co('/customer/session'),
        {
          method: 'POST',
          headers: { 'idempotency-key': idemKey() },
          body: JSON.stringify({ phone, orderNumber }),
        },
      );
      rememberCustomer(r.phone, { token: r.customerToken, expiresAt: r.expiresAt });
      return r.phone;
    },
    forgetCustomer: (phone?: string) => {
      const next = { ...customerTokens.byPhone };
      if (phone) delete next[phoneKey(phone)];
      customerTokens = phone ? { byPhone: next } : { byPhone: {} };
      writeCustomerTokens(customerTokens);
    },
    customerOrders: (phone?: string) =>
      apiFetch<{ phone: string; orders: OrderSummary[] }>(
        co(`/customer/orders${phone ? `?phone=${phoneKey(phone)}` : ''}`),
        { headers: customerHeader(phone) },
      ),
    loyalty: (phone?: string) =>
      apiFetch<{ phone: string; loyalty: LoyaltyCard }>(
        co(`/customer/loyalty${phone ? `?phone=${phoneKey(phone)}` : ''}`),
        { headers: customerHeader(phone) },
      ),

    clearSession: clearSessionNow,
    ensureSession: ensureSessionNow,
    cart: cartGet,
    async addItem(
      productId: string,
      qty = 1,
      modifierIds: string[] = [],
      comboSelections?: ComboSelection[],
      /** Kernel 1.12 — units per option id (absent or 1 = one unit) */
      modifierQty?: Record<string, number>,
      /** Kernel 1.21 — the line's note */
      note?: string,
    ): Promise<Cart> {
      return (await addLine(productId, qty, modifierIds, comboSelections, modifierQty, note)).cart;
    },
    /** Kernel 1.14 — `addItem` with Core's `added` (what this call added, priced by Core) */
    addLine,
    /** Kernel 1.14 — Core's price for a configured line, without adding it (no session) */
    quoteLine: (
      slug: string,
      line: { qty: number } & LinePicks,
      signal?: AbortSignal,
    ): Promise<LineQuote> => {
      const q = [`qty=${encodeURIComponent(String(line.qty))}`];
      if (line.modifiers?.length)
        q.push(
          `modifiers=${line.modifiers.map((m) => `${encodeURIComponent(m.id)}:${m.qty ?? 1}`).join(',')}`,
        );
      if (line.comboSelections?.length)
        q.push(
          `combo=${line.comboSelections
            .map(
              (c) => `${encodeURIComponent(c.slotId)}:${encodeURIComponent(c.productId)}:${c.qty}`,
            )
            .join(',')}`,
        );
      return apiFetch<LineQuote>(
        sf(`/products/${encodeURIComponent(slug)}/quote?${q.join('&')}`),
        signal ? { signal } : undefined,
      );
    },
    updateItem: (itemId: string, qty: number) =>
      apiFetch<{ cart: Cart }>(co(`/cart/items/${itemId}`), {
        method: 'PATCH',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ qty }),
      }).then((r) => r.cart),
    /** Kernel 1.21 — a line's note ('' clears it); a line that then matches another (same
     *  product, options and note) folds into it */
    setItemNote: (itemId: string, note: string) =>
      apiFetch<{ cart: Cart }>(co(`/cart/items/${itemId}`), {
        method: 'PATCH',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ note: note.trim().slice(0, ITEM_NOTE_MAX) }),
      }).then((r) => r.cart),
    /** Kernel 1.21 — "me lembre pelo WhatsApp": consent to one reminder about this bag, from
     *  the store's number (only when `StoreProfile.cartReminder`). 409 REMINDER_OFF, 422
     *  INVALID_PHONE */
    cartReminder: (input: { phone: string; name?: string }) =>
      cartPost<{ reminder: { on: boolean } }>('/cart/reminder', {
        phone: input.phone,
        ...(input.name?.trim() ? { name: input.name.trim().slice(0, 80) } : {}),
      }).then((r) => r.reminder),
    /** Kernel 1.21 — withdraws that consent */
    cancelCartReminder: () =>
      cartPost<{ reminder: { on: boolean } }>('/cart/reminder', undefined, 'DELETE').then(
        (r) => r.reminder,
      ),
    removeItem: (itemId: string) =>
      apiFetch<{ cart: Cart }>(co(`/cart/items/${itemId}`), {
        method: 'DELETE',
        headers: { ...auth(), 'idempotency-key': idemKey() },
      }).then((r) => r.cart),
    /** Kernel 1.22: `{ mode: 'dine_in' }` at a table (no fee, no minimum in the totals) */
    setDelivery: (delivery: { mode: 'pickup' | 'delivery' | 'dine_in' } & DeliveryAddress) => {
      // Bind the token at call time — a queued write must target the cart it was
      // issued for, not a session rotated by a completed checkout.
      const bound = current();
      const bearer = bound ? { authorization: `Bearer ${bound}` } : {};
      const p = deliveryQueue.then(() =>
        apiFetch<{ cart: Cart }>(co('/cart/delivery'), {
          method: 'POST',
          headers: { ...bearer, 'idempotency-key': idemKey() },
          body: JSON.stringify(delivery),
        }).then((r) => r.cart),
      );
      // A failed write must not wedge the queue — the next call still runs.
      deliveryQueue = p.catch(() => {});
      return p;
    },
    async checkout(input: CheckoutInput): Promise<Order> {
      // the cart this order closes: its token is the order's tracking credential
      const sent = current();
      const body = JSON.stringify(input);
      const of = hashOf(`${sent ?? ''}\n${body}`);
      if (checkoutKey?.of !== of) {
        const kept = readCheckoutKey();
        checkoutKey = kept?.of === of ? kept : { of, key: idemKey() };
      }
      const attempt = checkoutKey;
      storeCheckoutKey(attempt);
      // the outcome is known: only this attempt's own key leaves storage
      const settle = () => {
        if (checkoutKey === attempt) checkoutKey = null;
        if (readCheckoutKey()?.key === attempt.key) storeCheckoutKey(null);
      };
      let r: {
        order: Order;
        /** null for a table's order (no phone): nothing to keep */
        customerToken?: string | null;
        customerTokenExpiresAt?: string | null;
      };
      try {
        r = await apiFetch<typeof r>(co('/checkout'), {
          method: 'POST',
          // a verified token for this phone lets Core honour its personal (loyalty) coupons
          headers: {
            ...(sent ? { authorization: `Bearer ${sent}` } : {}),
            // a table order carries no phone: no customer token rides with it
            ...(input.customer.phone ? customerHeader(input.customer.phone) : {}),
            'idempotency-key': attempt.key,
          },
          body,
        });
      } catch (err) {
        // a definite refusal (PRICES_CHANGED is stored under the key) needs a new key to retry
        const unknown =
          err instanceof ApiError &&
          (err.status === 0 || err.status >= 500 || err.code === 'IDEMPOTENCY_IN_PROGRESS');
        if (!unknown) settle();
        throw err;
      }
      settle();
      // this device placed an order for the phone — it may read the phone's history
      if (r.customerToken && r.customerTokenExpiresAt && input.customer.phone)
        rememberCustomer(input.customer.phone, {
          token: r.customerToken,
          expiresAt: r.customerTokenExpiresAt,
        });
      // The order's token is its tracking credential — keep it before rotation swaps the session.
      if (sent) {
        orderTokenMem.set(r.order.id, sent);
        storeOrderToken(r.order.id, sent);
      }
      // Rotate now so the next `cart()` reads a fresh cart; a rotation failure must not mask a placed order.
      try {
        clearSessionNow();
        await ensureSessionNow();
      } catch {
        /* order placed; session heals lazily */
      }
      return r.order;
    },
    /** Kernel 1.18 — the storefront chat of this cart session (needs one: Bearer, like the
     *  cart). The Vendedor answers asynchronously and edits this session's cart. */
    chat: () => apiFetch<StoreChat>(co('/chat'), { headers: auth() }),
    /** Kernel 1.18 — say something in the chat (1–1000 characters); starts the cart session when
     *  there is none. Pass the same `idempotencyKey` to retry a send that may have landed. */
    sendChat: async (text: string, opts: { idempotencyKey?: string } = {}) => {
      await ensureSessionNow();
      return apiFetch<StoreChat>(co('/chat'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': opts.idempotencyKey ?? idemKey() },
        body: JSON.stringify({ text }),
      });
    },
    order: (id: string) => {
      const bearer = orderBearer(id);
      return apiFetch<{ order: Order }>(co(`/orders/${id}`), {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }).then((r) => r.order, forgetRefused(id));
    },
    /** Kernel 1.7 — start/resume the order's online payment and sync it with the
     *  provider. Same order credential as `order()`; 409 PAYMENT_NOT_REQUIRED, 503
     *  PAYMENT_UNAVAILABLE. Kernel 1.19: `cardForm` asks for the in-page card form
     *  (`next.kind === 'card'`) instead of a hosted checkout. Kernel 1.20: `deviceId` is Mercado
     *  Pago's device fingerprint, for the Pix Core creates in this call. */
    payOrder: (
      id: string,
      opts?: { cardForm?: boolean; challengeDone?: boolean; deviceId?: string | null },
    ) => {
      const bearer = orderBearer(id);
      const deviceId = opts?.deviceId && DEVICE_ID_RE.test(opts.deviceId) ? opts.deviceId : null;
      return apiFetch<{ order: Order; next: PaymentNext }>(co(`/orders/${id}/pay`), {
        method: 'POST',
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          'idempotency-key': idemKey(),
        },
        ...(opts?.cardForm || deviceId
          ? {
              body: JSON.stringify({
                ...(opts?.cardForm ? { card: 'form' } : {}),
                ...(opts?.cardForm && opts.challengeDone ? { challenge: 'complete' } : {}),
                ...(deviceId ? { deviceId } : {}),
              }),
            }
          : {}),
      }).then((r) => ({ ...r, next: safeNext(r.next) }));
    },
    /** Kernel 1.19 — pay a card_online order with the card form's token. 409
     *  PAYMENT_IN_PROGRESS (an earlier submit is unresolved), 409 PAYMENT_NOT_REQUIRED, 422
     *  INVALID_PAYMENT, 503 PAYMENT_UNAVAILABLE. */
    payCard: (id: string, input: CardPaymentInput) => {
      const bearer = orderBearer(id);
      return apiFetch<{ order: Order; next: PaymentNext }>(co(`/orders/${id}/card`), {
        method: 'POST',
        headers: {
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          'idempotency-key': idemKey(),
        },
        body: JSON.stringify(input),
      }).then((r) => ({ ...r, next: safeNext(r.next) }));
    },
    /** Kernel 1.3 — SSE over fetch (the session token rides as Bearer, which
     *  EventSource can't send). Calls `onOrder` per `order` event; resolves when
     *  Core closes the stream (terminal state or lifetime), throws
     *  STREAM_UNAVAILABLE when there's no event stream to read. */
    orderStream: (
      id: string,
      since: number,
      onOrder: (order: Order) => void,
      signal?: AbortSignal,
    ): Promise<void> => orderEvents(id, orderBearer(id), since, onOrder, signal),
    /** Kernel 1.2 — long poll: resolves when the order moves past `since` or after `waitS` */
    orderWait: (id: string, since: number, waitS = 25, signal?: AbortSignal) => {
      const bearer = orderBearer(id);
      return apiFetch<{ order: Order; changed: boolean }>(
        co(`/orders/${id}?since=${since}&wait=${waitS}`),
        {
          headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
          ...(signal ? { signal } : {}),
        },
      );
    },
    /** Kernel 1.21 — keep an order's status-only link credential (`?t=` of `/pedido/:id`, which
     *  `VenduaProvider` reads and strips); a malformed one is ignored */
    addTrackingToken: (orderId: string, token: string): boolean => {
      if (!/^[0-9a-f-]{36}$/.test(orderId) || !TRACK_TOKEN_RE.test(token)) return false;
      trackTokenMem.set(orderId, token);
      storeTrackToken(orderId, token);
      return true;
    },
    /** Kernel 1.21 — true when this device reads the order only through its tracking link (it
     *  holds no order token for it): `useOrder` then reads `orderStatus` */
    tracksOnly: (orderId: string): boolean =>
      !orderTokenMem.has(orderId) &&
      !(orderId in readOrderTokens()) &&
      trackBearer(orderId) !== undefined,
    /** Kernel 1.21 — the order through its tracking link: status and items, nothing personal */
    orderStatus: (id: string) =>
      apiFetch<{ order: OrderTracking }>(co(`/orders/${id}`), {
        headers: { authorization: `Bearer ${trackBearer(id) ?? ''}` },
      }).then((r) => r.order, forgetTrack(id)),
    /** Kernel 1.21 — `orderWait` through the tracking link */
    orderStatusWait: (id: string, since: number, waitS = 25, signal?: AbortSignal) =>
      apiFetch<{ order: OrderTracking; changed: boolean }>(
        co(`/orders/${id}?since=${since}&wait=${waitS}`),
        {
          headers: { authorization: `Bearer ${trackBearer(id) ?? ''}` },
          ...(signal ? { signal } : {}),
        },
      ),
    /** Kernel 1.21 — `orderStream` through the tracking link */
    orderStatusStream: (
      id: string,
      since: number,
      onStatus: (order: OrderTracking) => void,
      signal?: AbortSignal,
    ): Promise<void> => orderEvents(id, trackBearer(id), since, onStatus, signal),
  };
}

/** Error codes emitted by Core — kept in sync with `HttpError` call sites in
 *  packages/core (storefronts may switch on these; never invent others). */
export const ERROR_CODES = [
  'TENANT_NOT_FOUND',
  'TENANT_SUSPENDED',
  'SESSION_REQUIRED',
  'CART_NOT_FOUND',
  'CART_NOT_OPEN',
  'PRODUCT_NOT_FOUND',
  'SOLD_OUT',
  'MODIFIER_SOLD_OUT',
  'INVALID_MODIFIER',
  'MODIFIER_REQUIRED',
  'MODIFIER_LIMIT',
  'INVALID_QTY',
  'EMPTY_CART',
  'STORE_CLOSED',
  'STORE_PAUSED',
  'ORDER_MIN_NOT_MET',
  'DELIVERY_UNAVAILABLE',
  'PICKUP_UNAVAILABLE',
  'OUT_OF_ZONE',
  'INVALID_DELIVERY',
  'INVALID_CUSTOMER',
  'INVALID_PAYMENT',
  // Kernel 1.17 — cash change below the total (`details.minCents`) or above Core's cap
  'INVALID_CHANGE',
  'ORDER_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'INVALID_ORDER_TRANSITION',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_IN_PROGRESS',
  // an Idempotency-Key replayed with a different request
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  // Kernel-side: Core (or a proxy) served no event stream — live orders fall back to the long poll
  'STREAM_UNAVAILABLE',
  // storefront platform (Phase 1b)
  'INVALID_NOTIFY',
  'INVALID_PAGE',
  'INVALID_TEMPLATE',
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_VERSION_CONFLICT',
  'INVALID_TOKENS',
  'INVALID_MANIFEST',
  'MIGRATION_NOT_FOUND',
  // commerce completeness (Phase 2 — Kernel 1.2)
  'OUT_OF_STOCK',
  'INVALID_COMBO',
  'COMBO_SLOT_COUNT',
  'COMBO_ITEM_LIMIT',
  'COMBO_ITEM_SOLD_OUT',
  'SCHEDULE_REQUIRED',
  'INVALID_SCHEDULE',
  'PAYMENT_NOT_ALLOWED',
  // Kernel 1.4 — the store turned this method off in its admin
  'PAYMENT_METHOD_UNAVAILABLE',
  // Kernel 1.7 — online payments (Mercado Pago)
  'PAYMENT_NOT_REQUIRED',
  'PAYMENT_UNAVAILABLE',
  'PAYMENT_ONLINE',
  // Kernel 1.19 — an earlier card submit hasn't resolved yet
  'PAYMENT_IN_PROGRESS',
  'INVALID_NOTES',
  'INVALID_COUPON',
  'COUPON_NOT_FOUND',
  'COUPON_EXPIRED',
  'COUPON_NOT_STARTED',
  'COUPON_EXHAUSTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_NOT_YOURS',
  'COUPON_ALREADY_USED',
  'COUPON_FIRST_ORDER_ONLY',
  // checkout refreshed stale line prices to the live catalog — re-read the cart
  'PRICES_CHANGED',
  'COUPON_EXISTS',
  'INVALID_IMPORT',
  'SHARE_NOT_FOUND',
  'CUSTOMER_REQUIRED',
  'CUSTOMER_MISMATCH',
  'CUSTOMER_NOT_VERIFIED',
  'INVALID_CEP',
  'CEP_NOT_FOUND',
  'CEP_UNAVAILABLE',
  'INVALID_PIX',
  'ZONE_NOT_FOUND',
  // control-plane (staff) API codes — leads module
  'INVALID_STATE',
  'INVALID_LEAD',
  'INVALID_SORT',
  'LEAD_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'MESSAGE_NOT_FOUND',
  'TASK_NOT_FOUND',
  'RUN_NOT_FOUND',
  'BRIEF_NOT_FOUND',
  'UNKNOWN_TOOL',
  'INVALID_AGENT_GOAL',
  'LEAD_SUPPRESSED',
  'LEAD_COST_CAP',
  'THREAD_PAUSED',
  'PARAMS_TOO_LARGE',
  'WAKEUP_NOT_FOUND',
  // memory v2 (agent memory items + lead facts)
  'MEMORY_ITEM_NOT_FOUND',
  'MEMORY_CAP_PINNED',
  'FACT_NOT_FOUND',
  'SOURCE_RUN_NOT_FOUND',
  'NOTE_LIMIT',
  // meetings module (booking surface + control meetings API)
  'MEETING_NOT_FOUND',
  'SLOT_TAKEN',
  'CANCEL_WINDOW',
  'LEAD_ARCHIVED',
  'BAD_START',
  'BAD_END',
  'BAD_TRANSITION',
  'BAD_REQUEST',
  'NOT_FOUND',
  'INTERNAL',
  'EMAIL_PROVIDER_UNAVAILABLE',
  'EMAIL_FETCH_FAILED',
  // Kernel 1.18 — the store has no storefront chat (off, or turned off since the page loaded)
  'CHAT_UNAVAILABLE',
  // Kernel 1.21 — the bag reminder: the store doesn't offer it; the phone isn't one
  'REMINDER_OFF',
  'INVALID_PHONE',
  // Kernel 1.22 — ordering from a table's QR code: the token is bad or replaced; the store turned
  // QR orders off; five of this table's orders still wait for the staff; the comanda changed
  // under the order (try again)
  'TABLE_NOT_FOUND',
  'TABLE_ORDERS_OFF',
  'TABLE_ORDERS_PENDING',
  'TABLE_BUSY',
  // Kernel 1.23 — a bag holds at most 50 lines; an order over Core's ceiling (R$ 10 mi)
  'CART_FULL',
  'ORDER_TOO_LARGE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type VenduaApi = ReturnType<typeof createApi>;

function resolveUrl(url: string, base: string): string | null {
  try {
    // typed without the DOM lib: Core typechecks this file too
    const here = (globalThis as { location?: { href?: string } }).location?.href;
    return new URL(url, new URL(base || '/', here)).href;
  } catch {
    return null;
  }
}

function isHttps(url: string) {
  try {
    const u = new URL(url);
    // dev stores run on http://<slug>.localhost, where the fake provider sends shoppers back
    const local = /(^|\.)localhost$|^127\.0\.0\.1$/.test(u.hostname);
    return u.protocol === 'https:' || (local && u.protocol === 'http:');
  } catch {
    return false;
  }
}
