import type { ComponentType, LazyExoticComponent } from 'react';

// compile-time half of docs/architecture/03-storefront-contract.md

export type ContractMajor = 1;
export type Ring = 'stable' | 'preview' | 'canary';

// slot registry v1 (04-extensions-and-overrides.md#slot-registry)
export const SLOT_KEYS = [
  'system.Notice',
  'system.StorePausedNotice',
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
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

// one @font-face — `family` must equal a font role's family name so `--v-font-*` resolves
export interface FontSource {
  family: string;
  src: string;
  weight?: number | string;
  style?: 'normal' | 'italic';
}

export interface StorefrontTokens {
  color: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    onAccent: string;
    danger: string;
    success: string;
  };
  font: { display: string; body: string; mono?: string; srcs?: FontSource[] };
  radius: { sm: string; md: string; lg: string };
  space: { scale: number | string[] };
  motion: { duration: string; easing: string };
}

export type SlotComponent =
  | ComponentType<Record<string, unknown>>
  | LazyExoticComponent<ComponentType<Record<string, unknown>>>;

export interface StorefrontConfig {
  contract: ContractMajor;
  ring: Ring;
  tokens: StorefrontTokens;
  overrides?: Partial<Record<SlotKey, () => Promise<{ default: SlotComponent }>>>;
  routes?: string;
  budgets?: 'default' | Record<string, number>;
}

export function defineStorefront(config: StorefrontConfig): StorefrontConfig {
  return config;
}
