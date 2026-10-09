/// <reference path="./virtual.d.ts" />
// @vendua/kernel v1 — the frozen public surface (docs/architecture/02-kernel.md,
// packages/kernel/API.md). Everything a storefront may touch is exported here;
// the package `exports` map hides the rest. Additive-only within Contract 2.

export { defineStorefront, SLOT_KEYS, SLOT_ALIASES } from './config.ts';
export type {
  ConsentPurpose,
  ContractMajor,
  DeprecatedSlotKey,
  FontSource,
  Ring,
  SlotKey,
  StorefrontConfig,
  StorefrontTokens,
} from './config.ts';
export type {
  CheckoutStep,
  CustomerDraft,
  DeliveryOption,
  ModifierGroup,
  PaymentMethod,
  PaymentStatusKind,
  SlotProps,
  StoreMoney,
  StoreTime,
  StoreWords,
} from './slot-props.ts';

// runtime + required mounts
export { VenduaProvider } from './provider.tsx';
export { SystemSurfaces, SurfaceRegion } from './SystemSurfaces.tsx';
export { StorefrontRoutes, KERNEL_ROUTES } from './router.tsx';
export { ErrorBoundary } from './error-boundary.tsx';

// data hooks
export {
  useStore,
  useCatalog,
  useProduct,
  useNotices,
  useCart,
  useCheckout,
  useDeliveryZones,
  useDeliveryQuote,
  useOrder,
  useOrderHistory,
  useCustomer,
  useAnalytics,
  useConsent,
  useOrders,
  useLoyalty,
  useCep,
  useWaitlist,
  useStockLeft,
  // Kernel 1.14 — the rules bound to the store's live data
  useCardState,
  useMenu,
  useStoreStatus,
  useStoreHours,
  useDeliverySummary,
  useMoney,
  useLinks,
  useCopy,
  useCartCount,
  useCoupon,
  useCouponCheck,
  useLineQuote,
  usePixTimer,
  useReducedMotion,
  useScrollSpy,
} from './hooks.ts';
export type { CartMutations, CustomerProfile, QueryError } from './hooks.ts';
export { useErrorSurface } from './errors.ts';
// Kernel 1.18 — the store's assistant (the Vendedor) chatting on the site
export { useStoreChat } from './chat.ts';
// Kernel 1.22 — the table whose QR code opened the store (ADR 0036)
export { useTable } from './table.ts';

// Kernel 1.14 — presentation rules (pure; also `@vendua/kernel/rules`) and display components
export * from './rules/index.ts';
export { ProductPrice, ProductImage, QrCode } from './display.tsx';
export type { ProductPriceProps, ProductImageProps, QrCodeProps } from './display.tsx';
export { haptic } from './haptics.ts';
export { Slot } from './slot.tsx';

// primitives (ADR 0007)
export {
  AddToCart,
  CartTrigger,
  CheckoutButton,
  Img,
  NotifyMeButton,
  ProductLink,
  QuantityStepper,
  StoreStatusBadge,
} from './primitives.tsx';
export type {
  AddToCartProps,
  CartTriggerProps,
  CheckoutButtonProps,
  ImgProps,
  NotifyMeButtonProps,
  ProductLinkProps,
  QuantityStepperProps,
  StoreStatusBadgeProps,
} from './primitives.tsx';

// page composition (Contract 2, ADR 0018)
export {
  defineSection,
  defineBlock,
  text,
  richText,
  number,
  boolean,
  select,
  image,
  url,
  product,
  category,
  list,
} from './composition/schema.ts';
export type {
  AreaSpec,
  BlockSchema,
  BooleanField,
  CategoryField,
  Field,
  ImageField,
  ListField,
  NumberField,
  ProductField,
  RichTextField,
  SectionSchema,
  SelectField,
  SettingsValues,
  TextField,
  UrlField,
} from './composition/schema.ts';
export { BlockArea, usePageContext } from './composition/runtime.tsx';
export type { PageContextValue } from './composition/runtime.tsx';
export type {
  BlockProps,
  SectionProps,
  StorefrontBundle,
  StorefrontSnapshot,
} from './composition/registry.ts';

// Core API types + helpers
export { ApiError, ERROR_CODES } from './api.ts';
export type {
  ApiErrorBody,
  StoreProfile,
  CatalogProduct,
  CatalogCategory,
  ProductDetail,
  Notice,
  NoticeAction,
  NoticeSeverity,
  SurfacesEnvelope,
  StateEnvelope,
  Cart,
  CartItem,
  CartTotals,
  CheckoutInput,
  DeliveryZone,
  ErrorCode,
  Order,
  QuoteResult,
  // Kernel 1.2
  CartCoupon,
  CartSchedule,
  CepResult,
  ComboSelection,
  ComboSlot,
  CouponCheck,
  DeliveryAddress,
  ImportLine,
  ImportReport,
  LoyaltyCard,
  OrderItem,
  OrderSummary,
  PixInfo,
  // Kernel 1.7
  PaymentNext,
  // Kernel 1.19
  CardPaymentInput,
  DeclineReason,
  // Kernel 1.12
  ModifierPricingRule,
  PaymentAdjustment,
  // Kernel 1.14
  AddedLine,
  LinePicks,
  LineQuote,
  SpecialDay,
  StoreMeta,
  // Kernel 1.15
  DistancePricing,
  GeoPoint,
  LatLng,
  MapTiles,
  // Kernel 1.18
  StoreChat,
  StoreChatMessage,
  // Kernel 1.24
  StoreChatMedia,
  StoreChatMediaKinds,
  // Kernel 1.21
  OrderTracking,
  // Kernel 1.22
  TableInfo,
} from './api.ts';
