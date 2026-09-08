import { resolve, sep, extname } from 'node:path';
const root = resolve('build');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};
Bun.serve({
  hostname: '127.0.0.1',
  port: 4173,
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
    const candidates = extname(path) ? [filePath] : [resolve(filePath, 'index.html')];
    for (const candidate of candidates) {
      const file = Bun.file(candidate);
      if (await file.exists())
        return new Response(file, {
          headers: { 'Content-Type': types[extname(candidate)] || file.type },
        });
    }
    return new Response(Bun.file(resolve(root, '404.html')), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
});
console.log('Venduá: http://127.0.0.1:4173');
