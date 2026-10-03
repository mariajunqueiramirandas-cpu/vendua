import type { PageTemplate, SectionInstance, StorefrontTokens } from '@vendua/templates';

// Typed client for /admin/v1 — cookie session, x-vendua-admin CSRF marker, and an
// Idempotency-Key minted per call (a retried mutation reuses its own key).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get field(): string | undefined {
    return typeof this.details?.field === 'string' ? this.details.field : undefined;
  }
}

type Init = RequestInit & { idem?: string; raw?: boolean; timeoutMs?: number };

// A dropped connection or a timeout leaves a write's outcome unknown: Core may have applied it.
// Inside one mutation (lib/query.ts `useMutation`), its retries resend the same request with the
// same key, so Core replays the first result instead of applying it twice. A new tap is a new
// mutation and a new key: it must not be answered with a stale replay.
let scope: object | null = null;
const scopedKeys = new WeakMap<object, Map<string, string>>();
export function withRetryScope<T>(owner: object, run: () => T): T {
  const prev = scope;
  scope = owner;
  try {
    return run();
  } finally {
    scope = prev;
  }
}

// a phone on a weak signal can hang a request for minutes; fail it so retry/offline UI takes over
const timeoutFor = (mutating: boolean, raw: boolean) => (raw ? 60_000 : mutating ? 30_000 : 20_000);

async function req<T>(path: string, init: Init = {}): Promise<T> {
  const { idem, raw, timeoutMs, ...rest } = init;
  const method = rest.method ?? 'GET';
  const mutating = method !== 'GET';
  // read before the first await: the scope is only set while the mutationFn starts
  let key = idem;
  if (mutating && !key) {
    let keys = scope ? scopedKeys.get(scope) : undefined;
    if (scope && !keys) scopedKeys.set(scope, (keys = new Map()));
    const print = `${method} ${path} ${typeof rest.body === 'string' ? rest.body : ''}`;
    key = keys?.get(print) ?? crypto.randomUUID();
    keys?.set(print, key);
  }

  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      ctl.abort();
    },
    timeoutMs ?? timeoutFor(mutating, !!raw),
  );
  const caller = rest.signal;
  caller?.addEventListener('abort', () => ctl.abort(), { once: true });
  const lost = () => {
    if (caller?.aborted && !timedOut) return caller.reason as Error;
    return timedOut
      ? new ApiError(0, 'TIMEOUT', 'a conexão está lenta')
      : new ApiError(0, 'NETWORK_ERROR', 'sem conexão');
  };
  try {
    let res: Response;
    try {
      res = await fetch(`/admin/v1${path}`, {
        credentials: 'same-origin',
        ...rest,
        signal: ctl.signal,
        headers: {
          ...(raw ? {} : { 'content-type': 'application/json' }),
          'x-vendua-admin': '1',
          ...(key ? { 'idempotency-key': key } : {}),
          ...rest.headers,
        },
      });
    } catch {
      throw lost();
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      const err = new ApiError(
        res.status,
        data.error?.code ?? 'ERROR',
        data.error?.message ?? res.statusText,
        data.error?.details,
      );
      // not for /session itself: App re-checks the session on this event, so a 401 there would loop
      if (res.status === 401 && path !== '/session')
        window.dispatchEvent(new CustomEvent('vendua:unauthenticated'));
      throw err;
    }
    const ct = res.headers.get('content-type') ?? '';
    try {
      return (await (ct.includes('json') ? res.json() : res.text())) as T;
    } catch {
      // the connection died mid-body: Core answered, but we can't know what
      throw lost();
    }
  } finally {
    clearTimeout(timer);
  }
}

