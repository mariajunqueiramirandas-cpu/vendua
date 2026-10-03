import type { ReactNode } from 'react';
import type {
  Cart,
  CartCoupon,
  CartItem,
  ComboSelection,
  ComboSlot,
  LoyaltyCard,
  Notice,
  NoticeAction,
  Order,
  OrderItem,
  ProductDetail,
  StoreProfile,
  CatalogProduct,
  GeoPoint,
  LatLng,
  MapTiles,
} from './api.ts';
import type { ConsentPurpose } from './config.ts';
import type { Vocabulary } from './rules/copy.ts';

// Typed props per slot (04 — "data in, callbacks out"). Additive-only within a
// Contract major: optional props may be added, nothing removed or retyped.

export interface CheckoutStep {
  id: 'dados' | 'entrega' | 'pagamento';
  label: string;
  done: boolean;
}

export interface CustomerDraft {
  name: string;
  phone: string;
  street: string;
  number: string;
  neighborhood: string;
  complement: string;
  remember: boolean;
  /** Kernel 1.2 */
  cep?: string;
  reference?: string;
}

export interface DeliveryOption {
  mode: 'pickup' | 'delivery';
  label: string;
  detail?: string;
  disabled?: boolean;
  /** Kernel 1.7 — shown while the option is selected (e.g. the store's pickup instructions) */
  note?: string;
}

export interface PaymentMethod {
  /** Kernel 1.7 adds 'card_online' — card through Mercado Pago (in the page since 1.17);
   *  Kernel 1.12 adds 'meal_voucher' ("Vale-refeição", paid on delivery) */
  id: 'pix' | 'card_online' | 'card_on_delivery' | 'cash' | 'meal_voucher';
  label: string;
  detail?: string;
  /** Kernel 1.12 — the store's discount/surcharge for this method, as a label ("−5%",
   *  "+R$ 1,50"); Core prices it into the totals */
  adjustment?: { label: string; kind: 'discount' | 'surcharge' | 'mixed' };
}

/** Kernel 1.7 — what `checkout.PaymentStatus` shows for an online payment:
 *  redirecting — leaving for Mercado Pago's hosted checkout (`href` = the link to tap); only a
 *    Core that still answers `redirect` reaches it — Kernel 1.17 takes the card in the page
 *  confirming — the Kernel is asking the provider (card return, a Pix being generated)
 *  due — not paid yet; `action` starts it
 *  paid — confirmed by the provider (`justPaid` = it happened while this page was open)
 *  processing — the provider is still analysing a card payment
 *  failed — not approved; `action` tries again
 *  expired — the Pix ran out; `action` makes a new one
 *  refunded — money returned (`refundedCents`, less than `amountCents` when partial)
 *  unavailable — the provider didn't answer; `action` retries, `whatsappHref` offers the store */
export type PaymentStatusKind =
  | 'redirecting'
  | 'confirming'
  | 'due'
  | 'paid'
  | 'processing'
  | 'failed'
  | 'expired'
  | 'refunded'
  | 'unavailable';

export type ModifierGroup = ProductDetail['modifierGroups'][number];

/** Kernel 1.14 — what a default needs to format in the store's terms: dates and times in the
 *  store's zone, money in its currency, its words (`store.vocabulary` over the defaults). The
 *  Kernel passes them; an override may ignore them. */
export type StoreTime = {
  /** IANA zone of the store (`store.hours.timezone`) */
  timeZone?: string;
};
export type StoreMoney = {
  currency?: string;
};
export type StoreWords = {
  vocabulary?: Vocabulary;
};

