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
export type PayMethod = 'pix' | 'card_online' | 'card_on_delivery' | 'cash';
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

export interface Plan {
  id: string;
  name: string;
  /** null for a legacy/pilot plan with no catalog price */
  priceCents: number | null;
  feeBps: number;
  features: { customDomain: boolean; customSite: boolean };
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
    modifiers: { name: string; priceDeltaCents: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    lineTotalCents: number;
  }[];
  notes: string | null;
  scheduledFor: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
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
  refundableCents?: number;
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

export interface Product {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  status: 'active' | 'sold_out' | 'archived';
  kind: 'simple' | 'combo';
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  sort: number;
  soldOutUntil: string | null;
  availabilitySchedule?: AvailabilitySchedule | null;
  /** false while outside its schedule */
  availableNow?: boolean;
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

export interface OptionGroup {
  id?: string;
  name: string;
  required?: boolean;
  minSelect: number;
  maxSelect: number;
  options: { id?: string; name: string; priceDeltaCents: number; status: 'active' | 'sold_out' }[];
}

export interface KitSlot {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  qtyPerItem: number;
  items: { productId: string; name?: string; priceDeltaCents: number; imageUrl?: string | null }[];
}

export interface ProductDetail extends Product {
  groups: OptionGroup[];
  gallery: { url: string; alt: string | null; width: number | null; height: number | null }[];
  comboSlots: KitSlot[];
  sales30: { qty: number; revenueCents: number };
}

export interface Category {
  id: string;
  slug: string;
  name: string;
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
  kind: 'neighborhood' | 'radius';
  neighborhoods: string[];
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
    whatsapp: string | null;
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
  preorder: { paymentMethods: PayMethod[]; maxDays: number };
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
     *  billing_past_due | invoice_open | incident */
    kind: string;
    count: number;
    title: string;
    detail?: string;
    href: string;
    productId?: string;
  }[];
  checklist: { id: string; label: string; done: boolean; href: string }[];
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
  label: string | null;
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
  reward: { kind: 'percent' | 'fixed' | 'free_delivery'; value: number; label: string };
  rewardValidDays: number;
}

export interface Marketing {
  coupons: Coupon[];
  loyalty: { program: LoyaltyProgram | null; issued: number; redeemed: number };
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

export interface Payments {
  methods: PayMethod[];
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
  last30: { method: PayMethod; status: string; orders: number; cents: number }[];
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
 *  refund_duplicate / refund_amount_mismatch / refund_failed (a refund MP didn't settle as asked) */
export type PaymentReview =
  | 'unverified'
  | 'amount_mismatch'
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

export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'open' | 'paid' | 'failed' | 'void';
export type DomainStatus = 'active' | 'pending_dns' | 'dns_ok' | 'failed';

export interface Invoice {
  id: string;
  number: number;
  /** 'upgrade': the difference to change plan mid-period; the plan changes once it's paid */
  kind: 'period' | 'upgrade';
  planName: string;
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
  } | null;
  billing: { available: boolean };
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

export type SignInResult =
  | { signedIn: true; store: StoreRef }
  | { signedIn: false; pickerToken: string; stores: StoreRef[] };

export type PayNext =
  | { kind: 'card'; url: string }
  | { kind: 'pix'; invoiceId: string }
  /** signed up with an access code: the team confirms this invoice by hand */
  | { kind: 'manual'; invoiceId: string };

export interface TemplateSection {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, { id: string; type: string; settings?: Record<string, unknown> }[]>;
  disabled?: boolean;
}
export interface PageTemplate {
  version: 1;
  page: string;
  sections: TemplateSection[];
  removed?: string[];
}
export interface StoreTokens {
  color: Record<
    'bg' | 'surface' | 'text' | 'muted' | 'accent' | 'onAccent' | 'danger' | 'success',
    string
  >;
  font: { display: string; body: string; mono?: string; srcs?: unknown[] };
  radius: { sm: string; md: string; lg: string };
  space: { scale: number | string[] };
  motion: { duration: string; easing: string };
}
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
      send<{ signupToken: string; existingStores: StoreRef[] }>('POST', '/signup/otp/verify', {
        phone,
        code,
      }),
    create: (p: {
      signupToken: string;
      planId: string;
      method: 'card' | 'pix';
      storeName: string;
      slug: string;
      ownerName: string;
      email: string;
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
    get<{ orders: OrderRow[] }>(`/orders/scheduled?from=${from}&to=${to}`),
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
  ) =>
    req<{ order: Order }>(`/orders/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ to, ...extra }),
      ...(idem ? { idem } : {}),
    }),
  markPaid: (id: string, status: 'paid' | 'pending') =>
    send<{ order: Order }>('POST', `/orders/${id}/payment`, { status }),
  refund: (id: string, p: { amountCents?: number | null; reason?: string }) =>
    send<{ order: Order; payments: OrderPayment[] }>('POST', `/orders/${id}/refund`, p),

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
  bulk: (ids: string[], action: string, extra: Record<string, unknown> = {}) =>
    send<{ updated: number }>('POST', '/products/bulk', { ids, action, ...extra }),
  importPreview: (text: string) =>
    send<{ items: { name: string; priceCents: number }[] }>('POST', '/products/import/preview', {
      text,
    }),
  importProducts: (text: string, categoryId: string) =>
    send<{ created: number }>('POST', '/products/import', { text, categoryId }),
  createCategory: (name: string) => send<{ category: Category }>('POST', '/categories', { name }),
  renameCategory: (id: string, name: string) => send('PATCH', `/categories/${id}`, { name }),
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

  store: () => get<StoreView>('/store'),
  updateStore: (patch: Record<string, unknown>) => send<StoreView>('PATCH', '/store', patch),
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
  updatePayments: (p: { methods?: PayMethod[]; pix?: Record<string, unknown> | null }) =>
    send<Payments>('PATCH', '/payments', p),
  mpConnect: () => send<{ url: string }>('POST', '/payments/mercadopago/connect'),
  mpDisconnect: () => send<Payments>('POST', '/payments/mercadopago/disconnect'),
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
    send<{ program: LoyaltyProgram | null }>('PUT', '/loyalty', { program }),
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

  help: (message: string, topic?: string) =>
    send<{ sent: true }>('POST', '/help', { message, topic }),
};
