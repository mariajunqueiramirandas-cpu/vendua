// @vendua/kernel — public surface. Deep imports are unsupported by contract
// (03-storefront-contract.md); the exports map + lint enforce it.

export { defineStorefront, SLOT_KEYS } from './config.ts';
export type {
  ContractMajor,
  FontSource,
  Ring,
  SlotKey,
  StorefrontConfig,
  StorefrontTokens,
} from './config.ts';

export { VenduaProvider, useKernel, invalidateQuery } from './provider.tsx';
export {
  useStore,
  useCatalog,
  useProduct,
  useNotices,
  useCart,
  useCheckout,
  useDeliveryZones,
  useOrder,
} from './hooks.ts';
export type { CartMutations, QueryError } from './hooks.ts';

export { AddToCart, QuantityStepper, CartTrigger, StoreStatusBadge } from './primitives.tsx';
export type { AddToCartProps, QuantityStepperProps, CartTriggerProps } from './primitives.tsx';

export { SystemSurfaces, SurfaceRegion, GenericNotice } from './SystemSurfaces.tsx';
export type { NoticeOverrideProps } from './SystemSurfaces.tsx';
export { ErrorBoundary } from './error-boundary.tsx';

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
  Cart,
  CartItem,
  CartTotals,
  CheckoutInput,
  DeliveryZone,
  ErrorCode,
  Order,
  QuoteResult,
  VenduaApi,
} from './api.ts';
