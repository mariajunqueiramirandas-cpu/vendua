import { describe, expect, test } from 'bun:test';
import { initialState } from '@vendua/agent-runtime';
import {
  ledgerPromises,
  allergenClaims,
  noTypedLinks,
  soldOutOffers,
} from '../src/agent-host/agents/vendedor/guards.ts';
import { finished, applyCustom, INITIAL } from '../src/agent-host/agents/vendedor/fold.ts';
import { floorOf } from '../src/vendedor/floor.ts';
import { cartHash, readAnswer, unusualOrder } from '../src/vendedor/gate.ts';
import { compileRule, parseMoney } from '../src/vendedor/knowledge.ts';
import { DEFAULT_SETTINGS, parseSettingsPatch, withDefaults } from '../src/vendedor/settings.ts';
import { readsAsShopper, triggerOf } from '../src/vendedor/signals.ts';
import { maskPhone } from '../src/vendedor/threads.ts';
import { claim } from '../src/platform/http.ts';
import type { CartView } from '../src/modules/cart.ts';

const cart = (over: Partial<CartView['totals']> = {}, qty = 1): CartView =>
  ({
    id: 'c',
    status: 'open',
    items: [
      {
        id: 'i1',
        productId: 'p1',
        slug: 'pizza',
        name: 'Pizza',
        qty,
        unitPriceCents: 4200,
        productStatus: 'active',
        modifiers: [{ id: 'm1', name: 'Catupiry', priceDeltaCents: 900, qty: 1, status: 'active' }],
        modifierIds: ['m1'],
        modifierQty: {},
        combo: [],
        comboSelections: [],
        lineTotalCents: 4200 * qty,
        imageUrl: null,
        stockQuantity: null,
        requiresPreorder: false,
        preorderLeadDays: 0,
      },
    ],
    totals: {
      subtotalCents: 4200 * qty,
      deliveryFeeCents: 0,
      discountCents: 0,
      paymentAdjustmentCents: 0,
      totalCents: 4200 * qty,
      itemCount: qty,
      minOrderCents: 0,
      remainingMinOrderCents: 0,
      belowMinOrder: false,
      freeDeliveryThresholdCents: null,
      freeDeliveryRemainingCents: null,
      ...over,
    },
    delivery: { mode: 'pickup' },
    coupon: null,
    schedule: { required: false, leadDays: 0, dates: [], paymentMethods: [] },
  }) as CartView;

describe('the confirmation gate', () => {
  test('a yes is read deterministically; doubts and changes are not a yes', () => {
    for (const y of ['sim', 'Sim!', 'pode', 'pode sim', 'confirmo'])
      expect(readAnswer(y)).toBe('plain_yes');
    for (const y of [
      'isso mesmo',
      'manda',
      'fechado',
      'ok',
      'beleza',
      '👍',
      'pode mandar',
      'sim, pode mandar',
    ])
      expect(readAnswer(y)).not.toBe('other');
    for (const n of [
      'não',
      'sim mas tira a cebola',
      'pode trocar a borda?',
      'quanto fica?',
      'espera',
      '',
      'sim '.repeat(30),
      '😡',
    ])
      expect(readAnswer(n)).toBe('other');
  });

  test('the hash moves with any price, option, total, payment or fulfilment change', () => {
    const base = cartHash(cart(), { payment: { method: 'pix' } });
    expect(cartHash(cart(), { payment: { method: 'pix' } })).toBe(base);
    expect(cartHash(cart({ totalCents: 4300 }), { payment: { method: 'pix' } })).not.toBe(base);
    expect(cartHash(cart({}, 2), { payment: { method: 'pix' } })).not.toBe(base);
    expect(cartHash(cart(), { payment: { method: 'cash' } })).not.toBe(base);
    expect(cartHash(cart(), { payment: { method: 'cash', changeForCents: 5000 } })).not.toBe(
      cartHash(cart(), { payment: { method: 'cash' } }),
    );
    expect(
      cartHash(
        { ...cart(), delivery: { mode: 'delivery', street: 'Rua A', number: '1' } },
        { payment: { method: 'pix' } },
      ),
    ).not.toBe(base);
  });

  test('an unusual order needs a plain yes', () => {
    expect(unusualOrder(cart({}, 12), 5000).unusual).toBe(true);
    expect(unusualOrder(cart({ totalCents: 50_000 }), 5_000).unusual).toBe(true);
    expect(unusualOrder(cart(), 5000).unusual).toBe(false);
  });
});

