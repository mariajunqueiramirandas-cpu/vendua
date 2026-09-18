import { resolve, sep, extname } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve('build');
const index = resolve(root, 'index.html');
const notFound = resolve(root, '404.html');
if (!existsSync(index)) {
  console.error('Prévia: build/index.html não encontrado. Rode `bun run build` antes.');
  process.exit(1);
}
if (!existsSync(notFound))
  console.warn('Prévia: build/404.html ausente — 404 responderá texto puro. Rode `bun run build`.');

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const port = Number(process.env.PORT ?? 4173);
Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const filePath = resolve(root, '.' + path);
    if (filePath !== root && !filePath.startsWith(root + sep))
      return new Response('Forbidden', { status: 403 });
    const candidate = extname(path) ? filePath : resolve(filePath, 'index.html');
    const file = Bun.file(candidate);
    const headers = { 'Content-Type': types[extname(candidate)] || file.type };
    if (await file.exists())
      return request.method === 'HEAD'
        ? new Response(null, { headers })
        : new Response(file, { headers });
    const body = Bun.file(notFound);
    return new Response(
      (await body.exists()) && request.method !== 'HEAD' ? body : 'Página não encontrada.',
      {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  },
});
console.log(`Venduá: http://127.0.0.1:${port}`);
