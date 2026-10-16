#!/usr/bin/env bun
// The admin app's shell level (ADR 0044 §2): apps/admin/app-version.json `native` says which
// native plugins a JS bundle may call, and Core only offers a bundle to shells at its level or
// above. A PR that changes the shell (its Capacitor dependencies, apps/admin/ios/ or
// apps/admin/android/) without raising `native` would ship an over-the-air bundle that calls
// code the phones in the field don't have. This fails it.
//   check-admin-native.mjs [--base <ref>]   (default: origin/<pr base> in CI, else origin/main)
// Exit 0 = pass, 1 = the shell changed and `native` didn't go up.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = 'apps/admin';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NATIVE_PKG = /^@(?:capacitor|capacitor-community|capgo)\//;

/** The Capacitor side of a package.json: name → version, sorted. */
export function nativeDeps(pkgJson) {
  if (!pkgJson) return '';
  const pkg = JSON.parse(pkgJson);
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.keys(all)
    .filter((n) => NATIVE_PKG.test(n))
    .sort()
    .map((n) => `${n}@${all[n]}`)
    .join('\n');
}

export const nativeLevel = (appJson) => (appJson ? Number(JSON.parse(appJson).native) || 0 : 0);

/** What changed in the shell, and whether `native` went up: the reasons to fail, or []. */
export function verdict({ files, basePkg, headPkg, baseApp, headApp }) {
  const why = [];
  const shellFiles = files.filter(
    (f) => f.startsWith(`${ADMIN}/ios/`) || f.startsWith(`${ADMIN}/android/`),
  );
  if (shellFiles.length)
    why.push(
      `${shellFiles.length} file(s) under ${ADMIN}/ios or ${ADMIN}/android, e.g. ${shellFiles[0]}`,
    );
  if (nativeDeps(basePkg) !== nativeDeps(headPkg))
    why.push(`the Capacitor dependencies in ${ADMIN}/package.json`);
  if (!why.length) return [];
  return nativeLevel(headApp) > nativeLevel(baseApp) ? [] : why;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const at = (ref, path) => {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return null;
  }
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  let base = null;
  const i = args.indexOf('--base');
  if (i >= 0) base = args[i + 1];
  if (!base && process.env.GITHUB_EVENT_PATH) {
    try {
      const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      if (ev.pull_request?.base?.ref) base = `origin/${ev.pull_request.base.ref}`;
    } catch {
      /* not a pull_request event */
    }
  }
  base ??= 'origin/main';
  let files;
  try {
    files = git(['diff', '--name-only', `${base}...HEAD`])
      .split('\n')
      .filter(Boolean);
  } catch {
    console.error(`git diff ${base}...HEAD failed: the checkout needs fetch-depth: 0`);
    process.exit(1);
  }
  const why = verdict({
    files,
    basePkg: at(base, `${ADMIN}/package.json`),
    headPkg: readFileSync(join(ROOT, ADMIN, 'package.json'), 'utf8'),
    baseApp: at(base, `${ADMIN}/app-version.json`),
    headApp: readFileSync(join(ROOT, ADMIN, 'app-version.json'), 'utf8'),
  });
  if (why.length) {
    console.error(
      `the admin app's native shell changed but ${ADMIN}/app-version.json "native" did not go up:\n` +
        why.map((w) => `  - ${w}`).join('\n') +
        `\nRaise "native" (and "version" for the stores), then run bun ${ADMIN}/scripts/native-version.ts.`,
    );
    process.exit(1);
  }
  console.log('admin native level OK');
}
