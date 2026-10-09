import { describe, expect, test } from 'bun:test';
import { routesFrom } from '../src/agent-host/models.ts';

describe('routesFrom', () => {
  test('a route must say whether it wants zero retention (AGENT_MODEL_ROUTES skips validation)', () => {
    const setting = {
      default: {
        fast: [
          { provider: 'openrouter', model: 'a/one', zdr: true },
          { provider: 'openrouter', model: 'a/two', zdr: false },
          { provider: 'openrouter', model: 'a/three' },
          { provider: 'openrouter', model: 'a/four', zdr: 'true' },
        ],
      },
    } as never;
    expect(routesFrom(setting, 't', 'vendedor', 'fast').map((r) => r.model)).toEqual([
      'a/one',
      'a/two',
    ]);
  });

  test('anthropic routes run and price claude-haiku-5-5; effort only where it is valid', () => {
    const setting = {
      default: {
        fast: [
          {
            provider: 'anthropic',
            model: 'claude-opus-5',
            zdr: true,
            effort: 'high',
            pricing: { inputPerMTok: 5, outputPerMTok: 25 },
          },
          { provider: 'anthropic', model: 'claude-haiku-5-5', zdr: true, effort: 'huge' },
          { provider: 'openrouter', model: 'a/one', zdr: true, effort: 'high' },
        ],
      },
    } as never;
    expect(routesFrom(setting, 't', 'vendedor', 'fast')).toEqual([
      {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        zdr: true,
        effort: 'high',
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
      },
      {
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        zdr: true,
        pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5 },
      },
      { provider: 'openrouter', model: 'a/one', zdr: true },
    ]);
  });
});
