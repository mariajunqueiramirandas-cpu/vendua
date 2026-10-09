#!/usr/bin/env bun
// Maps a git diff to the workspaces it affects (affected graph from
// docs/architecture/06-monorepo.md). Prints
// `{"packages": [<workspace dirs>], "allStorefronts": <bool>, "storefronts": [<slugs>], "coreTests": <bool>, "conformance": <bool>, "smoke": <bool>, "adminGate": <bool>, "edgeSmoke": <bool>}`
// — `packages` lists directories consumers `cd` into; `allStorefronts: true` expands
// to every `storefronts/*/` dir; `storefronts` lists the slugs to check/qa (touched ones, or every
// non-`_` storefront with a package.json when `allStorefronts`); `coreTests` /
// `conformance` gate the CI jobs of the same name (`conformance` is also true when `storefronts` is
// non-empty); `smoke` is the old `conformance` rule (template/shared/CI changes) and gates the
// fresh `ci-smoke` scaffold; `adminGate` gates the merchant admin's
// screenshot/axe job (it runs against Core + the Kernel's section catalog); `edgeSmoke` gates
// the Control Plane smoke (Core + the edge + `vendua release` serving the `_template` build).
// `packages/agent-runtime` is a Core dependency (not a storefront one): touching it flips
// `coreTests`, `conformance`, `adminGate` and `edgeSmoke` like a Core change, never `allStorefronts`.
// A bun.lock change that only touches stores' own workspace entries (a new store's `bun install`)
// maps to those stores, not to every storefront and Core (packages/conformance/src/lockfile.ts).
//   bun tools/affected.mjs [--base <ref>]     (default base: origin/main)
// Consumed by the `check` job's Builds step in .github/workflows/ci.yml.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { storefrontLockScopeSince } from '../packages/conformance/src/lockfile.ts';

// every deployable storefront: a dir under storefronts/ with a package.json, `_`-prefixed ones
// (_template and friends) are platform-owned and covered by `smoke`
function listStorefronts(root = 'storefronts') {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .filter((d) => existsSync(join(root, d.name, 'package.json')))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

const SHARED_PACKAGES = new Set([
  'kernel',
  'cli',
  'conformance',
  'ui-defaults',
  'templates',
  'codemods',
]);
// Core's own inputs: Core imports these, so they run its tests
const CORE_TEST_INPUTS = new Set(['packages/core', 'packages/agent-runtime']);
const SHARED_ROOT_FILES = new Set(['package.json', 'bun.lock', 'tsconfig.base.json']);
// the conformance e2e scaffolds from _template and runs against Core + Kernel
const ADMIN_INPUTS = new Set([
  'apps/admin',
  'packages/core',
  'packages/agent-runtime',
  'packages/kernel',
  'packages/templates',
]);
const CONFORMANCE_INPUTS = new Set([
  'packages/core',
  'packages/agent-runtime',
  'packages/kernel',
  'packages/cli',
  'packages/conformance',
  'packages/ui-defaults',
  'packages/templates',
  'packages/loader',
  'storefronts/_template',
]);

// the smoke publishes the template's build and serves it through the edge from Core's routes
const EDGE_INPUTS = new Set([
  'packages/core',
  'packages/agent-runtime',
  'packages/edge',
  'packages/cli',
  'packages/kernel',
  'packages/loader',
  'packages/templates',
  'packages/ui-defaults',
  'storefronts/_template',
]);

export function mapFiles(
  files,
  listAll = listStorefronts,
  exists = (slug) => existsSync(join('storefronts', slug, 'package.json')),
) {
  const packages = new Set();
  let allStorefronts = false;
  let ciChanged = false;
  let rootChanged = false;
  for (const f of files) {
    const parts = f.split('/');
    const [top, second] = parts;
    const depth = parts.length;
    if (top === 'packages') {
      if (depth === 2) continue; // file directly under packages/ — not a workspace
      packages.add(`packages/${second}`);
      if (SHARED_PACKAGES.has(second)) allStorefronts = true;
    } else if (top === 'storefronts') {
      if (depth === 2) {
        allStorefronts = true; // shared storefront infra — can't attribute to one slug
      } else {
        packages.add(`storefronts/${second}`);
      }
    } else if (top === 'apps') {
      if (depth > 2) packages.add(`apps/${second}`);
    } else if (top === 'site') {
      packages.add('site');
    } else if (SHARED_ROOT_FILES.has(f)) {
      allStorefronts = true;
      rootChanged = true;
    } else if (top === '.github' && (second === 'workflows' || second === 'actions')) {
      ciChanged = true;
    }
    // docs/, tools/, .github/, other root files → no workspace affected
  }
  const touches = (dir) => packages.has(dir);
  const storefronts = allStorefronts
    ? listAll()
    : [...packages]
        .filter((p) => p.startsWith('storefronts/'))
        .map((p) => p.slice('storefronts/'.length))
        .filter((slug) => !slug.startsWith('_'))
        // a deleted storefront still shows up in the diff
        .filter(exists)
        .sort();
  const smoke = ciChanged || allStorefronts || [...CONFORMANCE_INPUTS].some(touches);
  return {
    packages: [...packages].sort(),
    allStorefronts,
    storefronts,
    coreTests: ciChanged || rootChanged || [...CORE_TEST_INPUTS].some(touches),
    conformance: smoke || storefronts.length > 0,
    smoke,
    adminGate: ciChanged || rootChanged || [...ADMIN_INPUTS].some(touches),
    edgeSmoke: ciChanged || rootChanged || [...EDGE_INPUTS].some(touches),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let base = 'origin/main';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') {
      base = args[++i];
      if (!base) {
        console.error('--base requires a value');
        process.exit(1);
      }
    } else if (args[i] === '-h' || args[i] === '--help') {
      console.log('usage: affected.mjs [--base <ref>]   (default: origin/main)');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${args[i]} (see --help)`);
      process.exit(1);
    }
  }
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  } catch (err) {
    console.error(
      `git diff --name-only ${base}...HEAD failed — the checkout needs fetch-depth: 0\n` +
        (err.stderr?.toString() || err.message),
    );
    process.exit(1);
  }
  let files = out.split('\n').filter(Boolean);
  const scope = files.includes('bun.lock') ? storefrontLockScopeSince(base) : null;
  if (scope)
    files = files
      .filter((f) => f !== 'bun.lock')
      .concat(scope.map((slug) => `storefronts/${slug}/package.json`));
  console.log(JSON.stringify(mapFiles(files), null, 2));
}
