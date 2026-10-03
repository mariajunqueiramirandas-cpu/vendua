#!/usr/bin/env bun
// Enforces the agent-runtime boundary (ADR 0030 decision 11): `packages/agent-runtime` imports
// nothing from Core — no other `@vendua/*` package, no relative path leaving the package, and no
// npm dependency at all (only `node:` / `bun:` builtins).
//   check-agent-runtime-boundary.mjs [--root <dir>]   (default: packages/agent-runtime)
// Exit 0 = pass, 1 = offences (one `file:line specifier` per line) or usage error.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = '@vendua/agent-runtime';
const SOURCE_RE = /\.(?:ts|mts|js|mjs)$/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'agent-runtime');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) fail('--root requires a value');
      root = resolve(value);
    } else if (arg === '-h' || arg === '--help') {
      console.log('usage: check-agent-runtime-boundary.mjs [--root <dir>]');
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg} (see --help)`);
    }
  }
  return root;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && SOURCE_RE.test(entry.name)) yield full;
  }
}

// comments blanked (newlines kept) so a commented-out import neither fails nor shifts line numbers
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

const SPECIFIER_RES = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g, // import/export … from 'x'
  /\bimport\s*(['"])([^'"\n]+)\1/g, // import 'x'
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g, // import('x')
  /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g, // require('x')
];

function specifiers(src) {
  const text = stripComments(src);
  const found = new Map();
  for (const re of SPECIFIER_RES) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].lastIndexOf(m[2]);
      if (found.has(at)) continue;
      found.set(at, { spec: m[2], line: text.slice(0, at).split('\n').length });
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

function offends(spec, file, root) {
  if (spec === SELF || spec.startsWith(`${SELF}/`)) return false;
  if (spec.startsWith('.')) {
    const rel = relative(root, resolve(dirname(file), spec));
    return rel.startsWith('..') || isAbsolute(rel);
  }
  return !(spec.startsWith('node:') || spec.startsWith('bun:') || spec === 'bun');
}

const root = parseArgs(process.argv.slice(2));
try {
  if (!statSync(root).isDirectory()) throw new Error('not a directory');
} catch {
  fail(`--root ${root} is not a readable directory`);
}

const offences = [];
let files = 0;
for (const file of walk(root)) {
  files++;
  for (const { spec, line } of specifiers(readFileSync(file, 'utf8'))) {
    if (offends(spec, file, root)) offences.push(`${relative(root, file)}:${line} ${spec}`);
  }
}

if (offences.length > 0) {
  console.error(
    'agent-runtime must import nothing from Core (ADR 0030 decision 11) — only node:/bun: builtins and its own files:',
  );
  for (const o of offences) console.error(o);
  process.exit(1);
}
console.log(`agent-runtime boundary OK: ${files} file(s), no outside imports`);
