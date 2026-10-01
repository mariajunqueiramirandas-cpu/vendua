import type { StoreProfile } from '../api.ts';
import type { StorefrontConfig } from '../config.ts';

// URLs a store builds: its own pages, absolute links (share, QR, JSON-LD) and contacts.

/** The Kernel's reserved `(vendua)` pages — fixed in every store. */
export const KERNEL_PATHS = {
  cart: '/sacola',
  checkout: '/checkout',
  order: '/pedido/:id',
  orders: '/pedidos',
} as const;

/** Every route with no `paths` in the config. */
export const DEFAULT_PATHS = {
  home: '/',
  catalog: '/cardapio',
  product: '/produto/:slug',
  ...KERNEL_PATHS,
} as const;

export function resolvePaths(config: Pick<StorefrontConfig, 'paths'>) {
  return {
    home: DEFAULT_PATHS.home,
    catalog: config.paths?.catalog ?? DEFAULT_PATHS.catalog,
    product: config.paths?.product ?? DEFAULT_PATHS.product,
    ...KERNEL_PATHS,
  };
}

export function productHref(config: Pick<StorefrontConfig, 'paths'>, slug: string): string {
  return resolvePaths(config).product.replace(':slug', encodeURIComponent(slug));
}

export function catalogHref(config: Pick<StorefrontConfig, 'paths'>): string {
  return resolvePaths(config).catalog;
}

/** The catalog's deep-link id for a product (`#produto-<slug>`); the Kernel scrolls to it. */
export function productAnchor(slug: string): string {
  return `produto-${slug}`;
}

/** `base` (`https://host`) + a path; an already absolute URL stays as it is. */
export function absoluteUrl(base: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/** WhatsApp digits with the country code — Core's normalisation: 10–11 national digits get
 *  `55`, 12–13 starting with `55` stay; anything else is no number. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

export function whatsappUrl(raw: string | null | undefined, text?: string): string | null {
  const d = whatsappDigits(raw);
  if (!d) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** The bare handle from `@loja`, `instagram.com/loja/?hl=pt` or `loja` — Core's
 *  normalisation; null when it isn't one. */
export function instagramHandle(raw: string | null | undefined): string | null {
  const h = (raw ?? '')
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '')
    .replace(/\/?([?#].*)?$/, '')
    .replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}

export function instagramUrl(raw: string | null | undefined): string | null {
  const h = instagramHandle(raw);
  return h ? `https://www.instagram.com/${h}/` : null;
}

/** `(22) 98179-5040` (a no-break space after the area code); other lengths as given. */
export function phoneDisplay(digits: string): string {
  const all = digits.replace(/\D/g, '');
  const d = all.length > 11 && all.startsWith('55') ? all.slice(2) : all;
  if (d.length === 11) return `(${d.slice(0, 2)})\u00a0${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)})\u00a0${d.slice(2, 6)}-${d.slice(6)}`;
  return digits;
}

export interface ContactLinks {
  whatsapp: { href: string; display: string } | null;
  instagram: { href: string; handle: string } | null;
}

/** The store's WhatsApp and Instagram links. They open in a new tab: render them with
 *  `target="_blank" rel="noopener noreferrer"`. */
export function contactLinks(
  store: Pick<StoreProfile, 'whatsapp' | 'instagram'> | null | undefined,
  text?: string,
): ContactLinks {
  const wa = whatsappDigits(store?.whatsapp);
  const ig = instagramHandle(store?.instagram);
  return {
    whatsapp: wa ? { href: whatsappUrl(wa, text)!, display: phoneDisplay(wa) } : null,
    instagram: ig ? { href: instagramUrl(ig)!, handle: ig } : null,
  };
}
