import {
  boolean,
  category,
  defineBlock,
  defineSection,
  list,
  number,
  product,
  richText,
  select,
  text,
  url,
  type BlockSchema,
  type SectionSchema,
} from '../composition/schema.ts';

// SDK section/block schemas — pure data (no React) so the build plugin can
// publish the catalog in the artifact manifest. Settings are additive-only
// within a Contract major, like slot props.

export const pageContent = defineSection({ type: 'sdk:page-content', settings: {} });

export const header = defineSection({
  type: 'sdk:header',
  settings: {
    brand: text({ max: 60 }),
    logo: url(),
    links: list({ label: text({ max: 40, default: '' }), href: url({ default: '/' }) }, { max: 6 }),
    showStatus: boolean({ default: true }),
    cartLabel: text({ max: 30, default: 'Sacola' }),
  },
  areas: { actions: { accepts: ['badge', 'info'], max: 2 } },
});

export const footer = defineSection({
  type: 'sdk:footer',
  settings: {
    note: text({ max: 160 }),
    showHours: boolean({ default: true }),
    showContacts: boolean({ default: true }),
    links: list({ label: text({ max: 40, default: '' }), href: url({ default: '/' }) }, { max: 8 }),
  },
  areas: { extra: { accepts: ['info', 'social-proof', 'promo'], max: 3 } },
});

export const announcementBar = defineSection({
  type: 'sdk:announcement-bar',
  settings: {
    text: text({ max: 140, default: '' }),
    href: url(),
    linkLabel: text({ max: 40 }),
    tone: select(['accent', 'surface'], { default: 'accent' }),
  },
});

export const headerCart = defineSection({
  type: 'sdk:header-cart',
  settings: {
    label: text({ max: 30, default: 'Sacola' }),
    variant: select(['pill', 'text'], { default: 'pill' }),
  },
});

export const purchasePanel = defineSection({
  type: 'sdk:purchase-panel',
  settings: {
    variant: select(['split', 'compact', 'editorial'], { default: 'split' }),
    /** feature a fixed product (e.g. on home); empty = the route's product */
    product: product(),
    showDescription: boolean({ default: true }),
    addLabel: text({ max: 40, default: 'Adicionar à sacola' }),
    backLabel: text({ max: 40, default: 'Voltar ao cardápio' }),
    soldOutText: text({ max: 80, default: 'Esgotado no momento.' }),
    afterAdd: select(['cart', 'stay'], { default: 'cart' }),
  },
  areas: {
    media: { accepts: ['media', 'badge'], max: 3 },
    'after-price': { accepts: ['purchase-extras', 'badge', 'promo', 'info'], max: 4 },
    'after-cta': { accepts: ['purchase-extras', 'info', 'social-proof'], max: 4 },
  },
});

export const catalogGrid = defineSection({
  type: 'sdk:catalog-grid',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80 }),
    intro: text({ max: 240 }),
    variant: select(['grid', 'list'], { default: 'grid' }),
    showSearch: boolean({ default: false }),
    searchLabel: text({ max: 60, default: 'Buscar no cardápio' }),
    showCategoryTabs: boolean({ default: true }),
    allLabel: text({ max: 40, default: 'Tudo' }),
    emptyText: text({ max: 160, default: 'O cardápio ainda está vazio.' }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
});

export const productList = defineSection({
  type: 'sdk:product-list',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80 }),
    intro: text({ max: 240 }),
    category: category(),
    limit: number({ min: 1, max: 12, default: 4 }),
    variant: select(['grid', 'list'], { default: 'grid' }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
  },
});

export const storeStatus = defineSection({
  type: 'sdk:store-status',
  settings: {
    title: text({ max: 80, default: 'Horários' }),
    showHours: boolean({ default: true }),
    showAddress: boolean({ default: true }),
    variant: select(['card', 'inline'], { default: 'card' }),
  },
});

export const richTextSection = defineSection({
  type: 'sdk:rich-text',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 120 }),
    body: richText({ max: 4000 }),
  },
});

export const stockCounter = defineBlock({
  type: 'sdk:stock-counter',
  category: 'purchase-extras',
  settings: {
    threshold: number({ min: 1, max: 50, default: 5 }),
    showWhenPlenty: boolean({ default: false }),
  },
});

export const notifyMe = defineBlock({
  type: 'sdk:notify-me',
  category: 'purchase-extras',
  settings: {
    title: text({ max: 80, default: 'Esgotou? A gente te avisa quando voltar.' }),
    successText: text({ max: 120, default: 'Pronto! Você recebe uma mensagem quando voltar.' }),
  },
});

export const promoBadge = defineBlock({
  type: 'sdk:promo-badge',
  category: 'badge',
  settings: {
    text: text({ max: 40, default: '' }),
    tone: select(['accent', 'surface'], { default: 'accent' }),
  },
});

export const SDK_SCHEMAS: readonly (SectionSchema | BlockSchema)[] = [
  pageContent,
  header,
  footer,
  announcementBar,
  headerCart,
  purchasePanel,
  catalogGrid,
  productList,
  storeStatus,
  richTextSection,
  stockCounter,
  notifyMe,
  promoBadge,
];

/** The shape the artifact manifest publishes (template migrations target areas by category). */
export function catalogOf(
  schemas: readonly (SectionSchema | BlockSchema)[],
): Record<
  string,
  { areas?: Record<string, { accepts: string[]; max?: number }>; category?: string }
> {
  const out: Record<
    string,
    { areas?: Record<string, { accepts: string[]; max?: number }>; category?: string }
  > = {};
  for (const s of schemas) {
    if (s.kind === 'block') out[s.type] = { category: s.category };
    else
      out[s.type] = s.areas
        ? {
            areas: Object.fromEntries(
              Object.entries(s.areas).map(([k, a]) => [
                k,
                { accepts: [...a.accepts], ...(a.max !== undefined ? { max: a.max } : {}) },
              ]),
            ),
          }
        : {};
  }
  return out;
}
