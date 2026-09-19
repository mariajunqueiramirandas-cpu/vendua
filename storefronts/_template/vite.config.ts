import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server. Port is tenant-significant: `vendua scaffold` registers a
 * `localhost:<port>` domain row and Core resolves tenants from the Host
 * header — so proxies MUST stay object-form (changeOrigin stays false) and
 * must use the narrow '/checkout/v1' key, never bare '/checkout' (that would
 * swallow the SPA route on reload).
 */
export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/storefront': { target: 'http://localhost:8787' },
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