describe('who holds the floor', () => {
  const agent = (coverage: string, enabled = true) => ({
    enabled,
    settings: { ...DEFAULT_SETTINGS, coverage: coverage as never },
  });
  const t = (over: Record<string, unknown> = {}) => ({
    owner: 'open' as const,
    humanUntil: null,
    pendingSince: null,
    class: 'shopper' as const,
    channel: 'whatsapp' as const,
    ...over,
  });
  const now = new Date('2026-10-03T20:00:00Z');
  test('coverage modes', () => {
    expect(floorOf(t(), agent('always'), true, now).floor).toBe('agent');
    expect(floorOf(t(), agent('rehearsal'), true, now).floor).toBe('rehearsal');
    expect(floorOf(t(), agent('after_hours'), true, now).floor).toBe('store');
    expect(floorOf(t(), agent('after_hours'), false, now).floor).toBe('agent');
    expect(
      floorOf(t({ pendingSince: new Date(now.getTime() - 60_000) }), agent('when_slow'), true, now),
    ).toEqual({
      floor: 'wait',
      until: new Date(now.getTime() + 60_000),
    });
    expect(
      floorOf(
        t({ pendingSince: new Date(now.getTime() - 3 * 60_000) }),
        agent('when_slow'),
        true,
        now,
      ).floor,
    ).toBe('agent');
    expect(floorOf(t(), agent('when_slow'), false, now).floor).toBe('agent');
    expect(floorOf(t(), agent('always', false), true, now).floor).toBe('off');
  });
  test('a person, a mute, a non-shopper', () => {
    expect(
      floorOf(
        t({ owner: 'human', humanUntil: new Date(now.getTime() + 1) }),
        agent('always'),
        true,
        now,
      ).floor,
    ).toBe('store');
    expect(
      floorOf(
        t({ owner: 'human', humanUntil: new Date(now.getTime() - 1) }),
        agent('always'),
        true,
        now,
      ).floor,
    ).toBe('agent');
    expect(floorOf(t({ owner: 'muted' }), agent('always'), true, now).floor).toBe('muted');
    expect(floorOf(t({ class: 'other' }), agent('always'), true, now).floor).toBe('off');
    expect(floorOf(t({ channel: 'test' }), agent('rehearsal', false), true, now).floor).toBe(
      'agent',
    );
  });
});

describe('triggers and rules', () => {
  test('code triggers', () => {
    const on = { complaint: true, allergy: true };
    expect(triggerOf('quero falar com um atendente', on)).toBe('pediu uma pessoa');
    expect(triggerOf('meu pedido veio errado', on)).toBe('reclamação');
    expect(triggerOf('tenho alergia a amendoim', on)).toBe('alergia');
    expect(triggerOf('tenho alergia a amendoim', { complaint: true, allergy: false })).toBeNull();
    expect(triggerOf('uma calabresa por favor', on)).toBeNull();
    expect(readsAsShopper('segue o boleto da semana')).toBe(false);
    expect(readsAsShopper('boa noite, tem pizza?')).toBe(true);
  });
  test('rules the system can enforce compile; the rest is guidance', () => {
    expect(parseMoney('não aceite dinheiro acima de R$ 200')).toBe(20000);
    expect(parseMoney('pedido acima de 1.200,50 reais')).toBe(120050);
    expect(compileRule('Não aceite dinheiro acima de R$ 200')).toEqual({
      kind: 'cash_max',
      cents: 20000,
    });
    expect(compileRule('Não ofereça cupom para pedido abaixo de R$ 40')).toEqual({
      kind: 'coupon_min',
      cents: 4000,
    });
    expect(compileRule('Pedidos com mais de 10 pizzas: passe para mim')).toEqual({
      kind: 'handoff_qty',
      min: 11,
      term: 'pizza',
    });
    expect(compileRule('Pedido acima de R$ 300 me chame')).toEqual({
      kind: 'handoff_above',
      cents: 30000,
    });
    expect(compileRule('Nunca ofereça borda doce em pizza salgada')).toBeNull();
  });
});

