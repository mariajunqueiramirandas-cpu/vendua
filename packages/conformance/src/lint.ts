import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastProblems, validateTokens, type TemplateSet } from '@vendua/templates';
import { readTemplatesDir } from '@vendua/templates/node';
import { SDK_SCHEMAS, catalogOf } from '@vendua/kernel/sdk-catalog';
import { extractSchemas } from '@vendua/kernel/vite';
import { runOwnership } from './ownership.ts';
import type { CheckResult } from './report.ts';
import { lines, literals, stripComments } from './source.ts';
import { KERNEL_IMPORT_ALLOW, run, sourceFiles } from './static.ts';

// `vendua check` lint rules (04 — lint rules; 17 — Contract 2). Each rule is a
// stable check ID so a storefront's report reads the same across Kernel lines.

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Stores above this many overrides are flagged: each one freezes UI against Kernel improvements. */
export const OVERRIDE_LIMIT = 5;
/** JSX text longer than this many words in a store section is copy that belongs in settings. */
export const COPY_WORD_LIMIT = 4;

const fail = (id: string, title: string, detail: string): CheckResult => ({
  id,
  title,
  status: 'fail',
  detail,
});
const pass = (id: string, title: string, detail?: string): CheckResult => ({
  id,
  title,
  status: 'pass',
  ...(detail ? { detail } : {}),
});

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'qa-report', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

