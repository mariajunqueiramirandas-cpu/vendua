import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType, ReactElement } from 'react';
import { SLOT_KEYS } from '@vendua/kernel/config';
import { vocabularyOf } from '@vendua/kernel/rules';
import { SLOT_DEFAULTS, SLOT_FIXTURES } from '../src/index.ts';

// Every registered slot has a default, and every default renders its canonical
// fixture (04 — "every slot ships with a conformance fixture").
afterEach(() => setSystemTime());

const tags = (html: string) => html.replace(/<[^>]+>/g, '');

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

  test('the card form renders the Kernel’s fields once; card copy never sends the shopper away', () => {
    const Card = SLOT_DEFAULTS['checkout.CardPayment'];
    const fx = SLOT_FIXTURES['checkout.CardPayment'];
    const html = renderToStaticMarkup(<Card {...fx} />);
    expect(html.match(/data-part="fixture-fields"/g)).toHaveLength(1);
    expect(tags(html)).toContain('Saldo ou limite insuficiente');
    expect(tags(html)).toContain('vão direto para o Mercado Pago');
    const down = renderToStaticMarkup(
      <Card {...fx} phase="unavailable" declined={null} onRetry={() => {}} />,
    );
    expect(down).toContain('data-part="retry"');
    expect(down).toContain('data-part="whatsapp"');
    const Status = SLOT_DEFAULTS['checkout.PaymentStatus'];
    for (const status of ['confirming', 'processing', 'failed', 'paid', 'due'] as const) {
      const t = tags(
        renderToStaticMarkup(
          <Status status={status} method="card_online" amountCents={4700} currency="BRL" />,
        ),
      );
      expect(t).not.toContain('ambiente do Mercado Pago');
      expect(t).not.toMatch(/Levando você|no Mercado Pago dá/);
    }
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

  test('hours: closed days are rows, today is the store’s, a special day takes it', () => {
    const C = SLOT_DEFAULTS['store.HoursTable'];
    const hours = {
      timezone: 'America/Sao_Paulo',
      windows: [
        { days: [1, 2, 3, 4, 5], open: '09:00', close: '18:00' },
        { days: [6], open: '10:00', close: '14:00' },
      ],
    };
    // Sunday 01:30 UTC is still Saturday in São Paulo
    setSystemTime(new Date('2026-10-04T01:30:00Z'));
    const week = renderToStaticMarkup(<C hours={hours} status="open" />);
    const rows = week.match(/<tr[^]*?<\/tr>/g)!.map(tags);
    expect(rows).toEqual(['Seg – Sex09:00–18:00', 'Sábado · hoje10:00–14:00', 'DomingoFechado']);
    expect(week.match(/<tr[^>]*data-closed/g)).toHaveLength(1);
    const holiday = renderToStaticMarkup(
      <C
        hours={{ ...hours, specialDays: [{ date: '2026-10-03', closed: true, label: 'Feriado' }] }}
        status="closed"
      />,
    );
    const hrows = holiday.match(/<tr[^]*?<\/tr>/g)!.map(tags);
    expect(hrows[0]).toBe('Hoje · FeriadoFechado');
    expect(hrows[2]).toBe('Sábado10:00–14:00');
    expect(holiday.match(/data-today/g)).toHaveLength(1);
  });

  test('order progress walks the mode’s path: pickup has no "a caminho", delivery has "pronto"', () => {
    const C = SLOT_DEFAULTS['order.StatusPage'];
    const fx = SLOT_FIXTURES['order.StatusPage'];
    const steps = (state: string, mode: 'delivery' | 'pickup') => {
      const html = renderToStaticMarkup(
        <C {...fx} order={{ ...fx.order, state, delivery: { ...fx.order.delivery, mode } }} />,
      );
      const track = html.match(/<ol class="v-order-progress"[^]*?<\/ol>/)?.[0];
      if (!track) return null;
      return [...track.matchAll(/data-state="(\w+)"><span>([^<]+)/g)].map((m) => `${m[2]}:${m[1]}`);
    };
    expect(steps('ready', 'delivery')).toEqual([
      'Recebido:done',
      'Confirmado:done',
      'Preparo:done',
      'Pronto:current',
      'A caminho:todo',
      'Entregue:todo',
    ]);
    expect(steps('ready', 'pickup')).toEqual([
      'Recebido:done',
      'Confirmado:done',
      'Preparo:done',
      'Pronto:current',
      'Retirado:todo',
    ]);
    expect(steps('cancelled', 'delivery')).toBeNull();
  });

  test('a blocking notice is never dismissible; kind and severity are stamped', () => {
    const C = SLOT_DEFAULTS['system.Notice'];
    const fx = SLOT_FIXTURES['system.Notice'];
    const promo = renderToStaticMarkup(<C {...fx} />);
    expect(promo).toContain('data-part="dismiss"');
    expect(promo).toContain('data-kind="promo"');
    expect(promo).toContain('data-severity="info"');
    const blocking = renderToStaticMarkup(
      <C {...fx} notice={{ ...fx.notice, severity: 'blocking', dismissible: true }} />,
    );
    expect(blocking).not.toContain('data-part="dismiss"');
    expect(blocking).toContain('data-severity="blocking"');
    expect(blocking).toContain('role="alertdialog"');
    const emergency = renderToStaticMarkup(
      <C {...fx} notice={{ ...fx.notice, kind: 'emergency', severity: 'info' }} />,
    );
    expect(emergency).not.toContain('data-part="dismiss"');
  });

  test('instants read in the store’s zone, not the process’s', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Asia/Tokyo');
    const T = SLOT_DEFAULTS['order.Timeline'];
    const events = [{ at: '2026-09-26T15:00:00Z', from: null, to: 'placed', actor: 'x', meta: {} }];
    const tokyo = tags(renderToStaticMarkup(<T events={events} timeZone="Asia/Tokyo" />));
    expect(tokyo).toContain('27 de set., 00:00');
    expect(tags(renderToStaticMarkup(<T events={events} />))).not.toBe(tokyo);
    // the pause notice says the next instant in the store's words and zone
    setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const P = SLOT_DEFAULTS['system.PauseNotice'];
    const fx = SLOT_FIXTURES['system.PauseNotice'];
    const at = (timeZone: string) =>
      tags(
        renderToStaticMarkup(<P {...fx} resumesAt="2026-09-26T21:00:00Z" timeZone={timeZone} />),
      );
    expect(at('America/Sao_Paulo')).toContain('Volta hoje às 18:00');
    expect(at('Asia/Tokyo')).toContain('Volta amanhã às 06:00');
  });

  test('product cards flag low stock and encomendas, not plain items', () => {
    const C = SLOT_DEFAULTS['catalog.ProductCard'];
    const fx = SLOT_FIXTURES['catalog.ProductCard'];
    const card = (extra: object) =>
      renderToStaticMarkup(<C {...fx} product={{ ...fx.product, ...extra }} />);
    expect(card({})).not.toContain('data-part="badge"');
    expect(
      renderToStaticMarkup(
        <C {...fx} product={{ ...fx.product, lowStock: true, stockQuantity: 2 }} stockLeft={2} />,
      ),
    ).toContain('Últimas 2');
    expect(card({ requiresPreorder: true })).toContain('Encomenda');
  });

  test('Kernel 1.21: cards show what a product is (diets), never its allergen warnings', () => {
    const C = SLOT_DEFAULTS['catalog.ProductCard'];
    const fx = SLOT_FIXTURES['catalog.ProductCard'];
    const html = renderToStaticMarkup(
      <C
        {...fx}
        product={{ ...fx.product, dietary: ['contem_ovo', 'sem_lactose', 'vegano', 'novo_tag'] }}
      />,
    );
    expect(tags(html)).toContain('VeganoSem lactose');
    expect(html).not.toContain('Contém ovo');
    expect(html).not.toContain('novo_tag');
    expect(renderToStaticMarkup(<C {...fx} />)).not.toContain('data-part="dietary"');
  });

  test('Kernel 1.21: the address form offers the saved addresses, then "Outro endereço"', () => {
    const C = SLOT_DEFAULTS['checkout.AddressForm'];
    const fx = SLOT_FIXTURES['checkout.AddressForm'];
    const html = renderToStaticMarkup(
      <C
        {...fx}
        part="address"
        savedAddresses={[
          { id: '0', label: 'Rua A, 10 — Centro', detail: 'Portão azul' },
          { id: '1', label: 'Rua B, 2 — Praia' },
        ]}
        savedAddressId="1"
        onPickAddress={() => {}}
      />,
    );
    expect(tags(html)).toContain('Rua A, 10 — CentroPortão azulRua B, 2 — PraiaOutro endereço');
    expect(html).toMatch(/checked="" value="1"/);
    expect(renderToStaticMarkup(<C {...fx} part="address" />)).not.toContain('saved-address');
  });

  test('one badge per card, by the Kernel’s priority; low stock is what the bag leaves', () => {
    const C = SLOT_DEFAULTS['catalog.ProductCard'];
    const fx = SLOT_FIXTURES['catalog.ProductCard'];
    const card = (extra: object, stockLeft?: number) =>
      renderToStaticMarkup(
        <C
          {...fx}
          product={{ ...fx.product, stockQuantity: 5, lowStockThreshold: 3, ...extra }}
          {...(stockLeft === undefined ? {} : { stockLeft })}
        />,
      );
    const badge = (html: string) => html.match(/data-badge="([^"]+)"/)?.[1] ?? null;
    // 5 in stock, 3 of them in the bag: Core's threshold reads the 2 left
    expect(badge(card({}, 5))).toBeNull();
    expect(tags(card({}, 2))).toContain('Últimas 2');
    expect(tags(card({}, 1))).toContain('Última unidade');
    // an encomenda running low or all in the bag says the stock first
    expect(badge(card({ requiresPreorder: true }, 5))).toBe('preorder');
    expect(badge(card({ requiresPreorder: true }, 2))).toBe('low-stock');
    expect(badge(card({ requiresPreorder: true }, 0))).toBe('all-in-bag');
    expect(tags(card({ requiresPreorder: true }, 0))).toContain('Tudo na sacola');
    // sold out wins, and says so in the price row (with Core's schedule when it has one)
    const sold = card({ status: 'sold_out', availabilityLabel: 'Só sábados' }, 0);
    expect(badge(sold)).toBeNull();
    expect(sold).toContain('data-part="availability"');
    expect(tags(sold)).toContain('Só sábados');
    // the store's word for the bag
    const words = renderToStaticMarkup(
      <C
        {...fx}
        product={{ ...fx.product, stockQuantity: 1 }}
        stockLeft={0}
        vocabulary={vocabularyOf({ vocabulary: { itemSingular: 'doce', bag: 'cesta' } })}
      />,
    );
    expect(tags(words)).toContain('Tudo na cesta');
    const masculine = renderToStaticMarkup(
      <C
        {...fx}
        product={{ ...fx.product, stockQuantity: 1 }}
        stockLeft={0}
        vocabulary={vocabularyOf({ vocabulary: { bag: 'carrinho' } })}
      />,
    );
    expect(tags(masculine)).toContain('Tudo no carrinho');
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

  test('the encomenda calendar’s today is the store’s; earlier days are not offered', () => {
    const C = SLOT_DEFAULTS['checkout.SchedulePicker'];
    const fx = SLOT_FIXTURES['checkout.SchedulePicker'];
    // 02:00 UTC on the 30th: still the 29th in São Paulo, already midday in Tokyo
    setSystemTime(new Date('2026-09-30T02:00:00Z'));
    const day = (html: string, d: string) =>
      html.match(new RegExp(`<button[^>]*data-date="${d}"[^>]*>`))![0];
    const sp = renderToStaticMarkup(<C {...fx} timezone="America/Sao_Paulo" />);
    expect(day(sp, '2026-09-29')).toContain('data-today="true"');
    expect(day(sp, '2026-09-29')).not.toContain('aria-disabled');
    const tokyo = renderToStaticMarkup(<C {...fx} timezone="Asia/Tokyo" />);
    expect(day(tokyo, '2026-09-30')).toContain('data-today="true"');
    expect(day(tokyo, '2026-09-29')).toContain('aria-disabled="true"');
    expect(tags(tokyo)).toContain('Encomendas pedem 2 dias de antecedência.');
  });

  test('phone and CEP fields show the mask they promise', () => {
    const C = SLOT_DEFAULTS['checkout.AddressForm'];
    const fx = SLOT_FIXTURES['checkout.AddressForm'];
    expect(renderToStaticMarkup(<C {...fx} part="customer" />)).toContain(
      'value="(22) 99999-0000"',
    );
    // AddressForm has no hooks: call it and drive the CEP input's handler
    const changes: object[] = [];
    const looked: string[] = [];
    const tree = (C as (p: typeof fx) => ReactElement)({
      ...fx,
      onChange: (p) => changes.push(p),
      onCep: (d) => looked.push(d),
    });
    const find = (n: unknown): ReactElement | null => {
      if (!n || typeof n !== 'object') return null;
      if (Array.isArray(n)) return n.map(find).find(Boolean) ?? null;
      const el = n as ReactElement<{ name?: string; children?: unknown }>;
      if (el.props?.name === 'cep') return el;
      return find(el.props?.children);
    };
    const input = find(tree) as ReactElement<{ onChange: (e: unknown) => void }>;
    input.props.onChange({ target: { value: '28990' } });
    input.props.onChange({ target: { value: '28990-12' } });
    input.props.onChange({ target: { value: '28990123' } });
    expect(changes).toEqual([{ cep: '28990' }, { cep: '28990-12' }, { cep: '28990-123' }]);
    expect(looked).toEqual(['28990123']);
  });

  test('a coupon that doesn’t apply says why, with what is missing', () => {
    const C = SLOT_DEFAULTS['checkout.CouponField'];
    const fx = SLOT_FIXTURES['checkout.CouponField'];
    const why = (reason: string, details?: Record<string, unknown>) =>
      tags(
        renderToStaticMarkup(
          <C
            {...fx}
            coupon={{ ...fx.coupon!, applies: false, reason, ...(details ? { details } : {}) }}
          />,
        ),
      );
    expect(why('COUPON_MIN_SUBTOTAL', { remainingCents: 1250 })).toMatch(
      /Faltam R\$\s12,50 para usar este cupom\./,
    );
    expect(why('COUPON_EXPIRED')).toContain('Esse cupom expirou');
    expect(why('SOMETHING_NEW')).toContain('Este cupom não vale agora.');
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

  test('the store chat names who speaks and links only what the Kernel resolves', () => {
    const C = SLOT_DEFAULTS['system.Chat'];
    const fx = SLOT_FIXTURES['system.Chat'];
    const html = renderToStaticMarkup(
      <C
        {...fx}
        messages={[
          ...fx.messages,
          {
            id: 'x1',
            author: 'agent',
            body: 'Veja https://outra.example/sacola.',
            at: '2026-09-26T21:01:00Z',
            card: null,
          },
          {
            id: 'x2',
            author: 'merchant',
            body: 'Oi, aqui é a Ana.',
            at: '2026-09-26T21:02:00Z',
            card: null,
          },
        ]}
        resolveLink={(u) => (u.includes('doces.vendua.test') ? '/sacola' : null)}
        vocabulary={vocabularyOf({ vocabulary: { bag: 'carrinho' } })}
      />,
    );
    expect(html).toContain('data-vendua="chat"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('href="/sacola"');
    expect(html).not.toContain('href="https://outra.example');
    expect(tags(html)).toContain('Veja https://outra.example/sacola.');
    expect(tags(html)).toContain('Oi! Aqui é Bia, assistente virtual da Doces da Ana.');
    expect(html).toContain('data-author="merchant"');
    expect(tags(html)).toContain('Doces da Ana');
    expect(tags(html)).toContain('Bia está digitando…');
    expect(tags(html)).toContain('Bia pode montar seu carrinho com você.');
    expect(html).toContain('data-part="unread"');
  });
});
