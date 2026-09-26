import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vendua } from '@vendua/kernel/vite';
import config from './vendua.config.ts';

// port is tenant-significant (localhost:5176 maps to the example tenant); proxy must not rewrite Host
export default defineConfig({
  plugins: [react(), vendua({ config })],
  publicDir: 'assets',
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/storefront/v1': { target: 'http://localhost:8787' },
      // narrowed to the API prefix — a bare '/checkout' proxy would swallow the SPA route
      '/checkout/v1': { target: 'http://localhost:8787' },
      '/v1': { target: 'http://localhost:8787' },
    },
  },
});
