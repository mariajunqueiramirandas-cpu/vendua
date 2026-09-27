// `virtual:vendua/storefront` — provided by the `vendua()` Vite plugin; referenced
// from the Kernel entry so every storefront program sees it.
declare module 'virtual:vendua/storefront' {
  import type { StorefrontBundle } from '@vendua/kernel';
  export const snapshot: StorefrontBundle['snapshot'];
  export const sections: StorefrontBundle['sections'];
  const bundle: StorefrontBundle;
  export default bundle;
}
