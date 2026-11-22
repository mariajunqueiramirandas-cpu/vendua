/// <reference types="bun" />
import { mock } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'https://admin.test/admin/' });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { __ADMIN_BUILD__?: string }).__ADMIN_BUILD__ = 'test';

// Vite resolves the illustration assets at build time.
mock.module('../src/ui/Mascote.tsx', () => ({ Mascote: () => null }));
