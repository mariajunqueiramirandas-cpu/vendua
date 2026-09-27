import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Contract migration transforms (09 — Contract majors). Codemods are idempotent,
// scoped to one storefront at a time and dry-runnable: `plan()` computes every
// edit without writing; `apply()` writes exactly what the plan showed. A store
// the codemod can't prove safe is a `failed` result with a reason — that is the
// failure tail an agent (or a human) picks up, never a silent partial edit.

export interface FileEdit {
  file: string;
  before: string;
  after: string;
}

export interface CodemodResult {
  storefront: string;
  status: 'changed' | 'unchanged' | 'failed';
  edits: FileEdit[];
  notes: string[];
  reason?: string;
}

export interface Codemod {
  id: string;
  description: string;
  /** Edits for one storefront (relative paths → new content); throw CodemodFailure to refuse. */
  transform(files: ReadonlyMap<string, string>): { edits: Map<string, string>; notes: string[] };
}

export class CodemodFailure extends Error {}

const SRC = /\.(ts|tsx|css)$/;
const SKIP = new Set(['node_modules', 'dist', 'qa-report', '.vite']);

export function readStorefront(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (SRC.test(name)) files.set(relative(dir, p), readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

export function plan(codemod: Codemod, dir: string): CodemodResult {
  const storefront = dir;
  if (!existsSync(join(dir, 'vendua.config.ts')))
    return {
      storefront,
      status: 'failed',
      edits: [],
      notes: [],
      reason: 'not a storefront (no vendua.config.ts)',
    };
  const files = readStorefront(dir);
  try {
    const { edits, notes } = codemod.transform(files);
    const real: FileEdit[] = [];
    for (const [file, after] of edits) {
      const before = files.get(file) ?? '';
      if (before !== after) real.push({ file, before, after });
    }
    return { storefront, status: real.length ? 'changed' : 'unchanged', edits: real, notes };
  } catch (e) {
    if (e instanceof CodemodFailure)
      return { storefront, status: 'failed', edits: [], notes: [], reason: e.message };
    throw e;
  }
}

export function apply(result: CodemodResult): void {
  for (const e of result.edits) writeFileSync(join(result.storefront, e.file), e.after);
}

/** Minimal unified-ish diff for dry-run reports (line level, no context folding). */
export function diff(e: FileEdit): string {
  const a = e.before.split('\n');
  const b = e.after.split('\n');
  const out = [`--- ${e.file}`, `+++ ${e.file}`];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    // look ahead for the next resync point
    const nextInB = b.indexOf(a[i]!, j);
    const nextInA = a.indexOf(b[j]!, i);
    if (i < a.length && (nextInB === -1 || (nextInA !== -1 && nextInA - i <= nextInB - j))) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      out.push(`+${b[j]}`);
      j++;
    }
  }
  return out.join('\n');
}

export { CODEMODS, findCodemod } from './registry.ts';
