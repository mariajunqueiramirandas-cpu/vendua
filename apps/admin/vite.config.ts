import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { SPLASH_DEVICES, splashName } from './scripts/splash-devices.ts';

// iOS splash <link>s (scripts/splash-devices.ts), and dist/sw.js: the worker (./sw.js) with this build's VERSION and PRECACHE list.
// Precached: the shell, every route chunk, the pt-BR font subsets and the icons, so any
// screen opens offline. Install-time art (splash, store screenshots) is left to the network.
function serviceWorker(): Plugin {
  const skip = /(\.map$|^sw\.js$|^splash\/|^screenshots\/|cyrillic|greek|vietnamese|\.woff$)/;
  return {
    name: 'vendua-sw',
    apply: 'build',
    transformIndexHtml: () =>
      SPLASH_DEVICES.flatMap(([w, h, dpr]) =>
        [false, true].map((dark) => ({
          tag: 'link',
          attrs: {
            rel: 'apple-touch-startup-image',
            href: `/admin/${splashName(w, h, dpr, dark)}`,
            media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${dark ? 'dark' : 'light'})`,
          },
          injectTo: 'head' as const,
        })),
      ),
    closeBundle() {
      const dist = fileURLToPath(new URL('./dist', import.meta.url));
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        );
      const files = walk(dist)
        .map((f) => relative(dist, f).split('\\').join('/'))
        .filter((f) => !skip.test(f))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      const src = readFileSync(fileURLToPath(new URL('./sw.js', import.meta.url)), 'utf8');
      const head =
        `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 12))};\n` +
        `const PRECACHE = ${JSON.stringify(files.map((f) => `/admin/${f}`))};\n`;
      writeFileSync(join(dist, 'sw.js'), head + src);
    },
  };
}

// Object-form proxy keeps the Host header intact (string shorthand sets changeOrigin).
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  base: '/admin/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5196,
    strictPort: true,
    proxy: {
      '/admin/v1': { target: 'http://localhost:8787' },
      // uploaded photos are served by Core at /v1/media
      '/v1': { target: 'http://localhost:8787' },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
    rollupOptions: {
      output: {
        // the shell stays small: react + router + query in one vendor chunk, routes lazy
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
