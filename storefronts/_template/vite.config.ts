import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// port is tenant-significant; object-form proxies keep Host intact — bare '/checkout' would swallow the SPA route
export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/storefront/v1': { target: 'http://localhost:8787' },
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
