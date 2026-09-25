import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// object-form proxies keep Host untouched — tenant resolution rides on it
const core = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5191,
    proxy: {
      '/storefront/v1': { target: core, changeOrigin: false },
      // '/checkout/v1' — a bare '/checkout' prefix would swallow the SPA route
      '/checkout/v1': { target: core, changeOrigin: false },
      '/v1': { target: core, changeOrigin: false },
    },
  },
});