const get = <T>(p: string) => req<T>(p);
const send = <T>(method: string, p: string, body?: unknown) =>
  req<T>(p, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

// ── types ───────────────────────────────────────────────────────────────────

export type Role = 'owner' | 'manager' | 'attendant';
export type OrderState =
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded';
export type StoreStatus = 'open' | 'closed' | 'paused';
export type PayMethod = 'pix' | 'card_online' | 'card_on_delivery' | 'cash' | 'meal_voucher';
/** signed: negative = discount, positive = surcharge; Core applies it to subtotal − coupon */
export interface PaymentAdjustment {
  percentBps?: number;
  fixedCents?: number;
}
export type PaymentAdjustments = Partial<Record<PayMethod, PaymentAdjustment>>;
export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'refunded'
  | 'partially_refunded'
  | 'charged_back'
  | 'in_mediation';
export type MpStatus = 'not_connected' | 'connected' | 'expiring' | 'disconnected' | 'restricted';

export type PlanFeature =
  'customDomain' | 'customSite' | 'kds' | 'printing' | 'loyalty' | 'vendedor';
export type PlanFeatures = Record<PlanFeature, boolean>;

export interface Plan {
  id: string;
  name: string;
  /** null for a legacy/pilot plan with no catalog price */
  priceCents: number | null;
  feeBps: number;
  features: PlanFeatures;
  /** a new store on this plan starts with these free days, no card (0 = none; ADR 0025) */
  trialDays: number;
  /** the one plan the admin points to first (exactly one public plan has it) */
  recommended: boolean;
  /** Duá's conversations a month (0 without it) */
  aiConversations: number;
  /** …and during the free trial */
  aiTrialConversations: number;
  /** a store can pick it now; a closed one is shown, never picked (PLAN_UNAVAILABLE) */
  available: boolean;
}

export interface StoreRef {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface Session {
  user: {
    id: string;
    name: string;
    phone: string;
    role: Role;
    email: string | null;
    prefs: {
      sound?: boolean;
      volume?: number;
      push?: boolean;
      /** push when an online payment lands (default on) */
      pushPayments?: boolean;
      /** WhatsApp when an order waits past the accept target and no alert reached a device */
      whatsappAlerts?: boolean;
      emailInvoices?: boolean;
      theme?: string;
      dismissedHints?: string[];
    };
  };
  store: { id: string; slug: string; name: string; logoUrl: string | null; url: string };
  stores: StoreRef[];
  push: { publicKey: string | null };
  support: { whatsapp: string | null };
  /** `features` is what's open right now: in the plan AND paid for (or in its trial) */
  plan: { id: string; name: string; features: PlanFeatures };
  /** the nav: Vendedor in the phone bar once on, its "precisa de você" count as the badge */
  vendedor?: { enabled: boolean; name: string; waiting: number };
}

export interface Order {
  id: string;
  number: number;
  state: OrderState;
  customer: { name: string; phone: string };
  delivery: {
    mode: 'pickup' | 'delivery';
    neighborhood?: string | null;
    address?: string | null;
    addressParts?: Record<string, string | null>;
    zoneName?: string | null;
    distanceKm?: number | null;
    feeCents?: number;
    etaMin?: number | null;
    etaMax?: number | null;
    promisedFrom?: string | null;
    promisedTo?: string | null;
    lat?: number;
    lng?: number;
  };
  payment: {
    /** 'sandbox' (offline methods) · 'mercadopago' | 'fake' (online) — branch on `online` */
    provider: string;
    method: PayMethod;
    status: PaymentStatus;
    /** Mercado Pago handles it (webhook-confirmed); false = the merchant confirms by hand */
    online?: boolean;
    paidAt?: string | null;
    confirmedBy?: string | null;
    refundedCents?: number;
    pix?: {
      key?: string;
      keyType?: string;
      beneficiary?: string;
      copyPaste: string;
      expiresAt?: string | null;
    } | null;
    redirectUrl?: string | null;
  };
  items: {
    productId: string | null;
    slug: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    modifiers: { name: string; priceDeltaCents: number; qty?: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    lineTotalCents: number;
  }[];
  notes: string | null;
  scheduledFor: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** the payment method's discount (negative) or surcharge; 0 when none */
  paymentAdjustmentCents?: number;
  coupon: { code: string } | null;
  totalCents: number;
  placedAt: string;
  updatedAt: string;
  version: number;
  timeline: {
    at: string;
    from: string | null;
    to: OrderState;
    actor: string;
    meta: Record<string, unknown>;
  }[];
}

export interface OrderPayment {
  id: string;
  kind: 'pix' | 'card';
  status:
    | 'creating'
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'expired'
    | 'refunded'
    | 'partially_refunded'
    | 'charged_back'
    | 'in_mediation';
  amountCents: number;
  refundedCents: number;
  /** Core's figure: amount − refunded − refunds still pending (the refund sheet's cap) */
  refundableCents: number;
  /** set when a person has to look at this payment */
  review?: PaymentReview | null;
  providerFeeCents: number | null;
  netCents: number | null;
  approvedAt: string | null;
  createdAt: string;
  refunds: {
    amountCents: number;
    status: 'pending' | 'approved' | 'rejected';
    reason: string | null;
    createdAt: string;
  }[];
}

export interface OrderRow {
  id: string;
  number: number;
  state: OrderState;
  name: string;
  phone: string | null;
  totalCents: number;
  placedAt: string;
  mode: 'pickup' | 'delivery';
  neighborhood: string | null;
  paymentMethod: PayMethod;
  paymentStatus: string;
  itemCount: number;
  scheduledFor: string | null;
}

export interface Board {
  orders: Order[];
  scheduledUpcoming: number;
  acceptTargetMinutes: number;
  now: string;
}

/** the kitchen screen (Cozinha): what's being made now — no prices, first names only */
export interface Kitchen {
  tickets: KitchenTicket[];
  stations: KitchenStation[];
  categories: { id: string; name: string }[];
  stats: KitchenStats;
  prepDefaultMinutes: number;
  acceptTargetMinutes: number;
  now: string;
}
export type KitchenState = 'placed' | 'confirmed' | 'preparing' | 'ready';
export interface KitchenTicket {
  id: string;
  number: number;
  state: KitchenState;
  mode: 'pickup' | 'delivery';
  /** the customer's first name */
  name: string;
  notes: string | null;
  scheduledFor: string | null;
  placedAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  /** chosen on "aceitar", else the store's usual */
  prepMinutes: number;
  rush: boolean;
  paid: boolean;
  payMethod: PayMethod;
  version: number;
  items: KitchenItem[];
}
export interface KitchenItem {
  id: string;
  name: string;
  qty: number;
  modifiers: { name: string; qty: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  categoryId: string | null;
  stationId: string | null;
  doneAt: string | null;
}
export interface KitchenStation {
  id: string;
  name: string;
  categoryIds: string[];
}
export interface KitchenStats {
  readyToday: number;
  avgMakeSeconds: number | null;
  /** 0..1 */
  onTimeRate: number | null;
  readyLastHour: number;
  /** readies per hour of today, index = hour (store time) */
  hourly: number[];
}

export interface Product {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** "de" price, display-only strike-through; always above priceCents */
  compareAtPriceCents: number | null;
  status: 'active' | 'sold_out' | 'archived';
  /** Core's live status: stock 0 reads sold out; archived stays archived */
  liveStatus: 'active' | 'sold_out' | 'archived';
  kind: 'simple' | 'combo';
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  /** Core's low-stock call, the storefront's own */
  lowStock: boolean;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  sort: number;
  soldOutUntil: string | null;
  availabilitySchedule?: AvailabilitySchedule | null;
  /** false while outside its schedule */
  availableNow?: boolean;
  /** a lower price on some days and hours; it applies only while below priceCents */
  promoSchedule?: PromoSchedule | null;
  /** true while one of the promotion's windows holds */
  promoNow?: boolean;
  tags: string[];
  imageUrl: string | null;
  dominant: string | null;
  mediaCount: number;
  groupCount: number;
  waiting: number;
}

export interface AvailabilitySchedule {
  /** days: 0 = domingo … 6 = sábado; no from/to = the whole day */
  windows: { days: number[]; from?: string; to?: string }[];
  /** outside the windows: listed as unavailable, or not listed at all */
  outside: 'unavailable' | 'hidden';
}

export interface PromoSchedule {
  priceCents: number;
  /** the same windows as AvailabilitySchedule, in store time */
  windows: AvailabilitySchedule['windows'];
}

export type PricingRule = 'sum' | 'average' | 'most_expensive';

export interface OptionItem {
  id?: string;
  name: string;
  priceDeltaCents: number;
  status: 'active' | 'sold_out';
  /** how many of this one a shopper may take (1..20; 1 = a toggle) */
  maxQty?: number;
  description?: string | null;
  imageUrl?: string | null;
}

export interface OptionGroup {
  id?: string;
  name: string;
  required?: boolean;
  minSelect: number;
  /** counts units: up to the sum of the options' maxQty */
  maxSelect: number;
  pricingRule?: PricingRule;
  options: OptionItem[];
}

export interface KitSlot {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  qtyPerItem: number;
  items: { productId: string; name?: string; priceDeltaCents: number; imageUrl?: string | null }[];
}

/** What the shopper sees now: Core's storefront summary of the product, schedules in words. */
export interface StorefrontPreview {
  status: 'active' | 'sold_out' | 'archived';
  basePriceCents: number;
  compareAtPriceCents: number | null;
  fromPriceCents: number | null;
  promoLabel: string | null;
  availabilityLabel: string | null;
  lowStock: boolean;
  /** the availability schedule in words, whether or not it holds now */
  availabilityScheduleLabel: string | null;
  /** the promotion's days and hours in words, whether or not it applies now */
  promoScheduleLabel: string | null;
}

export interface ProductDetail extends Product {
  groups: OptionGroup[];
  gallery: { url: string; alt: string | null; width: number | null; height: number | null }[];
  comboSlots: KitSlot[];
  sales30: { qty: number; revenueCents: number };
  storefront: StorefrontPreview;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort: number;
  products: Product[];
}

export interface Window_ {
  days: number[];
  open: string;
  close: string;
}
export interface SpecialDay {
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
  label?: string;
}
export interface Zone {
  id: string;
  name: string;
  kind: 'neighborhood' | 'radius' | 'polygon';
  neighborhoods: string[];
  /** [lat, lng] vertices, ring not closed; only for kind 'polygon' */
  polygon: [number, number][] | null;
  feeCents: number;
  minOrderCents: number;
  etaMin: number;
  etaMax: number;
  active: boolean;
  maxDistanceKm: number | null;
  feePerKmCents: number;
  freeDeliveryOverCents: number | null;
}

export interface StoreView {
  url: string;
  profile: {
    name: string;
    tagline: string | null;
    description: string | null;
    /** 55 + DDD + number */
    whatsapp: string | null;
    /** the bare handle, no @ */
    instagram: string | null;
    email: string | null;
    city: string | null;
    address: string | null;
    logoUrl: string | null;
  };
  status: {
    status: StoreStatus;
    resumesAt: string | null;
    /** when the status may flip by the clock (opens, closes, a pause ends) */
    changesAt: string | null;
    override: 'paused' | 'closed' | null;
    pauseMessage: string | null;
    closedMessage: string | null;
    /** a self-serve store waits for its first plan payment; it can't be opened until then */
    billingHold: boolean;
  };
  hours: { timezone: string; windows: Window_[] };
  specialDays: SpecialDay[];
  operations: {
    prepTimeMinutes: number;
    acceptTargetMinutes: number;
    minOrderCents: number;
    pickupEnabled: boolean;
    pickupAddress: string | null;
    pickupInstructions: string | null;
    deliveryEnabled: boolean;
    demand: 'normal' | 'high';
  };
  location: { latitude: number; longitude: number } | null;
  /** ADR 0024: an address with a pin is priced by road distance from `location` */
  distancePricing: {
    enabled: boolean;
    baseFeeCents: number;
    feePerKmCents: number;
    minFeeCents: number;
    maxKm: number;
    freeOverCents: number | null;
  };
  preorder: {
    paymentMethods: PayMethod[];
    maxDays: number;
    /** while closed, a cart made only of encomendas still goes through */
    whileClosed: boolean;
  };
  zones: Zone[];
}

export interface Home {
  greetingName: string;
  timezone: string;
  status: {
    status: StoreStatus;
    resumesAt: string | null;
    /** when the status may flip by the clock (opens, closes, a pause ends) */
    changesAt: string | null;
    override: string | null;
  };
  hours: { timezone: string; windows: Window_[] };
  specialDays: SpecialDay[];
  today: {
    salesCents: number;
    orders: number;
    avgTicketCents: number;
    lastWeekSalesCents: number;
    lastWeekOrders: number;
  };
  spark: { date: string; salesCents: number }[];
  waiting: { n: number; late: number; oldest: string | null };
  inProgress: number;
  attention: {
    /** orders_waiting | closed_with_orders | pix_to_confirm | low_stock | waitlist |
     *  alerts_failing | mp_expiring | mp_disconnected | mp_restricted | billing_pending |
     *  billing_past_due | invoice_open | trial_ending | incident */
    kind: string;
    count: number;
    title: string;
    detail?: string;
    href: string;
    productId?: string;
  }[];
  checklist: ChecklistItem[];
  /** where the store's setup stands (the onboarding at /bem-vindo) */
  onboarding: { finished: boolean; dismissed: boolean; from: 'signup' | null; step: string | null };
  totalOrders: number;
  feed: {
    at: string;
    to: OrderState;
    from: OrderState | null;
    actor: string;
    orderId: string;
    number: number;
    name: string;
    totalCents: number;
  }[];
  live: { visitors: number; carts: number };
  best: { productId: string | null; name: string; qty: number; imageUrl: string | null }[];
  busiest: { hour: number; orders: number } | null;
}

export interface Customer {
  phone: string;
  name: string;
  orders: number;
  spentCents: number;
  firstAt: string;
  lastAt: string;
}

export interface CustomerDetail {
  customer: Customer & { cancelled: number };
  orders: OrderRow[];
  favorites: { name: string; qty: number }[];
  loyalty: {
    enabled: boolean;
    stampsRequired: number;
    stamps: number;
    rewardLabel: string;
    rewards: { code: string; label: string; expiresAt: string | null }[];
  };
  lastAddress: { address: string | null; neighborhood: string | null } | null;
}

export interface Coupon {
  id: string;
  code: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  /** the merchant's own words; null = none */
  label: string | null;
  /** what the shopper reads (Core's label rule) */
  displayLabel: string;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perPhoneLimit: number | null;
  firstOrderOnly: boolean;
  active: boolean;
  source: string;
  createdAt: string;
  redemptions: number;
  revenueCents: number;
  discountCents: number;
}

export interface LoyaltyProgram {
  stampsRequired: number;
  minOrderCents: number;
  reward: {
    kind: 'percent' | 'fixed' | 'free_delivery';
    value: number;
    /** only words the merchant typed; Core names the reward otherwise */
    label?: string | null;
  };
  rewardValidDays: number;
}
/** as Core serves it: `displayLabel` is what the shopper reads */
export interface LoyaltyProgramView extends LoyaltyProgram {
  reward: LoyaltyProgram['reward'] & { label: string | null; displayLabel: string };
}

export interface Marketing {
  coupons: Coupon[];
  loyalty: { program: LoyaltyProgramView | null; issued: number; redeemed: number };
  waitlist: {
    productId: string;
    name: string;
    status: string;
    stockQuantity: number | null;
    imageUrl: string | null;
    waiting: number;
    contacts: { contact: string; since: string }[];
  }[];
  announcement: { title: string; body?: string } | null;
}

export interface Kpis {
  revenueCents: number;
  orders: number;
  avgTicketCents: number;
  customers: number;
  newCustomers: number;
  cancelled: number;
  deliveryShare: number;
}

export interface Reports {
  range: { from: string; to: string; days: number; prevFrom: string; prevTo: string };
  current: Kpis;
  previous: Kpis;
  series: { date: string; revenueCents: number; orders: number }[];
  hours: { dow: number; hour: number; orders: number }[];
  products: {
    key: string;
    name: string;
    qty: number;
    revenueCents: number;
    imageUrl: string | null;
  }[];
  funnel: {
    visits: number;
    productViews: number;
    carts: number;
    checkouts: number;
    orders: number;
  };
  zones: {
    name: string;
    orders: number;
    revenueCents: number;
    feesCents: number;
    /** distinct carts that asked for delivery here */
    quotes: number;
    /** orders ÷ quotes; null when nobody asked */
    conversion: number | null;
  }[];
  /** places people asked for that no zone covers (top 10) */
  outOfZone: { neighborhood: string; quotes: number }[];
  payments: { method: PayMethod; orders: number; revenueCents: number }[];
  coupons: { code: string; orders: number; discountCents: number; revenueCents: number }[];
  repeat: { customers: number; returning: number };
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  inviteSentAt: string | null;
  inviteChannels: string[];
  inviteError: string | null;
}

export type InviteResult = {
  whatsapp: 'sent' | 'failed' | 'skipped';
  email: 'sent' | 'failed' | 'skipped';
};

export interface ActivityEntry {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  at: string;
}

/** Order steps the store's WhatsApp can tell shoppers about (ADR 0026). */
export type WaEvent =
  | 'placed'
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type PrinterKind = 'spooler' | 'tcp' | 'serial' | 'usb' | 'bluetooth';
export type CodePage = 'cp850' | 'cp860' | 'ascii';
export interface Printer {
  id: string;
  deviceId: string;
  kind: PrinterKind;
  /** the merchant's label, else what the app calls it */
  name: string;
  reportedName: string;
  label: string | null;
  address: string;
  source: 'agent' | 'manual';
  /** the app saw it in its last search */
  present: boolean;
  auto: boolean;
  paper: 58 | 80;
  codepage: CodePage;
  copies: number;
  cut: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}
export interface PrintDevice {
  id: string;
  name: string;
  platform: 'windows' | 'android' | 'linux';
  version: string | null;
  online: boolean;
  /** the app picked up its connection after you approved it */
  ready: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  printers: Printer[];
}
export interface Printers {
  /** the plan has printing (when false, `devices` is empty and the screen shows the lock) */
  included: boolean;
  printOn: 'placed' | 'confirmed';
  devices: PrintDevice[];
  downloads: { windows: string; android: string };
}
export interface Pairing {
  code: string;
  platform: PrintDevice['platform'];
  name: string;
  status: 'pending' | 'approved' | 'expired' | 'taken';
  expiresAt: string;
  deviceId: string | null;
}
export type PrinterPatch = Partial<
  Pick<Printer, 'label' | 'auto' | 'paper' | 'codepage' | 'copies' | 'cut'>
>;

export type WaState = 'off' | 'connecting' | 'pairing' | 'open' | 'logged_out' | 'banned' | 'error';

export interface WaMessage {
  id: string;
  kind: 'order' | 'opt_out' | 'opt_in' | 'test';
  event: WaEvent | null;
  orderId: string | null;
  orderNumber: number | null;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'expired' | 'skipped';
  /** a code, never copy: not_on_whatsapp, opted_out, disconnected, … */
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface Whatsapp {
  /** the Venduá service that runs the stores' WhatsApp is up */
  available: boolean;
  state: WaState;
  /** a code: pair_requested, pair_expired, reconnecting, gateway_offline, logged_out, … */
  detail: string | null;
  /** the linked account, digits with the country code */
  phone: string | null;
  name: string | null;
  connectedAt: string | null;
  pairCode: string | null;
  pairCodeExpiresAt: string | null;
  pairPhone: string | null;
  disconnecting: boolean;
  /** the store's contact WhatsApp, national digits — the number to suggest */
  suggestedPhone: string | null;
  events: Record<WaEvent, boolean>;
  /** what the shopper reads at each step (a sample order); null = this step says nothing */
  previews: Record<WaEvent, string | null>;
  stats: { sent: number; failed: number; optouts: number };
  recent: WaMessage[];
}

export interface Payments {
  methods: PayMethod[];
  adjustments: PaymentAdjustments;
  pix: { key: string; keyType: string; beneficiary: string; city: string; sample: string } | null;
  mercadoPago: {
    /** the install has Mercado Pago credentials */
    available: boolean;
    status: MpStatus;
    accountId: string | null;
    liveMode: boolean | null;
    connectedAt: string | null;
    expiresAt: string | null;
    lastError: string | null;
  };
  /** what PATCH accepts, either sign */
  adjustmentBounds: { maxPercentBps: number; maxFixedCents: number };
  last30: { method: PayMethod; status: string; orders: number; cents: number }[];
  last30TotalCents: number;
  last30Orders: number;
  /** per method, most money first */
  last30ByMethod: { method: PayMethod; cents: number; orders: number }[];
  awaitingPix: { id: string; number: number; name: string; totalCents: number; placedAt: string }[];
  month: StatementTotals & { month: string };
  /** money Core couldn't verify or settle by itself — a person looks at each (newest 50) */
  review: {
    paymentId: string;
    orderId: string;
    orderNumber: number;
    reason: PaymentReview;
    status: OrderPayment['status'];
    amountCents: number;
    at: string;
  }[];
}

/** unverified (no usable token to confirm it) · amount_mismatch (paid ≠ order) ·
 *  paid_twice (a second payment landed on a paid order) ·
 *  refund_duplicate / refund_amount_mismatch / refund_failed (a refund MP didn't settle as asked) */
export type PaymentReview =
  | 'unverified'
  | 'amount_mismatch'
  | 'paid_twice'
  | 'refund_duplicate'
  | 'refund_amount_mismatch'
  | 'refund_failed';

export interface StatementTotals {
  grossCents: number;
  providerFeeCents: number;
  applicationFeeCents: number;
  netCents: number;
  refundedCents: number;
  count: number;
}

export interface Statement {
  month: string;
  /** netCents is what MP reports before any refund; refunds are their own line */
  netBasis?: 'before_refunds';
  totals: StatementTotals;
  payments: {
    id: string;
    orderId: string;
    orderNumber: number;
    kind: 'pix' | 'card';
    status: OrderPayment['status'];
    amountCents: number;
    providerFeeCents: number | null;
    netCents: number | null;
    refundedCents: number;
    approvedAt: string | null;
    createdAt: string;
  }[];
}

export interface Alerts {
  devices: {
    id: string;
    userId: string;
    userName: string;
    device: string;
    createdAt: string;
    lastOkAt: string | null;
    lastError: string | null;
    lastResult: 'ok' | 'error' | 'gone' | null;
    lastAt: string | null;
  }[];
  recent: {
    event: string;
    ref: string | null;
    channel: 'push' | 'whatsapp';
    result: 'ok' | 'error' | 'gone';
    detail: string | null;
    at: string;
    userName: string | null;
  }[];
  /** the platform's WhatsApp is set up, so missed alerts fall back to it */
  whatsappFallback: boolean;
}

export interface Incident {
  id: string;
  title: string;
  body: string | null;
  severity: 'info' | 'degraded' | 'outage';
  startedAt: string;
  resolvedAt: string | null;
}

export type SubscriptionStatus = 'pending' | 'trialing' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'open' | 'paid' | 'failed' | 'void';
export type DomainStatus = 'active' | 'pending_dns' | 'dns_ok' | 'failed';

export interface ChecklistItem {
  /** profile | hours | delivery | pix | menu | first_order */
  id: string;
  label: string;
  done: boolean;
  href: string;
}

/** The store's setup, kept by Core so it resumes on any device (GET/PATCH /onboarding). */
export interface Onboarding {
  /** what the store sells: one of Core's segment ids (features/onboarding/segments.ts) */
  segment: string | null;
  /** 'signup': born in /comecar — the onboarding doesn't ask again what signup knew */
  from: 'signup' | null;
  step: string | null;
  skipped: string[];
  finishedAt: string | null;
  dismissedAt: string | null;
  checklist: ChecklistItem[];
}

export interface Invoice {
  id: string;
  number: number;
  /** 'upgrade': the difference to change plan mid-period; the plan changes once it's paid.
   *  'ai_pack': a one-off pack of the Vendedor's conversations */
  kind: 'period' | 'upgrade' | 'ai_pack';
  planName: string;
  aiPackName: string | null;
  /** a paid pack's conversations went in; false = paid after the plan lost Duá, refunded */
  aiCredited: boolean | null;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
  method: 'card' | 'pix';
  status: InvoiceStatus;
  dueAt: string;
  paidAt: string | null;
  pix: { copyPaste: string; expiresAt: string | null } | null;
}

export interface Account {
  plan: Plan & { since: string };
  plans: Plan[];
  subscription: {
    status: SubscriptionStatus;
    method: 'card' | 'pix';
    planId: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlan: { id: string; name: string } | null;
    /** an upgrade waiting for its invoice (amount from Core) */
    pendingUpgrade: {
      planId: string;
      planName: string;
      amountCents: number;
      until: string;
      invoice: Invoice;
    } | null;
    /** card: where the owner authorizes the recurring charge (while pending) */
    checkoutUrl: string | null;
    payerEmail: string | null;
    /** the free trial's end (the first charge); kept after it converts */
    trialEndsAt: string | null;
  } | null;
  billing: { available: boolean };
  /** Duá's conversations: this month's (or the trial's) allowance, plus packs bought */
  ai: {
    included: boolean;
    period: 'month' | 'trial' | null;
    limit: number;
    used: number;
    /** bought in packs and left over: each pack lasts 30 days from its payment */
    packRemaining: number;
    /** when the first of those packs lapses */
    packExpiresAt: string | null;
    remaining: number;
    resetsAt: string | null;
  };
  aiPacks: AiPack[];
  invoices: Invoice[];
  address: string;
  domains: { host: string; kind: 'store' | 'custom'; status: DomainStatus; primary: boolean }[];
  customDomain: {
    id: string;
    host: string;
    status: 'pending_dns' | 'dns_ok' | 'active' | 'failed';
    cnameTarget: string;
    txtName: string;
    txtValue: string;
    lastCheckedAt: string | null;
    lastError: string | null;
  } | null;
  siteRequest: {
    id: string;
    status: 'requested' | 'in_progress' | 'delivered' | 'cancelled';
    brief: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface AiPack {
  id: string;
  name: string;
  priceCents: number;
  conversations: number;
}

export type SignInResult =
  | { signedIn: true; store: StoreRef }
  | { signedIn: false; pickerToken: string; stores: StoreRef[] };

export type PayNext =
  | { kind: 'card'; url: string }
  | { kind: 'pix'; invoiceId: string }
  /** signed up with an access code: the team confirms this invoice by hand */
  | { kind: 'manual'; invoiceId: string }
  /** a free trial: the store is open and nothing is charged until `endsAt` */
  | { kind: 'trial'; endsAt: string };

export type { PageTemplate };
export type TemplateSection = SectionInstance;
export type StoreTokens = StorefrontTokens;
export interface Appearance {
  url: string;
  previewUrl: string;
  pages: {
    page: string;
    label: string;
    version: number;
    template: PageTemplate;
    source: string;
    updatedAt: string;
  }[];
  tokens: { version: number; tokens: StoreTokens } | null;
  publish: { state: 'publishing' | 'live'; since: string | null; lastBuildAt: string | null };
  sections: Record<string, unknown>;
}

export interface SearchResult {
  orders: {
    id: string;
    number: number;
    state: OrderState;
    name: string;
    totalCents: number;
    placedAt: string;
  }[];
  products: {
    id: string;
    name: string;
    status: string;
    priceCents: number;
    imageUrl: string | null;
  }[];
  customers: { phone: string; name: string; orders: number }[];
}

// ── endpoints ───────────────────────────────────────────────────────────────

// ── menu import ("cole o link do seu cardápio") ─────────────────────────────

export type ImportSection = 'profile' | 'hours' | 'delivery' | 'payments';
export type ImportStatus = 'reading' | 'ready' | 'failed' | 'applying' | 'applied' | 'expired';
export interface ImportLost {
  scope: 'store' | 'category' | 'product';
  subject?: string;
  code: string;
  detail?: string;
}
export interface ImportPreviewProduct {
  name: string;
  description: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  /** archived = comes over hidden, for the merchant to check */
  status: 'active' | 'sold_out' | 'archived';
  stockQuantity: number | null;
  tags: string[];
  /** the old platform's thumbnail; re-hosted on apply */
  image: string | null;
  photos: number;
  optionGroups: { name: string; min: number; max: number; options: number }[];
  scheduled: boolean;
}
export interface MenuImport {
  id: string;
  /** null until a custom domain's platform is found */
  platform: string | null;
  sourceUrl: string;
  status: ImportStatus;
  errorCode: 'NOT_FOUND' | 'BLOCKED' | 'UNREADABLE' | 'TOO_LARGE' | 'TIMEOUT' | null;
  createdAt: string;
  readAt: string | null;
  appliedAt: string | null;
  counts: {
    categories: number;
    products: number;
    hidden: number;
    photos: number;
    optionGroups: number;
    hours: number;
    zones: number;
    paymentMethods: number;
    pix: boolean;
    logo: boolean;
    cover: boolean;
    lost: number;
  } | null;
  preview: {
    store: {
      name?: string;
      tagline?: string;
      announcement?: { title: string; body?: string };
      whatsapp?: string;
      instagram?: string;
      address?: string;
      city?: string;
      logoUrl?: string;
      coverUrl?: string;
      brandColor?: string;
    };
    hours: { days: number[]; open: string; close: string }[];
    operations: {
      minOrderCents?: number;
      prepTimeMinutes?: number;
      pickup?: boolean;
      delivery?: boolean;
    };
    zones: {
      name: string;
      kind: 'neighborhood' | 'radius' | 'polygon';
      feeCents: number;
      neighborhoods: number;
      maxDistanceKm: number | null;
    }[];
    payments: {
      methods: PayMethod[];
      adjustments: PaymentAdjustments;
      pix: { type: string; key: string; beneficiary: string; city: string | null } | null;
    } | null;
    categories: { name: string; description: string | null; products: ImportPreviewProduct[] }[];
  } | null;
  lost: ImportLost[];
  mode: 'add' | 'replace' | null;
  sections: ImportSection[] | null;
  result: {
    categories: { created: number; reused: number };
    products: number;
    hidden: number;
    archived: number;
    images: number;
    sections: ImportSection[];
  } | null;
  images: { total: number; done: number; failed: number; finished: boolean };
}

// ── Vendedor (ADR 0031; Core: src/vendedor/views.ts, results.ts, settings.ts, pack.ts, gaps.ts,
// cards.ts and the inline shapes of src/admin/routes-vendedor.ts) ─────────────────────────────

export type VendedorPresence =
  'off' | 'answering' | 'rehearsal' | 'covering' | 'disconnected' | 'budget' | 'trouble';
export type Coverage = 'rehearsal' | 'when_slow' | 'after_hours' | 'always';
export type AgentTone = 'relaxed' | 'balanced' | 'formal';
export type IncentiveReason = 'recovery' | 'first_order' | 'hesitation';

export interface StoreAgentSettings {
  name: string;
  disclose: boolean;
  tone: AgentTone;
  voice: string;
  coverage: Coverage;
  slowAfterMin: 1 | 2 | 5;
  capabilities: { closeOrder: boolean; sendPix: boolean; suggest: boolean; coupons: boolean };
  pinnedPairings: { whenCategoryId: string; suggestProductId: string }[];
  handoff: {
    complaint: boolean;
    allergy: boolean;
    aboveCents: number | null;
    newCashCustomer: boolean;
  };
  humanSilenceMin: number;
  unknownNumbers: 'shoppers_only' | 'all';
  recovery: { enabled: boolean; delayMin: number };
  incentives: null | {
    couponIds: string[];
    reasons: IncentiveReason[];
    minOrderCents: number;
    monthlyBudgetCents: number;
    perCustomerDays: number;
  };
  pixOnlyAfterCancels: number | null;
  voiceReplies: boolean;
}

export interface WaitingRow {
  threadId: string;
  name: string;
  preview: string | null;
  reason: string | null;
  since: string;
}

export interface VendedorHome {
  agent: {
    enabled: boolean;
    name: string;
    disclose: boolean;
    intro: string;
    coverage: Coverage;
    slowAfterMin: number;
    enabledAt: string | null;
    firstSaleAt: string | null;
  };
  presence: VendedorPresence;
  /** what Duá can still take this period: 0 left means new shoppers go to the store */
  allowance: {
    period: 'month' | 'trial' | null;
    limit: number;
    used: number;
    remaining: number;
    resetsAt: string | null;
  };
  whatsapp: { state: string | null; linked: boolean };
  active: number;
  replyP50Sec: number | null;
  today: {
    closedCents: number;
    orders: number;
    averageCents: number | null;
    conversations: number;
    conversion: number | null;
    suggestionsOffered: number;
    suggestionsTaken: number;
    drafts: number;
  };
  waiting: WaitingRow[];
  whileAway: {
    orderId: string;
    number: number;
    totalCents: number;
    placedAt: string;
    scheduledFor: string | null;
  }[];
  demand: {
    unmet: { term: string; count: number }[];
    outOfZone: { term: string; count: number }[];
  };
  onboarding: { started: boolean; finished: boolean; part: string | null };
}

export type ThreadFilter = 'all' | 'waiting' | 'orders' | 'agent' | 'others';
/** who answers now: Ana, Ensaio, the store, the store's grace minutes, muted, nobody */
export type ThreadFloor = 'agent' | 'rehearsal' | 'store' | 'wait' | 'muted' | 'off';
export type ThreadOwner = 'open' | 'agent' | 'human' | 'muted';
export type ThreadStage =
  'browsing' | 'building' | 'checkout' | 'confirming' | 'paying' | 'ordered' | 'after';
export type ThreadChannel = 'whatsapp' | 'test' | 'web' | 'instagram';

export interface ThreadRow {
  id: string;
  name: string;
  /** masked by Core */
  phone: string | null;
  owner: ThreadOwner;
  floor: ThreadFloor;
  reason: string | null;
  waitingSince: string | null;
  stage: ThreadStage;
  class: 'unknown' | 'shopper' | 'other';
  preview: string | null;
  previewAuthor: string | null;
  lastAt: string;
  orderNumber: number | null;
  unread: boolean;
}

export type MessageAuthor = 'shopper' | 'agent' | 'merchant' | 'core';

export interface ThreadMessage {
  id: string;
  author: MessageAuthor;
  kind: string;
  body: string | null;
  transcript: string | null;
  /** 'draft' = Ensaio: written, never sent */
  status: string;
  at: string;
  /** Core's cards: summary | pix | order | link | product */
  card: string | null;
  /** SummaryCardData for card 'summary', OrderCardData for 'order' */
  data: unknown;
  hasMedia: boolean;
  seconds: number | null;
  verdict: string | null;
  turnId: string | null;
  suggestion: boolean;
}

export type SacolaStep = 'montar' | 'endereco' | 'pagamento' | 'confirmar' | 'feito';

export interface Sacola {
  count: number;
  totalCents: number;
  lines: { text: string; totalCents: number }[];
  step: SacolaStep;
}

export interface CustomerCard {
  firstName: string | null;
  orders: number;
  lastOrder: { number: number; placedAt: string; items: string; state: string } | null;
  usual: string | null;
  addresses: { label: string; hasPin: boolean }[];
  preferredPayment: string | null;
  cancelledRecently: number;
}

export interface ThreadDetail {
  thread: ThreadRow & {
    humanUntil: string | null;
    profileName: string | null;
    test: boolean;
    channel: ThreadChannel;
  };
  messages: ThreadMessage[];
  sacola: Sacola | null;
  customer: (CustomerCard & { phone: string | null; firstSeen: string | null }) | null;
  order: {
    id: string;
    number: number;
    state: string;
    totalCents: number;
    paymentStatus: string;
  } | null;
  humanSilenceMin: number;
}

/** Core's receipt: every figure here is Core's ("calculado pela loja") */
/** Core's order card (src/vendedor/cards.ts) */
export interface OrderCardData {
  number: number;
  state: string;
  totalCents: number;
  payment: string | null;
  paymentUrl: string | null;
}

export interface SummaryCardData {
  id: string;
  lines: { text: string; totalCents: number }[];
  subtotalCents: number;
  feeCents: number;
  discountCents: number;
  discountLabel: string | null;
  adjustmentCents: number;
  totalCents: number;
  mode: 'pickup' | 'delivery';
  address: string | null;
  eta: string | null;
  payment: string | null;
  changeForCents: number | null;
  scheduledFor: string | null;
  unusual: string[];
  test: boolean;
}

export interface WhyView {
  asked: string | null;
  steps: { kind: 'lookup' | 'figure' | 'rule' | 'action' | 'blocked'; text: string }[];
}

export interface KnowledgeItem {
  id: string;
  kind: 'answer' | 'rule' | 'question';
  status: string;
  source: string;
  question: string | null;
  answer: string | null;
  /** the system enforces it ("sempre cumprida"); otherwise "orientação" */
  guaranteed: boolean;
  guarantee: string | null;
  askedCount: number;
  usedCount: number;
  at: string;
}

export interface Knowledge {
  questions: KnowledgeItem[];
  learned: KnowledgeItem[];
  answers: KnowledgeItem[];
  rules: KnowledgeItem[];
}

export interface EnsaioView {
  drafts: number;
  compared: number;
  agreed: number;
  disagreements: {
    threadId: string;
    draftId: string;
    shopper: string | null;
    draft: string;
    merchant: string | null;
    at: string;
  }[];
}

export interface ClienteOcultoResult {
  name: string;
  check: string;
  passed: boolean;
  why: string;
  turns: number;
  threadId: string | null;
}

export interface ClienteOculto {
  latest: {
    id: string;
    trigger: string;
    status: string;
    passed: number | null;
    total: number | null;
    results: ClienteOcultoResult[] | null;
    error: string | null;
    at: string;
    finishedAt: string | null;
  } | null;
  history: {
    id: string;
    passed: number | null;
    total: number | null;
    status: string;
    at: string;
  }[];
}

export type ResultsPeriod = 'today' | '7d' | '30d';

export interface VendedorResults {
  period: ResultsPeriod;
  since: string;
  closed: { cents: number; orders: number; averageCents: number | null };
  assisted: { cents: number; orders: number; windowHours: number };
  siteAverageCents: number | null;
  funnel: { conversations: number; carts: number; summaries: number; orders: number };
  suggestions: { offered: number; taken: number; revenueCents: number };
  recovered: { orders: number; cents: number };
  replySec: { p50: number | null; p95: number | null };
  handoffs: { reason: string; count: number }[];
  proposals: {
    kind: 'answer' | 'retire_suggestion' | 'recovery_delay';
    text: string;
    evidence: string;
    ref: string | null;
  }[];
  enoughData: boolean;
}

export interface VendedorSettings {
  enabled: boolean;
  settings: StoreAgentSettings;
  /** how Duá introduces himself to a shopper: "o Duá, assistente virtual da …" */
  intro: string;
  coupons: { id: string; code: string; label: string | null; kind: string; value: number }[];
  incentivesUsedCents: number;
}

/** partial settings; nested groups merge field by field in Core. The name is always Duá. */
export type VendedorSettingsPatch = Partial<
  Omit<StoreAgentSettings, 'name' | 'capabilities' | 'handoff' | 'recovery'>
> & {
  enabled?: boolean;
  capabilities?: Partial<StoreAgentSettings['capabilities']>;
  handoff?: Partial<StoreAgentSettings['handoff']>;
  recovery?: Partial<StoreAgentSettings['recovery']>;
};

export type GapKind =
  'size_unstated' | 'unpriced_option' | 'no_allergen_info' | 'duplicate_name' | 'empty_combo_slot';

export interface MenuGap {
  kind: GapKind;
  productId: string | null;
  categoryId: string | null;
  title: string;
  detail: string;
}

export interface VendedorOnboardingProgress {
  started?: boolean;
  finished?: boolean;
  part?: string;
  step?: string;
  skipped?: string[];
  interviewDone?: boolean;
  tested?: boolean;
}

export interface VendedorOnboarding {
  progress: VendedorOnboardingProgress;
  enabled: boolean;
  settings: StoreAgentSettings;
  readiness: {
    menu: boolean;
    hours: boolean;
    fulfilment: boolean;
    whatsapp: boolean;
    whatsappState: string | null;
  };
  read: { products: number; zones: number };
  gaps: MenuGap[];
  interview: { threadId: string; messages: ThreadMessage[] };
  proposals: KnowledgeItem[];
  taught: { answers: number; rules: number };
}

export interface CustomerFact {
  key: string;
  label: string;
  value: unknown;
  sensitive: boolean;
  at: string;
}

export const api = {
  auth: {
    start: (phone: string) =>
      send<{ sent: boolean; devCode?: string; expiresAt: string }>('POST', '/auth/otp/start', {
        phone,
      }),
    verify: (phone: string, code: string) =>
      send<
        | { signedIn: true; store: StoreRef }
        | { signedIn: false; pickerToken: string; stores: StoreRef[] }
      >('POST', '/auth/otp/verify', { phone, code }),
    select: (pickerToken: string, storeId: string) =>
      send<{ signedIn: true; store: StoreRef }>('POST', '/auth/select', { pickerToken, storeId }),
    logout: () => send<{ ok: true }>('POST', '/auth/logout'),
    emailStart: (email: string) =>
      send<{ sent: true; devLink?: string }>('POST', '/auth/email/start', { email }),
    emailVerify: (token: string) => send<SignInResult>('POST', '/auth/email/verify', { token }),
  },
  signup: {
    plans: () =>
      get<{
        plans: Plan[];
        billing: { available: boolean; accessCode: boolean };
        /** the team turned signup on and its WhatsApp, email and billing are set up */
        signup: { open: boolean };
        storeDomain: string;
      }>('/signup/plans'),
    slug: (slug: string) =>
      get<{
        slug: string;
        available: boolean;
        reason?: 'taken' | 'reserved' | 'invalid';
        suggestion?: string;
      }>(`/signup/slug?slug=${encodeURIComponent(slug)}`),
    otpStart: (phone: string) =>
      send<{ sent: boolean; devCode?: string; expiresAt: string }>('POST', '/signup/otp/start', {
        phone,
      }),
    otpVerify: (phone: string, code: string) =>
      send<{ signupToken: string; existingStores: StoreRef[]; trialEligible: boolean }>(
        'POST',
        '/signup/otp/verify',
        { phone, code },
      ),
    create: (p: {
      signupToken: string;
      planId: string;
      /** the plan's free trial: no payment method asked */
      trial?: boolean;
      method?: 'card' | 'pix';
      storeName: string;
      slug: string;
      ownerName: string;
      email: string;
      segment?: string;
      accessCode?: string;
    }) => send<{ signedIn: true; store: StoreRef; next: PayNext }>('POST', '/signup', p),
  },
  session: () => get<Session>('/session'),
  switchStore: (storeId: string) =>
    send<{ signedIn: true }>('POST', '/session/switch', { storeId }),
  updateMe: (patch: {
    name?: string;
    email?: string | null;
    prefs?: Partial<Session['user']['prefs']>;
  }) => send<{ user: unknown }>('PATCH', '/me', patch),
  sessions: () =>
    get<{
      sessions: {
        id: string;
        device: string;
        createdAt: string;
        lastSeenAt: string;
        current: boolean;
      }[];
    }>('/me/sessions'),
  endSession: (id: string) => send<{ ok: true }>('DELETE', `/me/sessions/${id}`),
  pushSubscribe: (sub: PushSubscriptionJSON) => send('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => send('POST', '/push/unsubscribe', { endpoint }),

  home: () => get<Home>('/home'),
  search: (q: string) => get<SearchResult>(`/search?q=${encodeURIComponent(q)}`),

  board: () => get<Board>('/orders/board'),
  orders: (p: {
    q?: string | undefined;
    state?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    before?: string | undefined;
  }) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) s.set(k, v);
    return get<{ orders: OrderRow[]; next: string | null }>(`/orders?${s}`);
  },
  scheduled: (from: string, to: string) =>
    get<{ orders: OrderRow[]; days: { date: string; count: number; totalCents: number }[] }>(
      `/orders/scheduled?from=${from}&to=${to}`,
    ),
  order: (id: string) =>
    get<{
      order: Order;
      customer: { phone: string; orders: number; firstAt: string; spentCents: number } | null;
      /** absent in placeholder data seeded from the board */
      payments?: OrderPayment[];
    }>(`/orders/${id}`),
  transition: (
    id: string,
    to: OrderState,
    extra: { prepMinutes?: number; reason?: string } = {},
    idem?: string,
    /** keepalive: the request outlives the page (the kitchen sends a held "pronto" on leaving) */
    opts: { keepalive?: boolean } = {},
  ) =>
    req<{ order: Order }>(`/orders/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, ...extra }),
      ...(idem ? { idem } : {}),
      ...(opts.keepalive ? { keepalive: true } : {}),
    }),
  markPaid: (id: string, status: 'paid' | 'pending') =>
    send<{ order: Order }>('POST', `/orders/${id}/payment`, { status }),
  refund: (id: string, p: { amountCents?: number | null; reason?: string }) =>
    send<{ order: Order; payments: OrderPayment[] }>('POST', `/orders/${id}/refund`, p),

  kitchen: () => get<Kitchen>('/kitchen'),
  kitchenItems: (orderId: string, items: string[], done: boolean) =>
    send<{ ticket: KitchenTicket }>('POST', `/kitchen/orders/${orderId}/items`, { items, done }),
  kitchenRush: (orderId: string, rush: boolean) =>
    send<{ ticket: KitchenTicket }>('POST', `/kitchen/orders/${orderId}/rush`, { rush }),
  kitchenStations: (stations: { id?: string; name: string; categoryIds: string[] }[]) =>
    send<{ stations: KitchenStation[] }>('PUT', '/kitchen/stations', { stations }),

  catalog: () => get<{ categories: Category[] }>('/catalog'),
  product: (id: string) => get<{ product: ProductDetail }>(`/products/${id}`),
  createProduct: (p: {
    name: string;
    categoryId: string;
    priceCents: number;
    description?: string | null;
  }) => send<{ product: ProductDetail }>('POST', '/products', p),
  updateProduct: (id: string, patch: Record<string, unknown>) =>
    send<{ product: ProductDetail; waitlistWoken: number }>('PATCH', `/products/${id}`, patch),
  duplicateProduct: (id: string) =>
    send<{ product: ProductDetail }>('POST', `/products/${id}/duplicate`),
  setMedia: (
    id: string,
    media: { url: string; alt?: string | null; width?: number | null; height?: number | null }[],
  ) => send<{ product: ProductDetail }>('PUT', `/products/${id}/media`, { media }),
  setOptions: (id: string, groups: OptionGroup[]) =>
    send<{ product: ProductDetail }>('PUT', `/products/${id}/options`, { groups }),
  setKit: (id: string, slots: KitSlot[]) =>
    send<{ product: ProductDetail }>('PUT', `/products/${id}/kit`, { slots }),
  orderProducts: (categoryId: string, ids: string[]) =>
    send('PUT', '/products/order', { categoryId, ids }),
  /** relative changes (+5, −2): a sale drawn meanwhile still counts; Core floors at 0 */
  // keepalive: the Estoque screen sends its last taps as the app closes
  adjustStock: (changes: { productId: string; add: number }[]) =>
    req<{ stock: Record<string, number>; waitlistWoken: number }>('/products/stock', {
      method: 'POST',
      body: JSON.stringify({ changes }),
      keepalive: true,
    }),
  bulk: (ids: string[], action: string, extra: Record<string, unknown> = {}) =>
    send<{ updated: number }>('POST', '/products/bulk', { ids, action, ...extra }),
  importPreview: (text: string) =>
    send<{ items: { name: string; priceCents: number }[] }>('POST', '/products/import/preview', {
      text,
    }),
  importProducts: (text: string, categoryId: string) =>
    send<{ created: number }>('POST', '/products/import', { text, categoryId }),
  createCategory: (name: string, description?: string | null) =>
    send<{ category: Category }>('POST', '/categories', {
      name,
      ...(description ? { description } : {}),
    }),
  updateCategory: (id: string, c: { name?: string; description?: string | null }) =>
    send('PATCH', `/categories/${id}`, c),
  deleteCategory: (id: string) => send('DELETE', `/categories/${id}`),
  orderCategories: (ids: string[]) => send('PUT', '/categories/order', { ids }),

  uploadMedia: async (
    blob: Blob,
    meta: { width: number; height: number; dominant: string | null },
  ) => {
    const q = new URLSearchParams({ w: String(meta.width), h: String(meta.height) });
    if (meta.dominant) q.set('dominant', meta.dominant);
    return req<{
      id: string;
      url: string;
      width: number;
      height: number;
      dominant: string | null;
      variants: number[];
    }>(`/media?${q}`, {
      method: 'POST',
      body: blob,
      raw: true,
      headers: { 'content-type': blob.type },
    });
  },

  onboarding: () => get<Onboarding>('/onboarding'),
  updateOnboarding: (p: {
    step?: string | null;
    skipped?: string[];
    segment?: string | null;
    finished?: true;
    dismissed?: boolean;
  }) => send<Onboarding>('PATCH', '/onboarding', p),

  store: () => get<StoreView>('/store'),
  updateStore: (patch: Record<string, unknown>) => send<StoreView>('PATCH', '/store', patch),
  /** roughly where a one-line address is (Core asks the geocoder); null = not found */
  geocode: (q: string) =>
    get<{
      point: {
        lat: number;
        lng: number;
        precision: 'address' | 'street' | 'postcode' | 'area';
      } | null;
    }>(`/geocode?q=${encodeURIComponent(q.slice(0, 300))}`),
  pause: (p: {
    for: '15m' | '1h' | 'today' | 'indefinite' | 'minutes';
    minutes?: number;
    message?: string | null;
  }) => send<StoreView>('POST', '/store/pause', p),
  resume: () => send<StoreView>('POST', '/store/resume'),
  createZone: (z: Partial<Zone>) => send<{ zones: Zone[] }>('POST', '/zones', z),
  updateZone: (id: string, z: Partial<Zone>) => send<{ zones: Zone[] }>('PATCH', `/zones/${id}`, z),
  deleteZone: (id: string) => send<{ zones: Zone[] }>('DELETE', `/zones/${id}`),

  payments: () => get<Payments>('/payments'),
  updatePayments: (p: {
    methods?: PayMethod[];
    pix?: Record<string, unknown> | null;
    /** replaces the whole map */
    adjustments?: PaymentAdjustments | null;
  }) => send<Payments>('PATCH', '/payments', p),
  /** back: 'onboarding' — Mercado Pago returns to /bem-vindo instead of Pagamentos */
  mpConnect: (back?: 'onboarding') =>
    send<{ url: string }>('POST', '/payments/mercadopago/connect', back ? { back } : undefined),
  mpDisconnect: () => send<Payments>('POST', '/payments/mercadopago/disconnect'),

  whatsapp: () => get<Whatsapp>('/whatsapp'),
  whatsappPair: (phone: string) => send<Whatsapp>('POST', '/whatsapp/pair', { phone }),
  whatsappDisconnect: () => send<Whatsapp>('POST', '/whatsapp/disconnect'),
  whatsappSettings: (events: Partial<Record<WaEvent, boolean>>) =>
    send<Whatsapp>('PATCH', '/whatsapp/settings', { events }),
  whatsappTest: () => send<Whatsapp>('POST', '/whatsapp/test'),

  printers: () => get<Printers>('/printers'),
  printersSettings: (printOn: Printers['printOn']) =>
    send<Printers>('PATCH', '/printers/settings', { printOn }),
  pairing: (code: string) => get<Pairing>(`/printers/pairing/${encodeURIComponent(code)}`),
  pairDevice: (code: string) =>
    send<Printers & { deviceId: string }>('POST', '/printers/pairing', { code }),
  unpairDevice: (id: string) => send<Printers>('DELETE', `/printers/devices/${id}`),
  addNetworkPrinter: (deviceId: string, address: string) =>
    send<Printer>('POST', `/printers/devices/${deviceId}/printers`, { address }),
  updatePrinter: (id: string, patch: PrinterPatch) =>
    send<Printer>('PATCH', `/printers/${id}`, patch),
  removePrinter: (id: string) => send<Printers>('DELETE', `/printers/${id}`),
  testPrinter: (id: string) => send<{ jobId: string }>('POST', `/printers/${id}/test`),
  printOrder: (orderId: string, printerId?: string) =>
    send<{ jobs: number; printers: string[] }>(
      'POST',
      `/orders/${orderId}/print`,
      printerId ? { printerId } : {},
    ),
  statement: (month: string) => get<Statement>(`/payments/statement?month=${month}`),

  alerts: () => get<Alerts>('/alerts'),
  testAlert: () => send<{ devices: number; ok: number; failed: number }>('POST', '/alerts/test'),
  helpStatus: () => get<{ incidents: Incident[] }>('/help/status'),

  customers: (p: { q?: string; sort?: string; offset?: number }) => {
    const s = new URLSearchParams();
    if (p.q) s.set('q', p.q);
    if (p.sort) s.set('sort', p.sort);
    if (p.offset) s.set('offset', String(p.offset));
    return get<{
      customers: Customer[];
      stats: { customers: number; repeat: number; newThisMonth: number };
      next: number | null;
    }>(`/customers?${s}`);
  },
  customer: (phone: string) => get<CustomerDetail>(`/customers/${phone}`),
  exportCustomer: (phone: string) => get<unknown>(`/customers/${phone}/export`),
  forgetCustomer: (phone: string, confirm: string) =>
    send<{ anonymized: number }>('POST', `/customers/${phone}/forget`, { confirm }),

  marketing: () => get<Marketing>('/marketing'),
  createCoupon: (c: Record<string, unknown>) => send<{ coupons: Coupon[] }>('POST', '/coupons', c),
  updateCoupon: (id: string, c: Record<string, unknown>) =>
    send<{ coupons: Coupon[] }>('PATCH', `/coupons/${id}`, c),
  setLoyalty: (program: LoyaltyProgram | null) =>
    send<{ program: LoyaltyProgramView | null }>('PUT', '/loyalty', { program }),
  waitlistNotified: (productId: string) =>
    send<{ notified: number }>('POST', `/waitlist/${productId}/notified`),
  setAnnouncement: (a: { title: string; body?: string } | null) =>
    send('PUT', '/announcement', { announcement: a }),
  share: () =>
    get<{
      store: { name: string; url: string };
      products: {
        id: string;
        slug: string;
        name: string;
        priceCents: number;
        imageUrl: string | null;
        url: string;
      }[];
    }>('/share'),

  reports: (from: string, to: string) => get<Reports>(`/reports?from=${from}&to=${to}`),

  team: () => get<{ members: Member[] }>('/team'),
  addMember: (m: { name: string; phone: string; role: Role; email?: string | null }) =>
    send<{ members: Member[]; invite: InviteResult; signInUrl: string }>('POST', '/team', m),
  resendInvite: (id: string) =>
    send<{ members: Member[]; invite: InviteResult }>('POST', `/team/${id}/invite`),
  updateMember: (id: string, m: { role?: Role; name?: string }) =>
    send<{ members: Member[] }>('PATCH', `/team/${id}`, m),
  removeMember: (id: string) => send<{ members: Member[] }>('DELETE', `/team/${id}`),
  activity: (before?: number) =>
    get<{ entries: ActivityEntry[]; next: number | null }>(
      `/activity${before ? `?before=${before}` : ''}`,
    ),
  account: () => get<Account>('/account'),
  startSubscription: (p: { planId: string; method: 'card' | 'pix'; payerEmail: string }) =>
    send<Account>('POST', '/account/subscription', p),
  updateSubscription: (p: { planId?: string; method?: 'card' | 'pix'; payerEmail?: string }) =>
    send<Account>('PATCH', '/account/subscription', p),
  cancelSubscription: () => send<Account>('POST', '/account/subscription/cancel'),
  resumeSubscription: () => send<Account>('POST', '/account/subscription/resume'),
  invoicePix: (id: string) => send<Account>('POST', `/account/invoices/${id}/pix`),
  /** a one-off Pix invoice for the pack (an open one is reused); the terms shown go along, so a
   *  pack repriced meanwhile answers AI_PACK_CHANGED instead of charging something else */
  buyAiPack: (pack: Pick<AiPack, 'id' | 'priceCents' | 'conversations'>) =>
    send<Account & { invoiceId: string }>('POST', '/account/ai-packs', {
      packId: pack.id,
      priceCents: pack.priceCents,
      conversations: pack.conversations,
    }),
  addDomain: (host: string) => send<Account>('POST', '/account/domains', { host }),
  checkDomain: (id: string) => send<Account>('POST', `/account/domains/${id}/check`),
  removeDomain: (id: string) => send<Account>('DELETE', `/account/domains/${id}`),
  requestSite: (brief: string) => send<Account>('POST', '/account/site-request', { brief }),
  updateSiteRequest: (brief: string) => send<Account>('PATCH', '/account/site-request', { brief }),

  appearance: () => get<Appearance>('/appearance'),
  pageHistory: (page: string) =>
    get<{ history: { version: number; source: string; at: string; by: string }[] }>(
      `/appearance/pages/${encodeURIComponent(page)}/history`,
    ),
  savePage: (page: string, template: PageTemplate, expectVersion?: number) =>
    send<{ version: number; template: PageTemplate }>(
      'PUT',
      `/appearance/pages/${encodeURIComponent(page)}`,
      {
        template,
        ...(expectVersion !== undefined ? { expectVersion } : {}),
      },
    ),
  restorePage: (page: string, toVersion: number) =>
    send<{ version: number }>('POST', `/appearance/pages/${encodeURIComponent(page)}/restore`, {
      toVersion,
    }),
  saveTokens: (tokens: StoreTokens) =>
    send<{ version: number }>('PUT', '/appearance/tokens', { tokens }),

  startImport: (url: string) =>
    send<{ id: string; platform: string | null }>('POST', '/imports', { url }),
  importOf: (id: string) => get<MenuImport>(`/imports/${id}`),
  imports: () => get<{ imports: MenuImport[] }>('/imports'),
  applyImport: (id: string, body: { mode: 'add' | 'replace'; sections: ImportSection[] }) =>
    send<MenuImport>('POST', `/imports/${id}/apply`, body),
  discardImport: (id: string) => send<MenuImport>('POST', `/imports/${id}/discard`),

  help: (message: string, topic?: string) =>
    send<{ sent: true }>('POST', '/help', { message, topic }),

  vendedor: {
    home: () => get<VendedorHome>('/vendedor'),
    threads: (p: { filter?: ThreadFilter; q?: string; before?: string; limit?: number } = {}) => {
      const s = new URLSearchParams();
      if (p.filter && p.filter !== 'all') s.set('filter', p.filter);
      if (p.q) s.set('q', p.q);
      if (p.before) s.set('before', p.before);
      if (p.limit) s.set('limit', String(p.limit));
      const qs = s.toString();
      return get<{ threads: ThreadRow[]; next: string | null }>(
        `/vendedor/threads${qs ? `?${qs}` : ''}`,
      );
    },
    thread: (id: string) => get<ThreadDetail>(`/vendedor/threads/${encodeURIComponent(id)}`),
    why: (threadId: string, messageId: string) =>
      get<WhyView>(
        `/vendedor/threads/${encodeURIComponent(threadId)}/why/${encodeURIComponent(messageId)}`,
      ),
    suggestions: (threadId: string) =>
      get<{ replies: string[] }>(`/vendedor/threads/${encodeURIComponent(threadId)}/suggestions`),
    take: (threadId: string) =>
      send<ThreadDetail>('POST', `/vendedor/threads/${encodeURIComponent(threadId)}/take`, {}),
    release: (threadId: string) =>
      send<ThreadDetail>('POST', `/vendedor/threads/${encodeURIComponent(threadId)}/release`, {}),
    reply: (threadId: string, text: string) =>
      send<ThreadDetail>('POST', `/vendedor/threads/${encodeURIComponent(threadId)}/reply`, {
        text,
      }),
    /** "não é cliente" */
    mute: (threadId: string) =>
      send<ThreadDetail>('POST', `/vendedor/threads/${encodeURIComponent(threadId)}/mute`, {}),
    unmute: (threadId: string) =>
      send<ThreadDetail>('POST', `/vendedor/threads/${encodeURIComponent(threadId)}/unmute`, {}),

    settings: () => get<VendedorSettings>('/vendedor/settings'),
    updateSettings: (patch: VendedorSettingsPatch) =>
      send<VendedorSettings>('PATCH', '/vendedor/settings', patch),

    knowledge: () => get<Knowledge>('/vendedor/knowledge'),
    previewRule: (text: string) =>
      get<{ guaranteed: boolean; guarantee: string | null }>(
        `/vendedor/knowledge/preview?text=${encodeURIComponent(text)}`,
      ),
    teach: (
      item: { kind: 'answer'; question: string; answer: string } | { kind: 'rule'; text: string },
    ) => send<Knowledge>('POST', '/vendedor/knowledge', item),
    updateKnowledge: (
      id: string,
      patch: {
        question?: string;
        answer?: string;
        status?: 'live' | 'dismissed';
        replyWaiting?: boolean;
      },
    ) => send<Knowledge>('PATCH', `/vendedor/knowledge/${encodeURIComponent(id)}`, patch),
    deleteKnowledge: (id: string) =>
      send<Knowledge>('DELETE', `/vendedor/knowledge/${encodeURIComponent(id)}`),

    ensaio: () => get<EnsaioView>('/vendedor/ensaio'),
    verdict: (
      draftId: string,
      v: {
        verdict: 'same' | 'different' | 'dismissed';
        teach?: true;
        question?: string;
        answer?: string;
      },
    ) => send<EnsaioView>('POST', `/vendedor/drafts/${encodeURIComponent(draftId)}/verdict`, v),

    clienteOculto: () => get<ClienteOculto>('/vendedor/cliente-oculto'),
    runClienteOculto: () => send<ClienteOculto>('POST', '/vendedor/cliente-oculto', {}),

    results: (period: ResultsPeriod) =>
      get<VendedorResults>(`/vendedor/resultados?period=${period}`),

    testChat: () => get<ThreadDetail>('/vendedor/test-chat'),
    sendTest: (text: string) => send<ThreadDetail>('POST', '/vendedor/test-chat', { text }),
    resetTest: () => send<ThreadDetail>('DELETE', '/vendedor/test-chat'),

    onboarding: () => get<VendedorOnboarding>('/vendedor/onboarding'),
    updateOnboarding: (p: VendedorOnboardingProgress) =>
      send<VendedorOnboarding>('PATCH', '/vendedor/onboarding', p),
    interview: (text: string) =>
      send<VendedorOnboarding>('POST', '/vendedor/onboarding/interview', { text }),

    customerFacts: (phone: string) =>
      get<{ facts: CustomerFact[] }>(`/customers/${encodeURIComponent(phone)}/vendedor`),
    forgetFact: (phone: string, key: string) =>
      send<{ facts: CustomerFact[] }>(
        'DELETE',
        `/customers/${encodeURIComponent(phone)}/vendedor/facts/${encodeURIComponent(key)}`,
      ),
  },
};
