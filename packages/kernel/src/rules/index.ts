// @vendua/kernel/rules — the Kernel's presentation rules over Core's fields, pure (no React,
// no DOM beyond Intl). Also re-exported from `@vendua/kernel`; `@vendua/ui-defaults` and the
// merchant admin import this subpath. Additive-only within Contract 2 (API.md, RULES_V1).

export {
  LOCALE,
  formatCents,
  formatCentsParts,
  formatDateTime,
  formatTime,
  formatDay,
  formatWhen,
  localNow,
  plural,
  foldText,
  interpolate,
  countdown,
  MEDIA_WIDTHS,
  mediaSrcSet,
} from './format.ts';
export { priceDisplay, priceWords } from './price.ts';
export type { PriceDisplay, PriceInput } from './price.ts';
export { MAX_LINE_QTY, cardState } from './card.ts';
export type { CardInput, CardState } from './card.ts';
export { arrangeMenu, matchProduct } from './menu.ts';
export { hoursRows, todayHours, statusHint, statusWords } from './hours.ts';
export type { HoursRow, HoursWindow, StatusHint, StoreHours, TodayHours } from './hours.ts';
export { zoneFeeFloor, deliverySummary, deliveryWords } from './delivery.ts';
export type { DeliverySummary, DeliveryWords } from './delivery.ts';
export {
  KERNEL_PATHS,
  DEFAULT_PATHS,
  resolvePaths,
  productHref,
  catalogHref,
  productAnchor,
  absoluteUrl,
  whatsappDigits,
  whatsappUrl,
  instagramHandle,
  instagramUrl,
  phoneDisplay,
  contactLinks,
} from './links.ts';
export type { ContactLinks } from './links.ts';
export { digitsOf, isValidPhone, phoneKey, maskPhone, maskCep, isValidCep } from './phone.ts';
export { noticeSeverity, noticeLinks, isBlocking, visibleNotices } from './notices.ts';
export {
  ORDER_STATE_LABEL,
  TERMINAL_ORDER_STATES,
  orderPath,
  orderProgress,
  orderStepLabel,
  PAYMENT_METHOD_LABEL,
  PAYMENT_LABEL,
  PAYMENT_METHOD_ORDER,
  PAYMENT_METHOD_DETAIL,
  PAYMENT_STATUS_LABEL,
  PIX_KEY_LABEL,
  adjustmentKind,
  adjustmentShort,
  adjustmentText,
  lineSummary,
} from './orders.ts';
export type { OrderProgress } from './orders.ts';
export { ERROR_COPY, errorCopy, COUPON_REASON, isCouponError, couponMessage } from './errors.ts';
export { qrMatrix, qrSvgPath, qrSvg } from './qr.ts';
export { DEFAULT_VOCABULARY, vocabularyOf } from './copy.ts';
export type { Vocabulary } from './copy.ts';
