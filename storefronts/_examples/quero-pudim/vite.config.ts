import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// port is tenant-significant (seeded domain maps localhost:5174) — proxy must not rewrite Host
export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/storefront': { target: 'http://localhost:8787' },
      // narrowed to the API prefix — a bare '/checkout' key would swallow the SPA route
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
