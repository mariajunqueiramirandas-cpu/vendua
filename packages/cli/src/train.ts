import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCompat, type ArtifactManifest } from '@vendua/templates';
import { control, coreOrigin } from './core.ts';
import { select } from './fleet.ts';
import { die } from './paths.ts';

// `vendua train [slug…] [--core] [--record] [--report <file>]` — the build + judge
// half of a fleet train (09 — fleet trains): rebuild every in-repo storefront on
// the current Kernel in one run, conformance-check each artifact, validate its
// manifest against the compat matrix, and prove the train touched zero
// storefront source. `--core` pulls templates/tokens from Core; `--record` files
// each manifest with Core so template migrations know the store's Kernel.
// Promotion by ring waits for the Control Plane (Phase 4).

async function exec(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const p = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, output: `${out}\n${err}`.trim() };
}

interface Row {
  storefront: string;
  tenant: string;
  kernel: string;
  contract: number | string;
  source: string;
  build: 'pass' | 'fail';
  compat: string;
  check: string;
  recorded: string;
}

export async function cmdTrain(args: string[], root: string): Promise<never> {
  const withCore = args.includes('--core');
  const record = args.includes('--record');
  const ri = args.indexOf('--report');
  const reportFile = ri >= 0 ? args[ri + 1] : undefined;
  const slugs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--report');
  let stores;
  try {
    stores = select(root, slugs);
  } catch (e) {
    die((e as Error).message);
  }

  const before = (await exec(['git', 'status', '--porcelain', '--', 'storefronts'], root)).output;
  const rows: Row[] = [];
  for (const s of stores) {
    console.log(`[train] ${s.rel} …`);
    const env: Record<string, string> = withCore
      ? { VENDUA_CORE_ORIGIN: coreOrigin() }
      : { VENDUA_CORE_ORIGIN: '' };
    const build = await exec(['bun', 'run', 'build'], s.dir, env);
    const row: Row = {
      storefront: s.rel,
      tenant: s.tenant,
      kernel: '—',
      contract: '—',
      source: '—',
      build: build.code === 0 ? 'pass' : 'fail',
      compat: '—',
      check: '—',
      recorded: '—',
    };
    if (build.code !== 0) {
      console.log(build.output.slice(-1500));
      rows.push(row);
      continue;
    }
    const mf = join(s.dir, 'dist', 'vendua-manifest.json');
    const manifest = existsSync(mf)
      ? (JSON.parse(readFileSync(mf, 'utf8')) as ArtifactManifest)
      : null;
    if (manifest) {
      row.kernel = manifest.kernel;
      row.contract = manifest.contract;
      row.source = `templates:${manifest.templates.source} tokens:${manifest.tokens.source}`;
      const problems = checkCompat(manifest);
      row.compat = problems.length ? `fail: ${problems.join('; ')}` : 'pass';
    } else row.compat = 'fail: no manifest (built without vendua())';
    const bin = join(root, 'node_modules', '.bin', 'vendua-conformance');
    if (existsSync(bin)) {
      const ck = await exec([bin, 'static', s.dir], root);
      const fails = ck.output.split('\n').filter((l) => l.startsWith('FAIL'));
      row.check = ck.code === 0 ? 'pass' : `fail: ${fails.join(' | ')}`;
    }
    if (record && manifest && row.compat === 'pass') {
      try {
        await control(
          'POST',
          `/control/v1/storefronts/${s.tenant}/builds`,
          { manifest },
          `build:${s.tenant}:${manifest.builtAt}`,
        );
        row.recorded = `→ ${s.tenant}`;
      } catch (e) {
        row.recorded = `fail: ${(e as Error).message}`;
      }
    }
    rows.push(row);
  }
  const after = (await exec(['git', 'status', '--porcelain', '--', 'storefronts'], root)).output;
  const touched = after !== before;
  const kernels = [...new Set(rows.map((r) => r.kernel))];
  const green = rows.every(
    (r) =>
      r.build === 'pass' &&
      r.compat === 'pass' &&
      r.check !== undefined &&
      !r.check.startsWith('fail') &&
      !r.recorded.startsWith('fail'),
  );

  const md = [
    `# Train dry-run — Kernel ${kernels.join(', ')}`,
    '',
    `${rows.length} storefronts rebuilt in one run${withCore ? ' (templates/tokens pulled from Core)' : ''}.`,
    '',
    '| Storefront | Tenant | Kernel | Contract | Snapshot | Build | Compat | vendua check | Recorded |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| \`${r.storefront}\` | ${r.tenant} | ${r.kernel} | ${r.contract} | ${r.source} | ${r.build} | ${r.compat} | ${r.check} | ${r.recorded} |`,
    ),
    '',
    `Storefront source diff after the train: **${touched ? 'CHANGED — a train must never edit store code' : 'none'}**.`,
    '',
    `Result: **${green && !touched ? 'green' : 'red'}**.`,
    '',
  ].join('\n');
  console.log(md);
  if (reportFile) writeFileSync(reportFile, md);
  process.exit(green && !touched ? 0 : 1);
}
