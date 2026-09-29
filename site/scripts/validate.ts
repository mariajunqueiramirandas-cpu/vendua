// Runs before `vite build`. The site's palette is the merchant admin's: every token both files define
// must hold the same value in Creme and in Noite, so the brand can't drift between the two products.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const site = readFileSync(join(ROOT, 'src/lib/styles/theme.css'), 'utf8');
const admin = readFileSync(join(ROOT, '../apps/admin/src/ui/theme.css'), 'utf8');

/** `--name: value;` pairs of the first block whose selector matches. */
function tokens(css: string, selector: RegExp) {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block matching ${selector}`);
  const start = css.indexOf('{', m.index) + 1;
  let depth = 1;
  let i = start;
  while (depth && i < css.length) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  const out = new Map<string, string>();
  for (const t of css.slice(start, i - 1).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out.set(t[1]!, t[2]!.replace(/\s+/g, ' ').trim());
  return out;
}

const pairs: [string, RegExp, RegExp][] = [
  ['Creme', /^:root\s*\{/m, /^:root\s*\{/m],
  ['Noite', /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{/, /:root\[data-theme='noite'\]\s*\{/],
];

const drift: string[] = [];
let shared = 0;
for (const [theme, siteSel, adminSel] of pairs) {
  const s = tokens(site, siteSel);
  const a = tokens(admin, adminSel);
  for (const [k, v] of s) {
    if (!a.has(k)) continue;
    shared++;
    if (a.get(k) !== v) drift.push(`${theme} ${k}: site "${v}" ≠ admin "${a.get(k)}"`);
  }
}
if (shared < 40)
  throw new Error(`only ${shared} tokens shared with the admin theme — did a selector change?`);
if (drift.length) {
  console.error('The site and the admin disagree on these brand tokens:\n  ' + drift.join('\n  '));
  console.error('The admin (apps/admin/src/ui/theme.css) is the source: copy its values.');
  process.exit(1);
}
console.log(`tokens: ${shared} shared with the admin, no drift`);
