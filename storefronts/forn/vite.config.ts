import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tenant resolution rides on the Host header — the proxy must forward the
// storefront's own host. Vite 8 string-shorthand defaults changeOrigin:true,
// so spell it out.
const core = { target: 'http://localhost:8787', changeOrigin: false };
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // kernel's exports map only exposes '.' and './config' — the documented
      // '@vendua/kernel/src/styles.css' specifier isn't reachable (see
      // OBSERVATIONS.md). Alias keeps the contract import specifier working.
      '@vendua/kernel/src/styles.css': fileURLToPath(
        new URL('../../packages/kernel/src/styles.css', import.meta.url),
      ),
    },
  },
  server: {
    port: 5192,
    strictPort: true,
    proxy: { '/storefront': core, '/checkout': core, '/v1': core },
  },
});
