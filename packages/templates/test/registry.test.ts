import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { findMigration, runMigration } from '../src/index.ts';
import { readTemplatesDir } from '../src/node.ts';
import { SDK_SCHEMAS, catalogOf } from '../../kernel/src/sdk/schemas.ts';

const REPO = join(import.meta.dir, '../../..');
const m = findMigration('2026-09-delivery-eta-on-product')!;
const sections = catalogOf(SDK_SCHEMAS) as never;

describe('2026-09-delivery-eta-on-product', () => {
  for (const store of [
    'storefronts/_template',
    'storefronts/quero-pudim',
    'storefronts/_examples/quero-pudim',
  ]) {
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
