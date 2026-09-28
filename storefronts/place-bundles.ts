// Lays every built storefront out as stores/<tenant slug>/ for the multi-store image
// (nginx-stores.conf). Slug: package.json vendua.tenant, else the folder name
// (_examples/<x> → example-<x>). _template also becomes _default, the fallback bundle.
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [root = 'storefronts', out = 'stores'] = process.argv.slice(2);
const dirs = [
  ...readdirSync(root).map((d) => [d, d] as const),
  ...(existsSync(join(root, '_examples'))
    ? readdirSync(join(root, '_examples')).map((d) => [`_examples/${d}`, `example-${d}`] as const)
    : []),
];
for (const [dir, fallback] of dirs) {
  const dist = join(root, dir, 'dist');
  const pkg = join(root, dir, 'package.json');
  if (!existsSync(dist) || !existsSync(pkg)) continue;
  const slug: string = JSON.parse(readFileSync(pkg, 'utf8')).vendua?.tenant ?? fallback;
  if (dir === '_template') cpSync(dist, join(out, '_default'), { recursive: true });
  if (!/^[a-z0-9-]+$/.test(slug)) continue;
  cpSync(dist, join(out, slug), { recursive: true });
  console.log(`${dir} → ${slug}`);
}
if (!existsSync(join(out, '_default')))
  throw new Error('no _template build: nothing to fall back to');
