import { describe, expect, test } from 'bun:test';
import { groupUnits, guestsMilli, lineReason, splitGroup } from '../src/modules/party-math.ts';

// Festa calculada (0126): the per-guest math is integers and always rounds up.

describe('party math', () => {
  test('children count by the store’s factor', () => {
    expect(guestsMilli(30, 10, 5000)).toBe(35_000);
    expect(guestsMilli(30, 3, 3333)).toBe(30_999);
    expect(guestsMilli(0, 4, 0)).toBe(0);
  });

  test('a group’s pieces round up', () => {
    // 15 salgados × 40 guests
    expect(groupUnits(40_000, 15_000)).toBe(600);
    // 1.5 docinhos × 35 guests = 52.5 → 53
    expect(groupUnits(35_000, 1_500)).toBe(53);
  });

  test('pieces split across picks, remainder first, rounded up to whole sales', () => {
    const lines = splitGroup('g', 601, [
      { productId: 'a', unitsPerSale: 100 },
      { productId: 'b', unitsPerSale: 100 },
      { productId: 'c', unitsPerSale: 50 },
    ]);
    expect(lines.map((l) => [l.productId, l.wanted, l.qty, l.units])).toEqual([
      ['a', 201, 3, 300],
      ['b', 200, 2, 200],
      ['c', 200, 4, 200],
    ]);
    // more picks than pieces: no line for nothing
    expect(
      splitGroup('g', 2, [
        { productId: 'a', unitsPerSale: 1 },
        { productId: 'b', unitsPerSale: 1 },
        { productId: 'c', unitsPerSale: 1 },
      ]).map((l) => l.productId),
    ).toEqual(['a', 'b']);
  });

  test('a line says why', () => {
    expect(lineReason('Salgados', 600, { qty: 2, wanted: 200 }, 100)).toBe(
      '200 de 600 salgados · 2 × 100',
    );
    expect(lineReason('Bolo', 2, { qty: 2, wanted: 2 }, 1)).toBe('2 bolo · 2');
  });
});
