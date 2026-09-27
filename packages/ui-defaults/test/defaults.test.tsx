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
});
