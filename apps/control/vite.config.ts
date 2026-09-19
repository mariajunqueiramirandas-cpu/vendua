import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server for the control app. The proxy keeps /control/v1 same-origin
 * (cookie auth + the CSRF marker both expect it); object-form entries keep
 * the Host header intact — string shorthand sets changeOrigin and breaks
 * tenant resolution conventions elsewhere in the repo.
 */
export default defineConfig({
  plugins: [react()],
  base: '/control/',
  server: {
    port: 5195,
    strictPort: true,
    proxy: {
      '/control/v1': { target: 'http://localhost:8787' },
    },
  },
  build: {
    // Prod: Core serves these assets itself at /control/*.
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
