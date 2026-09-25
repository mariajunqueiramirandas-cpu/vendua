import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Object-form proxy keeps the Host header intact; string shorthand would set changeOrigin and break tenant resolution.
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
    // Prod: Core serves these assets at /control/*.
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
