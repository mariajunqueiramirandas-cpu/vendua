import { describe, expect, test } from 'bun:test';
import pkg from '../package.json' with { type: 'json' };

// The v1.0 freeze (roadmap 1b-i): every runtime export is intended and listed in
// API.md. Adding one is a Kernel minor (update both); removing or renaming one is
// a Contract major — this test fails loudly either way.
const FROZEN_V1 = [
  'AddToCart',
  'ApiError',
  'BlockArea',
  'CartTrigger',
  'CheckoutButton',
  'ERROR_CODES',
  'ErrorBoundary',
  'Img',
  'KERNEL_PATHS',
  'KERNEL_ROUTES',
  'NotifyMeButton',
  'ProductLink',
  'QuantityStepper',
  'SLOT_ALIASES',
  'SLOT_KEYS',
  'StoreStatusBadge',
  'StorefrontRoutes',
  'SurfaceRegion',
  'SystemSurfaces',
  'VenduaProvider',
  'boolean',
  'category',
  'defineBlock',
  'defineSection',
  'defineStorefront',
  'formatCents',
  'image',
  'list',
  'number',
  'product',
  'richText',
  'select',
  'text',
  'url',
  'useAnalytics',
  'useCart',
  'useCatalog',
  'useCheckout',
  'useConsent',
  'useCustomer',
  'useDeliveryQuote',
  'useDeliveryZones',
  'useErrorSurface',
  'useNotices',
  'useOrder',
  'useOrderHistory',
  'usePageContext',
  'useProduct',
  'useStore',
];

describe('public surface', () => {
  test('runtime exports match the frozen v1 list', async () => {
    const mod = await import('../src/index.ts');
    const now = Object.keys(mod).sort();
    const removed = FROZEN_V1.filter((k) => !now.includes(k));
    expect(removed, 'removing an export is a Contract major').toEqual([]);
    expect(
      now.filter((k) => !FROZEN_V1.includes(k)),
      'new exports need API.md + this list',
    ).toEqual([]);
  });

  test('the exports map hides internals', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './client',
      './config',
      './package.json',
      './sdk-catalog',
      './styles.css',
      './vite',
    ]);
  });

  test('API.md documents every export', async () => {
    const doc = await Bun.file(new URL('../API.md', import.meta.url)).text();
    const missing = FROZEN_V1.filter((k) => !doc.includes(`\`${k}\``));
    expect(missing).toEqual([]);
  });

  test('kernel carries real semver', () => {
    expect(pkg.version).toMatch(/^[1-9]\d*\.\d+\.\d+$/);
  });
});
