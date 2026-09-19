/**
 * e2e orchestrator — build the storefront artifact, seed the qa-* fixture
 * tenants, serve dist/ through the preview server (static + API proxy with
 * Host untouched), then run the Playwright suite against it. Exit code is the
 * suite's: non-zero when any check fails.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyStats, startPreview } from './preview.ts';
import { seedQaTenants } from './qa-seed.ts';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function runE2E(storefrontDir: string): Promise<number> {
  const dir = resolve(storefrontDir);
  const port = Number(process.env.VENDUA_PREVIEW_PORT ?? 5199);
  const coreOrigin = process.env.VENDUA_CORE_ORIGIN ?? 'http://localhost:8787';
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';

  if (!existsSync(dir)) {
    console.error(`storefront dir not found: ${dir}`);
    return 2;
  }

  console.log(`[e2e] building ${dir} …`);
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: dir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  });
  if ((await build.exited) !== 0) {
    console.error('[e2e] storefront build failed');
    return 2;
  }
  const distDir = join(dir, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error(`[e2e] build produced no dist/index.html in ${distDir}`);
    return 2;
  }

  console.log(`[e2e] seeding QA tenants (qa-open/qa-paused/qa-closed/qa-edge) …`);
  await seedQaTenants({ databaseUrl, previewPort: port });

  const server = await startPreview({ distDir, port, coreOrigin });
  console.log(`[e2e] preview :${port} → core ${coreOrigin} (Host forwarded untouched)`);
  try {
    // Harness sanity: the qa tenant must resolve through the proxy before the
    // suite runs — otherwise every check would fail for a harness reason.
    const probe = await fetch(`http://qa-open.localhost:${port}/storefront/v1/store`);
    if (!probe.ok) {
      console.error(`[e2e] qa tenant probe failed: ${probe.status} ${await probe.text()}`);
      return 2;
    }
    const tenant = (await probe.json()) as { slug?: string };
    if (tenant.slug !== 'qa-open') {
      console.error(`[e2e] probe resolved wrong tenant: ${JSON.stringify(tenant)}`);
      return 2;
    }

    const reportDir = join(dir, 'qa-report');
    const proc = Bun.spawn(['bunx', 'playwright', 'test', '--config', 'playwright.config.ts'], {
      cwd: PKG_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        VENDUA_PREVIEW_PORT: String(port),
        VENDUA_QA_REPORT_DIR: reportDir,
        VENDUA_QA_TRACES: join(reportDir, 'traces'),
        VENDUA_STOREFRONT_DIR: dir,
        DATABASE_URL: databaseUrl,
      },
    });
    const code = await proc.exited;
    return code;
  } finally {
    server.close();
    if (proxyStats.requests.size) {
      console.log('[e2e] proxied request/status totals:');
      for (const [k, n] of [...proxyStats.requests.entries()].sort()) {
        console.log(`      ${n} × ${k}`);
      }
    }
  }
}
