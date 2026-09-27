import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// The in-repo fleet: every storefront package (storefronts/* and
// storefronts/_examples/*). `vendua.tenant` in its package.json names the Core
// tenant it builds for (default: the package slug).

export interface FleetStore {
  dir: string;
  rel: string;
  slug: string;
  tenant: string;
}

function read(dir: string): FleetStore | null {
  if (!existsSync(join(dir, 'vendua.config.ts')) || !existsSync(join(dir, 'package.json')))
    return null;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string;
    vendua?: { tenant?: string };
  };
  const slug = pkg.name.replace(/^@vendua\/(storefront-)?/, '');
  return { dir, rel: '', slug, tenant: pkg.vendua?.tenant ?? slug };
}

export function fleet(root: string): FleetStore[] {
  const out: FleetStore[] = [];
  for (const base of ['storefronts', join('storefronts', '_examples')]) {
    const abs = join(root, base);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      if (name.startsWith('.')) continue;
      const s = read(join(abs, name));
      if (s) out.push({ ...s, rel: relative(root, s.dir) });
    }
  }
  return out;
}

/** `slugs` may name package slugs, tenants or repo-relative dirs. */
export function select(root: string, slugs: string[]): FleetStore[] {
  const all = fleet(root);
  if (slugs.length === 0) return all;
  return slugs.map((s) => {
    const hit = all.find((x) => x.slug === s || x.tenant === s || x.rel === s);
    if (!hit) throw new Error(`no storefront '${s}' (known: ${all.map((x) => x.slug).join(', ')})`);
    return hit;
  });
}
