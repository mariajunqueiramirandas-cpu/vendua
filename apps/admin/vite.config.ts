import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Object-form proxy keeps the Host header intact (string shorthand sets changeOrigin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5196,
    strictPort: true,
    proxy: {
      '/admin/v1': { target: 'http://localhost:8787' },
      // uploaded photos are served by Core at /v1/media
      '/v1': { target: 'http://localhost:8787' },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
    rollupOptions: {
      output: {
        // the shell stays small: react + router + query in one vendor chunk, routes lazy
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
