import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { findMigration, runMigration } from '../src/index.ts';
import { readTemplatesDir } from '../src/node.ts';
import { SDK_SCHEMAS, catalogOf } from '../../kernel/src/sdk/schemas.ts';

const REPO = join(import.meta.dir, '../../..');
const m = findMigration('2026-09-delivery-eta-on-product')!;
const sections = catalogOf(SDK_SCHEMAS) as never;

describe('2026-09-delivery-eta-on-product', () => {
  for (const store of ['storefronts/_template', 'storefronts/quero-pudim']) {
    test(`lands in the purchase panel's after-price area on ${store}`, () => {
      const product = readTemplatesDir(join(REPO, store, 'templates')).product!;
      const r = runMigration(m, product, { kernelVersion: '1.1.0', sections });
      expect(r.status).toBe('applied');
      if (r.status !== 'applied') return;
      const panel = r.template.sections.find((s) => s.type === 'sdk:purchase-panel')!;
      expect(panel.blocks?.['after-price']?.at(-1)?.type).toBe('sdk:delivery-eta');
      // merchant settings untouched
      expect(panel.settings).toEqual(
        product.sections.find((s) => s.type === 'sdk:purchase-panel')!.settings,
      );
      expect(runMigration(m, r.template, { kernelVersion: '1.1.0', sections }).status).toBe(
        'skipped',
      );
    });
  }

  test('a store still on Kernel 1.0 is skipped, not broken', () => {
    const product = readTemplatesDir(join(REPO, 'storefronts/_template/templates')).product!;
    expect(runMigration(m, product, { kernelVersion: '1.0.0', sections })).toMatchObject({
      status: 'skipped',
    });
  });
});

describe('2026-09-loyalty-teaser-on-product', () => {
  const lt = findMigration('2026-09-loyalty-teaser-on-product')!;
  for (const store of ['storefronts/_template', 'storefronts/quero-pudim']) {
    test(`lands in a promo-accepting area on ${store}, idempotently`, () => {
      const product = readTemplatesDir(join(REPO, store, 'templates')).product!;
      const r = runMigration(lt, product, { kernelVersion: '1.2.0', sections });
      expect(r.status).toBe('applied');
      if (r.status !== 'applied') return;
      const placed = r.template.sections.flatMap((s) =>
        Object.values(s.blocks ?? {}).flatMap((bs) => bs.map((b) => b.type)),
      );
      expect(placed).toContain('sdk:loyalty-teaser');
      expect(runMigration(lt, r.template, { kernelVersion: '1.2.0', sections }).status).toBe(
        'skipped',
      );
    });
  }

  test('Kernel 1.1 stores are skipped', () => {
    const product = readTemplatesDir(join(REPO, 'storefronts/_template/templates')).product!;
    expect(runMigration(lt, product, { kernelVersion: '1.1.1', sections }).status).toBe('skipped');
  });
});
