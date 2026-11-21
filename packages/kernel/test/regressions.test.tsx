import { act } from 'react';
import { afterEach, describe, expect, test } from 'bun:test';
import { CheckoutButton } from '../src/primitives.tsx';
import { invalidateQuery, useKernel, useQuery } from '../src/provider.tsx';
import { ERROR_COPY, deliverySummary, errorCopy, noticeLinks } from '../src/rules/index.ts';
import { useConsent } from '../src/hooks.ts';
import { PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});

describe('Kernel regression suite', () => {
  test('returning shopper with saved consent in localStorage mounts without infinite render loop', async () => {
    mockCore();
    let renders = 0;
    let seenPurposes: string[] | null = null;
    function Reader() {
      renders++;
      const { consent } = useConsent();
      seenPurposes = consent?.purposes ?? null;
      return <p data-test="consent">{consent ? consent.purposes.join(',') : 'none'}</p>;
    }
    m = await mount({
      local: {
        'vendua.consent': JSON.stringify({
          version: 1,
          purposes: ['analytics'],
          at: '2026-10-01T12:00:00.000Z',
        }),
      },
      config: { tenant: 'quero-pudim', consent: { purposes: ['analytics', 'marketing'] } },
      children: <Reader />,
    });
    await flush();
    expect(seenPurposes).toEqual(['analytics']);
    expect(renders).toBeLessThan(10);
  });

  test('seeded invalidateQuery(key, data) updates subscribers in place without a redundant refetch', async () => {
    mockCore();
    let reads = 0;
    let latest: string | undefined;
    let currentApi: ReturnType<typeof useKernel>['api'] | null = null;
    function Probe() {
      const { api } = useKernel();
      currentApi = api;
      const q = useQuery('probe:item', async () => {
        reads++;
        return { value: `read-${reads}` };
      });
      latest = q.data?.value;
      return null;
    }
    m = await mount({ children: <Probe /> });
    await flush();
    expect(reads).toBe(1);
    expect(latest).toBe('read-1');

    await act(async () => {
      invalidateQuery('probe:item', { value: 'seeded' }, currentApi!);
    });
    await flush();
    expect(latest).toBe('seeded');
    expect(reads).toBe(1);
  });

  test('CheckoutButton allows dine-in table shoppers below delivery/pickup minimum order', async () => {
    mockCore();
    const token = `vqr.0b9a4f4e-1c1d-4e2f-9a3b-5c6d7e8f9a0b.1.${'a'.repeat(43)}`;
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input), 'http://shop.test');
      if (u.pathname === '/storefront/v1/store') {
        return new Response(JSON.stringify({ ...STORE, dineIn: { enabled: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.pathname === '/storefront/v1/table') {
        return new Response(
          JSON.stringify({
            table: { id: 't1', number: '4', label: 'Mesa 4', ordering: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u.pathname === '/checkout/v1/cart') {
        return new Response(
          JSON.stringify({
            cart: {
              id: 'cart-1',
              status: 'open',
              items: [
                {
                  id: 'line-1',
                  productId: PRODUCT.id,
                  slug: 'pudim',
                  name: 'Pudim',
                  qty: 1,
                  unitPriceCents: 1200,
                  productStatus: 'active',
                  modifiers: [],
                  lineTotalCents: 1200,
                },
              ],
              totals: {
                subtotalCents: 1200,
                deliveryFeeCents: 0,
                totalCents: 1200,
                itemCount: 1,
                minOrderCents: 3000,
                remainingMinOrderCents: 1800,
                belowMinOrder: true,
              },
              delivery: null,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    window.history.replaceState(null, '', `/?mesa=${token}`);
    m = await mount({
      path: `/?mesa=${token}`,
      session: 'tok-open-cart',
      children: <CheckoutButton>Fechar pedido</CheckoutButton>,
    });
    await flush(8);
    const btn = document.querySelector(
      '[data-vendua="checkout-button"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(false);
  });

  test('deliverySummary supports pure distancePricing stores when zones are empty', () => {
    const store = {
      ...STORE,
      minOrderCents: 2000,
      prepTimeMinutes: 30,
      distancePricing: {
        fromFeeCents: 600,
        feePerKmCents: 200,
        maxKm: 8,
        freeOverCents: 8000,
      },
      fulfillment: {
        pickupMinutes: 30,
        deliveryExtraMinutes: 5,
        deliveryPausedUntil: '2099-01-01T20:00:00.000Z',
      },
    };
    const summary = deliverySummary(store, []);
    expect(summary.delivery).not.toBeNull();
    expect(summary.delivery?.etaMin).toBe(45);
    expect(summary.delivery?.etaMax).toBe(65);
    expect(summary.delivery?.fee).toEqual({ form: 'from', cents: 600 });
    expect(summary.delivery?.minOrderCents).toBe(2000);
    expect(summary.delivery?.freeOverCents).toBe(8000);
    expect(summary.delivery?.pausedUntil).toBe('2099-01-01T20:00:00.000Z');
  });

  test('noticeLinks filters out unsafe javascript: and protocol-relative hrefs', () => {
    const links = noticeLinks({
      id: 'n1',
      kind: 'banner',
      severity: 'info',
      title: 'Aviso',
      dismissible: true,
      priority: 1,
      actions: [
        { type: 'link', label: 'BadJs', href: 'javascript:alert(1)' },
        { type: 'link', label: 'GoodRel', href: '/cardapio' },
      ],
    });
    expect(links.map((l) => l.href)).toEqual(['/cardapio']);

    const protoRel = noticeLinks({
      id: 'n2',
      kind: 'banner',
      severity: 'info',
      title: 'Aviso',
      dismissible: true,
      priority: 1,
      actions: [
        { type: 'link', label: 'ProtoRel', href: '//evil.example/phish' },
        { type: 'link', label: 'GoodAbs', href: 'https://wa.me/5522999999999' },
      ],
    });
    expect(protoRel.map((l) => l.href)).toEqual(['https://wa.me/5522999999999']);
  });

  test('ERROR_COPY covers all newly mapped checkout/payment error codes in pt-BR', () => {
    for (const code of [
      'PAYMENT_METHOD_UNAVAILABLE',
      'PAYMENT_LOCKED',
      'INVALID_DELIVERY',
      'INVALID_CUSTOMER',
      'INVALID_PHONE',
      'INVALID_NOTES',
    ]) {
      expect(code in ERROR_COPY).toBe(true);
      expect(errorCopy(code).title).toBe(ERROR_COPY[code]!.title);
    }
  });
});
