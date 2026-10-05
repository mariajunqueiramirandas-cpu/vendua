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
});