export interface SlotProps {
  'system.Notice': { notice: Notice; onDismiss?: () => void; onAction?: (a: NoticeAction) => void };
  'system.PauseNotice': {
    notice: Notice;
    resumesAt?: string;
    actions: NoticeAction[];
    onNotifyMe?: () => void;
    onDismiss?: () => void;
  } & StoreTime;
  'system.StoreClosedNotice': {
    notice: Notice;
    opensAt?: string;
    onDismiss?: () => void;
  } & StoreTime;
  'system.PromoNotice': { notice: Notice; onDismiss?: () => void };
  'system.ConsentBanner': {
    purposes: { id: ConsentPurpose; label: string }[];
    onAccept: (ids: ConsentPurpose[]) => void;
    onReject: () => void;
  };
  'system.ErrorFallback': { error: { code: string; message: string }; retry: () => void };
  'system.NotFound': { path: string; homeHref: string };
  'system.EmergencyOverlay': { notice: Notice };
  'checkout.Layout': {
    steps: CheckoutStep[];
    current: CheckoutStep['id'];
    onStep: (id: CheckoutStep['id']) => void;
    children: ReactNode;
  };
  'checkout.Summary': {
    cart: Cart;
    currency: string;
    /** Kernel 1.12 — the chosen payment method's name, for the
     *  `totals.paymentAdjustmentCents` line ("Desconto · Pix") */
    paymentLabel?: string;
  } & StoreWords;
  'checkout.AddressForm': {
    value: CustomerDraft;
    onChange: (patch: Partial<CustomerDraft>) => void;
    errors: Partial<Record<keyof CustomerDraft, string>>;
    /** 'customer' = name/phone; 'address' = delivery address */
    part: 'customer' | 'address';
    neighborhoods: string[];
    /** Kernel 1.2 — CEP autofill (Core lookup); absent = no CEP field */
    onCep?: (cep: string) => void;
    cepStatus?: 'idle' | 'pending' | 'found' | 'not_found' | 'unavailable';
    /** Kernel 1.2 — "usar minha localização" (device geolocation → distance pricing) */
    onLocate?: () => void;
    locateStatus?: 'idle' | 'pending' | 'located' | 'denied' | 'out_of_zone';
    /** what Core answered for the address: zone + fee, when known */
    zoneHint?: string;
  };
  /** Kernel 1.15 — distance pricing (ADR 0024): the shopper confirms where the order goes on a
   *  map; the confirmed point is what Core prices. Rendered under the address form. */
  'checkout.LocationPicker': {
    /** where the map opens: the typed address (geocoded), the device's location or the store */
    center: LatLng;
    /** how close `center` is: 'address' opens zoomed in to the door, 'area' further out */
    precision: GeoPoint['precision'];
    /** the confirmed point; null until the shopper confirms one */
    value: LatLng | null;
    tiles: MapTiles;
    /** 'finding' = placing the typed address; 'quoting' = Core is pricing the point */
    status: 'idle' | 'finding' | 'quoting' | 'confirmed' | 'out_of_zone' | 'error';
    /** the confirmed point's price ("3,2 km · R$ 9,50 · 40–50 min") */
    hint?: string;
    /** a validation message ("Confirme o local no mapa.") */
    error?: string;
    onConfirm: (point: LatLng) => void;
    /** re-centres on the device's location; absent = no geolocation */
    onLocate?: () => void;
    locateStatus?: 'idle' | 'pending' | 'denied';
  };
  'checkout.DeliveryOptions': {
    options: DeliveryOption[];
    selected: DeliveryOption['mode'];
    onSelect: (mode: DeliveryOption['mode']) => void;
  } & StoreMoney;
  'checkout.PaymentMethods': {
    methods: PaymentMethod[];
    selected: PaymentMethod['id'];
    onSelect: (id: PaymentMethod['id']) => void;
  } & StoreMoney;
  'checkout.SuccessPage': { order: Order; currency: string } & StoreTime;
  'checkout.EmptyCart': { onBrowse: () => void } & StoreWords;
  'cart.Drawer': {
    cart: Cart;
    currency: string;
    presentation: 'page' | 'drawer';
    onClose: () => void;
    /** the Kernel's CheckoutButton — rendered, never re-implemented */
    checkout: ReactNode;
    lines: ReactNode;
    summary: ReactNode;
  } & StoreWords;
  'cart.LineItem': {
    item: CartItem;
    currency: string;
    pending: boolean;
    /** Kernel 1.9 — the most this line can hold: stock left after the cart's other lines */
    max?: number;
    onQty: (qty: number) => void;
    onRemove: () => void;
  } & StoreWords;
  'order.StatusPage': {
    order: Order;
    currency: string;
    timeline: ReactNode;
    /** Kernel 1.7 — the store's pickup address/instructions, for pickup orders */
    pickup?: { address: string | null; instructions: string | null };
  } & StoreTime;
  'order.Timeline': { events: Order['timeline'] } & StoreTime;
  'store.HoursTable': { hours: StoreProfile['hours']; status?: StoreProfile['status'] };
  'catalog.ProductCard': {
    product: CatalogProduct;
    currency: string;
    href: string;
    /** the Kernel's ProductLink wrapper — renders the anchor with its hooks */
    link: (children: ReactNode) => ReactNode;
    /** Kernel 1.5 — wraps children in the Kernel's add-to-cart button (qty 1). Absent when
     *  the product can't be added from the grid (sold out, combo, options, encomenda). */
    quickAdd?: (children: ReactNode) => ReactNode;
    /** Kernel 1.9 — tracked stock minus what the cart holds (absent = not tracked);
     *  `product.stockQuantity` stays Core's number */
    stockLeft?: number;
  } & StoreWords;
  'catalog.ComboPicker': {
    slots: ComboSlot[];
    value: ComboSelection[];
    onChange: (next: ComboSelection[]) => void;
    currency: string;
    /** slotId → message */
    errors: Record<string, string>;
  };
  'catalog.Gallery': {
    images: { url: string; alt: string | null }[];
    productName: string;
    figureVariant: CatalogProduct['figureVariant'];
  };
  'checkout.CouponField': {
    coupon: CartCoupon | null;
    discountCents: number;
    currency: string;
    pending: boolean;
    error?: string;
    onApply: (code: string) => void;
    onRemove: () => void;
  };
  'checkout.SchedulePicker': {
    /** YYYY-MM-DD, Core's bookable dates */
    dates: string[];
    value: string | undefined;
    onChange: (date: string) => void;
    required: boolean;
    leadDays: number;
    timezone?: string;
    error?: string;
  };
  'checkout.Notes': { value: string; onChange: (v: string) => void; max: number };
  'checkout.PixPayment': {
    /** copia e cola; render as QR + copy button */
    copyPaste: string;
    beneficiary: string;
    keyLabel?: string;
    amountCents?: number;
    currency: string;
    /** Kernel 1.7 — an online Pix (Mercado Pago): confirms by itself, expires at `expiresAt` */
    online?: boolean;
    expiresAt?: string | null;
  } & StoreTime;
  /** Kernel 1.7 — an online payment's state (card via Mercado Pago, online Pix) */
  'checkout.PaymentStatus': {
    status: PaymentStatusKind;
    method: 'pix' | 'card_online';
    amountCents: number;
    currency: string;
    refundedCents?: number;
    justPaid?: boolean;
    /** the Kernel's next step for the shopper (pay, try again, new Pix) */
    action?: { label: string; onClick: () => void; pending?: boolean };
    href?: string;
    whatsappHref?: string;
    /** one line of context, e.g. why the provider call failed */
    detail?: string;
  };
  /** Kernel 1.17 — the card form on the order page: the chrome around the Kernel-owned card
   *  fields (Mercado Pago's Secure Fields, or the bank's 3-D Secure challenge) */
  'checkout.CardPayment': {
    amountCents: number;
    currency: string;
    /** loading — the fields are on their way; ready — fill and pay; challenge — the bank's
     *  verification is in `fields`; unavailable — the fields didn't load */
    phase: 'loading' | 'ready' | 'challenge' | 'unavailable';
    /** why the last attempt was refused, in the shopper's words (a fresh form follows) */
    declined: { title: string; body?: string } | null;
    /** Kernel-owned card fields or challenge frame: render it exactly once and never inspect
     *  or restyle its insides */
    fields: ReactNode;
    whatsappHref?: string;
    /** while unavailable: load the fields again */
    onRetry?: () => void;
  };
  'order.Items': {
    items: OrderItem[];
    currency: string;
    notes?: string | null;
    scheduledFor?: string | null;
    discountCents?: number;
    couponCode?: string | null;
    /** Kernel 1.12 — the payment method's discount (<0) or surcharge (>0) and its name */
    paymentAdjustmentCents?: number;
    paymentLabel?: string;
    /** "pedir de novo" — present when the Kernel can replay the order */
    onReorder?: () => void;
    reorderPending?: boolean;
  } & StoreWords;
  'customer.LoyaltyCard': { card: LoyaltyCard; currency: string } & StoreTime;
  'customer.PhoneVerify': {
    phone: string;
    pending: boolean;
    error?: string;
    onSubmit: (phone: string, orderNumber: number) => void;
  };
  'catalog.ModifierPicker': {
    groups: ModifierGroup[];
    value: Record<string, string[]>;
    onChange: (groupId: string, ids: string[]) => void;
    currency: string;
    errors: Record<string, string>;
    /** Kernel 1.12 — units chosen per picked option id (absent = 1). Options with `maxQty` > 1
     *  take a stepper; a group's min/max count units */
    quantities?: Record<string, number>;
    /** Kernel 1.12 — set an option's units (0 unpicks it); the Kernel clamps to the option's
     *  `maxQty` and to what the group's `maxSelect` leaves */
    onQtyChange?: (groupId: string, modifierId: string, qty: number) => void;
  };
}
