/// <reference path="./virtual.d.ts" />
// @vendua/kernel v1 — the frozen public surface (docs/architecture/02-kernel.md,
// packages/kernel/API.md). Everything a storefront may touch is exported here;
// the package `exports` map hides the rest. Additive-only within Contract 2.

export { defineStorefront, SLOT_KEYS, SLOT_ALIASES, KERNEL_PATHS } from './config.ts';
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
  SlotProps,
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
} from './hooks.ts';
export type { CartMutations, CustomerProfile, QueryError } from './hooks.ts';
export { useErrorSurface } from './errors.ts';

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
export { ApiError, ERROR_CODES, formatCents } from './api.ts';
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
} from './api.ts';
