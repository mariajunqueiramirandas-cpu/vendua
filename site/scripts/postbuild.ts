import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { site } from '../src/lib/content/site';

// a cópia plana do 404 é o que o nginx serve como error_page
const notFound = 'build/404/index.html';
if (!existsSync(notFound))
  throw new Error('build/404/index.html não encontrado — rode `vite build` antes do pós-build.');
copyFileSync(notFound, 'build/404.html');

// sitemap = só páginas indexáveis; /privacidade/ e /404/ ficam fora (VALIDACAO.md F05)
const routes = ['/', '/contato/'];
if (site.publicDomain) {
  let domain: URL;
  try {
    domain = new URL(site.publicDomain);
  } catch {
    throw new Error(`site.publicDomain inválido: "${site.publicDomain}".`);
  }
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
