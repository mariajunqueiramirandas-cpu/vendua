import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  openArtifactStore,
  releaseKey,
  BUNDLE_RE,
  type ArtifactStore,
} from '@vendua/edge/artifacts';
import {
  createManifest,
  MANIFEST_FILE,
  uploadRelease,
  type QaCheck,
  type StorefrontManifest,
} from '@vendua/edge/manifest';
import { checkCompat, type ArtifactManifest } from '@vendua/templates';
import { didYouMean } from './args.ts';
import { control } from './core.ts';
import { fleet, select, type FleetStore } from './fleet.ts';
import { die } from './paths.ts';

// `vendua release build|publish` — turns a storefront's dist/ into an immutable, content-addressed
// release (storefront.manifest.json), uploads it to the artifact store the edge serves from and
// registers it with the Control Plane, which promotes it where the fleet policy says so.

const USAGE = `vendua release build [slug…] [--no-build] [--core]
vendua release publish <slug…|--all> [--artifacts <uri>] [--no-build] [--no-register] [--core]`;

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

async function gitCommit(root: string): Promise<string> {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 64);
  const r = await exec(['git', 'rev-parse', 'HEAD'], root).catch(() => null);
  return r?.code === 0 && r.output ? r.output : 'unknown';
}

export function bundleOf(root: string, s: FleetStore): string {
  const bundle = relative(join(root, 'storefronts'), s.dir).split(sep).join('/');
  if (!BUNDLE_RE.test(bundle)) throw new Error(`'${bundle}' is not a valid bundle name`);
  // Core gives a bundle to the store it is named after; `_` dirs are platform-owned
  if (!bundle.startsWith('_') && s.tenant !== bundle)
    throw new Error(
      `${s.rel}: builds for tenant '${s.tenant}' — a store's package name and vendua.tenant must be '${bundle}'`,
    );
  return bundle;
}

function compat(build: unknown): QaCheck[] {
  if (!build || typeof build !== 'object')
    return [{ id: 'compat', ok: false, detail: 'no vendua-manifest.json' }];
  try {
    const problems = checkCompat(build as ArtifactManifest);
    return [
      problems.length
        ? { id: 'compat', ok: false, detail: problems.join('; ') }
        : { id: 'compat', ok: true },
    ];
  } catch (e) {
    return [{ id: 'compat', ok: false, detail: (e as Error).message }];
  }
}

interface Row {
  bundle: string;
  tenant: string;
  release: string;
  kernel: string;
  files: string;
  qa: string;
  upload?: string;
  register?: string;
  failed: boolean;
}

