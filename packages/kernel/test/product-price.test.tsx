import { afterEach, describe, expect, test } from 'bun:test';
import { ProductPrice, productPriceLabel } from '../src/index.ts';
import { mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.13 — ProductPrice: the one price markup stores render instead of formatting
// basePriceCents themselves.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const price = (id: string) => document.querySelector(`#${id} [data-part="price"]`);

async function render(products: Record<string, Parameters<typeof ProductPrice>[0]>) {
  mockCore();
  m = await mount({
    path: '/nowhere-in-particular',
    children: (
      <>
        {Object.entries(products).map(([id, props]) => (
          <div id={id} key={id}>
            <ProductPrice {...props} />
          </div>
        ))}
      </>
    ),
  });
}

describe('ProductPrice', () => {
  test('strikes the "de" price only when it is above the price', async () => {
    await render({
      promo: { product: { basePriceCents: 1800, compareAtPriceCents: 2400 } },
      equal: { product: { basePriceCents: 1800, compareAtPriceCents: 1800 } },
      lower: { product: { basePriceCents: 1800, compareAtPriceCents: 1200 } },
      none: { product: { basePriceCents: 1800, compareAtPriceCents: null } },
      bare: { product: { basePriceCents: 1800 } },
    });
    const promo = price('promo');
    expect(promo?.tagName).toBe('SPAN');
    const struck = promo?.querySelector('s[data-part="compare-at"]');
    expect(struck?.textContent).toMatch(/^de R\$\s24,00$/);
    expect(struck?.querySelector('.v-sr')?.textContent).toBe('de ');
    const sr = [...(promo?.querySelectorAll(':scope > .v-sr') ?? [])].map((e) => e.textContent);
    expect(sr).toEqual(['por ']);
    expect(promo?.textContent).toMatch(/^de R\$\s24,00 por R\$\s18,00$/);
    for (const id of ['equal', 'lower', 'none', 'bare']) {
      expect(price(id)?.querySelector('s')).toBeNull();
      expect(price(id)?.querySelector('.v-sr')).toBeNull();
      expect(price(id)?.textContent).toMatch(/^R\$\s18,00$/);
    }
  });

  test('"a partir de", className and renderAmount', async () => {
    await render({
      from: {
        product: { basePriceCents: 1800, compareAtPriceCents: 2400 },
        from: true,
        className: 'my-price',
        renderAmount: (t) => <b>{t}</b>,
      },
    });
    const el = price('from');
    expect(el?.classList.contains('my-price')).toBe(true);
    expect(el?.textContent).toMatch(/^de R\$\s24,00 por a partir de R\$\s18,00$/);
    expect([...(el?.querySelectorAll('b') ?? [])].map((b) => b.textContent)).toEqual([
      expect.stringMatching(/24,00/),
      expect.stringMatching(/18,00/),
    ]);
  });

  test('productPriceLabel reads the same words', () => {
    expect(productPriceLabel({ basePriceCents: 1800, compareAtPriceCents: 2400 })).toMatch(
      /^de R\$\s24,00 por R\$\s18,00$/,
    );
    expect(productPriceLabel({ basePriceCents: 1800, compareAtPriceCents: 1800 })).toMatch(
      /^R\$\s18,00$/,
    );
    expect(productPriceLabel({ basePriceCents: 1800, compareAtPriceCents: null })).toMatch(
      /^R\$\s18,00$/,
    );
    expect(productPriceLabel({ basePriceCents: 1800 }, 'USD')).toMatch(/US\$\s18,00/);
  });
});
