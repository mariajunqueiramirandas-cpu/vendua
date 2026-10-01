import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { SLOT_KEYS } from '@vendua/kernel/config';
import { SLOT_DEFAULTS, SLOT_FIXTURES } from '../src/index.ts';

// Every registered slot has a default, and every default renders its canonical
// fixture (04 — "every slot ships with a conformance fixture").
describe('slot defaults', () => {
  test('cover every registered slot key', () => {
    expect(Object.keys(SLOT_DEFAULTS).sort()).toEqual([...SLOT_KEYS].sort());
    expect(Object.keys(SLOT_FIXTURES).sort()).toEqual([...SLOT_KEYS].sort());
  });

  for (const key of SLOT_KEYS) {
    test(`${key} renders its fixture`, () => {
      const C = SLOT_DEFAULTS[key] as ComponentType<Record<string, unknown>>;
      const html = renderToStaticMarkup(<C {...(SLOT_FIXTURES[key] as Record<string, unknown>)} />);
      expect(html.length).toBeGreaterThan(20);
      expect(html).toContain('data-part="root"');
    });
  }

  test('commerce hooks the conformance suite drives are stamped', () => {
    const r = (k: (typeof SLOT_KEYS)[number]) =>
      renderToStaticMarkup(
        (() => {
          const C = SLOT_DEFAULTS[k] as ComponentType<Record<string, unknown>>;
          return <C {...(SLOT_FIXTURES[k] as Record<string, unknown>)} />;
        })(),
      );
    expect(r('cart.LineItem')).toContain('data-vendua="qty-stepper"');
    expect(r('checkout.Summary')).toContain('data-vendua="total"');
    expect(r('checkout.AddressForm')).toContain('name="neighborhood"');
    expect(r('checkout.PaymentMethods')).toContain('type="radio"');
    expect(r('system.Notice')).toContain('data-vendua="notice"');
  });

  test('unknown action types degrade to links; unknown severity to info', () => {
    const C = SLOT_DEFAULTS['system.Notice'];
    const html = renderToStaticMarkup(
      <C
        notice={{
          id: 'x',
          kind: 'zzz',
          severity: 'catastrophic',
          title: 't',
          dismissible: false,
          priority: 0,
          actions: [
            { type: 'teleport', label: 'Ir', href: '/x' },
            { type: 'bogus', label: 'Boom' },
          ],
        }}
      />,
    );
    expect(html).toContain('data-severity="info"');
    expect(html).toContain('href="/x"');
    expect(html).not.toContain('Boom');
  });

  test('hours fold runs of equal days and name the rest', () => {
    const C = SLOT_DEFAULTS['store.HoursTable'];
    const html = renderToStaticMarkup(<C {...SLOT_FIXTURES['store.HoursTable']} />);
    expect(html).toContain('Seg – Sex');
    expect(html).toContain('09:00–18:00');
    expect(html).toContain('Sáb – Dom');
    expect(html.match(/<tr/g)?.length).toBe(2);
    const every = renderToStaticMarkup(
      <C
        status="open"
        hours={{
          timezone: 'America/Sao_Paulo',
          windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '10:00', close: '20:00' }],
        }}
      />,
    );
    expect(every).toContain('Todos os dias');
    expect(every).toContain('data-today="true"');
  });

  test('product cards flag low stock and encomendas, not plain items', () => {
    const C = SLOT_DEFAULTS['catalog.ProductCard'];
    const fx = SLOT_FIXTURES['catalog.ProductCard'];
    const card = (extra: object) =>
      renderToStaticMarkup(<C {...fx} product={{ ...fx.product, ...extra }} />);
    expect(card({})).not.toContain('data-part="badge"');
    expect(card({ lowStock: true, stockQuantity: 2 })).toContain('Últimas 2');
    expect(card({ requiresPreorder: true })).toContain('Encomenda');
  });

  test('a card priced by a required list shows Core’s "a partir de"', () => {
    const C = SLOT_DEFAULTS['catalog.ProductCard'];
    const fx = SLOT_FIXTURES['catalog.ProductCard'];
    const card = (extra: object) =>
      renderToStaticMarkup(<C {...fx} product={{ ...fx.product, ...extra }} />);
    const from = card({ basePriceCents: 0, compareAtPriceCents: null, fromPriceCents: 2290 });
    expect(from).toContain('data-part="from"');
    expect(from).toMatch(/a partir de <\/span>R\$\s22,90/);
    expect(from).not.toContain('0,00');
    // not above the price: the price itself
    expect(card({ fromPriceCents: 1800 })).not.toContain('a partir de');
  });

  test('an option list longer than 12 gets a filter, a short one does not', () => {
    const C = SLOT_DEFAULTS['catalog.ModifierPicker'];
    const fx = SLOT_FIXTURES['catalog.ModifierPicker'];
    const group = (n: number, name: string) => ({
      id: `g${n}`,
      name,
      required: false,
      minSelect: 0,
      maxSelect: 1,
      modifiers: Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        name: `Opção ${i + 1}`,
        priceDeltaCents: 0,
        status: 'active',
      })),
    });
    const html = (g: ReturnType<typeof group>) =>
      renderToStaticMarkup(<C {...fx} groups={[g]} value={{}} errors={{}} />);
    expect(html(group(12, 'Bordas'))).not.toContain('data-part="option-search"');
    const long = html(group(13, 'Sabores da pizza'));
    expect(long).toContain('data-part="option-search"');
    expect(long).toContain('placeholder="Buscar sabor"');
    expect(html(group(40, 'Adicionais'))).toContain('placeholder="Buscar opção"');
  });
});
