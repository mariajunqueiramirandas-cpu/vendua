import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyStats, startPreview } from './preview.ts';
import { seedQaTenants } from './qa-seed.ts';
import { readTemplatesDir } from '@vendua/templates/node';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface E2EOptions {
  /** `dir` already holds a built artifact (dist/ + templates/) — e.g. the stale reference; don't build */
  prebuilt?: boolean;
  /** Playwright --grep: run a subset (the stale job runs the S-series) */
  grep?: string;
}

export async function runE2E(storefrontDir: string, opts: E2EOptions = {}): Promise<number> {
  const dir = resolve(storefrontDir);
  const port = Number(process.env.VENDUA_PREVIEW_PORT ?? 5199);
  const coreOrigin = process.env.VENDUA_CORE_ORIGIN ?? 'http://localhost:8787';
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';

  if (!existsSync(dir)) {
    console.error(`storefront dir not found: ${dir}`);
    return 2;
  }

  if (opts.prebuilt) {
    console.log(`[e2e] prebuilt artifact ${dir} — not rebuilding`);
  } else {
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
  }
  const distDir = join(dir, 'dist');
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error(`[e2e] build produced no dist/index.html in ${distDir}`);
    return 2;
  }

  console.log(`[e2e] seeding QA tenants (qa-open/qa-paused/qa-closed/qa-edge) …`);
  let templates: Record<string, unknown>;
  try {
    templates = readTemplatesDir(join(dir, 'templates'));
  } catch (err) {
    console.error(`[e2e] ${(err as Error).message}`);
    return 2;
  }
  await seedQaTenants({ databaseUrl, previewPort: port, templates });

  // S05's fixture storefront (every override throws) — built and served beside the target
  const fixtureDir = join(PKG_DIR, 'fixtures', 'override-crash');
  const fixturePort = Number(process.env.VENDUA_FIXTURE_PORT ?? port - 10);
  const fixtureBuild = Bun.spawn(['bun', 'run', 'build'], {
    cwd: fixtureDir,
    stdout: 'ignore',
    stderr: 'inherit',
    env: { ...process.env, VENDUA_CORE_ORIGIN: '' },
  });
  if ((await fixtureBuild.exited) !== 0) {
    console.error('[e2e] S05 fixture storefront failed to build');
    return 2;
  }
  const fixtureServer = await startPreview({
    distDir: join(fixtureDir, 'dist'),
    port: fixturePort,
    coreOrigin,
    snapshotTemplates: true,
  });
  const server = await startPreview({ distDir, port, coreOrigin });
  console.log(`[e2e] preview :${port} → core ${coreOrigin} (Host forwarded untouched)`);
  try {
    // the qa tenant must resolve through the proxy before the suite runs
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
    const argv = ['bunx', 'playwright', 'test', '--config', 'playwright.config.ts'];
    if (opts.grep) argv.push('--grep', opts.grep);
    const proc = Bun.spawn(argv, {
      cwd: PKG_DIR,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        VENDUA_PREVIEW_PORT: String(port),
        VENDUA_FIXTURE_PORT: String(fixturePort),
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
    fixtureServer.close();
    if (proxyStats.requests.size) {
      console.log('[e2e] proxied request/status totals:');
      for (const [k, n] of [...proxyStats.requests.entries()].sort()) {
        console.log(`      ${n} × ${k}`);
      }
    }
  }
}