function k07(dir: string): CheckResult {
  const id = 'K07';
  const title = 'no-deep-kernel-imports: only @vendua/kernel entry points';
  const problems: string[] = [];
  const files = [...sourceFiles(dir), ...walk(dir, /\.css$/)];
  for (const f of files) {
    for (const { n, text } of lines(f)) {
      for (const m of text.matchAll(
        /(?:from\s+|import\s*\(\s*|@import\s+(?:url\()?)['"](@vendua\/[^'"]+)['"]/g,
      )) {
        if (!KERNEL_IMPORT_ALLOW.has(m[1]!))
          problems.push(
            `${relative(dir, f)}:${n}: ${m[1]} — allowed: ${[...KERNEL_IMPORT_ALLOW].join(', ')}`,
          );
      }
    }
  }
  return problems.length ? fail(id, title, problems.join('\n')) : pass(id, title);
}

/** Override module paths from the config's lazy imports. */
function overrideFiles(dir: string): { key: string; file: string }[] {
  const cfg = join(dir, 'vendua.config.ts');
  if (!existsSync(cfg)) return [];
  const src = stripComments(readFileSync(cfg, 'utf8'));
  const out: { key: string; file: string }[] = [];
  for (const m of src.matchAll(
    /['"]([a-z]+\.[A-Za-z]+)['"]\s*:\s*\(\)\s*=>\s*import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ))
    out.push({ key: m[1]!, file: resolve(dir, m[2]!) });
  return out;
}

/** Relative imports of a module, transitively (so a helper can't smuggle a hook in). */
function closure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = resolve(dirname(f), m[1]!);
      for (const cand of [base, `${base}.ts`, `${base}.tsx`])
        if (existsSync(cand) && statSync(cand).isFile()) visit(cand);
    }
  };
  visit(entry);
  return [...seen];
}

const IMPURE =
  /\b(useCart|useCheckout|useCustomer|useDeliveryQuote|useConsent|useOrderHistory|AddToCart|CheckoutButton|QuantityStepper|NotifyMeButton|fetch)\b/;

// overrides load with vendua.config.ts, in Node, before the Kernel's React runtime exists
const KERNEL_MAIN_IMPORT = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@vendua\/kernel['"]/g;

function k08(dir: string): CheckResult {
  const id = 'K08';
  const title =
    'override-purity: overrides are presentational (no mutations, API or commerce primitives)';
  const problems: string[] = [];
  for (const { key, file } of overrideFiles(dir)) {
    for (const f of closure(file)) {
      for (const { n, text } of lines(f)) {
        const hit = IMPURE.exec(text);
        if (hit)
          problems.push(
            `${relative(dir, f)}:${n} (${key}): '${hit[1]}' — overrides receive data via props and act through callbacks`,
          );
      }
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(KERNEL_MAIN_IMPORT)) {
        if (m[1]) continue;
        const values = m[2]!
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('type '));
        if (values.length)
          problems.push(
            `${relative(dir, f)}:${src.slice(0, m.index).split('\n').length} (${key}): runtime import of ${values.join(', ')} from '@vendua/kernel' — an override loads with the store config, so import helpers from '@vendua/kernel/rules' (types: \`import type\`)`,
          );
      }
    }
  }
  return problems.length ? fail(id, title, problems.join('\n')) : pass(id, title);
}

const PRODUCT_URL =
  'hand-built product URL — use ProductLink (route resolution + prefetch) or useLinks().product(slug); an absolute link (QR, share) is useLinks().absolute(…)';

function k09(dir: string): CheckResult {
  const id = 'K09';
  const title = 'require-primitives: commerce goes through Kernel primitives';
  const problems: string[] = [];
  for (const f of sourceFiles(dir)) {
    const rel = relative(dir, f);
    const found: { n: number; msg: string }[] = [];
    for (const { n, text } of lines(f)) {
      if (/\buseCheckout\s*\(/.test(text))
        found.push({
          n,
          msg: 'useCheckout() — checkout is a Kernel page; link with CheckoutButton',
        });
      if (
        /\bmutations\s*\.\s*(add|updateQty|remove|setDelivery)\b/.test(text) ||
        /\.\s*mutations\b/.test(text)
      )
        found.push({ n, msg: 'cart mutation called directly — use AddToCart / QuantityStepper' });
      if (/\bnavigate\s*\(\s*[`'"]\/produto/.test(text)) found.push({ n, msg: PRODUCT_URL });
    }
    for (const l of literals(stripComments(readFileSync(f, 'utf8'))))
      if (l.raw.includes('/produto/')) found.push({ n: l.line, msg: PRODUCT_URL });
    for (const { n, msg } of found.sort((a, b) => a.n - b.n)) problems.push(`${rel}:${n}: ${msg}`);
  }
  const unique = [...new Set(problems)];
  return unique.length ? fail(id, title, unique.join('\n')) : pass(id, title);
}

/** Selector text of every rule in a stylesheet (declarations and at-rule preludes excluded). */
export function selectors(css: string): { text: string; line: number }[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: { text: string; line: number }[] = [];
  let buf = '';
  let line = 1;
  let start = 1;
  for (const ch of src) {
    if (ch === '\n') line++;
    if (ch === '{') {
      const sel = buf.trim();
      if (sel && !sel.startsWith('@')) out.push({ text: sel, line: start });
      buf = '';
    } else if (ch === '}' || ch === ';') {
      buf = '';
    } else {
      if (!buf.trim()) start = line;
      buf += ch;
    }
  }
  return out;
}

function k10(dir: string): CheckResult {
  const id = 'K10';
  const title =
    'no-v-namespace: store CSS targets only documented parts, never v-* / [data-vendua]';
  const problems: string[] = [];
  const check = (where: string, css: string, offset = 0) => {
    for (const s of selectors(css)) {
      if (/\.v-[a-z]/i.test(s.text) || /\[data-vendua/i.test(s.text))
        problems.push(
          `${where}:${s.line + offset}: '${s.text.replace(/\s+/g, ' ').slice(0, 80)}' — use [data-part] / --v-<component>-* (packages/kernel/API.md#styling-api)`,
        );
    }
  };
  for (const f of walk(dir, /\.css$/)) check(relative(dir, f), readFileSync(f, 'utf8'));
  for (const f of sourceFiles(dir)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<style[^>]*>\s*\{\s*`([\s\S]*?)`\s*\}\s*<\/style>/g))
      check(relative(dir, f), m[1]!, src.slice(0, m.index).split('\n').length - 1);
    for (const { n, text } of lines(f))
      if (/className=\{?\s*[`'"][^`'"]*\bv-[a-z]/.test(text))
        problems.push(
          `${relative(dir, f)}:${n}: Kernel class in store markup — v-* classes are Kernel internals`,
        );
  }
  return problems.length ? fail(id, title, problems.join('\n')) : pass(id, title);
}

type Catalog = Record<
  string,
  { areas?: Record<string, { accepts: string[]; max?: number }>; category?: string }
>;

/** Declared area keys the section (and the modules it imports) never renders as a literal <BlockArea name>. */
function unrenderedAreas(entry: string, declared: string[]): string[] {
  if (declared.length === 0) return [];
  const rendered = new Set<string>();
  for (const f of closure(entry)) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/<BlockArea\b/g)) {
      const tag = src.slice(m.index, m.index + 400).split('/>')[0]!;
      const named = /\bname\s*=\s*\{?\s*(['"`])([^'"`$]+)\1/.exec(tag);
      // a computed name could be any key — can't tell, so don't guess
      if (!named) return [];
      rendered.add(named[2]!);
    }
  }
  return declared.filter((k) => !rendered.has(k));
}

function k11(dir: string): CheckResult {
  const id = 'K11';
  const title =
    'composition: sections export literal schemas; templates reference known types in accepting areas';
  const problems: string[] = [];
  if (existsSync(join(dir, 'routes')))
    problems.push('routes/ exists — Contract 2 pages are templates/ + sections/ (ADR 0018)');

  const store: Catalog = {};
  const secDir = join(dir, 'sections');
  if (existsSync(secDir)) {
    for (const f of readdirSync(secDir).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(join(secDir, f), 'utf8');
      if (
        !/export\s+const\s+schema\s*=\s*define(Section|Block)\s*\(/.test(src) ||
        !/export\s+default\s+function/.test(src)
      ) {
        problems.push(
          `sections/${f}: needs \`export const schema = defineSection|defineBlock(...)\` + a default component`,
        );
        continue;
      }
      const found = extractSchemas(src);
      const types = Object.keys(found);
      if (types.length !== 1) {
        problems.push(
          `sections/${f}: exactly one literal schema type expected, found ${types.length}`,
        );
        continue;
      }
      const type = types[0]!;
      if (!type.startsWith('store:'))
        problems.push(`sections/${f}: '${type}' — store modules use the store: namespace`);
      if (store[type]) problems.push(`sections/${f}: duplicate type '${type}'`);
      if (/\bareas\s*:/.test(src) && !found[type]!.areas && !found[type]!.category)
        problems.push(
          `sections/${f}: areas must be a literal object (the build publishes them for template migrations)`,
        );
      store[type] = found[type]!;
      for (const key of unrenderedAreas(join(secDir, f), Object.keys(found[type]!.areas ?? {})))
        problems.push(
          `sections/${f}: declares area '${key}' but never renders <BlockArea name="${key}" /> — blocks a merchant places there would not show`,
        );
    }
  }

  let templates: TemplateSet = {};
  try {
    templates = readTemplatesDir(join(dir, 'templates'));
  } catch (e) {
    problems.push((e as Error).message);
  }
  if (Object.keys(templates).length === 0) problems.push('templates/ has no page templates');
  const known: Catalog = { ...(catalogOf(SDK_SCHEMAS) as Catalog), ...store };
  for (const [page, t] of Object.entries(templates)) {
    for (const s of t!.sections) {
      const sec = known[s.type];
      if (!sec)
        problems.push(
          `templates/${page}: section '${s.type}' (#${s.id}) is not an SDK or store section in this build`,
        );
      else if (sec.category)
        problems.push(`templates/${page}: '${s.type}' is a block, placed as a section`);
      for (const [area, blocks] of Object.entries(s.blocks ?? {})) {
        const spec = sec?.areas?.[area];
        if (sec && !spec) problems.push(`templates/${page}: ${s.type} has no area '${area}'`);
        if (spec?.max !== undefined && blocks.length > spec.max)
          problems.push(
            `templates/${page}: ${s.type}.${area} holds ${blocks.length} blocks, max ${spec.max}`,
          );
        for (const b of blocks) {
          const blk = known[b.type];
          if (!blk?.category)
            problems.push(`templates/${page}: block '${b.type}' (#${b.id}) is not a known block`);
          else if (spec && !spec.accepts.includes(blk.category))
            problems.push(
              `templates/${page}: ${b.type} (${blk.category}) placed in ${s.type}.${area}, which accepts ${spec.accepts.join('/')}`,
            );
        }
      }
    }
  }
  return problems.length
    ? fail(id, title, problems.join('\n'))
    : pass(
        id,
        title,
        `${Object.keys(store).length} store modules, pages: ${Object.keys(templates).sort().join(', ')}`,
      );
}

/** JSX text between tags, with its line. */
export function jsxTexts(src: string): { text: string; line: number }[] {
  const clean = stripComments(src);
  const out: { text: string; line: number }[] = [];
  for (const m of clean.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1]!.replace(/\s+/g, ' ').trim();
    if (!text || /^[\W\d_]*$/.test(text)) continue;
    // TS generics / comparisons (`a > b <`) aren't JSX text
    if (/[;=()]|=>|&&/.test(text)) continue;
    out.push({ text, line: clean.slice(0, m.index).split('\n').length });
  }
  return out;
}

function k12(dir: string): CheckResult {
  const id = 'K12';
  const title = `content-as-data: no hard-coded copy (> ${COPY_WORD_LIMIT} words) in store sections`;
  const problems: string[] = [];
  for (const f of walk(join(dir, 'sections'), /\.tsx$/)) {
    for (const t of jsxTexts(readFileSync(f, 'utf8'))) {
      if (t.text.split(' ').length > COPY_WORD_LIMIT)
        problems.push(
          `${relative(dir, f)}:${t.line}: "${t.text.slice(0, 60)}" — move it into the section's settings`,
        );
    }
  }
  return problems.length ? fail(id, title, problems.join('\n')) : pass(id, title);
}

async function evalConfig(
  dir: string,
): Promise<{ tokens?: unknown; overrides: string[] } | { error: string }> {
  const ev = await run(
    [
      'bun',
      '-e',
      'const m = await import(process.env.VENDUA_CFG); const c = m.default ?? m; ' +
        'console.log(JSON.stringify({ tokens: c.tokens, overrides: Object.keys(c.overrides ?? {}) }));',
    ],
    dir,
    60_000,
    { VENDUA_CFG: join(dir, 'vendua.config.ts') },
  );
  if (ev.code !== 0) return { error: ev.output.slice(-1500) };
  return JSON.parse(ev.output.trim().split('\n').pop() ?? '{}');
}

async function k13_14(dir: string): Promise<CheckResult[]> {
  const t13 = 'tokens: complete, CSS-safe, WCAG AA on every default-surface pair';
  const t14 = `override budget: ≤ ${OVERRIDE_LIMIT} slot overrides (each freezes UI against Kernel improvements)`;
  const cfg = await evalConfig(dir);
  if ('error' in cfg) return [fail('K13', t13, cfg.error), fail('K14', t14, cfg.error)];
  const v = validateTokens(cfg.tokens);
  const r13 = v.ok ? pass('K13', t13) : fail('K13', t13, v.errors.join('\n'));
  if (v.ok && contrastProblems(v.tokens).length)
    throw new Error('unreachable: validateTokens checks contrast');
  const n = cfg.overrides.length;
  const detail = `${n} override${n === 1 ? '' : 's'}${n ? `: ${cfg.overrides.join(', ')}` : ''}`;
  const r14 = n > OVERRIDE_LIMIT ? fail('K14', t14, detail) : pass('K14', t14, detail);
  return [r13, r14];
}

async function k15(dir: string): Promise<CheckResult> {
  const id = 'K15';
  const title = 'overrides render their slot fixture (canonical props) without throwing';
  if (overrideFiles(dir).length === 0) return pass(id, title, 'no overrides');
  const r = await run(['bun', join(PKG_DIR, 'src', 'render-overrides.tsx'), dir], dir, 90_000);
  const last = r.output.trim().split('\n').pop() ?? '';
  let parsed: { key: string; ok: boolean; error?: string }[];
  try {
    parsed = JSON.parse(last);
  } catch {
    return fail(id, title, r.output.slice(-2000));
  }
  const bad = parsed.filter((x) => !x.ok);
  return bad.length
    ? fail(id, title, bad.map((b) => `${b.key}: ${b.error}`).join('\n'))
    : pass(id, title, parsed.map((p) => p.key).join(', '));
}

export async function runLint(dir: string): Promise<CheckResult[]> {
  return [
    k07(dir),
    k08(dir),
    k09(dir),
    k10(dir),
    k11(dir),
    k12(dir),
    ...(await k13_14(dir)),
    await k15(dir),
    ...runOwnership(dir),
  ];
}
