import type { TemplateSet } from '@vendua/templates';

// What a page renders when neither Core nor the build snapshot has a template
// for it — a sane store from SDK sections alone.
export const DEFAULT_TEMPLATES: TemplateSet = {
  layout: {
    version: 1,
    page: 'layout',
    sections: [
      { id: 'header', type: 'sdk:header' },
      { id: 'content', type: 'sdk:page-content' },
      { id: 'footer', type: 'sdk:footer' },
    ],
  },
  // Kernel 1.21: a store starting from these (no template yet, or the admin's first edit) jumps
  // between categories and greets a returning shopper; saved templates keep their own settings
  home: {
    version: 1,
    page: 'home',
    sections: [
      {
        id: 'catalog',
        type: 'sdk:catalog-grid',
        settings: { categoryNav: 'jump' },
        blocks: { 'before-grid': [{ id: 'recent-order', type: 'sdk:recent-order' }] },
      },
    ],
  },
  catalog: {
    version: 1,
    page: 'catalog',
    sections: [
      {
        id: 'catalog',
        type: 'sdk:catalog-grid',
        settings: { title: 'Cardápio', showSearch: true, categoryNav: 'jump' },
      },
    ],
  },
  product: {
    version: 1,
    page: 'product',
    sections: [{ id: 'purchase', type: 'sdk:purchase-panel' }],
  },
};
