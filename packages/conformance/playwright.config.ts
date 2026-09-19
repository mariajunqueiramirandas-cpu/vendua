import { defineConfig } from '@playwright/test';

/**
 * Conformance e2e config — the orchestrator (src/e2e.ts) builds the
 * storefront, seeds the qa-* tenants and starts the preview server before
 * invoking this. Browsers reach the preview via
 * --host-resolver-rules=MAP *.localhost 127.0.0.1 — verified in-session:
 * http://qa-open.localhost:<port> reaches the preview with the right Host,
 * which is how Core resolves the tenant.
 */
export default defineConfig({
  testDir: './src/suite',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Serial: Core's fixed-window limiter (240 req/min per tenant on
  // /checkout/v1) is shared across a run's whole burst — parallel workers
  // stack checkout flows on the same qa-* tenant and trip each other.
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
