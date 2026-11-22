/// <reference types="bun" />
import { mock } from 'bun:test';
import '../../../packages/kernel/test/setup.ts';

(globalThis as { __ADMIN_BUILD__?: string }).__ADMIN_BUILD__ = 'test';

// Vite resolves the illustration assets at build time.
mock.module('../src/ui/Mascote.tsx', () => ({ Mascote: () => null }));
