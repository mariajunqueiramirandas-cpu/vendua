// The menu import's platforms, as Core reads them today. Mirrors
// packages/core/src/modules/menu-import/adapters/index.ts (`recognise`, `ADAPTERS`, `BLOCKED`),
// each adapter's `match` and `read`, http.ts `LIMITS`, and the admin's words in
// apps/admin/src/features/import/copy.ts and ImportFlow.tsx.

export type Readable =
  'instadelivery' | 'cardapioweb' | 'olaclick' | 'takeat' | 'deliverydireto' | 'saipos' | 'goomer';
export type Blocked = 'anotaai' | 'ifood';

export const NAME: Record<Readable | Blocked, string> = {
  instadelivery: 'Instadelivery',
  cardapioweb: 'Cardápio Web',
  olaclick: 'OlaClick',
  takeat: 'Takeat',
  deliverydireto: 'Delivery Direto',
  saipos: 'Saipos',
  goomer: 'Goomer',
  anotaai: 'anota.ai',
  ifood: 'iFood',
};

/** copy.ts READABLE: the order merchants know them */
export const READABLE: Readable[] = [
  'instadelivery',
  'cardapioweb',
  'olaclick',
  'takeat',
  'deliverydireto',
  'saipos',
  'goomer',
];

/** copy.ts readableNames(): "Instadelivery, Cardápio Web, … ou Goomer" */
export const readableNames = () =>
  `${READABLE.slice(0, -1)
    .map((p) => NAME[p])
    .join(', ')} ou ${NAME[READABLE.at(-1)!]}`;

const set = (s: string) => new Set(s.split(' '));
const RESERVED: Record<Readable, Set<string>> = {
  instadelivery: set(
    'api app admin blog login cadastro cadastre-se planos precos contato sobre termos privacidade ajuda suporte parceiros portal',
  ),
  cardapioweb: set(
    'api admin login cadastro entrar painel planos precos blog ajuda suporte termos privacidade contato',
  ),
  olaclick: set('www app api admin panel painel blog help ajuda'),
  takeat: set('login cadastro admin api pedido pedidos conta'),
  deliverydireto: set(
    'ss bs ws api admin blog login cadastro termos privacidade ajuda planos precos contato sobre static img',
  ),
  saipos: set(
    'www app api blog conta meajuda delivery-api static cms lp materiais material ofertas conteudo ideias store webmail vpn security seguro assinatura rating offline',
  ),
  goomer: set(
    'www api api-go mobile static ssr-api blog app admin painel ajuda help status webmenu _next',
  ),
};

const first = (u: URL) => u.pathname.split('/').filter(Boolean)[0]?.toLowerCase();

/** each adapter's `match(url)`: the store's ref, or null */
const MATCH: Record<Readable, (u: URL) => string | null> = {
  instadelivery(u) {
    if (u.hostname.replace(/^www\./, '') !== 'instadelivery.com.br') return null;
    const s = first(u);
    return s && /^[a-z0-9][a-z0-9_.-]{1,79}$/.test(s) && !RESERVED.instadelivery.has(s) ? s : null;
  },
  cardapioweb(u) {
    if (
      !/^(?:www\.)?(?:app|menu|mesa|balcao|entrega|local|delivery)\.cardapioweb\.com$/.test(
        u.hostname,
      )
    )
      return null;
    const s = first(u);
    return s && /^[a-z0-9_][a-z0-9_.-]{1,99}$/.test(s) && !RESERVED.cardapioweb.has(s) ? s : null;
  },
  olaclick(u) {
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.ola\.click$/.exec(u.hostname);
    return m && !RESERVED.olaclick.has(m[1]!) ? m[1]! : null;
  },
  takeat(u) {
    if (u.hostname !== 'pedido.takeat.app') return null;
    const s = first(u);
    return s && /^[a-z0-9][a-z0-9_-]{1,79}$/.test(s) && !RESERVED.takeat.has(s) ? s : null;
  },
  deliverydireto(u) {
    if (u.hostname.replace(/^www\./, '') !== 'deliverydireto.com.br') return null;
    const [brand, unit] = u.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => s.toLowerCase());
    const slug = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
    if (!brand || !slug.test(brand) || RESERVED.deliverydireto.has(brand)) return null;
    const notUnit = set('pages categories item items stores basic_info');
    return unit && slug.test(unit) && !notUnit.has(unit) ? `${brand}/${unit}` : brand;
  },
  saipos(u) {
    const m = /^([a-z0-9][a-z0-9-]{0,62})\.saipos\.com$/.exec(u.hostname);
    return m && !RESERVED.saipos.has(m[1]!) ? m[1]! : null;
  },
  goomer(u) {
    const slug = /^[a-z0-9][a-z0-9-]{0,80}$/;
    const sub = /^([a-z0-9][a-z0-9-]*)\.goomer\.app$/.exec(u.hostname)?.[1];
    if (sub && sub !== 'www') return slug.test(sub) && !RESERVED.goomer.has(sub) ? sub : null;
    if (u.hostname !== 'www.goomer.app' && u.hostname !== 'goomer.app') return null;
    const s = first(u) ?? '';
    return slug.test(s) && !RESERVED.goomer.has(s) ? s : null;
  },
};