/** Builds (unless --no-build) and writes dist/storefront.manifest.json; returns the manifest. */
async function buildOne(
  root: string,
  s: FleetStore,
  opts: { build: boolean; core: boolean; commit: string },
): Promise<StorefrontManifest> {
  const bundle = bundleOf(root, s);
  if (opts.build) {
    // repo data unless --core, like `vendua train`: a release is a function of the source
    const r = await exec(
      ['bun', 'run', 'build'],
      s.dir,
      opts.core ? {} : { VENDUA_CORE_ORIGIN: '' },
    );
    if (r.code !== 0) {
      console.error(r.output.slice(-1500));
      throw new Error('build failed');
    }
  }
  const dist = join(s.dir, 'dist');
  if (!existsSync(join(dist, 'index.html')))
    throw new Error(`no ${s.rel}/dist/index.html — build first`);
  const m = createManifest({
    dir: dist,
    bundle,
    tenant: s.tenant,
    commit: opts.commit,
    checks: compat,
  });
  writeFileSync(join(dist, MANIFEST_FILE), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

function describe(m: StorefrontManifest): Pick<Row, 'release' | 'kernel' | 'files' | 'qa'> {
  const failing = m.qa.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail ?? 'failed'}`);
  return {
    release: m.release,
    kernel: m.kernelVersion,
    files: String(m.budgets.files),
    qa: failing.length ? `failed (${failing.join(' | ')})` : 'passed',
  };
}

function table(rows: Row[], publish: boolean) {
  const cols: [keyof Row, string][] = [
    ['bundle', 'bundle'],
    ['tenant', 'tenant'],
    ['release', 'release'],
    ['kernel', 'kernel'],
    ['files', 'files'],
    ['qa', 'qa'],
    ...(publish
      ? ([
          ['upload', 'upload'],
          ['register', 'register'],
        ] as [keyof Row, string][])
      : []),
  ];
  const cell = (r: Row, k: keyof Row) => String(r[k] ?? '—');
  const width = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => cell(r, k).length)));
  const line = (vals: string[]) =>
    vals
      .map((v, i) => v.padEnd(width[i]!))
      .join('  ')
      .trimEnd();
  console.log(line(cols.map(([, h]) => h)));
  for (const r of rows) console.log(line(cols.map(([k]) => cell(r, k))));
}

interface RegisterResult {
  created: boolean;
  promoted?: { tenant: string; deploymentId: string }[];
}

export async function cmdRelease(args: string[], root: string): Promise<never> {
  const sub = args[0];
  if (sub !== 'build' && sub !== 'publish') die(`usage:\n${USAGE}`, 2);
  const rest = args.slice(1);
  const ai = rest.indexOf('--artifacts');
  const artifacts = ai >= 0 ? rest[ai + 1] : process.env.VENDUA_ARTIFACTS;
  if (ai >= 0 && !rest[ai + 1]) die('--artifacts needs a uri', 2);
  const known = new Set(['--no-build', '--no-register', '--all', '--core', '--artifacts']);
  const unknown = rest.find((a) => a.startsWith('--') && !known.has(a));
  if (unknown)
    die(`unknown option '${unknown}'${didYouMean(unknown, [...known])}\nusage:\n${USAGE}`, 2);
  // bundle names (`_template`, `quero-pudim`) work as well as slugs and tenants
  const slugs = rest
    .filter((a, i) => !a.startsWith('--') && (ai < 0 || i !== ai + 1))
    .map((a) => (fleet(root).some((f) => f.rel === `storefronts/${a}`) ? `storefronts/${a}` : a));
  const all = rest.includes('--all');
  const build = !rest.includes('--no-build');
  const register = !rest.includes('--no-register');
  const core = rest.includes('--core');

  if (sub === 'publish' && !all && slugs.length === 0)
    die('publish needs storefront slugs or --all', 2);
  if (all && slugs.length) die('pass slugs or --all, not both', 2);

  let stores: FleetStore[];
  let store: ArtifactStore | null = null;
  try {
    stores = select(root, slugs);
    if (sub === 'publish') {
      if (!artifacts)
        throw new Error('no artifact store: pass --artifacts <uri> or set VENDUA_ARTIFACTS');
      store = openArtifactStore(artifacts);
    }
  } catch (e) {
    die((e as Error).message);
  }

  const commit = await gitCommit(root);
  const rows: Row[] = [];
  for (const s of stores) {
    const row: Row = {
      bundle: s.rel,
      tenant: s.tenant,
      release: '—',
      kernel: '—',
      files: '—',
      qa: '—',
      failed: false,
    };
    rows.push(row);
    console.log(`[release] ${s.rel} …`);
    let m: StorefrontManifest;
    try {
      row.bundle = bundleOf(root, s);
      m = await buildOne(root, s, { build, core, commit });
      Object.assign(row, describe(m));
    } catch (e) {
      row.qa = `error: ${(e as Error).message}`;
      row.failed = true;
      continue;
    }
    if (!store) continue;
    try {
      row.upload = await uploadRelease(store, join(s.dir, 'dist'), m);
    } catch (e) {
      row.upload = `fail: ${(e as Error).message}`;
      row.failed = true;
      continue;
    }
    if (!register) continue;
    try {
      const artifactUri = `${store.uri}/${releaseKey(m.bundle, m.release)}`;
      const r = await control<RegisterResult>(
        'POST',
        '/control/v1/fleet/releases',
        { manifest: m, artifactUri },
        `release:${m.release}:${crypto.randomUUID()}`,
      );
      const promoted = (r.promoted ?? []).map((p) => p.tenant);
      row.register = `${r.created ? 'created' : 'existing'}${promoted.length ? ` → ${promoted.join(', ')}` : ''}`;
    } catch (e) {
      row.register = `fail: ${(e as Error).message}`;
      row.failed = true;
    }
  }

  console.log('');
  table(rows, sub === 'publish');
  if (store) console.log(`\nartifacts: ${store.uri}`);
  process.exit(rows.some((r) => r.failed) ? 1 : 0);
}
