import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BUNDLE_RE, RELEASE_RE, isSafeKey, releaseKey, type ArtifactStore } from './artifacts.ts';

export const MANIFEST_FILE = 'storefront.manifest.json';
export const BUILD_MANIFEST_FILE = 'vendua-manifest.json';
export const ENTRY = 'index.html';
export const ENTRY_GZIP_BUDGET = 350_000;
const MAX_FILES = 10_000;

export interface ManifestFile {
  size: number;
  sha256: string;
  type: string;
}

export interface Budgets {
  files: number;
  totalBytes: number;
  htmlBytes: number;
  jsBytes: number;
  cssBytes: number;
  entryGzipBytes: number;
}

export interface QaCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

export interface StorefrontManifest {
  manifestVersion: 1;
  release: string;
  bundle: string;
  tenant: string;
  contract: number;
  kernelVersion: string;
  builtAt: string;
  commit: string;
  entry: 'index.html';
  spaFallback: true;
  files: Record<string, ManifestFile>;
  budgets: Budgets;
  qa: { status: 'passed' | 'failed'; checks: QaCheck[] };
  build: unknown;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
};

export function typeFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 && TYPES[name.slice(dot + 1).toLowerCase()]) || 'application/octet-stream';
}

export function isTextType(type: string): boolean {
  return /^(text\/|application\/(json|manifest\+json|xml|javascript)|image\/svg\+xml)/.test(type);
}

export function sha256Hex(data: Uint8Array | string): string {
  return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

/** Every file under `dir` except the storefront manifest itself, '/'-separated and sorted. */
export function listDist(dir: string): string[] {
  const out: string[] = [];
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = rel.split(sep).join('/');
    if (path === MANIFEST_FILE || !statSync(join(dir, rel)).isFile()) continue;
    if (!isSafeKey(path)) throw new Error(`unservable file name in ${dir}: '${path}'`);
    out.push(path);
  }
  if (out.length > MAX_FILES) throw new Error(`${dir} has ${out.length} files (max ${MAX_FILES})`);
  return out.sort();
}

export function hashDist(dir: string): Record<string, ManifestFile> {
  const files: Record<string, ManifestFile> = {};
  for (const path of listDist(dir)) {
    const bytes = readFileSync(join(dir, path));
    files[path] = { size: bytes.length, sha256: sha256Hex(bytes), type: typeFor(path) };
  }
  return files;
}

