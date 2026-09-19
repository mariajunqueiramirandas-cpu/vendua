import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tenant resolution rides on the Host header — the proxy must forward the
// storefront's own host. Vite 8 string-shorthand defaults changeOrigin:true,
// so spell it out.
const core = { target: 'http://localhost:8787', changeOrigin: false };
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5192,
    strictPort: true,
    // Reserved prefixes are the versioned mounts only — a bare '/checkout'
    // would swallow a storefront page route of the same name.
    proxy: { '/storefront': core, '/checkout/v1': core, '/v1': core },
  },
});
