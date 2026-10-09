#!/usr/bin/env bun
// Enforces the storefront write-scope boundary (docs/architecture/06-monorepo.md):
// a PR labelled `storefront:<slug>` may only touch `storefronts/<slug>/**`.
// CI: `check-storefront-paths.mjs [--base <ref>]` — labels+diff from $GITHUB_EVENT_PATH.
// Local: `check-storefront-paths.mjs --slug <slug> --files f1 f2 …`
// It also holds storefronts/<slug>/package.json to <slug>: the release a store builds is
// adopted by the tenant its package names, so a rename would take over another store's site.
// bun.lock is the one path outside the folder it accepts, and only when the lock change is the
// store's own workspace entry (packages/conformance/src/lockfile.ts).
// Exit 0 = pass, 1 = violations/usage error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { storefrontLockViolation } from '../packages/conformance/src/lockfile.ts';

const LABEL_PREFIX = 'storefront:';
// `platform` label: deliberate escape hatch for platform-wide changes — the label is the audit
const PLATFORM_LABEL = 'platform';
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { slugs: [], files: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--slug') {
      const value = argv[++i];
      if (!value) fail('--slug requires a value');
      opts.slugs.push(value);
    } else if (arg === '--base') {
      const value = argv[++i];
      if (!value) fail('--base requires a value');
      opts.base = value;
    } else if (arg === '--files') {
      opts.files = argv.slice(i + 1);
      break;
    } else if (arg === '-h' || arg === '--help') {
      console.log(
        'usage:\n' +
          '  check-storefront-paths.mjs [--base <ref>]            # CI: labels+files from $GITHUB_EVENT_PATH + git diff\n' +
          '  check-storefront-paths.mjs --slug <s> --files f…     # local: explicit list',
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg} (see --help)`);
    }
  }
  return opts;
}

function changedFiles(base) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    fail(
      `git diff --name-only ${base}...HEAD failed — the checkout needs fetch-depth: 0\n` +
        (err.stderr?.toString() || err.message),
    );
  }
}

const opts = parseArgs(process.argv.slice(2));
const slugs = opts.slugs
  .map((s) => (s.startsWith(LABEL_PREFIX) ? s.slice(LABEL_PREFIX.length) : s))
  .filter((s) => s !== PLATFORM_LABEL);
let files = opts.files;

let platformLabelled = opts.slugs.includes(PLATFORM_LABEL);
if (files === null && slugs.length === 0) {
  // CI mode: labels and base ref come from the pull_request event payload.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail('no --slug/--files and $GITHUB_EVENT_PATH is unset (see --help)');
  const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = payload.pull_request;
  if (pr) {
    for (const label of pr.labels ?? []) {
      if (label.name === PLATFORM_LABEL) platformLabelled = true;
      if (label.name?.startsWith(LABEL_PREFIX)) slugs.push(label.name.slice(LABEL_PREFIX.length));
    }
    opts.base ??= `origin/${pr.base.ref}`;
  }
} else if (files === null) {
  fail(
    'usage: --slug <slug> --files f1 f2 … — or no args in CI with $GITHUB_EVENT_PATH (see --help)',
  );
}

const unique = [...new Set(slugs)];
if (unique.length > 1) {
  fail(
    `a PR belongs to one storefront — found: ${unique.map((s) => `${LABEL_PREFIX}${s}`).join(', ')}`,
  );
}
if (unique.length === 0) {
  // unlabelled ≠ unbounded: any diff touching a non-reserved storefront is a
  // storefront PR; underscored dirs (`_template`) are platform-owned and exempt
  files ??= changedFiles(opts.base ?? 'origin/main');
  const sfRe = /^storefronts\/([^/]+)\//;
  const scoped = files.map((f) => sfRe.exec(f)?.[1]);
  const slugDirs = new Set(scoped.filter((s) => s && !s.startsWith('_')));
  if (slugDirs.size > 0) {
    if (platformLabelled) {
      console.log(
        `'${PLATFORM_LABEL}' label — platform-wide change may touch storefronts (${[...slugDirs].join(', ')}); skipping`,
      );
      process.exit(0);
    }
    const slugs = [...slugDirs].join(', ');
    fail(
      `this diff touches storefronts/${slugs} but carries no '${LABEL_PREFIX}' label\n` +
        `  label it '${LABEL_PREFIX}${slugDirs.size === 1 ? [...slugDirs][0] : '<slug>'}' — a storefront PR must be labelled to merge\n` +
        `  (deliberate platform-wide change that must touch a storefront? label it '${PLATFORM_LABEL}')`,
    );
  }
  console.log('no storefront:* label — not a storefront PR; skipping');
  process.exit(0);
}

const slug = unique[0];
if (!SLUG_RE.test(slug)) fail(`invalid storefront slug in label: "${slug}"`);

files ??= changedFiles(opts.base ?? 'origin/main');

const allowed = `storefronts/${slug}/`;
const violations = files.filter((f) => !f.startsWith(allowed));
const lockIdx = violations.indexOf('bun.lock');
let lockWhy = null;
if (lockIdx !== -1) {
  lockWhy = storefrontLockViolation(slug, opts.base ?? 'origin/main');
  if (lockWhy === null) violations.splice(lockIdx, 1);
}
if (violations.length > 0) {
  console.error(
    `storefront:${slug} PRs may only touch ${allowed}** (and bun.lock's entry for it) — offending paths:`,
  );
  for (const f of violations) console.error(`  ${f}${f === 'bun.lock' ? ` — ${lockWhy}` : ''}`);
  process.exit(1);
}
// the same derivation as `vendua release` (packages/cli/src/fleet.ts)
const pkgPath = `${allowed}package.json`;
if (existsSync(pkgPath)) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    fail(`${pkgPath} is not valid JSON`);
  }
  const name =
    typeof pkg?.name === 'string' ? pkg.name.replace(/^@vendua\/(storefront-)?/, '') : null;
  const tenant = pkg?.vendua?.tenant ?? name;
  if (name !== slug || tenant !== slug)
    fail(
      `${pkgPath} must build for '${slug}': name '@vendua/storefront-${slug}' and no other vendua.tenant` +
        ` (found name ${JSON.stringify(pkg?.name)}, tenant ${JSON.stringify(tenant)})`,
    );
}
console.log(
  `storefront:${slug}: all ${files.length} changed file(s) under ${allowed}${lockIdx !== -1 ? ' (plus its bun.lock entry)' : ''}`,
);
