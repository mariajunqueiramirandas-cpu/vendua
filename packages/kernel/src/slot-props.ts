import type { ReactNode } from 'react';
import type {
  Cart,
  CartItem,
  Notice,
  NoticeAction,
  Order,
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
  'catalog.ModifierPicker': {
    groups: ModifierGroup[];
    value: Record<string, string[]>;
    onChange: (groupId: string, ids: string[]) => void;
    currency: string;
    errors: Record<string, string>;
  };
}
