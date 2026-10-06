import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Storefronts may switch on the Kernel's ERROR_CODES (packages/kernel/src/api.ts);
// every literal code the storefront/checkout surfaces throw must be listed there.
// Staff-only modules (CRM, agent, channels) are out of scope.
const STOREFRONT_MODULES = [
  'platform/http.ts',
  'platform/tenancy.ts',
  'modules/cart.ts',
  'modules/cart-share.ts',
  'modules/cart-reminder.ts',
  'modules/cart-ops.ts',
  'modules/catalog.ts',
  'modules/catalog-search.ts',
  'modules/checkout.ts',
  'modules/combos.ts',
  'modules/commerce-routes.ts',
  'modules/coupons.ts',
  'modules/customer.ts',
  'modules/geo.ts',
  'modules/orders.ts',
  'modules/payments/store-payments.ts',
  'modules/place-order.ts',
  'modules/preorder.ts',
  'modules/stock.ts',
  'modules/storefront-platform.ts',
];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('error codes', () => {
  test('every HttpError code Core throws is in the Kernel ERROR_CODES', () => {
    const api = readFileSync(join(import.meta.dir, '../../kernel/src/api.ts'), 'utf8');
    const start = api.indexOf('export const ERROR_CODES');
    const block = api.slice(start, api.indexOf('] as const', start));
    const known = new Set([...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
    const thrown = new Set<string>();
    const scoped = files(join(import.meta.dir, '../src')).filter((f) =>
      STOREFRONT_MODULES.some((m) => f.endsWith(m)),
    );
    expect(scoped).toHaveLength(STOREFRONT_MODULES.length);
    for (const f of scoped) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/HttpError\(\s*\d{3},\s*'([A-Z_]+)'/g)) thrown.add(m[1]!);
    }
    expect(thrown.size).toBeGreaterThan(40);
    expect([...thrown].filter((c) => !known.has(c)).sort()).toEqual([]);
  });
});