describe('settings', () => {
  test('defaults fill an old row; patches are bounded and role-gated', () => {
    expect(withDefaults({ name: 'Bia' }).coverage).toBe('when_slow');
    const p = parseSettingsPatch(
      { name: 'Bia', coverage: 'always', slowAfterMin: 5 },
      DEFAULT_SETTINGS,
      'manager',
    );
    expect(p.settings).toMatchObject({ name: 'Bia', coverage: 'always', slowAfterMin: 5 });
    expect(() => parseSettingsPatch({ slowAfterMin: 3 }, DEFAULT_SETTINGS, 'manager')).toThrow();
    expect(() => parseSettingsPatch({ nope: 1 }, DEFAULT_SETTINGS, 'manager')).toThrow();
    expect(() => parseSettingsPatch({ enabled: true }, DEFAULT_SETTINGS, 'manager')).toThrow();
    expect(() =>
      parseSettingsPatch({ capabilities: { coupons: true } }, DEFAULT_SETTINGS, 'manager'),
    ).toThrow();
    expect(parseSettingsPatch({ enabled: true }, DEFAULT_SETTINGS, 'owner').enabled).toBe(true);
    expect(() => parseSettingsPatch({ name: 'x'.repeat(31) }, DEFAULT_SETTINGS, 'owner')).toThrow();
  });
  test('phones are masked', () => {
    expect(maskPhone('11987654821')).toBe('(11) 9••••-4821');
    expect(maskPhone('+351912345678')).toBe('+351••••5678');
  });
});

describe('the verifier', () => {
  const ctx = (
    raw: string,
    ledger: Record<string, { value: unknown }> = {},
    catalog: string[] = [],
  ) => {
    const s = initialState('browsing', INITIAL as never);
    for (const [id, f] of Object.entries(ledger))
      s.ledger[id] = { id, value: f.value as never, text: '', kind: 'money', sourceSeq: 1 };
    s.context.tenant = { catalog } as never;
    return {
      state: s,
      raw,
      gateway: null as never,
      meta: { tenantId: 't', agentId: 'vendedor', actorId: 'a', turnId: 'x' },
    };
  };
  test('promises the ledger backs pass; others are blocked', async () => {
    expect((await ledgerPromises.run('', ctx('A entrega é grátis!'))).ok).toBe(false);
    expect(
      (await ledgerPromises.run('', ctx('A entrega é grátis!', { 'cart.fee': { value: 0 } }))).ok,
    ).toBe(true);
    expect((await ledgerPromises.run('', ctx('Te dou um desconto especial'))).ok).toBe(false);
    expect((await ledgerPromises.run('', ctx('Vou te reembolsar'))).ok).toBe(false);
    expect((await allergenClaims.run('', ctx('Essa pizza é sem glúten'))).ok).toBe(false);
    expect((await allergenClaims.run('', ctx('Essa pizza é {{pizza.diet}}'))).ok).toBe(true);
    expect((await noTypedLinks.run('', ctx('Peça em www.loja.com.br'))).ok).toBe(false);
  });
  test('a sold-out product is not offered, but saying it ran out is fine', async () => {
    const cat = ['pizza-x · Pizza Portuguesa · R$ 40,00 · esgotado'];
    expect((await soldOutOffers.run('', ctx('Quer uma Pizza Portuguesa?', {}, cat))).ok).toBe(
      false,
    );
    expect((await soldOutOffers.run('', ctx('Não temos Pizza Portuguesa hoje.', {}, cat))).ok).toBe(
      true,
    );
  });
});

describe('the fold', () => {
  test('a turn is done when the shopper was answered, by it or by the store', () => {
    const s = initialState('browsing', INITIAL as never);
    s.context.subject = { floor: 'agent' } as never;
    s.custom = applyCustom(s.custom, {
      actorId: 'a',
      tenantId: 't',
      seq: 1,
      turnId: 'u1',
      step: null,
      version: 'v',
      at: new Date('2026-10-03T20:00:00Z'),
      type: 'turn.started',
      payload: {
        batch: [
          {
            id: 'm',
            kind: 'message.inbound',
            source: 'whatsapp',
            payload: { at: '2026-10-03T20:00:00.000Z' },
            input: null,
          },
        ],
      },
    });
    expect(finished(s)).toBe(false);
    s.lastReplyAt = '2026-10-03T20:00:05.000Z';
    expect(finished(s)).toBe(true);
    s.lastReplyAt = null;
    s.context.subject = { floor: 'store' } as never;
    expect(finished(s)).toBe(true);
  });
});

test("a client key can't take an internal claim's namespace", async () => {
  const run = async () => ({ status: 200, body: null });
  await expect(
    claim(null as never, crypto.randomUUID(), 'vendedor:t:c:r1:h', 'f', run),
  ).rejects.toMatchObject({ status: 400 });
});
