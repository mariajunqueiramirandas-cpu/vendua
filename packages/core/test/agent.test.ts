import { describe, expect, test } from 'bun:test';
import { resolveMaxSteps } from '../src/agent/runner.ts';
import { DEFAULT_GUARDRAILS, type Guardrails } from '../src/modules/integrations.ts';

const g = (over: Partial<Guardrails> = {}): Guardrails => ({ ...DEFAULT_GUARDRAILS, ...over });

describe('resolveMaxSteps', () => {
  test('run param beats guardrails', () => {
    expect(resolveMaxSteps({ maxSteps: 5 }, g({ maxSteps: 30 }))).toBe(5);
  });
  test('guardrails value used when param absent', () => {
    expect(resolveMaxSteps({}, g({ maxSteps: 30 }))).toBe(30);
  });
  test('non-finite or non-number param falls through to guardrails', () => {
    expect(resolveMaxSteps({ maxSteps: '9' }, g({ maxSteps: 30 }))).toBe(30);
    expect(resolveMaxSteps({ maxSteps: Number.NaN }, g({ maxSteps: 30 }))).toBe(30);
    expect(resolveMaxSteps({ maxSteps: Number.POSITIVE_INFINITY }, g({ maxSteps: 30 }))).toBe(30);
  });
  test('no param, no stored value → default 12', () => {
    expect(resolveMaxSteps({}, g())).toBe(12);
  });
  test('0 or negative = uncapped (Infinity)', () => {
    expect(resolveMaxSteps({ maxSteps: 0 }, g())).toBe(Number.POSITIVE_INFINITY);
    expect(resolveMaxSteps({ maxSteps: -3 }, g())).toBe(Number.POSITIVE_INFINITY);
    expect(resolveMaxSteps({}, g({ maxSteps: 0 }))).toBe(Number.POSITIVE_INFINITY);
  });
});
