import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PRODUCT_PATH,
  absoluteImage,
  escapeHtml,
  injectMeta,
  pageHead,
  productPattern,
  productSlug,
  storeMeta,
  type PageHead,
  type StoreMeta,
} from '../src/meta.ts';
import { INDEX_HTML } from './helpers.ts';

const STORE: StoreMeta = {
  title: 'Quero Pudim — pudins artesanais',
  description: 'Pudins de pote feitos no dia.',
  image: 'https://quero.vendua.com.br/v1/media/logo.png',
  url: 'https://quero.vendua.com.br',
  siteName: 'Quero Pudim',
};

const HEAD: PageHead = {
  title: 'Quero Pudim — pudins artesanais',
  description: 'Pudins de pote feitos no dia.',
  image: 'https://quero.vendua.com.br/v1/media/logo.png',
  url: 'https://quero.vendua.com.br/',
  siteName: 'Quero Pudim',
  type: 'website',
};

const headOf = (html: string) => html.slice(0, html.search(/<\/head>/i));
const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;
/** content of the meta tag named/propertied `key` (first one) */
function content(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`);
  return re.exec(html)?.[1];
}

describe('injectMeta', () => {
  test('inserts every tag after the title when the page has none', () => {
    const out = injectMeta(INDEX_HTML, HEAD);
    const head = headOf(out);
    expect(count(out, /<title>/g)).toBe(1);
    expect(out).toContain('<title>Quero Pudim — pudins artesanais</title><meta name="description"');
    expect(content(head, 'description')).toBe(HEAD.description!);
    expect(content(head, 'og:type')).toBe('website');
    expect(content(head, 'og:site_name')).toBe('Quero Pudim');
    expect(content(head, 'og:title')).toBe(HEAD.title);
    expect(content(head, 'og:description')).toBe(HEAD.description!);
    expect(content(head, 'og:url')).toBe('https://quero.vendua.com.br/');
    expect(content(head, 'og:image')).toBe(HEAD.image!);
    expect(content(head, 'twitter:card')).toBe('summary_large_image');
    expect(head).toContain('<link rel="canonical" href="https://quero.vendua.com.br/">');
    // the rest of the page is untouched
    expect(out.replace(/<title>.*?<link rel="canonical"[^>]*>/s, '<title>Loja</title>')).toBe(
      INDEX_HTML,
    );
  });

  test('replaces tags the page already has where they stand, never duplicating one', () => {
    const html = `<!doctype html><html><head>
<meta charset="utf-8">
<META NAME='Description' content='velha'>
<title data-x="1">Loja velha</title>
<meta property="og:title" content="velho">
<meta name="og:image" content=/velha.png>
<meta property="og:title" content="velho de novo">
<meta name="twitter:title" content="velho">
<link rel="icon" href="/favicon.ico"><link rel="canonical" href="https://velho.example/">
</head><body><title>svg title</title><meta name="description" content="body"></body></html>`;
    const out = injectMeta(html, HEAD);
    const head = headOf(out);
    for (const key of ['description', 'og:title', 'og:image', 'og:url', 'twitter:card'])
      expect(count(head, new RegExp(`(name|property)="${key}"`, 'gi'))).toBe(1);
    expect(count(head, /<title/g)).toBe(1);
    expect(count(head, /rel="canonical"/g)).toBe(1);
    // in place: description stays before the title, og:title after it
    expect(head.indexOf('name="description"')).toBeLessThan(head.indexOf('<title>'));
    expect(content(head, 'description')).toBe(HEAD.description!);
    expect(content(head, 'og:title')).toBe(HEAD.title);
    expect(content(head, 'og:image')).toBe(HEAD.image!);
    // a hand-written twitter:title is replaced, never added when absent
    expect(content(head, 'twitter:title')).toBe(HEAD.title);
    expect(head).not.toContain('twitter:description');
    expect(head).toContain('<link rel="icon" href="/favicon.ico">');
    expect(head).not.toContain('velh');
    // the body is not the head
    expect(out).toContain('<body><title>svg title</title><meta name="description" content="body">');
  });

  test('escapes merchant text for text and attribute contexts', () => {
    const evil = `Pudim "da vó" <b>&</b> </title><script>alert(1)</script> it's $& $' $1`;
    const out = injectMeta(INDEX_HTML, {
      ...HEAD,
      title: evil,
      description: evil,
      siteName: evil,
      image: 'https://x.example/a.png?"onerror=alert(1)',
    });
    expect(out).not.toContain('<script>alert(1)');
    expect(out).not.toContain('"da vó"');
    expect(count(out, /<\/title>/g)).toBe(1);
    const escaped =
      'Pudim &quot;da vó&quot; &lt;b&gt;&amp;&lt;/b&gt; &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; it&#39;s $&amp; $&#39; $1';
    expect(out).toContain(`<title>${escaped}</title>`);
    expect(content(out, 'og:title')).toBe(escaped);
    expect(content(out, 'og:site_name')).toBe(escaped);
    expect(content(out, 'og:image')).toBe('https://x.example/a.png?&quot;onerror=alert(1)');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  test("a null description or image leaves the page's own tag alone", () => {
    const html = `<html><head><title>x</title><meta property="og:image" content="https://loja.example/share.png"><meta name="description" content="da loja"></head></html>`;
    const out = injectMeta(html, { ...HEAD, description: null, image: null });
    expect(content(out, 'og:image')).toBe('https://loja.example/share.png');
    expect(content(out, 'description')).toBe('da loja');
    expect(out).not.toContain('og:description');
    expect(content(out, 'twitter:card')).toBe('summary_large_image');
    const bare = injectMeta('<head><title>x</title></head>', { ...HEAD, image: null });
    expect(content(bare, 'twitter:card')).toBe('summary');
    expect(bare).not.toContain('og:image');
  });

  test('comments, scripts and styles are never edited', () => {
    const html = `<head><!-- <title>c</title><meta property="og:title" content="c"> --><script>const t = '<title>s</title><meta name="description" content="s">';</script><style>/* <link rel="canonical"> */</style></head>`;
    const out = injectMeta(html, HEAD);
    expect(out).toContain(
      `<!-- <title>c</title><meta property="og:title" content="c"> --><script>const t = '<title>s</title><meta name="description" content="s">';</script><style>/* <link rel="canonical"> */</style>`,
    );
    expect(count(out, /<title>Quero/g)).toBe(1);
    expect(count(out, /rel="canonical" href/g)).toBe(1);
  });

  test('a title is added before </head>; no </head> leaves the page as is', () => {
    const out = injectMeta('<html><head><meta charset="utf-8"></head><body></body></html>', HEAD);
    expect(out).toStartWith('<html><head><meta charset="utf-8"><title>Quero Pudim');
    expect(out).toEndWith('</head><body></body></html>');
    expect(injectMeta('<p>fragment</p>', HEAD)).toBe('<p>fragment</p>');
  });
});

describe('product paths', () => {
  test('the default product route matches one segment, case-insensitively', () => {
    expect(productSlug('/produto/bolo-de-pote')).toBe('bolo-de-pote');
    expect(productSlug('/produto/bolo-de-pote/')).toBe('bolo-de-pote');
    expect(productSlug('/Produto/Bolo')).toBe('Bolo');
    expect(productSlug('/produto/p%C3%A3o%20doce')).toBe('pão doce');
    for (const miss of [
      '/',
      '/produto',
      '/produto/',
      '/produto/a/b',
      '/produtos/bolo',
      '/cardapio',
      '/x/produto/bolo',
      '/produto/%E0%A4%A',
      '/produto/a%2Fb',
      '/produto/a%00b',
      `/produto/${'a'.repeat(201)}`,
    ])
      expect(productSlug(miss)).toBeNull();
  });

  test('a custom pattern from the build manifest, the default otherwise', () => {
    expect(productPattern(null)).toBe(DEFAULT_PRODUCT_PATH);
    expect(productPattern({ kernel: '1.14.0' })).toBe(DEFAULT_PRODUCT_PATH);
    expect(productPattern({ paths: { product: 'p/:slug' } })).toBe(DEFAULT_PRODUCT_PATH);
    expect(productPattern({ paths: { product: '/p/:slug/detalhes' } })).toBe('/p/:slug/detalhes');
    expect(productSlug('/p/bolo/detalhes', '/p/:slug/detalhes')).toBe('bolo');
    expect(productSlug('/p/bolo', '/p/:slug/detalhes')).toBeNull();
    expect(productSlug('/produto/bolo', '/p/:slug/detalhes')).toBeNull();
  });

  test("the default is the Kernel's DEFAULT_PATHS.product", async () => {
    // loaded at runtime only: the edge image ships without workspace dependencies
    const links: string = '../../kernel/src/rules/links.ts';
    const { DEFAULT_PATHS } = (await import(links)) as { DEFAULT_PATHS: { product: string } };
    expect(DEFAULT_PRODUCT_PATH).toBe(DEFAULT_PATHS.product);
  });
});

describe('pageHead', () => {
  test("a store page: the store's head, canonical on its own origin without the query", () => {
    expect(pageHead(STORE, '/cardapio')).toEqual({
      ...HEAD,
      url: 'https://quero.vendua.com.br/cardapio',
    });
  });

  test('a product page: product · store, its description and image (made absolute)', () => {
    const head = pageHead(STORE, '/produto/pudim', {
      name: '  Pudim\nde leite ',
      description: 'Cremoso,\n\tsem furinhos.',
      imageUrl: '/v1/media/pudim.jpg',
    });
    expect(head).toEqual({
      title: 'Pudim de leite · Quero Pudim',
      description: 'Cremoso, sem furinhos.',
      image: 'https://quero.vendua.com.br/v1/media/pudim.jpg',
      url: 'https://quero.vendua.com.br/produto/pudim',
      siteName: 'Quero Pudim',
      type: 'product',
    });
  });

  test("a product without description or image falls back to the store's", () => {
    const head = pageHead(STORE, '/produto/pudim', {
      name: 'Pudim',
      description: '  ',
      imageUrl: 'javascript:alert(1)',
    });
    expect(head.description).toBe(STORE.description);
    expect(head.image).toBe(STORE.image);
    expect(head.type).toBe('product');
    // a nameless product is no product
    expect(pageHead(STORE, '/produto/x', { name: ' ', description: null, imageUrl: null })).toEqual(
      { ...HEAD, url: 'https://quero.vendua.com.br/produto/x' },
    );
  });

  test('long text is cut on a code point with an ellipsis', () => {
    const head = pageHead({ ...STORE, description: `${'á'.repeat(298)}😀😀😀` }, '/');
    expect(Array.from(head.description!).length).toBe(300);
    expect(head.description!.endsWith('😀…')).toBe(true);
  });

  test('absoluteImage keeps http(s) and resolves paths against the origin', () => {
    const o = 'https://loja.example';
    expect(absoluteImage('https://cdn.example/a.png', o)).toBe('https://cdn.example/a.png');
    expect(absoluteImage('//cdn.example/a.png', o)).toBe('https://cdn.example/a.png');
    expect(absoluteImage('/v1/media/a.png', o)).toBe('https://loja.example/v1/media/a.png');
    expect(absoluteImage('data:image/png;base64,xx', o)).toBeNull();
    expect(absoluteImage('', o)).toBeNull();
    expect(absoluteImage(null, o)).toBeNull();
  });
});

describe('storeMeta', () => {
  test("reads the envelope's meta, or null for an older Core or a malformed one", () => {
    expect(storeMeta({ version: 1, store: {}, notices: [], meta: STORE })).toEqual(STORE);
    expect(storeMeta({ version: 1, store: {}, notices: [] })).toBeNull();
    expect(storeMeta(null)).toBeNull();
    expect(storeMeta('x')).toBeNull();
    expect(storeMeta({ meta: { ...STORE, url: 'javascript:alert(1)' } })).toBeNull();
    expect(storeMeta({ meta: { ...STORE, title: '' } })).toBeNull();
    expect(storeMeta({ meta: { ...STORE, url: 'https://loja.example/x/' } })?.url).toBe(
      'https://loja.example',
    );
  });
});
