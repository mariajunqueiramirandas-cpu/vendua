import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server for the quero-pudim spike. Port is tenant-significant: the seeded
 * domain row maps `localhost:5174` (and `127.0.0.1:5174`) to this store, and
 * Core resolves tenants from the Host header — so the proxy must NOT rewrite
 * it (changeOrigin stays false).
 */
export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/storefront/v1': { target: 'http://localhost:8787' },
      // Narrowed to the API prefix: every Kernel call lives under
      // /checkout/v1/*, and a bare '/checkout' proxy would swallow the SPA
      // route (direct load of /checkout 404'd).
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
