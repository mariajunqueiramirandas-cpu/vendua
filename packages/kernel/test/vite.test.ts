import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSchemas, vendua, KERNEL_VERSION } from '../src/vite.ts';
import { TOKENS } from './harness.tsx';

describe('extractSchemas', () => {
  test('reads section areas and block categories without running store code', () => {
    const src = `
      import { defineSection, defineBlock, text } from '@vendua/kernel';
      export const schema = defineSection({
        type: 'store:story',
        settings: { title: text({ max: 80 }) },
        areas: { aside: { accepts: ['social-proof', 'badge'], max: 2 } },
      });
      export const other = defineBlock({ type: 'store:seal', category: 'badge', settings: {} });`;
    expect(extractSchemas(src)).toEqual({
      'store:story': {
        areas: { aside: { accepts: ['social-proof', 'badge'], max: 2 } },
        order: ['aside'],
      },
      'store:seal': { category: 'badge' },
    });
  });

  test('non-literal areas are skipped, not evaluated', () => {
    const src = `defineSection({ type: 'store:x', settings: {}, areas: { a: { accepts: CATS } } })`;
    expect(extractSchemas(src)).toEqual({ 'store:x': {} });
  });
});

function fakeStorefront(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vendua-plugin-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@vendua/storefront-demo' }));
  mkdirSync(join(dir, 'templates'));
  writeFileSync(
    join(dir, 'templates', 'home.json'),
    JSON.stringify({ version: 1, page: 'home', sections: [{ id: 'g', type: 'sdk:catalog-grid' }] }),
  );
  mkdirSync(join(dir, 'sections'));
  writeFileSync(
    join(dir, 'sections', 'story.tsx'),
    `export const schema = defineSection({ type: 'store:story', settings: {}, areas: { aside: { accepts: ['badge'] } } });`,
  );
  return dir;
}

async function runPlugin(
  tokens: typeof TOKENS,
  root: string,
  paths?: { catalog?: string; product?: `${string}:slug${string}` },
) {
  const plugin = vendua({ config: { contract: 2, tokens, ...(paths ? { paths } : {}) } });
  const errors: string[] = [];
  const emitted: { fileName: string; source: string }[] = [];
  const ctx = {
    error: (m: string) => {
      errors.push(m);
      throw new Error(m);
    },
    addWatchFile: () => {},
    emitFile: (f: { fileName: string; source: string }) => emitted.push(f),
  };
  (plugin.configResolved as (c: unknown) => void)({ root, server: { port: 5199 } });
  try {
    await (plugin.buildStart as (this: unknown) => Promise<void>).call(ctx);
    (plugin.generateBundle as (this: unknown) => void).call(ctx);
  } catch {
    /* recorded in errors */
  }
  const mod = (plugin.load as (id: string) => string | null)('\0vendua-storefront');
  return { errors, emitted, mod };
}

describe('vendua() plugin', () => {
  test('bundles the repo snapshot and writes a manifest', async () => {
    const { errors, emitted, mod } = await runPlugin(TOKENS, fakeStorefront());
    expect(errors).toEqual([]);
    expect(mod).toContain('"sdk:catalog-grid"');
    expect(mod).toContain("import.meta.glob('/sections/*.tsx'");
    const manifest = JSON.parse(emitted.find((e) => e.fileName === 'vendua-manifest.json')!.source);
    expect(manifest).toMatchObject({
      storefront: 'demo',
      contract: 2,
      kernel: KERNEL_VERSION,
      coreApi: { storefront: 1, checkout: 1 },
      templates: { source: 'repo', pages: ['home'] },
    });
    expect(manifest.sections['store:story']).toEqual({
      areas: { aside: { accepts: ['badge'] } },
      order: ['aside'],
    });
    expect(manifest.sections['sdk:purchase-panel'].order).toEqual([
      'media',
      'after-price',
      'after-cta',
    ]);
    expect(manifest.sections['sdk:purchase-panel'].areas['after-price'].accepts).toContain(
      'purchase-extras',
    );
    // the edge matches product pages by the store's route (Kernel 1.14)
    expect(manifest.paths).toEqual({
      home: '/',
      catalog: '/cardapio',
      product: '/produto/:slug',
      cart: '/sacola',
      checkout: '/checkout',
      order: '/pedido/:id',
      orders: '/pedidos',
    });
  });

  test('the manifest carries a store’s custom routes', async () => {
    const { emitted } = await runPlugin(TOKENS, fakeStorefront(), {
      catalog: '/menu',
      product: '/p/:slug',
    });
    const manifest = JSON.parse(emitted.find((e) => e.fileName === 'vendua-manifest.json')!.source);
    expect(manifest.paths).toMatchObject({
      catalog: '/menu',
      product: '/p/:slug',
      cart: '/sacola',
    });
  });

  test('refuses tokens that fail WCAG AA', async () => {
    const { errors } = await runPlugin(
      { ...TOKENS, color: { ...TOKENS.color, muted: '#DDDDDD' } },
      fakeStorefront(),
    );
    expect(errors[0]).toContain('fail WCAG AA');
    expect(errors[0]).toContain('color.muted on color.bg');
  });
});
