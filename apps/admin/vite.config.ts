import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MagicString from 'magic-string';
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

// Every Phosphor icon ships six weights in one Map; the app draws regular, bold, fill and
// duotone only, so thin and light are dropped from each icon's definitions (shell headroom).
// A `weight="thin"` or `"light"` in src fails the build: add the weight back here first.
function phosphorWeights(drop = ['thin', 'light']): Plugin {
  type Node = { type: string; start: number; end: number; [k: string]: unknown };
  return {
    name: 'vendua-phosphor-weights',
    apply: 'build',
    transform(code, id) {
      if (/[\\/]apps[\\/]admin[\\/]src[\\/].+\.tsx?$/.test(id)) {
        const used = code.match(new RegExp(`weight[=:]\\s*\\{?\\s*['"](${drop.join('|')})['"]`));
        if (used) this.error(`${id}: Phosphor weight "${used[1]}" is stripped from the build`);
        return;
      }
      if (!/@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/][^\\/]+\.es\.js$/.test(id)) return;
      const s = new MagicString(code);
      const visit = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(visit);
        const node = n as Node;
        const arg = (node.arguments as Node[] | undefined)?.[0];
        if (
          node.type === 'NewExpression' &&
          (node.callee as Node & { name?: string }).name === 'Map' &&
          arg?.type === 'ArrayExpression'
        ) {
          const els = arg.elements as Node[];
          els.forEach((el, i) => {
            const key = (el.elements as (Node & { value?: unknown })[] | undefined)?.[0]?.value;
            if (typeof key !== 'string' || !drop.includes(key)) return;
            const next = els[i + 1];
            s.remove(el.start, next ? next.start : el.end);
          });
          return;
        }
        for (const k in node) if (k !== 'type') visit(node[k]);
      };
      visit(this.parse(code));
      return s.hasChanged() ? { code: s.toString(), map: s.generateMap({ hires: true }) } : null;
    },
  };
}

// The app's copy of the page (ADR 0044): served from the bundle at `/`, so the PWA's links
// (manifest, icons, iOS splash) have nothing to point at, and the theme script stays.
function nativeHtml(): Plugin {
  return {
    name: 'vendua-native-html',
    transformIndexHtml: (html) =>
      html
        .replace(/\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '')
        .replace(/\s*<meta name="(apple-mobile-web-app|mobile-web-app)[^>]*>/g, ''),
  };
}

// `vite build` is the website; `vite build --mode native` is the iOS/Android app's bundle
// (dist-native/), from the same source: src/platform/ is the only file that differs.
// Object-form proxy keeps the Host header intact (string shorthand sets changeOrigin).
export default defineConfig(({ mode }) => {
  const native = mode === 'native';
  return {
    plugins: [react(), tailwindcss(), phosphorWeights(), native ? nativeHtml() : serviceWorker()],
    base: native ? '/' : '/admin/',
    // the PWA's manifest, icons and splash art: the app has its own (ios/, android/)
    publicDir: native ? false : 'public',
    define: {
      // who is calling, in every request's x-vendua-client (the deploy passes the commit)
      __ADMIN_BUILD__: JSON.stringify((process.env.GIT_COMMIT ?? '').slice(0, 12) || 'dev'),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@platform-impl': fileURLToPath(
          new URL(native ? './src/platform/native.ts' : './src/platform/web.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: 5196,
      strictPort: true,
      proxy: {
        '/admin/v1': { target: 'http://localhost:8787' },
        '/analytics/v1': { target: 'http://localhost:8787' },
        // uploaded photos are served by Core at /v1/media
        '/v1': { target: 'http://localhost:8787' },
      },
    },
    build: {
      outDir: native ? 'dist-native' : 'dist',
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
  };
});
