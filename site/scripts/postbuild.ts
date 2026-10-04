import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { site } from '../src/lib/content';

const BUILD = join(import.meta.dir, '../build');

// nginx serves this flat copy as its error_page, with a real 404 status
const notFound = join(BUILD, '404/index.html');
if (!existsSync(notFound)) throw new Error('build/404/index.html missing: run `vite build` first');
copyFileSync(notFound, join(BUILD, '404.html'));

const domain = new URL(site.domain);
if (domain.protocol !== 'https:') throw new Error('site.domain must be https');

const html = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? html(p) : p.endsWith('.html') ? [p] : [];
  });
const problems: string[] = [];

// The sitemap is every prerendered page that doesn't ask to stay out of search (/privacidade/ and
// the 404 are noindex), so a new page lands in it by being built. Each one must name itself as
// canonical, carry valid JSON-LD and its own title and description: two pages competing for one
// search, or a copied canonical, quietly drops a page from Google.
const pages = html(BUILD)
  .filter((f) => f.endsWith('/index.html'))
  .map((f) => ({
    path: f.slice(BUILD.length).replace(/index\.html$/, ''),
    src: readFileSync(f, 'utf8'),
  }))
  .filter((p) => !/<meta name="robots" content="noindex"/.test(p.src))
  .sort((a, b) => a.path.localeCompare(b.path));
const attr = (src: string, re: RegExp) => re.exec(src)?.[1] ?? '';
const seen = new Map<string, string>();
for (const p of pages) {
  const url = new URL(p.path, domain).href;
  const canonical = attr(p.src, /<link rel="canonical" href="([^"]+)"/);
  if (canonical !== url) problems.push(`${p.path}: canonical is "${canonical}", not ${url}`);
  const ld = [...p.src.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!ld.length) problems.push(`${p.path}: no JSON-LD`);
  for (const [, json] of ld)
    try {
      JSON.parse(json!);
    } catch {
      problems.push(`${p.path}: JSON-LD doesn't parse`);
    }
  for (const what of ['title', 'description']) {
    const value =
      what === 'title'
        ? attr(p.src, /<title>([^<]*)<\/title>/)
        : attr(p.src, /<meta name="description" content="([^"]*)"/);
    if (!value) problems.push(`${p.path}: no ${what}`);
    else if (seen.has(value)) problems.push(`${p.path}: same ${what} as ${seen.get(value)}`);
    else seen.set(value, p.path);
  }
}
writeFileSync(
  join(BUILD, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages
    .map((p) => `<url><loc>${new URL(p.path, domain).href}</loc></url>`)
    .join('')}</urlset>\n`,
);
writeFileSync(
  join(BUILD, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', domain).href}\n`,
);

// Words the site must never say (docs/merchant-admin-design.md §9 and the launch decisions): no platform
// jargon, no custom-software pitch, no price promise beyond the three plans, and no real store standing in for the
// fictional one. Checked on the text a visitor reads, not on the source.
const BANNED: [RegExp, string][] = [
  [/\btemplates?\b/i, 'platform word'],
  [/\bslots?\b/i, 'platform word'],
  [/\btenants?\b/i, 'platform word'],
  [/\bwebhooks?\b/i, 'platform word'],
  [/\bSKU\b/, 'platform word'],
  [/\bSaaS\b/i, 'platform word'],
  [/\bomnichannel\b/i, 'platform word'],
  [/sob medida/i, 'custom software is gone'],
  [/software house/i, 'custom software is gone'],
  [/sem taxas?/i, "Mercado Pago keeps its fee on each payment (Venduá's is none)"],
  [/(?<!\b14\s+dias\s+)\bgr[aá]tis\b/i, "only Bandeira's 14-day trial is free"],
  [/\bem breve\b/i, 'sign-up is open'],
  [/quero pudim/i, 'the site shows only the fictional Bolos da Nena'],
];
for (const file of html(BUILD)) {
  const text = readFileSync(file, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<link[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  for (const [re, why] of BANNED) {
    const m = re.exec(text);
    if (m) problems.push(`${file.slice(BUILD.length + 1)}: "${m[0]}" (${why})`);
  }
}
if (problems.length) {
  console.error('Pages that break the site rules:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(
  `postbuild: 404.html, sitemap.xml (${pages.length} pages), robots.txt; SEO and copy rules pass`,
);
