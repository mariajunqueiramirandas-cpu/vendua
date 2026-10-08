// @ts-nocheck -- apps/control has no @types/bun, and its tsc includes every .ts; run with `bun test`
import { describe, expect, test } from 'bun:test';
import { parseMoney } from './format.ts';

describe('parseMoney', () => {
  test('pt-BR thousands and decimals', () => {
    expect(parseMoney('1.500')).toBe(150_000);
    expect(parseMoney('1.500,00')).toBe(150_000);
    expect(parseMoney('R$ 1.234,56')).toBe(123_456);
    expect(parseMoney('49,9')).toBe(4990);
  });
  test('a dot followed by cents is the decimal separator', () => {
    expect(parseMoney('49.90')).toBe(4990);
  });
  test('garbage is null', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
  });
});
