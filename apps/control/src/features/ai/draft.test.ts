// @ts-nocheck -- apps/control has no @types/bun, and its tsc includes every .ts; run with `bun test`
import { describe, expect, test } from 'bun:test';
import {
  bestValueEndpoint,
  blendedPrice,
  emptyRoute,
  rankEndpoints,
  routePaths,
  routesFromView,
  routesOut,
  validateRoutes,
  valueScore,
  withEndpoint,
  withOption,
  withProvider,
  withZdr,
} from './draft.ts';

const ep = (tag, input, output, tps, zdr = true) => ({
  tag,
  provider: tag.split('/')[0],
  pricing: { inputPerMTok: input, outputPerMTok: output },
  tps,
  latencyMs: null,
  uptime: null,
  zdr,
});

describe('value ranking', () => {
  test('blendedPrice weighs input 3:1', () => {
    expect(blendedPrice({ inputPerMTok: 1, outputPerMTok: 5 })).toBe(2);
  });

  test('valueScore is tokens/s per blended dollar, null without a sample', () => {
    expect(valueScore(ep('a', 1, 5, 100))).toBe(50);
    expect(valueScore(ep('a', 1, 5, null))).toBeNull();
    expect(valueScore(ep('a', 1, 5, 0))).toBeNull();
  });

  test('a free endpoint is floored, finite and ranks by its speed', () => {
    expect(valueScore(ep('free', 0, 0, 30))).toBe(3000);
    expect(rankEndpoints([ep('free', 0, 0, 30), ep('freer', 0, 0, 60)]).map((e) => e.tag)).toEqual([
      'freer',
      'free',
    ]);
  });

  test('rank: best value first, unmeasured last by price', () => {
    const list = [
      ep('slow', 0.1, 0.4, null),
      ep('fast/dear', 2, 8, 200), // 200 / 3.5
      ep('cheap', 0.2, 0.6, 40), // 40 / 0.3
      ep('cheaper', 0.05, 0.2, null),
    ];
    expect(rankEndpoints(list).map((e) => e.tag)).toEqual([
      'cheap',
      'fast/dear',
      'cheaper',
      'slow',
    ]);
  });

  test('best respects ZDR and needs a measurement', () => {
    const list = [ep('leaky', 0.1, 0.1, 500, false), ep('safe', 1, 1, 50)];
    expect(bestValueEndpoint(list, false)?.tag).toBe('leaky');
    expect(bestValueEndpoint(list, true)?.tag).toBe('safe');
    expect(bestValueEndpoint([ep('a', 1, 1, null)], false)).toBeNull();
    expect(bestValueEndpoint([ep('leaky', 1, 1, 50, false)], true)).toBeNull();
    expect(bestValueEndpoint([], false)).toBeNull();
  });
});

describe('endpoint on a route', () => {
  const models = [
    {
      id: 'm/x',
      name: 'X',
      contextLength: null,
      pricing: { inputPerMTok: 1, outputPerMTok: 2 },
      zdr: { providers: 2, pricing: { inputPerMTok: 1.5, outputPerMTok: 3 } },
      direct: null,
    },
  ];
  const endpoints = [ep('deepinfra/turbo', 0.5, 1, 90), ep('other', 2, 4, 30)];
  const base = {
    ...emptyRoute(),
    provider: 'openrouter',
    model: 'm/x',
    zdr: true,
    inputPerMTok: '1.5',
    outputPerMTok: '3',
  };

  test('pinning follows the endpoint price, unpinning goes back to routing', () => {
    const pinned = withEndpoint(base, 'deepinfra/turbo', endpoints, models);
    expect(pinned.endpoint).toBe('deepinfra/turbo');
    expect([pinned.inputPerMTok, pinned.outputPerMTok]).toEqual(['0.5', '1']);
    const back = withEndpoint(pinned, '', endpoints, models);
    expect([back.endpoint, back.inputPerMTok, back.outputPerMTok]).toEqual(['', '1.5', '3']);
  });

  test('a custom price stays', () => {
    const custom = { ...base, inputPerMTok: '9' };
    const pinned = withEndpoint(custom, 'other', endpoints, models);
    expect([pinned.endpoint, pinned.inputPerMTok]).toEqual(['other', '9']);
  });

  test('model, provider and ZDR changes', () => {
    const pinned = withEndpoint(base, 'other', endpoints, models);
    expect(withProvider(pinned, 'openai').endpoint).toBe('');
    expect(
      withOption(pinned, {
        model: 'm/y',
        name: 'Y',
        contextLength: null,
        pricing: { inputPerMTok: 1, outputPerMTok: 1 },
        verified: true,
      }).endpoint,
    ).toBe('');
    const off = withZdr(pinned, false, models);
    expect([off.endpoint, off.inputPerMTok]).toEqual(['other', '2']);
  });

  test('roundtrip and validation', () => {
    const view = {
      default: { fast: [{ provider: 'openrouter', model: 'm/x', zdr: true, endpoint: 'a/b' }] },
    };
    const d = routesFromView(view);
    expect(d.default.fast[0].endpoint).toBe('a/b');
    expect(routesOut(d)).toEqual(view);
    d.default.fast[0].endpoint = '';
    expect(routesOut(d).default.fast[0]).not.toHaveProperty('endpoint');
    d.default.fast[0] = { ...d.default.fast[0], provider: 'openai', endpoint: 'a/b' };
    expect(validateRoutes(d)['default.fast.0.endpoint']).toBeDefined();
    expect(routePaths(d).has('default.fast.0.endpoint')).toBe(true);
  });
});
