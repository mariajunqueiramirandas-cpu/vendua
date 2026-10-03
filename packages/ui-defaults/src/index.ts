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
  ComboPicker,
  CouponField,
  Gallery,
  LoyaltyCard,
  Notes,
  OrderItems,
  PhoneVerify,
  PixPayment,
  SchedulePicker,
} from './growth.tsx';
import { PaymentStatus } from './payment.tsx';
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
import { LocationPicker } from './location.tsx';
import { StoreChat } from './chat.tsx';

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
  'catalog.ComboPicker': ComboPicker,
  'catalog.Gallery': Gallery,
  'checkout.CouponField': CouponField,
  'checkout.SchedulePicker': SchedulePicker,
  'checkout.Notes': Notes,
  'checkout.PixPayment': PixPayment,
  'order.Items': OrderItems,
  'customer.LoyaltyCard': LoyaltyCard,
  'customer.PhoneVerify': PhoneVerify,
  'checkout.LocationPicker': LocationPicker,
  'checkout.PaymentStatus': PaymentStatus,
  'system.Chat': StoreChat,
};

export { noticeSeverity, noticeLinks, NoticeCard } from './system.tsx';
export { QtyControl } from './commerce.tsx';
export {
  money,
  dateTime,
  time,
  dayLabel,
  ORDER_STATE_LABEL,
  PAYMENT_LABEL,
  COUPON_REASON,
  MEDIA_WIDTHS,
  mediaSrcSet,
  countdown,
} from './format.ts';
export { PixQr } from './growth.tsx';
export { Calendar, type CalendarProps } from './calendar.tsx';
export { qrMatrix, qrSvgPath } from './qr.ts';
export { SLOT_FIXTURES } from './fixtures.tsx';
