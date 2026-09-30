import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { runStatic } from '../src/static.ts';
import { jsxTexts, selectors } from '../src/lint.ts';

const REPO = join(import.meta.dir, '../../..');
const TEMPLATE = join(REPO, 'storefronts/_template');
const TMP_ROOT = join(import.meta.dir, '.tmp');

// A Contract 2 baseline: the scaffold template's own files (minus deps/builds).
function templateFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (['node_modules', 'dist', 'qa-report'].includes(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|json|css|html)$/.test(name))
        out[relative(TEMPLATE, p)] = readFileSync(p, 'utf8');
    }
  };
  walk(TEMPLATE);
  return out;
}
const BASE = templateFiles();

/** Fixture lives inside the repo tree so module resolution (@vendua/kernel, bun) works offline. */
const made: string[] = [];
function fixture(patch: Record<string, string | null>): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'kcheck-'));
  const files = { ...BASE, ...patch };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  // same deps + base config as the template, so typecheck (K01) runs for real
  symlinkSync(join(TEMPLATE, 'node_modules'), join(dir, 'node_modules'));
  const tsconfig = JSON.parse(files['tsconfig.json']!);
  tsconfig.extends = join(REPO, 'tsconfig.base.json');
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const byId = async (dir: string) =>
  Object.fromEntries((await runStatic(dir)).map((r) => [r.id, r]));
const config = (extra: string) =>
  BASE['vendua.config.ts']!.replace("budgets: 'default',", `budgets: 'default',\n${extra}`);

