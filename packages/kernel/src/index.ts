// @vendua/kernel — public surface. Deep imports are unsupported by contract
// (03-storefront-contract.md); the exports map + lint enforce it.

export { defineStorefront, SLOT_KEYS } from './config.ts';
export type {
  ContractMajor,
  Ring,
  SlotKey,
  StorefrontConfig,
  StorefrontTokens,
} from './config.ts';

export { VenduaProvider, useKernel } from './provider.tsx';
export { useStore, useCatalog, useProduct, useNotices, useCart, useCheckout } from './hooks.ts';
export type { CartMutations } from './hooks.ts';

export { AddToCart, QuantityStepper, CartTrigger, StoreStatusBadge } from './primitives.tsx';
export type { AddToCartProps, QuantityStepperProps, CartTriggerProps } from './primitives.tsx';

export { SystemSurfaces, SurfaceRegion, GenericNotice } from './SystemSurfaces.tsx';
export { ErrorBoundary } from './error-boundary.tsx';

export { ApiError } from './api.ts';
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
  Order,
  VenduaApi,
} from './api.ts';
