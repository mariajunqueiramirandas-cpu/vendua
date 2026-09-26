// `virtual:vendua/storefront` — provided by the `vendua()` Vite plugin. Storefronts
// reference this file via `@vendua/kernel/client` in their tsconfig types.
declare module 'virtual:vendua/storefront' {
  import type { StorefrontBundle } from '@vendua/kernel';
  export const snapshot: StorefrontBundle['snapshot'];
  export const sections: StorefrontBundle['sections'];
  const bundle: StorefrontBundle;
  export default bundle;
}
