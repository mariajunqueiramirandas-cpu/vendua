import type { ComponentType, LazyExoticComponent } from 'react';
import type { FontSource, StorefrontTokens } from '@vendua/templates';

// compile-time half of the Storefront Contract (03-storefront-contract.md, v2 per ADR 0018)

export type ContractMajor = 2;
export type Ring = 'stable' | 'early' | 'canary';
export type { FontSource, StorefrontTokens };

// slot registry (04-extensions-and-overrides.md#slot-registry) — additive only
export const SLOT_KEYS = [
  'system.Notice',
  'system.PauseNotice',
  'system.StoreClosedNotice',
  'system.ConsentBanner',
  'system.ErrorFallback',
  'system.NotFound',
  'system.EmergencyOverlay',
  'system.PromoNotice',
  'checkout.Layout',
  'checkout.Summary',
  'checkout.AddressForm',
  'checkout.DeliveryOptions',
  'checkout.PaymentMethods',
  'checkout.SuccessPage',
  'checkout.EmptyCart',
  'cart.Drawer',
  'cart.LineItem',
  'order.StatusPage',
  'order.Timeline',
  'store.HoursTable',
  'catalog.ProductCard',
  'catalog.ModifierPicker',
  // Kernel 1.2 — commerce completeness (roadmap Phase 2)
  'catalog.ComboPicker',
  'catalog.Gallery',
  'checkout.CouponField',
  'checkout.SchedulePicker',
  'checkout.Notes',
  'checkout.PixPayment',
  'order.Items',
  'customer.LoyaltyCard',
  'customer.PhoneVerify',
  // Kernel 1.7 — online payments
  'checkout.PaymentStatus',
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

/** Renamed slots keep their old key for the rest of the major (04 — deprecation
 *  lifecycle). `vendua check` warns and names the codemod that rewrites them. */
export const SLOT_ALIASES = {
  'system.StorePausedNotice': { to: 'system.PauseNotice', codemod: 'c3-rehearsal' },
} as const satisfies Record<string, { to: SlotKey; codemod: string }>;
export type DeprecatedSlotKey = keyof typeof SLOT_ALIASES;

export type SlotComponent =
  | ComponentType<Record<string, unknown>>
  | LazyExoticComponent<ComponentType<Record<string, unknown>>>;

export type ConsentPurpose = 'analytics' | 'marketing';

export interface StorefrontConfig {
  contract: ContractMajor;
  /** @deprecated The ring is Control Plane data (storefront_ops.ring) — ignored
   *  here, removed in Contract 3; the `c3-rehearsal` codemod deletes it. */
  ring?: Ring;
  tokens: StorefrontTokens;
  /** Last resort (17 — styling API): an overridden slot stops receiving Kernel improvements. */
  overrides?: Partial<
    Record<SlotKey | DeprecatedSlotKey, () => Promise<{ default: SlotComponent }>>
  >;
  /** Brand-page URLs. Kernel pages (/sacola, /checkout, /pedido/:id, /pedidos) are fixed. */
  paths?: { catalog?: string; product?: `${string}:slug${string}` };
  /** Old URLs kept alive (e.g. '/cart' → '/sacola'). */
  redirects?: Record<string, string>;
  /** Non-essential purposes the store asks consent for; none → no consent banner. */
  consent?: { purposes: ConsentPurpose[] };
  /** CDN template for `Img` srcsets: `{src}` and `{w}` are substituted. */
  images?: { cdn?: string };
  budgets?: 'default' | Record<string, number>;
}

export function defineStorefront(config: StorefrontConfig): StorefrontConfig {
  return config;
}

export const KERNEL_PATHS = {
  cart: '/sacola',
  checkout: '/checkout',
  order: '/pedido/:id',
  orders: '/pedidos',
} as const;

export function resolvePaths(config: StorefrontConfig) {
  return {
    home: '/',
    catalog: config.paths?.catalog ?? '/cardapio',
    product: config.paths?.product ?? '/produto/:slug',
    ...KERNEL_PATHS,
  };
}

export function productHref(config: StorefrontConfig, slug: string): string {
  return resolvePaths(config).product.replace(':slug', encodeURIComponent(slug));
}