describe('runStatic', () => {
  test('storefronts/_template passes every K-check', async () => {
    const results = await runStatic(TEMPLATE);
    expect(
      results.filter((r) => r.status !== 'pass').map((r) => `${r.id} ${r.detail ?? ''}`),
    ).toEqual([]);
    expect(results.map((r) => r.id)).toEqual([
      'K01',
      'K02',
      'K03',
      'K04',
      'K06',
      'K07',
      'K08',
      'K09',
      'K10',
      'K11',
      'K12',
      'K13',
      'K14',
      'K15',
    ]);
  }, 180_000);

  test('K01: contract 1 is no longer supported; deprecated slot keys pass with a codemod note', async () => {
    const old = await byId(
      fixture({
        'vendua.config.ts': BASE['vendua.config.ts']!.replace('contract: 2', 'contract: 1'),
      }),
    );
    expect(old.K01?.status).toBe('fail');
    const alias = await byId(
      fixture({
        'vendua.config.ts': config(
          "  overrides: { 'system.StorePausedNotice': () => import('./overrides/P.tsx') },",
        ),
        'overrides/P.tsx': 'export default function P() { return <p>pausado</p>; }\n',
      }),
    );
    expect(alias.K01?.status).toBe('pass');
    expect(alias.K01?.detail).toContain('system.PauseNotice');
    expect(alias.K01?.detail).toContain('c3-rehearsal');
  }, 180_000);

  test('K02: the system route group must be mounted', async () => {
    const r = await byId(
      fixture({ 'main.tsx': BASE['main.tsx']!.replace('<StorefrontRoutes />', '<div />') }),
    );
    expect(r.K02?.status).toBe('fail');
    expect(r.K02?.detail).toContain('StorefrontRoutes');
  }, 180_000);

  test('K04: a route under /control fails', async () => {
    const r = await byId(
      fixture({ 'sections/control.tsx': 'export const route = { path: "/control/panel" };\n' }),
    );
    expect(r.K04?.status).toBe('fail');
  }, 180_000);

  test('K06: string-shorthand and bare-prefix proxies fail', async () => {
    for (const key of ['/checkout', '/storefront']) {
      const r = await byId(
        fixture({
          'vite.config.ts': `export default { server: { proxy: { "${key}": "http://localhost:8787" } } };\n`,
        }),
      );
      expect(r.K06?.status).toBe('fail');
      expect(r.K06?.detail).toContain(key);
    }
  }, 180_000);

  test('K07–K12: each rule catches its violation', async () => {
    const r = await byId(
      fixture({
        'sections/bad.tsx': [
          "import { SLOT_DEFAULTS } from '@vendua/ui-defaults';",
          "import { defineSection, useCart, type SectionProps } from '@vendua/kernel';",
          "export const schema = defineSection({ type: 'store:bad', settings: {} });",
          'export default function Bad(_: SectionProps<typeof schema>) {',
          '  const { mutations } = useCart();',
          "  void mutations.add('x');",
          '  void SLOT_DEFAULTS;',
          '  return <a className="v-btn" href="/produto/pudim">Este texto longo foi escrito direto no código</a>;',
          '}',
        ].join('\n'),
        'styles/global.css': `${BASE['styles/global.css']}\n.v-notice { color: red; }\n[data-section='sdk:header'] [data-part='brand'] { color: blue; }\n`,
        'templates/home.json': JSON.stringify({
          version: 1,
          page: 'home',
          sections: [
            { id: 'ghost', type: 'store:missing' },
            {
              id: 'pp',
              type: 'sdk:purchase-panel',
              blocks: {
                'after-price': [{ id: 'f', type: 'store:intro' }],
                media: [{ id: 'n', type: 'sdk:notify-me' }],
              },
            },
          ],
        }),
      }),
    );
    expect(r.K07?.status).toBe('fail');
    expect(r.K07?.detail).toContain('@vendua/ui-defaults');
    expect(r.K09?.status).toBe('fail');
    expect(r.K09?.detail).toContain('AddToCart');
    expect(r.K09?.detail).toContain('ProductLink');
    expect(r.K10?.status).toBe('fail');
    expect(r.K10?.detail).toContain('.v-notice');
    expect(r.K10?.detail).not.toContain('sdk:header');
    expect(r.K10?.detail).toContain('Kernel class in store markup');
    expect(r.K11?.status).toBe('fail');
    expect(r.K11?.detail).toContain("'store:missing'");
    expect(r.K11?.detail).toContain('is not a known block');
    expect(r.K11?.detail).toContain(
      'sdk:notify-me (purchase-extras) placed in sdk:purchase-panel.media',
    );
    expect(r.K12?.status).toBe('fail');
    expect(r.K12?.detail).toContain('Este texto longo');
  }, 180_000);

  test('K08, K14, K15: impure/too many/broken overrides', async () => {
    const keys = [
      'system.Notice',
      'system.PromoNotice',
      'cart.LineItem',
      'order.Timeline',
      'store.HoursTable',
      'catalog.ProductCard',
    ];
    const r = await byId(
      fixture({
        'vendua.config.ts': config(
          `  overrides: {\n${keys.map((k, i) => `    '${k}': () => import('./overrides/O${i}.tsx'),`).join('\n')}\n  },`,
        ),
        ...Object.fromEntries(
          keys.map((_, i) => [
            `overrides/O${i}.tsx`,
            i === 0
              ? "import { useCart } from '@vendua/kernel';\nexport default function O() { useCart(); return <p>x</p>; }\n"
              : i === 1
                ? "export default function O(): never { throw new Error('broken override'); }\n"
                : 'export default function O() { return <p>ok</p>; }\n',
          ]),
        ),
      }),
    );
    expect(r.K08?.status).toBe('fail');
    expect(r.K08?.detail).toContain("'useCart'");
    expect(r.K14?.status).toBe('fail');
    expect(r.K14?.detail).toContain('6 overrides');
    expect(r.K15?.status).toBe('fail');
    expect(r.K15?.detail).toContain('broken override');
  }, 180_000);

  test('K13: tokens failing AA are caught before any build', async () => {
    // whatever muted the template ships, swap in one too pale for its bg
    const failing = BASE['vendua.config.ts']!.replace(
      /muted: '#[0-9A-Fa-f]{6}'/,
      "muted: '#C8C4BE'",
    );
    expect(failing).not.toBe(BASE['vendua.config.ts']);
    const r = await byId(fixture({ 'vendua.config.ts': failing }));
    expect(r.K13?.status).toBe('fail');
    expect(r.K13?.detail).toContain('color.muted on color.bg');
  }, 180_000);
});

describe('parsers', () => {
  test('selectors skip declarations and at-rule preludes', () => {
    const got = selectors(
      '@media (min-width: 1px) { .a, .b > p { color: red; } }\n:root { --v-x: 1; }',
    ).map((s) => s.text);
    expect(got).toEqual(['.a, .b > p', ':root']);
  });

  test('jsxTexts finds copy, ignores expressions and comparisons', () => {
    const src =
      'const x = a > b < c;\nreturn <p>Olá mundo lindo de meu deus</p>;\n<span>{name}</span>';
    // `a > b <` yields a one-word fragment — harmless, it can never cross the word limit
    expect(
      jsxTexts(src)
        .filter((t) => t.text.split(' ').length > 1)
        .map((t) => t.text),
    ).toEqual(['Olá mundo lindo de meu deus']);
  });
});
