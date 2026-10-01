// A page's head tags (title, description, Open Graph, Twitter, canonical) written server-side:
// WhatsApp, Instagram and most crawlers read link previews without running the store's JS.

/** The store's head as Core serves it in `/storefront/v1/surfaces?design=1` (`meta`). */
export interface StoreMeta {
  title: string;
  description: string | null;
  image: string | null;
  /** the store's public origin */
  url: string;
  siteName: string;
}

/** What a product page's head needs from `GET /storefront/v1/products/:slug`. */
export interface ProductHead {
  name: string;
  description: string | null;
  imageUrl: string | null;
}

export interface PageHead {
  title: string;
  description: string | null;
  /** absolute */
  image: string | null;
  /** canonical: the store's origin + this page's path, no query */
  url: string;
  siteName: string;
  type: 'website' | 'product';
}

/** The Kernel's `DEFAULT_PATHS.product` — the edge ships without workspace dependencies, and a
 *  test keeps the two equal. */
export const DEFAULT_PRODUCT_PATH = '/produto/:slug';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;
const SLUG_MAX = 200;

/** Merchant text on one line, bounded (cut on a code point, with an ellipsis). */
function clean(s: string | null | undefined, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const cps = Array.from(t);
  return cps.length <= max
    ? t
    : `${cps
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

function httpOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** `src` made absolute against `origin`; anything but http(s) is dropped. */
export function absoluteImage(src: string | null | undefined, origin: string): string | null {
  if (typeof src !== 'string' || !src.trim()) return null;
  try {
    const u = new URL(src.trim(), `${origin}/`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The envelope's `meta`, or null (an older Core, or a malformed one: the page stays as built). */
export function storeMeta(state: unknown): StoreMeta | null {
  const m = (state as { meta?: unknown } | null)?.meta as Record<string, unknown> | undefined;
  if (!m || typeof m !== 'object') return null;
  const title = clean(m.title as string, TITLE_MAX);
  const siteName = clean(m.siteName as string, TITLE_MAX);
  const url = typeof m.url === 'string' ? httpOrigin(m.url) : null;
  if (!title || !siteName || !url) return null;
  return {
    title,
    description: typeof m.description === 'string' ? m.description : null,
    image: typeof m.image === 'string' ? m.image : null,
    url,
    siteName,
  };
}

/** The store's product route: the build manifest's `paths.product` when it carries one (Kernel
 *  1.14's vendua-manifest.json has no `paths` yet, so today every store gets the default). */
export function productPattern(build: unknown): string {
  const p = (build as { paths?: { product?: unknown } } | null)?.paths?.product;
  return typeof p === 'string' && p.length <= 200 && /^\/[^?#]*:slug/.test(p)
    ? p
    : DEFAULT_PRODUCT_PATH;
}

/** The product slug `pathname` names under `pattern` (case-insensitive, like the Kernel's
 *  router; one trailing slash allowed), or null. */
export function productSlug(pathname: string, pattern = DEFAULT_PRODUCT_PATH): string | null {
  const at = pattern.indexOf(':slug');
  if (at < 0) return null;
  const prefix = pattern.slice(0, at).toLowerCase();
  const suffix = pattern.slice(at + ':slug'.length).toLowerCase();
  let p = pathname;
  if (p.length > 1 && p.endsWith('/') && !suffix.endsWith('/')) p = p.slice(0, -1);
  const lower = p.toLowerCase();
  if (p.length <= prefix.length + suffix.length) return null;
  if (!lower.startsWith(prefix) || !lower.endsWith(suffix)) return null;
  const raw = p.slice(prefix.length, p.length - suffix.length);
  if (raw.includes('/')) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return slug.length <= SLUG_MAX && !/[\u0000-\u001f\u007f/]/.test(slug) ? slug : null;
}

/** The head of the page at `pathname`: the store's, or the product's over it. */
export function pageHead(
  store: StoreMeta,
  pathname: string,
  product: ProductHead | null = null,
): PageHead {
  const name = product ? clean(product.name, TITLE_MAX) : null;
  const p = name ? product : null;
  return {
    title: name ? (clean(`${name} · ${store.siteName}`, TITLE_MAX) ?? name) : store.title,
    description:
      clean(p?.description, DESCRIPTION_MAX) ?? clean(store.description, DESCRIPTION_MAX),
    image: absoluteImage(p?.imageUrl, store.url) ?? absoluteImage(store.image, store.url),
    url: `${store.url}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    siteName: store.siteName,
    type: p ? 'product' : 'website',
  };
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const blank = (s: string) => ' '.repeat(s.length);

