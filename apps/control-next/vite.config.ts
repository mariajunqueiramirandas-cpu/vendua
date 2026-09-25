import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Object-form proxy keeps the Host header intact (string shorthand sets changeOrigin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/control/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5196,
    strictPort: true,
    proxy: {
      '/control/v1': { target: 'http://localhost:8787' },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
