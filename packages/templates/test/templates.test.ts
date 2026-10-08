import { describe, expect, test } from 'bun:test';
import {
  checkCompat,
  defineTemplateMigration,
  findArea,
  runMigration,
  satisfies,
  validateTemplate,
  withRemovals,
  type PageTemplate,
} from '../src/index.ts';

const product: PageTemplate = {
  version: 1,
  page: 'product',
  sections: [
    { id: 'panel', type: 'sdk:purchase-panel', settings: { variant: 'split' } },
    { id: 'story', type: 'store:story', settings: { title: 'Da cozinha' } },
  ],
};

describe('validateTemplate', () => {
  test('accepts a well-formed template, including unknown types', () => {
    const r = validateTemplate({
      ...product,
      sections: [...product.sections, { id: 'x', type: 'sdk:from-the-future' }],
    });
    expect(r.ok).toBe(true);
  });

  test('rejects duplicate ids, bad types and oversized settings', () => {
    const r = validateTemplate({
      version: 1,
      page: 'home',
      sections: [
        { id: 'a', type: 'sdk:hero' },
        { id: 'a', type: 'bogus' },
        { id: 'b', type: 'store:x', settings: { blob: 'x'.repeat(20_000) } },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain("'a' is not unique");
      expect(r.errors.join('\n')).toContain('.type must match');
      expect(r.errors.join('\n')).toContain('settings exceeds');
    }
  });

  test('layout needs exactly one page-content marker', () => {
    expect(validateTemplate({ version: 1, page: 'layout', sections: [] }).ok).toBe(false);
    expect(
      validateTemplate({
        version: 1,
        page: 'layout',
        sections: [{ id: 'c', type: 'sdk:page-content' }],
      }).ok,
    ).toBe(true);
    expect(
      validateTemplate({
        version: 1,
        page: 'home',
        sections: [{ id: 'c', type: 'sdk:page-content' }],
      }).ok,
    ).toBe(false);
  });

  test('page mismatch and version are enforced', () => {
    expect(validateTemplate(product, 'home').ok).toBe(false);
    expect(validateTemplate({ ...product, version: 2 }).ok).toBe(false);
  });
});

describe('withRemovals', () => {
  test('records types a merchant dropped and clears them when re-added', () => {
    const next: PageTemplate = { ...product, sections: [product.sections[0]!] };
    const edited = withRemovals(product, next);
    expect(edited.removed).toEqual(['store:story']);
    const readded = withRemovals(edited, { ...product, removed: edited.removed! });
    expect(readded.removed).toBeUndefined();
  });
});

const reviews = defineTemplateMigration({
  id: '2026-11-reviews-on-product',
  description: 'reviews after the purchase panel',
  requiresKernel: '>=1.4.0',
  pages: ['product'],
  up(t) {
    if (t.has('sdk:reviews')) return;
    t.insertAfter('sdk:purchase-panel', { type: 'sdk:reviews' });
  },
});

describe('runMigration', () => {
  test('applies once, then is idempotent', () => {
    const first = runMigration(reviews, product, { kernelVersion: '1.4.0' });
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    expect(first.template.sections.map((s) => s.type)).toEqual([
      'sdk:purchase-panel',
      'sdk:reviews',
      'store:story',
    ]);
    expect(runMigration(reviews, first.template, { kernelVersion: '1.4.0' }).status).toBe(
      'skipped',
    );
  });

  test('skips stores on an older or unknown kernel', () => {
    expect(runMigration(reviews, product, { kernelVersion: '1.3.9' })).toMatchObject({
      status: 'skipped',
    });
    expect(runMigration(reviews, product, {})).toMatchObject({ status: 'skipped' });
  });

  test('never re-adds what a merchant removed', () => {
    const r = runMigration(
      reviews,
      { ...product, removed: ['sdk:reviews'] },
      { kernelVersion: '2.0.0' },
    );
    expect(r).toMatchObject({ status: 'skipped', reason: 'merchant removed sdk:reviews' });
  });

  test('a missing anchor is a conflict, not a crash', () => {
    const r = runMigration(
      reviews,
      { ...product, sections: [product.sections[1]!] },
      { kernelVersion: '1.4.0' },
    );
    expect(r.status).toBe('conflict');
  });

  test('never mutates the input template', () => {
    const before = JSON.stringify(product);
    runMigration(reviews, product, { kernelVersion: '1.4.0' });
    expect(JSON.stringify(product)).toBe(before);
  });
});

describe('findArea', () => {
  test('targets the first area accepting the category, honoring max', () => {
    const block = defineTemplateMigration({
      id: '2026-10-badge',
      description: 'badge',
      pages: ['product'],
      up(t, ctx) {
        const hit = findArea(t, 'badge', ctx.sections);
        if (!hit) return;
        t.addBlock(hit.section, hit.area, { type: 'sdk:promo-badge' });
      },
    });
    const sections = {
      'sdk:purchase-panel': { areas: { 'after-price': { accepts: ['badge'], max: 1 } } },
      'store:story': { areas: { aside: { accepts: ['badge', 'info'] } } },
    };
    const r1 = runMigration(block, product, { sections });
    expect(r1.status).toBe('applied');
    if (r1.status !== 'applied') return;
    expect(r1.template.sections[0]!.blocks?.['after-price']?.[0]?.type).toBe('sdk:promo-badge');
    // panel area is full now → next application lands in the story aside
    const r2 = runMigration(block, r1.template, { sections });
    if (r2.status !== 'applied') throw new Error(r2.status);
    expect(r2.template.sections[1]!.blocks?.aside?.[0]?.id).toBe('sdk-promo-badge-2');
  });
});

describe('semver + compat', () => {
  test('satisfies ranges', () => {
    expect(satisfies('1.1.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('1.0.0', '1.0.0')).toBe(true);
  });

  test('checkCompat accepts the current line and rejects contract 1 / kernel 2', () => {
    const ok = { contract: 2, kernel: '1.0.0', coreApi: { storefront: 1, checkout: 1 } };
    expect(checkCompat(ok)).toEqual([]);
    expect(checkCompat({ ...ok, contract: 1 })[0]).toContain('no compat-matrix row');
    expect(checkCompat({ ...ok, kernel: '2.0.0' })[0]).toContain('outside');
  });
});

import { contrastProblems, contrastRatio, parseColor, validateTokens } from '../src/index.ts';

const TOKENS = {
  color: {
    bg: '#FCFBF8',
    surface: '#FFFFFF',
    text: '#1A1714',
    muted: '#77705F',
    accent: '#AC5E10',
    onAccent: '#FCFBF8',
    danger: '#B3372F',
    success: '#3D7A4F',
  },
  font: { display: 'Georgia, serif', body: 'system-ui' },
  radius: { sm: '2px', md: '8px', lg: '12px' },
  space: { scale: ['4px', '8px'] },
  motion: { duration: '200ms', easing: 'ease' },
};

describe('tokens', () => {
  test('parses colour syntaxes', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseColor('hsl(0, 0%, 0%)')).toEqual([0, 0, 0]);
    expect(parseColor('var(--x)')).toBeNull();
    expect(contrastRatio('#000', '#fff')!).toBeCloseTo(21, 0);
  });

  test('the shipped brand tokens pass AA', () => {
    expect(contrastProblems(TOKENS)).toEqual([]);
    expect(validateTokens(TOKENS).ok).toBe(true);
  });

  test('a failing pair or unsafe value is rejected', () => {
    const bad = validateTokens({ ...TOKENS, color: { ...TOKENS.color, muted: '#cccccc' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('color.muted on color.bg');
    const inj = validateTokens({ ...TOKENS, radius: { ...TOKENS.radius, sm: '2px;} body{x' } });
    expect(inj.ok).toBe(false);
  });

  test("a font source's weight and style can't break out of its @font-face", () => {
    const font = (src: Record<string, unknown>) =>
      validateTokens({
        ...TOKENS,
        font: { ...TOKENS.font, srcs: [{ family: 'Brand', src: '/f.woff2', ...src }] },
      }).ok;
    for (const weight of [400, '700', '300 800', 'normal', 'bold'])
      expect(font({ weight })).toBe(true);
    expect(font({ style: 'italic' })).toBe(true);
    for (const weight of ['400;}body{display:none', 'bolder', 4000, 400.5, ''])
      expect(font({ weight })).toBe(false);
    for (const style of ['oblique', 'normal;}*{color:red', 1]) expect(font({ style })).toBe(false);
  });
});

describe('findArea ordering', () => {
  test('follows the declared area order, not object key order (jsonb reorders keys)', () => {
    const m = defineTemplateMigration({
      id: '2026-10-order',
      description: 'x',
      pages: ['product'],
      up(t, ctx) {
        const hit = findArea(t, 'info', ctx.sections);
        if (hit) t.addBlock(hit.section, hit.area, { type: 'sdk:x' });
      },
    });
    // shorter key first, the way Postgres hands jsonb back
    const sections = {
      'sdk:purchase-panel': {
        areas: { 'after-cta': { accepts: ['info'] }, 'after-price': { accepts: ['info'] } },
        order: ['after-price', 'after-cta'],
      },
    };
    const r = runMigration(m, product, { sections });
    if (r.status !== 'applied') throw new Error(r.status);
    expect(Object.keys(r.template.sections[0]!.blocks ?? {})).toEqual(['after-price']);
  });
});
