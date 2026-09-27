import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vendua } from '@vendua/kernel/vite';
import config from './vendua.config.ts';

// S05 fixture: built and served by `vendua-conformance e2e` beside the storefront under test
export default defineConfig({ plugins: [react(), vendua({ config })], publicDir: false });
