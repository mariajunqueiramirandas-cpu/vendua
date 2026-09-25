import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// port is tenant-significant (localhost:5174 maps to this store); proxy must not rewrite Host
export default defineConfig({
  plugins: [react()],
  publicDir: 'assets',
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/storefront/v1': { target: 'http://localhost:8787' },
      // narrowed to the API prefix — a bare '/checkout' proxy would swallow the SPA route
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