export function readBuildManifest(dir: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, BUILD_MANIFEST_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Content-addressed id: rebuilding the same source (only builtAt differs) yields the same id. */
export function releaseId(
  bundle: string,
  files: Record<string, { sha256: string }>,
  build: unknown,
): string {
  const lines = Object.entries(files)
    .filter(([p]) => p !== BUILD_MANIFEST_FILE && p !== MANIFEST_FILE)
    .map(([p, f]) => `${p} ${f.sha256}\n`)
    .sort();
  let text = `${bundle}\n${lines.join('')}`;
  if (build && typeof build === 'object') {
    const { builtAt: _drop, ...rest } = build as Record<string, unknown>;
    text += `vendua-manifest ${sha256Hex(JSON.stringify(rest))}\n`;
  }
  return sha256Hex(text).slice(0, 20);
}

export function computeRelease(dir: string, bundle: string) {
  if (!BUNDLE_RE.test(bundle)) throw new Error(`invalid bundle '${bundle}'`);
  const files = hashDist(dir);
  const build = readBuildManifest(dir);
  return { release: releaseId(bundle, files, build), files, build };
}

/** Local JS/CSS the entry HTML loads directly (scripts, stylesheets, modulepreloads). */
export function entryAssets(html: string, files: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const tag = /<(script|link)\b[^>]*>/gi;
  for (const m of html.matchAll(tag)) {
    const t = m[0];
    if (m[1]!.toLowerCase() === 'link' && !/\brel=["']?(stylesheet|modulepreload)\b/i.test(t))
      continue;
    const ref = /\b(?:src|href)=["']?([^"'\s>]+)/i.exec(t)?.[1];
    if (!ref || /^([a-z]+:)?\/\//i.test(ref)) continue;
    const path = ref.replace(/[?#].*$/, '').replace(/^\.?\//, '');
    if (/\.(m?js|css)$/.test(path) && path in files) out.add(path);
  }
  return [...out].sort();
}

export function measureBudgets(dir: string, files: Record<string, ManifestFile>): Budgets {
  const b: Budgets = {
    files: 0,
    totalBytes: 0,
    htmlBytes: 0,
    jsBytes: 0,
    cssBytes: 0,
    entryGzipBytes: 0,
  };
  for (const [path, f] of Object.entries(files)) {
    b.files += 1;
    b.totalBytes += f.size;
    if (/\.html?$/.test(path)) b.htmlBytes += f.size;
    else if (/\.m?js$/.test(path)) b.jsBytes += f.size;
    else if (path.endsWith('.css')) b.cssBytes += f.size;
  }
  if (files[ENTRY]) {
    const html = readFileSync(join(dir, ENTRY), 'utf8');
    for (const p of entryAssets(html, files))
      b.entryGzipBytes += Bun.gzipSync(readFileSync(join(dir, p))).length;
  }
  return b;
}

function buildCheck(build: unknown): QaCheck {
  const b = build as { manifestVersion?: unknown; contract?: unknown; kernel?: unknown } | null;
  if (!b || typeof b !== 'object')
    return { id: 'manifest', ok: false, detail: `${BUILD_MANIFEST_FILE} missing or invalid` };
  const problems: string[] = [];
  if (b.manifestVersion !== 1) problems.push('manifestVersion must be 1');
  if (!Number.isInteger(b.contract) || (b.contract as number) < 1)
    problems.push('contract must be a positive integer');
  if (typeof b.kernel !== 'string' || !/^\d+\.\d+\.\d+/.test(b.kernel))
    problems.push('kernel must be a semver string');
  return problems.length
    ? { id: 'manifest', ok: false, detail: problems.join('; ') }
    : { id: 'manifest', ok: true };
}

/** The `manifest`, `entry` and `budget` QA checks (compat lives with the compat matrix). */
export function qaChecks(dir: string, build: unknown, budgets: Budgets): QaCheck[] {
  let entry: QaCheck;
  try {
    const html = readFileSync(join(dir, ENTRY), 'utf8');
    entry = /["'/]v1\/v\.js\b/.test(html)
      ? { id: 'entry', ok: true }
      : { id: 'entry', ok: false, detail: `${ENTRY} does not load /v1/v.js` };
  } catch {
    entry = { id: 'entry', ok: false, detail: `no ${ENTRY}` };
  }
  const budget: QaCheck =
    budgets.entryGzipBytes <= ENTRY_GZIP_BUDGET
      ? { id: 'budget', ok: true, detail: `entry ${budgets.entryGzipBytes} B gzip` }
      : {
          id: 'budget',
          ok: false,
          detail: `entry ${budgets.entryGzipBytes} B gzip > ${ENTRY_GZIP_BUDGET}`,
        };
  return [buildCheck(build), entry, budget];
}

export interface CreateManifestOptions {
  dir: string;
  bundle: string;
  tenant: string;
  commit: string;
  builtAt?: string;
  /** extra checks recorded first (the CLI adds `compat`) */
  checks?: (build: unknown) => QaCheck[];
}

export function createManifest(o: CreateManifestOptions): StorefrontManifest {
  const { release, files, build } = computeRelease(o.dir, o.bundle);
  const budgets = measureBudgets(o.dir, files);
  const checks = [...(o.checks?.(build) ?? []), ...qaChecks(o.dir, build, budgets)];
  const b = (build ?? {}) as { contract?: unknown; kernel?: unknown };
  return {
    manifestVersion: 1,
    release,
    bundle: o.bundle,
    tenant: o.tenant,
    contract: typeof b.contract === 'number' ? b.contract : 0,
    kernelVersion: typeof b.kernel === 'string' ? b.kernel : 'unknown',
    builtAt: o.builtAt ?? new Date().toISOString(),
    commit: o.commit,
    entry: ENTRY,
    spaFallback: true,
    files,
    budgets,
    qa: { status: checks.every((c) => c.ok) ? 'passed' : 'failed', checks },
    build,
  };
}

function fail(msg: string): never {
  throw new Error(`invalid storefront manifest: ${msg}`);
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const isCount = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
const isStr = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;

export function parseManifest(x: unknown): StorefrontManifest {
  if (!isObj(x)) fail('not an object');
  if (x.manifestVersion !== 1) fail('manifestVersion must be 1');
  if (typeof x.release !== 'string' || !RELEASE_RE.test(x.release))
    fail('release must be 20 lowercase hex chars');
  if (typeof x.bundle !== 'string' || !BUNDLE_RE.test(x.bundle)) fail(`bad bundle`);
  if (!isStr(x.tenant, 64)) fail('tenant must be a non-empty string');
  if (!Number.isInteger(x.contract) || (x.contract as number) < 0)
    fail('contract must be an integer');
  if (!isStr(x.kernelVersion, 64)) fail('kernelVersion must be a string');
  if (!isStr(x.builtAt, 40) || Number.isNaN(Date.parse(x.builtAt as string)))
    fail('builtAt must be an ISO date');
  if (!isStr(x.commit, 64)) fail('commit must be a string');
  if (x.entry !== ENTRY) fail(`entry must be '${ENTRY}'`);
  if (x.spaFallback !== true) fail('spaFallback must be true');
  if (!isObj(x.files)) fail('files must be an object');
  const paths = Object.keys(x.files);
  if (paths.length > MAX_FILES) fail(`more than ${MAX_FILES} files`);
  for (const p of paths) {
    const f = x.files[p];
    if (!isSafeKey(p) || p === MANIFEST_FILE) fail(`bad file path '${p}'`);
    if (
      !isObj(f) ||
      !isCount(f.size) ||
      typeof f.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(f.sha256) ||
      !isStr(f.type, 128)
    )
      fail(`bad file entry '${p}'`);
  }
  if (!(ENTRY in x.files)) fail(`files has no ${ENTRY}`);
  const b = x.budgets;
  if (
    !isObj(b) ||
    !['files', 'totalBytes', 'htmlBytes', 'jsBytes', 'cssBytes', 'entryGzipBytes'].every((k) =>
      isCount(b[k]),
    )
  )
    fail('budgets must hold non-negative integers');
  const qa = x.qa;
  if (!isObj(qa) || (qa.status !== 'passed' && qa.status !== 'failed'))
    fail("qa.status must be 'passed' or 'failed'");
  if (
    !Array.isArray(qa.checks) ||
    !qa.checks.every(
      (c) =>
        isObj(c) &&
        isStr(c.id, 64) &&
        typeof c.ok === 'boolean' &&
        (c.detail === undefined || typeof c.detail === 'string'),
    )
  )
    fail('qa.checks must be { id, ok, detail? }[]');
  if (!('build' in x)) fail('build is required');
  return x as unknown as StorefrontManifest;
}

/**
 * Uploads a built dist to `store` — every file, then the manifest last, since its presence is
 * what marks the release complete. Skips everything when the release is already there.
 */
export async function uploadRelease(
  store: ArtifactStore,
  dir: string,
  m: StorefrontManifest,
): Promise<'uploaded' | 'exists'> {
  if (await store.exists(releaseKey(m.bundle, m.release, MANIFEST_FILE))) return 'exists';
  for (const [path, f] of Object.entries(m.files)) {
    const body = new Uint8Array(readFileSync(join(dir, path)));
    if (sha256Hex(body) !== f.sha256)
      throw new Error(`${path} changed since the manifest was built`);
    await store.put(releaseKey(m.bundle, m.release, path), body, f.type);
  }
  await store.put(
    releaseKey(m.bundle, m.release, MANIFEST_FILE),
    new TextEncoder().encode(`${JSON.stringify(m, null, 2)}\n`),
    'application/json; charset=utf-8',
  );
  return 'uploaded';
}
