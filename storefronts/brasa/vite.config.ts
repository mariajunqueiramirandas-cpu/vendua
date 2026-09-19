import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: storefront reads (/storefront), checkout session (/checkout) and
// the loader (/v1/v.js) all forward to Core. Tenant resolution rides on the
// Host header — Vite's string shorthand forces `changeOrigin: true` and
// rewrites it, so every entry is the explicit object form with
// changeOrigin: false (see OBSERVATIONS.md).
const core = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5191,
    proxy: {
      '/storefront/v1': { target: core, changeOrigin: false },
      // '/checkout/v1', not bare '/checkout' — reserved prefixes are the
      // versioned mounts; a bare prefix would swallow a same-named page route.
      '/checkout/v1': { target: core, changeOrigin: false },
      '/v1': { target: core, changeOrigin: false },
    },
  },
});