const BLOCKED: [Blocked, RegExp][] = [
  ['anotaai', /(^|\.)anota\.ai$/],
  ['ifood', /(^|\.)ifood\.com\.br$/],
];
const PLATFORM_DOMAIN =
  /(^|\.)(instadelivery\.com\.br|cardapioweb\.com|cardapioweb\.com\.br|ola\.click|olaclick\.app|deliverydireto\.com\.br|takeat\.app|saipos\.com|goomer\.app|anota\.ai|ifood\.com\.br)$/;
const LOCAL = ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'test', 'invalid', 'example'];

function isPublicHostname(host: string) {
  if (host.length > 253 || !host.includes('.')) return false;
  const labels = host.split('.');
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return false;
  return !LOCAL.some((s) => host === s || host.endsWith(`.${s}`));
}

export type Verdict =
  | { kind: 'empty' }
  | { kind: 'ok'; platform: Readable; ref: string }
  | { kind: 'custom'; host: string }
  | { kind: 'blocked'; platform: Blocked }
  | { kind: 'unsupported' }
  | { kind: 'invalid' };

/** adapters/index.ts `recognise`: pasted text → which platform reads it, or why not */
export function recognise(input: string): Verdict {
  let s = input.trim();
  if (!s) return { kind: 'empty' };
  if (s.length > 500) return { kind: 'invalid' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'invalid' };
  if (url.username || url.password || url.port) return { kind: 'invalid' };
  const host = url.hostname.toLowerCase();
  for (const p of READABLE) {
    const ref = MATCH[p](url);
    if (ref) return { kind: 'ok', platform: p, ref };
  }
  for (const [platform, re] of BLOCKED) if (re.test(host)) return { kind: 'blocked', platform };
  if (!PLATFORM_DOMAIN.test(host) && isPublicHostname(host)) return { kind: 'custom', host };
  return { kind: 'unsupported' };
}

/** the links the box offers to try: a fictional store on each platform */
export const SAMPLES: { label: string; url: string }[] = [
  { label: 'Instadelivery', url: 'instadelivery.com.br/bolosdanena' },
  { label: 'Cardápio Web', url: 'app.cardapioweb.com/bolosdanena' },
  { label: 'OlaClick', url: 'bolosdanena.ola.click' },
  { label: 'Takeat', url: 'pedido.takeat.app/bolosdanena' },
  { label: 'Delivery Direto', url: 'deliverydireto.com.br/bolosdanena/centro' },
  { label: 'Saipos', url: 'bolosdanena.saipos.com' },
  { label: 'Goomer', url: 'bolosdanena.goomer.app' },
  { label: 'anota.ai', url: 'pedido.anota.ai/loja/bolosdanena' },
  { label: 'iFood', url: 'ifood.com.br/delivery/campos-rj/bolos-da-nena' },
  { label: 'Endereço próprio', url: 'www.bolosdanena.com.br' },
];

/**
 * How many GETs each adapter's `read` makes for a menu of `products` items in `categories`
 * categories (no pizza module, Takeat with its per-address fee list). Instadelivery: the whole
 * store in one; Cardápio Web: profile + menu; OlaClick: host lookup + 4; Takeat: store, menu,
 * schedule, fees; Delivery Direto: brand, categories, one per category, fees, payment forms;
 * Saipos: store lookup + one; Goomer: info, menu, then one per product for its options.
 */
export function requests(p: Readable, products: number, categories: number): number {
  switch (p) {
    case 'instadelivery':
      return 1;
    case 'cardapioweb':
      return 2;
    case 'olaclick':
      return 5;
    case 'takeat':
      return 4;
    case 'deliverydireto':
      return 4 + categories;
    case 'saipos':
      return 2;
    case 'goomer':
      return 2 + products;
  }
}

/** http.ts LIMITS, and Goomer's own budget (goomer.ts `limits`) */
export const LIMITS = {
  hostGapMs: 250,
  requests: 300,
  importMs: 60_000,
  goomer: { requests: 600, importMs: 150_000 },
};

/** the requests that go to one host, back to back, ≥ 250 ms apart: Goomer's per-product
 *  option lists all go to its mobile host, Delivery Direto's all to its one host */
export function sameHost(p: Readable, products: number, categories: number): number {
  if (p === 'goomer') return products;
  if (p === 'deliverydireto') return 4 + categories;
  return requests(p, products, categories);
}
