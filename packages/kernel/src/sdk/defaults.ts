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
  home: {
    version: 1,
    page: 'home',
    sections: [{ id: 'catalog', type: 'sdk:catalog-grid' }],
  },
  catalog: {
    version: 1,
    page: 'catalog',
    sections: [
      {
        id: 'catalog',
        type: 'sdk:catalog-grid',
        settings: { title: 'Cardápio', showSearch: true },
      },
    ],
  },
  product: {
    version: 1,
    page: 'product',
    sections: [{ id: 'purchase', type: 'sdk:purchase-panel' }],
  },
};
