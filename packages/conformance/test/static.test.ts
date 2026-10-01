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
import { jsxTexts, runLint, selectors } from '../src/lint.ts';
import { runOwnership } from '../src/ownership.ts';
import { balanced, literals } from '../src/source.ts';

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
      'K17',
      'K18',
      'K19',
      'K20',
      'K21',
      'K22',
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

// A bare directory is enough for the source-scanning rules: they read files, not the template.
function bare(files: Record<string, string>): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'own-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  made.push(dir);
  return dir;
}
const owned = (code: string) =>
  Object.fromEntries(runOwnership(bare({ 'sections/x.tsx': code })).map((r) => [r.id, r]));

type Case = [code: string, needle: string];

function expectFlagged(id: string, cases: Case[]) {
  for (const [code, needle] of cases) {
    const r = owned(code)[id]!;
    expect(r.status, code).toBe('fail');
    expect(r.detail, code).toContain('sections/x.tsx:1: ');
    expect(r.detail, code).toContain(needle);
  }
}

describe('Kernel ownership rules (K17-K22)', () => {
  test('K17 money-format: hand-rolled prices name formatCents / useMoney / ProductPrice', () => {
    expectFlagged('K17', [
      ["const f = new Intl.NumberFormat('en');", 'formatCents(cents) / useMoney()'],
      [
        'const a = (n: number) => n.toLocaleString(undefined, { style: "currency" });',
        'toLocaleString with a currency option',
      ],
      ['const a = n.toLocaleString(undefined, { currency: c });', 'toLocaleString with a currency'],
      ['const a = (n / 100).toFixed(2);', 'toFixed(2)'],
      ['const a = `R$ ${v}`;', "'R$' in a literal"],
      ["const a = 'R$ 10,00';", '<ProductPrice product={p} />'],
      ["const a = 'BRL';", "'BRL' literal"],
      ['const a = "BRL";', "'BRL' literal"],
      ["const a = 'pt-BR';", "'pt-BR' literal"],
      ['const a = p.totalCents / 100;', 'cents / 100'],
    ]);
    // text folding has its own Kernel rule
    expect(owned("const a = s.toLocaleLowerCase('pt-BR');").K17!.detail).toContain('foldText');
    const multi = owned(
      ['const a = n.toLocaleString(', '  undefined,', '  { currency: c },', ');'].join('\n'),
    ).K17!;
    expect(multi.detail).toContain('sections/x.tsx:1:');
  });

  test('K17 passes the Kernel formatters, plain numbers, lang attrs, regexes and comments', () => {
    const r = owned(
      [
        "import { formatCents, useMoney } from '@vendua/kernel';",
        '// R$ 10,00 BRL pt-BR Intl.NumberFormat toFixed(2)',
        'const a = (n: number) => n.toLocaleString();',
        'const b = (n: number) => n.toFixed(1);',
        'const c = (x: number, cur: string) => formatCents(x, cur);',
        'const d = /R\\$ ?(\\d+)/.exec("a");',
        'const e = <html lang="pt-BR" />;',
        'const f = "BRLX";',
      ].join('\n'),
    );
    expect(r.K17).toMatchObject({ status: 'pass' });
  });

  test('K18 price-and-card-fields: reads of Core price and stock fields name priceDisplay / cardState', () => {
    expectFlagged('K18', [
      ['const a = p.basePriceCents;', 'priceDisplay(p)'],
      ['const a = p?.fromPriceCents;', '<ProductPrice product={p} />'],
      ['const a = p.compareAtPriceCents > 0;', 'priceDisplay(p)'],
      ['const a = p.stockQuantity;', 'cardState(p, stockLeft)'],
      ['const a = p.lowStockThreshold;', 'useCardState(p)'],
      ['const a = p.lowStock === true;', 'cardState(p, stockLeft)'],
      ['const a = p.needsChoices === false;', '.canQuickAdd'],
      ['const a = !p.requiresPreorder;', 'useCardState(p)'],
      ['const { basePriceCents } = p;', 'basePriceCents destructured'],
    ]);
    const multi = owned(['const {', '  name,', '  lowStock,', '} = p;'].join('\n')).K18!;
    expect(multi.detail).toContain('sections/x.tsx:3: lowStock destructured');
  });

  test('K18 passes the helpers and lookalike names', () => {
    const r = owned(
      [
        "import { priceDisplay, cardState } from '@vendua/kernel';",
        'const d = priceDisplay(p);',
        'const s = cardState(p, 3);',
        'const labels = { lowStock: settings.lowStockLabel, basePrice: 1 };',
        'const { lowStock } = labels;',
        'const x = { basePriceCents: 100, stockQuantity: 2 };',
        'const y = s.badge === "low-stock" ? labels.lowStock : null;',
      ].join('\n'),
    );
    expect(r.K18).toMatchObject({ status: 'pass' });
  });

  test('K19 links: wa.me, instagram.com and built tel: link name contactLinks / useLinks', () => {
    expectFlagged('K19', [
      ['const a = `https://wa.me/${n}`;', 'contactLinks(store)'],
      ["const a = 'https://api.whatsapp.com/send?phone=1';", 'useLinks().contacts.whatsapp'],
      ['const a = "https://instagram.com/loja";', 'useLinks().contacts.instagram'],
      ['const a = `https://www.instagram.com/${h}/`;', 'instagramHandle'],
      ['const a = `tel:${phone}`;', 'tel: link built by hand'],
      ["const a = 'tel:' + phone;", 'contactLinks(store)'],
    ]);
    const r = owned(
      [
        "import { contactLinks } from '@vendua/kernel';",
        '// https://wa.me/5511999999999',
        'const a = contactLinks(store).whatsapp?.href;',
        "const b = 'tel:+5511999999999';",
      ].join('\n'),
    );
    expect(r.K19).toMatchObject({ status: 'pass' });
  });

  test('K20 store-time: hours and date math name useStoreHours / useStoreStatus / formatDateTime', () => {
    expectFlagged('K20', [
      ["const f = new Intl.DateTimeFormat('en');", 'formatDateTime(iso, timeZone)'],
      ['const a = d.toLocaleDateString();', 'formatDay'],
      ['const a = d.toLocaleTimeString();', 'formatTime'],
      ['const a = new Date().getDay();', 'useStoreHours() / useStoreStatus()'],
      ['const a = store.hours.windows.length;', 'useStoreHours()'],
      ['const a = store.hours?.windows;', 'useStoreStatus()'],
      ['const a = store.hours.timezone;', 'formatDateTime'],
    ]);
  });

  test('K20 allows the copyright year and the Kernel hooks', () => {
    const r = owned(
      [
        "import { useStoreHours, useStoreStatus, formatDateTime } from '@vendua/kernel';",
        'export const year = new Date().getFullYear();',
        'const opts = { timeZone: tz, hour: "2-digit" };',
        'const a = formatDateTime(iso, tz);',
        'const t = Date.now();',
      ].join('\n'),
    );
    expect(r.K20).toMatchObject({ status: 'pass' });
  });

  test('K21 media: <img> over Core media fields names ProductImage / Img', () => {
    expectFlagged('K21', [
      ['const a = <img src={product.imageUrl} alt="" />;', '<ProductImage product={p} />'],
      ['const a = <img src={store.logoUrl} alt="" />;', 'logoUrl'],
      ['const a = <img src={`${store.coverUrl}?w=800`} />;', '<Img src=…>'],
      ['const a = <img srcSet={mediaSrcSet(p.imageUrl)} />;', 'srcSet'],
    ]);
    const multi = owned(
      [
        'const a = (',
        '  <img',
        '    alt=""',
        '    onError={() => setBad(true)}',
        '    src={p.gallery[0]?.url}',
        '  />',
        ');',
      ].join('\n'),
    ).K21!;
    expect(multi.detail).toContain('sections/x.tsx:2: <img src={…gallery…}>');
    // a gallery item is { url, alt, … }
    const item = owned(
      [
        'const photos = product.gallery ?? [];',
        'const a = photos.map((g) => <img key={g.url} src={g.url} alt="" />);',
      ].join('\n'),
    ).K21!;
    expect(item.status).toBe('fail');
  });

  test('K21 passes Img, ProductImage, section settings and static art', () => {
    const r = owned(
      [
        "import { Img, ProductImage } from '@vendua/kernel';",
        'const a = <Img src={store.logoUrl} alt="" />;',
        'const b = <ProductImage product={p} />;',
        'const c = <img src={settings.cover} alt="" />;',
        'const d = <img src="/brand/logo.png" alt="" />;',
        'const e = <img src={item.url} alt="" />;',
      ].join('\n'),
    );
    expect(r.K21).toMatchObject({ status: 'pass' });
  });

  test('K22 platform-primitives: vibrate and reduced-motion queries name haptic / useReducedMotion', () => {
    expectFlagged('K22', [
      ['navigator.vibrate?.(8);', 'haptic.tick()'],
      ['navigator.vibrate(8);', 'haptic.commit()'],
      ["const a = matchMedia('(prefers-reduced-motion: reduce)').matches;", 'useReducedMotion()'],
      ['const a = window.matchMedia(`(prefers-reduced-motion: reduce)`);', 'useReducedMotion()'],
    ]);
    const multi = owned(
      ['const a = window.matchMedia(', "  '(prefers-reduced-motion: reduce)',", ');'].join('\n'),
    ).K22!;
    expect(multi.status).toBe('fail');
    const r = owned(
      [
        "import { haptic, useReducedMotion } from '@vendua/kernel';",
        'const wide = window.matchMedia("(min-width: 800px)").matches;',
        'const css = `@media (prefers-reduced-motion: reduce) { .a { transition: none; } }`;',
        'haptic.tick();',
      ].join('\n'),
    );
    expect(r.K22).toMatchObject({ status: 'pass' });
  });

  test('every failure row reads file:line: what — use <replacement>', () => {
    const results = runOwnership(
      bare({
        'sections/a.tsx': [
          "const a = 'BRL';",
          'const b = p.basePriceCents;',
          'const c = `https://wa.me/${n}`;',
          'const d = new Intl.DateTimeFormat("en");',
          'const e = <img src={p.imageUrl} />;',
          'navigator.vibrate(1);',
        ].join('\n'),
      }),
    );
    expect(results.map((r) => r.id)).toEqual(['K17', 'K18', 'K19', 'K20', 'K21', 'K22']);
    for (const r of results) {
      expect(r.status).toBe('fail');
      for (const row of r.detail!.split('\n'))
        expect(row).toMatch(/^sections\/a\.tsx:\d+: .+ — .*use /);
    }
  });

  test('a hand-rolled formatter is one row per line', () => {
    const r = owned(
      "const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });",
    ).K17!;
    expect(r.detail!.split('\n')).toHaveLength(1);
  });
});

