import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ORDER_STATES, canTransition, type DeliveryMode } from '../src/modules/orders.ts';

const MODES: DeliveryMode[] = ['delivery', 'pickup'];

describe('order transitions by delivery mode', () => {
  test('a pickup order never goes out for delivery, from any state', () => {
    for (const from of ORDER_STATES)
      expect(canTransition(from, 'out_for_delivery', 'pickup')).toBe(false);
    expect(canTransition('ready', 'out_for_delivery', 'delivery')).toBe(true);
    expect(canTransition('ready', 'delivered', 'pickup')).toBe(true);
    expect(canTransition('ready', 'delivered', 'delivery')).toBe(true);
  });

  test('only out_for_delivery depends on the mode', () => {
    for (const from of ORDER_STATES)
      for (const to of ORDER_STATES)
        if (to !== 'out_for_delivery')
          expect(canTransition(from, to, 'pickup')).toBe(canTransition(from, to, 'delivery'));
    // a pickup order already out (moved before the rule) can still be finished
    expect(canTransition('out_for_delivery', 'delivered', 'pickup')).toBe(true);
    expect(canTransition('out_for_delivery', 'cancelled', 'pickup')).toBe(true);
  });

  // The Kernel's orderPath (the steps a shopper's progress shows) must be a path Core accepts.
  test("every step of the Kernel's orderPath is a transition Core allows", async () => {
    // a computed specifier: tsc here doesn't compile the Kernel's sources
    const file = join(import.meta.dir, '../../kernel/src/rules/orders.ts');
    const { orderPath } = (await import(file)) as {
      orderPath: (mode: DeliveryMode) => readonly string[];
    };
    for (const mode of MODES) {
      const path = orderPath(mode);
      expect(path[0]).toBe('placed');
      expect(path.at(-1)).toBe('delivered');
      expect(path.includes('out_for_delivery')).toBe(mode === 'delivery');
      for (let i = 1; i < path.length; i++) {
        const [from, to] = [path[i - 1], path[i]] as [
          (typeof ORDER_STATES)[number],
          (typeof ORDER_STATES)[number],
        ];
        expect({ mode, from, to, ok: canTransition(from, to, mode) }).toEqual({
          mode,
          from,
          to,
          ok: true,
        });
      }
    }
  });
});
