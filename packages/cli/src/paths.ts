import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Repo-root + storefront path discovery. The monorepo root is the package.json
 * whose workspaces cover 'storefronts/*'; everything else hangs off that.
 */

export function findRoot(from = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      try {
        const pkg = JSON.parse(readFileSync(pj, 'utf8')) as {
          workspaces?: string[] | { packages?: string[] };
        };
        const ws = pkg.workspaces;
        const globs = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
        if (globs.some((g) => g === 'storefronts/*' || g.startsWith('storefronts/'))) return dir;
      } catch {
        /* unreadable package.json — keep walking up */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function isStorefrontDir(dir: string): boolean {
  return existsSync(join(dir, 'vendua.config.ts'));
}

/** Slug arg wins; otherwise the cwd must itself be a storefront dir. */
export function storefrontDir(root: string, slug: string | undefined): string {
  if (slug) {
    const dir = join(root, 'storefronts', slug);
    if (!isStorefrontDir(dir)) {
      die(`no storefront at storefronts/${slug} (missing vendua.config.ts)`);
    }
    return dir;
  }
  const cwd = process.cwd();
  if (isStorefrontDir(cwd)) return cwd;
  die('no <slug> given and cwd is not a storefront directory (no vendua.config.ts)');
}

/** Every port claimed by a storefronts/<slug>/vite.config.ts. */
export function usedPorts(root: string): Set<number> {
  const used = new Set<number>();
  const dir = join(root, 'storefronts');
  if (!existsSync(dir)) return used;
  for (const entry of readdirSync(dir)) {
    const cfg = join(dir, entry, 'vite.config.ts');
    if (!existsSync(cfg)) continue;
    const m = /port\s*:\s*(\d+)/.exec(readFileSync(cfg, 'utf8'));
    if (m?.[1]) used.add(Number(m[1]));
  }
  return used;
}

export function nextPort(root: string, from = 5200): number {
  const used = usedPorts(root);
  let port = from;
  while (used.has(port)) port += 1;
  return port;
}

export function die(msg: string, code = 1): never {
  console.error(`vendua: ${msg}`);
  process.exit(code);
}
