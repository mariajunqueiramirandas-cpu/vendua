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
} from './api.ts';
import type { ConsentPurpose } from './config.ts';

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
}

export interface PaymentMethod {
  id: 'pix' | 'card_on_delivery' | 'cash';
  label: string;
  detail?: string;
}

export type ModifierGroup = ProductDetail['modifierGroups'][number];

export interface SlotProps {
  'system.Notice': { notice: Notice; onDismiss?: () => void; onAction?: (a: NoticeAction) => void };
  'system.PauseNotice': {
    notice: Notice;
    resumesAt?: string;
    actions: NoticeAction[];
    onNotifyMe?: () => void;
    onDismiss?: () => void;
  };
  'system.StoreClosedNotice': { notice: Notice; opensAt?: string; onDismiss?: () => void };
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
  'checkout.Summary': { cart: Cart; currency: string };
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
  'checkout.DeliveryOptions': {
    options: DeliveryOption[];
    selected: DeliveryOption['mode'];
    onSelect: (mode: DeliveryOption['mode']) => void;
  };
  'checkout.PaymentMethods': {
    methods: PaymentMethod[];
    selected: PaymentMethod['id'];
    onSelect: (id: PaymentMethod['id']) => void;
  };
  'checkout.SuccessPage': { order: Order; currency: string };
  'checkout.EmptyCart': { onBrowse: () => void };
  'cart.Drawer': {
    cart: Cart;
    currency: string;
    presentation: 'page' | 'drawer';
    onClose: () => void;
    /** the Kernel's CheckoutButton — rendered, never re-implemented */
    checkout: ReactNode;
    lines: ReactNode;
    summary: ReactNode;
  };
  'cart.LineItem': {
    item: CartItem;
    currency: string;
    pending: boolean;
    onQty: (qty: number) => void;
    onRemove: () => void;
  };
  'order.StatusPage': { order: Order; currency: string; timeline: ReactNode };
  'order.Timeline': { events: Order['timeline'] };
  'store.HoursTable': { hours: StoreProfile['hours']; status?: StoreProfile['status'] };
  'catalog.ProductCard': {
    product: CatalogProduct;
    currency: string;
    href: string;
    /** the Kernel's ProductLink wrapper — renders the anchor with its hooks */
    link: (children: ReactNode) => ReactNode;
  };
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
  };
  'order.Items': {
    items: OrderItem[];
    currency: string;
    notes?: string | null;
    scheduledFor?: string | null;
    discountCents?: number;
    couponCode?: string | null;
    /** "pedir de novo" — present when the Kernel can replay the order */
    onReorder?: () => void;
    reorderPending?: boolean;
  };
  'customer.LoyaltyCard': { card: LoyaltyCard; currency: string };
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
  };
}
