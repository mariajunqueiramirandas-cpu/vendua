import { copyFileSync, writeFileSync } from 'node:fs';
import { site } from '../src/lib/content/site';
copyFileSync('build/404/index.html', 'build/404.html');
const routes = ['/', '/contato/'];
if (site.publicDomain) {
  const domain = new URL(site.publicDomain);
  if (domain.protocol !== 'https:') throw new Error('O domínio público deve usar HTTPS.');
  writeFileSync(
    'build/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map((route) => `<url><loc>${new URL(route, domain).href}</loc></url>`).join('')}</urlset>`,
  );
  writeFileSync(
    'build/robots.txt',
    `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap.xml', domain).href}\n`,
  );
} else writeFileSync('build/robots.txt', 'User-agent: *\nDisallow: /\n');
console.log('404 estático gerado. SEO de domínio condicionado à configuração.');
