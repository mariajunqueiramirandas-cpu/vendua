import { defineConfig } from '@playwright/test';

// Orchestrated by src/e2e.ts (builds storefront, seeds qa-* tenants, starts
// preview); *.localhost maps to 127.0.0.1 so requests carry the tenant Host.
export default defineConfig({
  testDir: './src/suite',
  // `.e2e.ts` keeps the Playwright suite out of the `bun test` unit gate.
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Serial: parallel workers share the per-tenant /checkout/v1 rate limit and trip it.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./src/suite/reporter.ts']],
  outputDir: process.env.VENDUA_QA_TRACES ?? 'qa-traces',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
    },
  },
});
