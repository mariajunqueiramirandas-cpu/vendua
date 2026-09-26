import type { ComponentType } from 'react';
import type { SlotKey, SlotProps } from '@vendua/kernel';
import {
  AddressForm,
  CheckoutLayout,
  CheckoutSummary,
  DeliveryOptions,
  EmptyCart,
  PaymentMethods,
  SuccessPage,
} from './checkout.tsx';
import {
  CartDrawer,
  CartLineItem,
  HoursTable,
  ModifierPicker,
  OrderStatusPage,
  OrderTimeline,
  ProductCard,
} from './commerce.tsx';
import {
  ConsentBanner,
  EmergencyOverlay,
  ErrorFallback,
  NoticeCard,
  NotFound,
  PauseNotice,
  PromoNotice,
  StoreClosedNotice,
} from './system.tsx';

// @vendua/ui-defaults — the token-driven default for EVERY registered slot
// (02-kernel.md#packages). Presentational only: the Kernel owns data + behavior
// and hands these props; styles live in styles.css under @layer vendua.

export type SlotDefaults = { [K in SlotKey]: ComponentType<SlotProps[K]> };

export const SLOT_DEFAULTS: SlotDefaults = {
  'system.Notice': NoticeCard,
  'system.PauseNotice': PauseNotice,
  'system.StoreClosedNotice': StoreClosedNotice,
  'system.PromoNotice': PromoNotice,
  'system.ConsentBanner': ConsentBanner,
  'system.ErrorFallback': ErrorFallback,
  'system.NotFound': NotFound,
  'system.EmergencyOverlay': EmergencyOverlay,
  'checkout.Layout': CheckoutLayout,
  'checkout.Summary': CheckoutSummary,
  'checkout.AddressForm': AddressForm,
  'checkout.DeliveryOptions': DeliveryOptions,
  'checkout.PaymentMethods': PaymentMethods,
  'checkout.SuccessPage': SuccessPage,
  'checkout.EmptyCart': EmptyCart,
  'cart.Drawer': CartDrawer,
  'cart.LineItem': CartLineItem,
  'order.StatusPage': OrderStatusPage,
  'order.Timeline': OrderTimeline,
  'store.HoursTable': HoursTable,
  'catalog.ProductCard': ProductCard,
  'catalog.ModifierPicker': ModifierPicker,
};

export { noticeSeverity, noticeLinks, NoticeCard } from './system.tsx';
export { QtyControl } from './commerce.tsx';
export { money, dateTime, time, ORDER_STATE_LABEL, PAYMENT_LABEL } from './format.ts';
export { SLOT_FIXTURES } from './fixtures.tsx';
