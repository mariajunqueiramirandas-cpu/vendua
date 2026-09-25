import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// tenant resolution rides on the Host header — Vite 8 defaults changeOrigin:true, so spell it out
const core = { target: 'http://localhost:8787', changeOrigin: false };
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5192,
    strictPort: true,
    // Reserved prefixes are the versioned mounts only — a bare '/checkout'
    // would swallow a storefront page route of the same name.
    proxy: { '/storefront/v1': core, '/checkout/v1': core, '/v1': core },
  },
});
