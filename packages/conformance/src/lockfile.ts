// A new store is a new bun workspace, so `bun install` adds its entry to the root bun.lock, and
// CI installs with --frozen-lockfile. A store PR may carry that change and nothing more: the
// store's `workspaces["storefronts/<slug>"]` entry and its own `packages` self-link. A new
// third-party package (or a store pinning another version, which nests one) still fails here.
// Zero dependencies: tools/check-storefront-paths.mjs runs it before `bun install`.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const isObj = (v: Json | undefined): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// `_template` and friends are platform-owned, so their entries never count as a store's
const STORE_DIR = /^storefronts\/([a-z0-9][a-z0-9._-]*)$/i;
const SELF_LINK = /^(.+)@workspace:(storefronts\/[^/]+)$/;

function canonical(v: Json | undefined): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function split(lock: Obj): { rest: string; stores: Map<string, string> } {
  const workspaces: Obj = isObj(lock.workspaces) ? { ...lock.workspaces } : {};
  const packages: Obj = isObj(lock.packages) ? { ...lock.packages } : {};
  const parts = new Map<string, Obj>();
  const part = (slug: string) => {
    let p = parts.get(slug);
    if (!p) parts.set(slug, (p = {}));
    return p;
  };
  for (const [dir, entry] of Object.entries(workspaces)) {
    const slug = STORE_DIR.exec(dir)?.[1];
    if (!slug) continue;
    part(slug).workspace = entry;
    delete workspaces[dir];
  }
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry) || entry.length !== 1 || typeof entry[0] !== 'string') continue;
    const m = SELF_LINK.exec(entry[0]);
    const slug = m?.[2] && STORE_DIR.exec(m[2])?.[1];
    if (!m || !slug || m[1] !== key) continue;
    part(slug).self = entry;
    delete packages[key];
  }
  const stores = new Map([...parts].map(([slug, p]) => [slug, canonical(p)]));
  return { rest: canonical({ ...lock, workspaces, packages }), stores };
}

/**
 * The stores whose own entries differ between two bun.lock texts, or `null` when anything
 * else differs (or either side doesn't parse).
 */
export function storefrontLockScope(baseText: string, headText: string): string[] | null {
  let base: Json, head: Json;
  try {
    base = Bun.JSONC.parse(baseText) as Json;
    head = Bun.JSONC.parse(headText) as Json;
  } catch {
    return null;
  }
  if (!isObj(base) || !isObj(head)) return null;
  const a = split(base);
  const b = split(head);
  if (a.rest !== b.rest) return null;
  const slugs = new Set([...a.stores.keys(), ...b.stores.keys()]);
  return [...slugs].filter((s) => a.stores.get(s) !== b.stores.get(s)).sort();
}

function gitShow(rev: string, cwd: string): string | null {
  const r = Bun.spawnSync(['git', 'show', rev], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** `storefrontLockScope` of bun.lock at the merge base of `base` and HEAD vs HEAD — the same
 * span as `git diff base...HEAD`. */
export function storefrontLockScopeSince(base: string, cwd = process.cwd()): string[] | null {
  const mb = Bun.spawnSync(['git', 'merge-base', base, 'HEAD'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (mb.exitCode !== 0) return null;
  const before = gitShow(`${mb.stdout.toString().trim()}:bun.lock`, cwd);
  const after = gitShow('HEAD:bun.lock', cwd);
  if (before === null || after === null) return null;
  return storefrontLockScope(before, after);
}

/** Why bun.lock may not ride on `slug`'s PR, or `null` when it may. */
export function storefrontLockViolation(
  slug: string,
  base: string,
  cwd = process.cwd(),
): string | null {
  const scope = storefrontLockScopeSince(base, cwd);
  if (scope === null)
    return `bun.lock changes more than a store's own workspace entry (a new package or a platform change)`;
  const others = scope.filter((s) => s !== slug);
  if (others.length) return `bun.lock changes other stores' entries: ${others.join(', ')}`;
  return null;
}
