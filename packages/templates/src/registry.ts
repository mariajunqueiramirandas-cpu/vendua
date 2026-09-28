import {
  defineTemplateMigration,
  findArea,
  MigrationConflict,
  type TemplateMigration,
} from './migrations.ts';

// Every fleet template migration, oldest first. Core runs them (dry-run, then by
// ring); ids are permanent — Core records applications by id.

/** Kernel 1.1's `sdk:delivery-eta` on every product page, in the first area of the
 *  page that accepts `info` blocks — whichever section (SDK or the store's own)
 *  owns it, per the store's recorded build manifest. */
const deliveryEtaOnProduct = defineTemplateMigration({
  id: '2026-09-delivery-eta-on-product',
  description:
    'place sdk:delivery-eta (Kernel 1.1) in the first product-page area accepting info blocks',
  requiresKernel: '>=1.1.0',
  pages: ['product'],
  up(t, ctx) {
    if (t.has('sdk:delivery-eta')) return;
    const hit = findArea(t, 'info', ctx.sections);
    if (!hit)
      throw new MigrationConflict(
        'no area on the product page accepts info blocks (or it is full)',
      );
    t.addBlock(hit.section, hit.area, { type: 'sdk:delivery-eta' });
  },
});

/** Kernel 1.2's `sdk:loyalty-teaser` on every product page, in the first area that
 *  accepts `promo` blocks. It renders nothing until the store runs a stamp card, so
 *  placing it everywhere is safe — turning the program on is then pure data. */
const loyaltyTeaserOnProduct = defineTemplateMigration({
  id: '2026-09-loyalty-teaser-on-product',
  description:
    'place sdk:loyalty-teaser (Kernel 1.2) in the first product-page area accepting promo blocks',
  requiresKernel: '>=1.2.0',
  pages: ['product'],
  up(t, ctx) {
    if (t.has('sdk:loyalty-teaser')) return;
    const hit = findArea(t, 'promo', ctx.sections);
    if (!hit)
      throw new MigrationConflict(
        'no area on the product page accepts promo blocks (or it is full)',
      );
    t.addBlock(hit.section, hit.area, { type: 'sdk:loyalty-teaser' });
  },
});

/** Kernel 1.5's phone bag bar, once, on the layout — it hides itself where the page
 *  already is the bag, so placing it everywhere is safe. */
const bagBarOnLayout = defineTemplateMigration({
  id: '2026-09-bag-bar-on-layout',
  description: 'append sdk:bag-bar (Kernel 1.5) to the layout',
  requiresKernel: '>=1.5.0',
  pages: ['layout'],
  up(t) {
    if (t.has('sdk:bag-bar') || t.wasRemoved('sdk:bag-bar')) return;
    t.append({ type: 'sdk:bag-bar' });
  },
});

export const TEMPLATE_MIGRATIONS: readonly TemplateMigration[] = [
  deliveryEtaOnProduct,
  loyaltyTeaserOnProduct,
  bagBarOnLayout,
];

export function findMigration(id: string): TemplateMigration | undefined {
  return TEMPLATE_MIGRATIONS.find((m) => m.id === id);
}