describe('K09 / K11 / K03 extensions', () => {
  test('K09: any string holding /produto/ and navigate(/produto…) name ProductLink / useLinks', async () => {
    const dir = bare({
      'sections/links.tsx': [
        'export const a = (slug: string) => `/produto/${slug}`;',
        "export const b = (slug: string) => '/produto/' + slug;",
        "export const c = () => navigate('/produto');",
        'export const d = <Link to={`/produto/${p.slug}`} />;',
        "export const e = 'produto';",
        "// '/produto/ignored'",
      ].join('\n'),
    });
    const k09 = (await runLint(dir)).find((r) => r.id === 'K09')!;
    expect(k09.status).toBe('fail');
    const rows = k09.detail!.split('\n');
    expect(rows.map((r) => r.split(':')[1])).toEqual(['1', '2', '3', '4']);
    expect(k09.detail).toContain('ProductLink');
    expect(k09.detail).toContain('useLinks().product(slug)');
  });

  test('K09 passes ProductLink and useLinks', async () => {
    const dir = bare({
      'sections/links.tsx':
        "export const a = <ProductLink product={p}>x</ProductLink>;\nexport const b = links.product(p.slug);\nexport const c = '/cardapio';\n",
    });
    expect((await runLint(dir)).find((r) => r.id === 'K09')?.status).toBe('pass');
  });

  const section = (areas: string, body: string) =>
    [
      "import { BlockArea, defineSection } from '@vendua/kernel';",
      `export const schema = defineSection({ type: 'store:x', settings: {}, areas: { ${areas} } });`,
      `export default function X() { return <div>${body}</div>; }`,
    ].join('\n');
  const AREAS = "actions: { accepts: ['badge'] }, 'after-price': { accepts: ['info'] }";
  const k11 = async (files: Record<string, string>) =>
    (await runLint(bare(files))).find((r) => r.id === 'K11')!;

  test('K11: a declared area the section never renders fails, naming <BlockArea>', async () => {
    const r = await k11({
      'sections/x.tsx': section(AREAS, '<BlockArea name="after-price" />'),
    });
    expect(r.detail).toContain(
      `sections/x.tsx: declares area 'actions' but never renders <BlockArea name="actions" />`,
    );
    expect(r.detail).not.toContain("declares area 'after-price'");
  });

  test('K11: every declared area rendered passes the area check', async () => {
    for (const body of [
      '<BlockArea name="actions" /><BlockArea name={\'after-price\'} className="p" />',
      '<BlockArea name="actions" />{ok ? <BlockArea only={["info"]} name="after-price" /> : null}',
    ]) {
      const r = await k11({ 'sections/x.tsx': section(AREAS, body) });
      expect(r.detail ?? '').not.toContain('declares area');
    }
  });

  test('K11: a computed area name, or an area rendered by an imported helper, is not guessed at', async () => {
    const computed = await k11({
      'sections/x.tsx': section(AREAS, '{keys.map((k) => <BlockArea key={k} name={k} />)}'),
    });
    expect(computed.detail ?? '').not.toContain('declares area');
    const helper = await k11({
      'sections/x.tsx': [
        "import { Areas } from './_shared/Areas.tsx';",
        section(AREAS, '<Areas />')
          .split('\n')
          .slice(0, 2)
          .join('\n')
          .replace(/^import.*\n/, ''),
        'export default function X() { return <Areas />; }',
      ].join('\n'),
      'sections/_shared/Areas.tsx':
        'import { BlockArea } from \'@vendua/kernel\';\nexport const Areas = () => (<><BlockArea name="actions" /><BlockArea name="after-price" /></>);\n',
    });
    expect(helper.detail ?? '').not.toContain('declares area');
  });

  test('K03: raw transports and qrcode name the Kernel replacement', async () => {
    const dir = bare({
      'package.json': JSON.stringify({
        dependencies: { react: '18.3.1', '@vendua/kernel': 'workspace:*', qrcode: '1.5.4' },
        devDependencies: { typescript: '6.0.3' },
      }),
      'sections/live.tsx': [
        "export const a = new EventSource('/stream');",
        "export const b = () => navigator.sendBeacon('/log', 'x');",
        "export const c = new WebSocket('wss://x');",
        "// new EventSource('/commented')",
      ].join('\n'),
    });
    const k03 = (await runStatic(dir)).find((r) => r.id === 'K03')!;
    expect(k03.status).toBe('fail');
    expect(k03.detail).toContain('sections/live.tsx:1: new EventSource');
    expect(k03.detail).toContain('useOrder(id)');
    expect(k03.detail).toContain('sections/live.tsx:2: navigator.sendBeacon');
    expect(k03.detail).toContain("useAnalytics().track('custom.<name>')");
    expect(k03.detail).toContain('sections/live.tsx:3: new WebSocket');
    expect(k03.detail).toContain('dependency qrcode not in contract allow-list — use <QrCode');
    expect(k03.detail).not.toContain(':4:');
  });

  test('Q07 uses the templates package contrast pairs, not its own list', () => {
    const suite = readFileSync(join(import.meta.dir, '../src/suite/conformance.e2e.ts'), 'utf8');
    expect(suite).toContain("import { CONTRAST_PAIRS, checkCompat } from '@vendua/templates'");
    expect(suite).not.toContain("['--v-color-text', '--v-color-bg']");
  });
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

  test('literals: strings, nested templates, regexes and JSX apostrophes', () => {
    const src = [
      "const a = /['\"]/g; const b = 'one';",
      'const c = `x ${y ? `in ${"deep"}` : ""} z`;',
      '<p>Don\'t</p><Foo a={1} /><a href="/produto/x" />',
      'const d = a / b; const e = "after division";',
    ].join('\n');
    const lits = literals(src).map((l) => [l.line, l.quote, l.raw]);
    expect(lits).toContainEqual([1, "'", 'one']);
    expect(lits).toContainEqual([2, '`', 'x ${y ? `in ${"deep"}` : ""} z']);
    expect(lits).toContainEqual([2, '`', 'in ${"deep"}']);
    expect(lits).toContainEqual([2, '"', 'deep']);
    expect(lits).toContainEqual([3, '"', '/produto/x']);
    expect(lits).toContainEqual([4, '"', 'after division']);
  });

  test('balanced reads call arguments across lines and over string parens', () => {
    const src = 'x.toLocaleString(\n  ")",\n  { a: (1) },\n); y(1)';
    expect(balanced(src, src.indexOf('('))).toBe('\n  ")",\n  { a: (1) },\n');
  });
});
