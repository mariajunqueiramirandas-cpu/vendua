import { describe, expect, test } from 'bun:test';
import pkg from '../package.json' with { type: 'json' };

// Kernel 1.14 — `@vendua/kernel/rules`, pure: every name is also a main-entry export.
const RULES_V1 = [
  'COUPON_REASON',
  'DEFAULT_PATHS',
  'DEFAULT_VOCABULARY',
  // Kernel 1.21 — allergen and diet tags
  'DIETARY_FILTERS',
  'DIETARY_LABEL',
  'ERROR_COPY',
  'KERNEL_PATHS',
  'LOCALE',
  'MAX_LINE_QTY',
  'MEDIA_WIDTHS',
  'ORDER_STATE_LABEL',
  'PAYMENT_LABEL',
  'PAYMENT_METHOD_DETAIL',
  'PAYMENT_METHOD_LABEL',
  'PAYMENT_METHOD_ORDER',
  'PAYMENT_STATUS_LABEL',
  'PIX_KEY_LABEL',
  'REFUNDED_PAYMENT_STATUSES',
  'TERMINAL_ORDER_STATES',
  'absoluteUrl',
  'adjustmentKind',
  'adjustmentShort',
  'adjustmentText',
  'arrangeMenu',
  'cardState',
  'catalogHref',
  'changeMessage',
  'contactLinks',
  'countdown',
  'couponMessage',
  'deliverySummary',
  'deliveryWords',
  'dietaryBadges',
  'digitsOf',
  'errorCopy',
  'foldText',
  'formatCents',
  'formatCentsParts',
  'formatDateTime',
  'formatDay',
  'formatTime',
  'formatWhen',
  'groupFull',
  'groupHint',
  'groupMissing',
  'hoursRows',
  'instagramHandle',
  'instagramUrl',
  'interpolate',
  'isBlocking',
  'isCouponError',
  'isValidCep',
  'isValidPhone',
  'lineSummary',
  'localNow',
  'maskCep',
  'maskPhone',
  'matchProduct',
  'mediaSrcSet',
  'modifierMax',
  'modifierUnits',
  'noticeLinks',
  'noticeSeverity',
  'orderPath',
  'orderProgress',
  'orderStepLabel',
  'phoneDisplay',
  'phoneKey',
  'plural',
  'priceDisplay',
  'priceWords',
  'productAnchor',
  'productHref',
  'qrMatrix',
  'qrSvg',
  'qrSvgPath',
  'resolvePaths',
  'slotFull',
  'slotHint',
  'slotMissing',
  'slotUnits',
  'statusHint',
  'statusWords',
  'takesOrders',
  'todayHours',
  'visibleNotices',
  'vocabularyOf',
  'whatsappDigits',
  'whatsappUrl',
  'zoneFeeFloor',
];

// `@vendua/kernel/sdk-catalog` — the SDK schemas as data, for the build plugin and the merchant
// admin; frozen like the main entry.
const SDK_CATALOG_V1 = [
  'DEFAULT_TEMPLATES',
  'PREVIEW_MESSAGE',
  'PREVIEW_QUERY_PARAM',
  'SDK_SCHEMAS',
  'announcementBar',
  'bagBar',
  'catalogGrid',
  'catalogOf',
  'deliveryEta',
  'footer',
  'header',
  'headerCart',
  'loyaltyTeaser',
  'notifyMe',
  'pageContent',
  'pixInfo',
  'productList',
  'promoBadge',
  'purchasePanel',
  // Kernel 1.21 — the returning shopper's last order
  'recentOrder',
  'resolveSettings',
  'richTextSection',
  'stockCounter',
  'storeStatus',
];

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
  'useCep',
  'useErrorSurface',
  'useLoyalty',
  'useNotices',
  'useOrder',
  'useOrderHistory',
  'useOrders',
  'usePageContext',
  'useProduct',
  'useStockLeft',
  'useStore',
  'useWaitlist',
  // Kernel 1.14 — hooks and components over the rules, `haptic`, `Slot`
  'ProductImage',
  'ProductPrice',
  'QrCode',
  'Slot',
  'haptic',
  'useCardState',
  'useCartCount',
  'useCopy',
  'useCoupon',
  'useCouponCheck',
  'useDeliverySummary',
  'useLineQuote',
  'useLinks',
  'useMenu',
  'useMoney',
  'usePixTimer',
  'useReducedMotion',
  'useScrollSpy',
  'useStoreHours',
  'useStoreStatus',
  // Kernel 1.18 — the store's assistant (the Vendedor) chatting on the site
  'useStoreChat',
  // …and every rule (RULES_V1), also served by the main entry
  ...RULES_V1,
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
      './config',
      './package.json',
      './rules',
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

  test('the rules entry matches the frozen list, documented, and stays pure', async () => {
    const mod = await import('../src/rules/index.ts');
    const now = Object.keys(mod).sort();
    expect(
      RULES_V1.filter((k) => !now.includes(k)),
      'removing a rule is a Contract major',
    ).toEqual([]);
    expect(
      now.filter((k) => !RULES_V1.includes(k)),
      'new rules need API.md + RULES_V1',
    ).toEqual([]);
    const doc = await Bun.file(new URL('../API.md', import.meta.url)).text();
    expect(RULES_V1.filter((k) => !doc.includes(`\`${k}\``))).toEqual([]);
    // no React, no ui-defaults (it imports the rules: a cycle), no Kernel runtime modules
    const glob = new Bun.Glob('*.ts');
    for await (const f of glob.scan(new URL('../src/rules', import.meta.url).pathname)) {
      const src = await Bun.file(new URL(`../src/rules/${f}`, import.meta.url)).text();
      const runtime = [...src.matchAll(/^import (?!type )[^;]*from '([^']+)';/gm)].map((m) => m[1]);
      expect(
        runtime.filter((m) => !m!.startsWith('./')),
        `${f} imports only sibling rules at runtime`,
      ).toEqual([]);
    }
  });

  test('the sdk-catalog entry matches the frozen list, documented', async () => {
    const mod = await import('../src/sdk/schemas.ts');
    const now = Object.keys(mod).sort();
    expect(
      SDK_CATALOG_V1.filter((k) => !now.includes(k)),
      'removing an sdk-catalog export is a Contract major',
    ).toEqual([]);
    expect(
      now.filter((k) => !SDK_CATALOG_V1.includes(k)),
      'new sdk-catalog exports need API.md + SDK_CATALOG_V1',
    ).toEqual([]);
    const doc = await Bun.file(new URL('../API.md', import.meta.url)).text();
    expect(SDK_CATALOG_V1.filter((k) => !doc.includes(`\`${k}\``))).toEqual([]);
  });

  test('kernel carries real semver', () => {
    expect(pkg.version).toMatch(/^[1-9]\d*\.\d+\.\d+$/);
  });
});
