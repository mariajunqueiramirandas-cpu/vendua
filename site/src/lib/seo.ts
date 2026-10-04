import { plans, signupUrl, site } from './content';

// Structured data (schema.org JSON-LD) for every page. Organization and WebSite tell search engines
// the brand is one entity with one site, whatever the spelling: people type "vendua", without the
// accent, as in the address, and Google needs to learn that is Venduá and not a typo.

export const abs = (path: string) => new URL(path, site.domain).href;

export const alternateName = 'Vendua';

const organization = {
  '@type': 'Organization',
  '@id': abs('/#organizacao'),
  name: site.name,
  alternateName,
  url: abs('/'),
  logo: { '@type': 'ImageObject', url: abs('/assets/brand/app-icon.png'), width: 192, height: 192 },
  description: site.description,
  sameAs: [site.instagram.url],
};

const website = {
  '@type': 'WebSite',
  '@id': abs('/#site'),
  name: site.name,
  alternateName: [alternateName, 'vendua.com.br'],
  url: abs('/'),
  inLanguage: 'pt-BR',
  publisher: { '@id': organization['@id'] },
};

/** "R$ 69,90" → "69.90" */
const amount = (price: string) => price.replace(/[^\d,]/g, '').replace(',', '.');

/** The product with the plans open for sign-up, at the build's prices (content.ts). */
export const product = () => ({
  '@type': 'SoftwareApplication',
  '@id': abs('/#app'),
  name: site.name,
  alternateName,
  url: abs('/'),
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Android, iOS, navegador',
  inLanguage: 'pt-BR',
  description: site.description,
  publisher: { '@id': organization['@id'] },
  offers: Object.values(plans)
    .filter((p) => p.available)
    .map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: amount(p.price),
      priceCurrency: 'BRL',
      category: 'subscription',
      url: signupUrl(p.id),
    })),
});

export type Crumb = { name: string; path: string };

export const breadcrumbs = (trail: Crumb[]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: c.name,
    item: abs(c.path),
  })),
});

export const article = (a: {
  title: string;
  description: string;
  path: string;
  published: string;
  modified?: string;
}) => ({
  '@type': 'Article',
  headline: a.title,
  description: a.description,
  mainEntityOfPage: abs(a.path),
  url: abs(a.path),
  image: abs('/og.png'),
  inLanguage: 'pt-BR',
  datePublished: a.published,
  dateModified: a.modified ?? a.published,
  author: { '@id': organization['@id'] },
  publisher: { '@id': organization['@id'] },
});

/** The page's JSON-LD: the brand's two nodes on every page, plus what the page is. */
export const graph = (nodes: object[]) =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': [organization, website, ...nodes] })
    // inside a <script>, "</" would end it early
    .replace(/</g, '\\u003c');
