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

// only indexable pages go in the sitemap; /privacidade/ and /404/ are noindex
const routes = ['/'];
const domain = new URL(site.domain);
if (domain.protocol !== 'https:') throw new Error('site.domain must be https');
writeFileSync(
  join(BUILD, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes
    .map((r) => `<url><loc>${new URL(r, domain).href}</loc></url>`)
    .join('')}</urlset>\n`,
);
writeFileSync(
  join(BUILD, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', domain).href}\n`,
);

// Words the site must never say (docs/merchant-admin-design.md §9 and the launch decisions): no platform
// jargon, no custom-software pitch, no promise about price, and no real store standing in for the
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
  [/sem taxas?/i, 'Venduá charges a per-order fee'],
  [/\bgr[aá]tis\b/i, 'the price is "em breve"'],
  [/quero pudim/i, 'the site shows only the fictional Bolos da Nena'],
];
const html = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? html(p) : p.endsWith('.html') ? [p] : [];
  });
const problems: string[] = [];
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
  console.error('Copy that breaks the site rules:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('postbuild: 404.html, sitemap.xml, robots.txt; copy rules pass');