// Raw text (scripts, styles) and comments can hold tag-looking strings: they are blanked out
// (same length, so indexes still point into the original) before any tag is looked for.
function maskRaw(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(-->|$)/g, blank)
    .replace(/<(script|style|template|textarea)\b[\s\S]*?(<\/\1\s*>|$)/gi, blank);
}

const TITLE = /<title\b[^>]*>[\s\S]*?(<\/title\s*>|$)/gi;

const ATTR = Object.fromEntries(
  ['name', 'property', 'rel'].map((n) => [
    n,
    new RegExp(`\\s${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i'),
  ]),
) as Record<'name' | 'property' | 'rel', RegExp>;

function attr(tag: string, name: keyof typeof ATTR): string | null {
  const m = ATTR[name].exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Tag {
  start: number;
  end: number;
  text: string;
}

function tags(masked: string, re: RegExp): Tag[] {
  return [...masked.matchAll(re)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
  }));
}

/**
 * Writes `head` into the page's `<head>`: the `<title>`, description, Open Graph, Twitter card
 * and canonical link. A tag the page already has is replaced where it stands (duplicates of it
 * dropped); a missing one is added after the title. A null description or image leaves the
 * page's own tag alone. Unchanged when there is no `</head>`.
 */
export function injectMeta(html: string, head: PageHead): string {
  const raw = maskRaw(html);
  // a `</head>` in a script, a comment or the title's text doesn't end the head
  const headEnd = raw.replace(TITLE, blank).search(/<\/head\s*>/i);
  if (headEnd < 0) return html;
  const src = html.slice(0, headEnd);
  let masked = raw.slice(0, headEnd);

  const edits: Edit[] = [];
  const inserts: string[] = [];
  /** the first of `found` becomes `text`, the rest go; none → `text` is added */
  const put = (found: Tag[], text: string, insert = true) => {
    found.forEach((t, i) => edits.push({ start: t.start, end: t.end, text: i ? '' : text }));
    if (!found.length && insert) inserts.push(text);
  };

  const titles = tags(masked, TITLE);
  for (const t of titles) masked = masked.slice(0, t.start) + blank(t.text) + masked.slice(t.end);
  put(titles, `<title>${escapeHtml(head.title)}</title>`);

  const metas = tags(masked, /<meta\b[^>]*>/gi);
  const metaFor = (key: string) =>
    metas.filter((t) =>
      (['name', 'property'] as const).some((a) => attr(t.text, a)?.trim().toLowerCase() === key),
    );
  const meta = (key: string, content: string | null, insert = true) => {
    if (content === null) return;
    const kind = key === 'description' || key.startsWith('twitter:') ? 'name' : 'property';
    put(metaFor(key), `<meta ${kind}="${key}" content="${escapeHtml(content)}">`, insert);
  };

  meta('description', head.description);
  meta('og:type', head.type);
  meta('og:site_name', head.siteName);
  meta('og:title', head.title);
  meta('og:description', head.description);
  meta('og:url', head.url);
  meta('og:image', head.image);
  const hasImage = head.image !== null || metaFor('og:image').length > 0;
  meta('twitter:card', hasImage ? 'summary_large_image' : 'summary');
  // Twitter reads these before og:*; a page that hand-wrote them must not keep the store-wide text
  meta('twitter:title', head.title, false);
  meta('twitter:description', head.description, false);
  meta('twitter:image', head.image, false);

  const canonical = tags(masked, /<link\b[^>]*>/gi).filter((t) =>
    (attr(t.text, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'),
  );
  put(canonical, `<link rel="canonical" href="${escapeHtml(head.url)}">`);

  const anchor = titles[0]?.end ?? src.length;
  if (inserts.length) edits.push({ start: anchor, end: anchor, text: inserts.join('') });
  edits.sort((a, b) => a.start - b.start || a.end - b.end);

  let out = '';
  let at = 0;
  for (const e of edits) {
    out += src.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + src.slice(at) + html.slice(headEnd);
}
